import os
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime
from functools import wraps

from flask import (
    Flask, abort, flash, g, jsonify, redirect, render_template, request,
    session, url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from db import DATABASE, close_db, get_db, init_db

app = Flask(__name__)
app.teardown_appcontext(close_db)

APP_VERSION = "0.9.12"
SHARE_TOKEN_MAX_AGE_DAYS = 30

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB


def _ensure_secret_key():
    """Load or generate the Flask secret key from the database.
    Called at module load time (outside request context), so uses a direct connection.
    """
    import sqlite3 as _sqlite3
    db = _sqlite3.connect(DATABASE)
    db.row_factory = _sqlite3.Row
    row = db.execute("SELECT value FROM app_config WHERE key = 'secret_key'").fetchone()
    if row:
        app.secret_key = row['value']
    else:
        key = secrets.token_hex(32)
        db.execute("INSERT INTO app_config (key, value) VALUES ('secret_key', ?)", (key,))
        db.commit()
        app.secret_key = key


def _allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# --- Decorators ---

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('user_id'):
            return redirect(url_for('login'))
        db = get_db()
        g.user = db.execute("SELECT * FROM user WHERE id = ?", (session['user_id'],)).fetchone()
        if not g.user:
            session.clear()
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


def family_access_required(role=None):
    """Decorator for routes under /family/<int:fid>/...
    Sets g.family, g.membership. If role='admin', requires admin role."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            fid = kwargs.get('fid')
            db = get_db()
            g.family = db.execute("SELECT * FROM family WHERE id = ?", (fid,)).fetchone()
            if not g.family:
                abort(404)
            g.membership = db.execute(
                "SELECT * FROM family_membership WHERE user_id = ? AND family_id = ?",
                (session['user_id'], fid),
            ).fetchone()
            if not g.membership:
                abort(403)
            if role == 'admin' and g.membership['role'] != 'admin':
                abort(403)
            g.is_admin = g.membership['role'] == 'admin'
            return f(*args, **kwargs)
        return decorated
    return decorator


def family_view_required(f):
    """Decorator for read-only family routes.
    Allows both logged-in members and unauthenticated viewers (via share link session key).
    Sets g.view_only, g.family, g.membership, g.is_admin, g.share_token.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        fid = kwargs.get('fid')
        db = get_db()
        g.family = db.execute("SELECT * FROM family WHERE id = ?", (fid,)).fetchone()
        if not g.family:
            abort(404)
        share = db.execute(
            "SELECT * FROM family_share_token WHERE family_id = ?", (fid,)
        ).fetchone()
        g.share_token = share

        user_id = session.get('user_id')
        if user_id:
            g.user = db.execute("SELECT * FROM user WHERE id = ?", (user_id,)).fetchone()
            if not g.user:
                session.clear()
                return redirect(url_for('login'))
            g.membership = db.execute(
                "SELECT * FROM family_membership WHERE user_id = ? AND family_id = ?",
                (user_id, fid),
            ).fetchone()
            if g.membership:
                g.is_admin = g.membership['role'] == 'admin'
                g.view_only = False
                return f(*args, **kwargs)

        # Not logged in or not a member — check session view access
        view_access = session.get('family_view_access', {})
        if (str(fid) in view_access or fid in view_access) and share and not _token_expired(share):
            g.membership = None
            g.is_admin = False
            g.view_only = True
            return f(*args, **kwargs)

        # No access — send to join page if a share token exists, else login
        if share:
            return redirect(url_for('join_family', token=share['token']))
        return redirect(url_for('login'))
    return decorated


@app.context_processor
def inject_globals():
    from markupsafe import Markup
    csrf = session.get('csrf_token', '')
    csrf_field = Markup(f'<input type="hidden" name="csrf_token" value="{csrf}">')
    return {
        'app_version': APP_VERSION,
        'current_user': g.get('user'),
        'current_family': g.get('family'),
        'is_admin': g.get('is_admin', False),
        'membership': g.get('membership'),
        'view_only': g.get('view_only', False),
        'share_token': g.get('share_token'),
        'csrf_field': csrf_field,
    }


# --- CSRF protection ---

# Routes excluded from CSRF check (no session yet, or external token-based flow)
_CSRF_EXEMPT = {'/login', '/register'}

@app.before_request
def csrf_protect():
    """Ensure a CSRF token exists in the session and validate it on POST."""
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_hex(32)

    if request.method == 'POST':
        # Exempt login/register (no session when first submitting) and invite accept (token-based)
        path = request.path
        if path in _CSRF_EXEMPT or path.startswith('/join/'):
            return
        token = request.form.get('csrf_token') or request.headers.get('X-CSRF-Token')
        if not token or token != session.get('csrf_token'):
            abort(403)


# --- Rate limiting ---

_rate_limit_store = defaultdict(deque)  # key -> deque of timestamps
_RATE_LIMIT_MAX = 10  # max attempts
_RATE_LIMIT_WINDOW = 300  # per 5 minutes


def _rate_limited(key):
    """Return True if key has exceeded the rate limit."""
    now = time.monotonic()
    attempts = _rate_limit_store[key]
    while attempts and attempts[0] < now - _RATE_LIMIT_WINDOW:
        attempts.popleft()
    if len(attempts) >= _RATE_LIMIT_MAX:
        return True
    attempts.append(now)
    return False


def _audit(db, action, entity_type, entity_id, description, family_id=None):
    user_id = session.get('user_id')
    db.execute(
        "INSERT INTO audit_log (user_id, family_id, action, entity_type, entity_id, description) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, family_id, action, entity_type, entity_id, description),
    )


# --- Auth routes ---

@app.route('/register', methods=['GET', 'POST'])
def register():
    if session.get('user_id'):
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        ip = request.remote_addr or 'unknown'
        if _rate_limited(f'register:{ip}'):
            flash('Too many attempts. Please try again later.', 'error')
            return render_template('register.html', username='', display_name='')
        username = request.form.get('username', '').strip()
        display_name = request.form.get('display_name', '').strip() or None
        password = request.form.get('password', '')
        confirm = request.form.get('confirm_password', '')

        if not username or len(username) < 3:
            flash('Username must be at least 3 characters.', 'error')
            return render_template('register.html', username=username, display_name=display_name)
        if len(password) < 8:
            flash('Password must be at least 8 characters.', 'error')
            return render_template('register.html', username=username, display_name=display_name)
        if password != confirm:
            flash('Passwords do not match.', 'error')
            return render_template('register.html', username=username, display_name=display_name)

        db = get_db()
        existing = db.execute("SELECT id FROM user WHERE username = ?", (username,)).fetchone()
        if existing:
            flash('Username already taken.', 'error')
            return render_template('register.html', username=username, display_name=display_name)

        cursor = db.execute(
            "INSERT INTO user (username, password_hash, display_name) VALUES (?, ?, ?)",
            (username, generate_password_hash(password), display_name),
        )
        db.commit()
        user_id = cursor.lastrowid
        session.clear()
        session['user_id'] = user_id
        flash('Account created!', 'success')
        return redirect(url_for('dashboard'))
    return render_template('register.html', username='', display_name='')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('user_id'):
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        ip = request.remote_addr or 'unknown'
        if _rate_limited(f'login:{ip}'):
            flash('Too many attempts. Please try again later.', 'error')
            return render_template('login.html', username='')
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        db = get_db()
        user = db.execute("SELECT * FROM user WHERE username = ?", (username,)).fetchone()
        if user and check_password_hash(user['password_hash'], password):
            session.clear()
            session['user_id'] = user['id']
            return redirect(url_for('dashboard'))
        flash('Invalid username or password.', 'error')
        return render_template('login.html', username=username)
    return render_template('login.html', username='')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


# --- Dashboard ---

@app.route('/')
@login_required
def dashboard():
    db = get_db()
    families = db.execute("""
        SELECT f.*, fm.role
        FROM family f
        JOIN family_membership fm ON fm.family_id = f.id
        WHERE fm.user_id = ?
        ORDER BY f.name
    """, (session['user_id'],)).fetchall()
    return render_template('dashboard.html', families=families)


@app.route('/family/new', methods=['GET', 'POST'])
@login_required
def family_new():
    if request.method == 'POST':
        name = request.form.get('name', '').strip()
        if not name:
            flash('Family name is required.', 'error')
            return render_template('family_new.html', name='')
        db = get_db()
        cursor = db.execute("INSERT INTO family (name) VALUES (?)", (name,))
        family_id = cursor.lastrowid
        db.execute(
            "INSERT INTO family_membership (user_id, family_id, role) VALUES (?, ?, 'admin')",
            (session['user_id'], family_id),
        )
        db.commit()
        flash(f'Family "{name}" created!', 'success')
        return redirect(url_for('family_tree', fid=family_id))
    return render_template('family_new.html', name='')


# --- Account settings ---

@app.route('/settings', methods=['GET', 'POST'])
@login_required
def settings():
    if request.method == 'POST':
        display_name = request.form.get('display_name', '').strip() or None
        current_password = request.form.get('current_password', '')
        new_password = request.form.get('new_password', '')

        db = get_db()
        if new_password:
            if not check_password_hash(g.user['password_hash'], current_password):
                flash('Current password is incorrect.', 'error')
                return render_template('settings.html')
            if len(new_password) < 8:
                flash('New password must be at least 8 characters.', 'error')
                return render_template('settings.html')
            db.execute("UPDATE user SET password_hash = ?, display_name = ? WHERE id = ?",
                       (generate_password_hash(new_password), display_name, session['user_id']))
        else:
            db.execute("UPDATE user SET display_name = ? WHERE id = ?",
                       (display_name, session['user_id']))
        db.commit()
        flash('Settings saved.', 'success')
        return redirect(url_for('settings'))

    # Load family context from ?fid so header pill shows nav tabs
    fid = request.args.get('fid')
    if fid:
        db = get_db()
        family = db.execute("SELECT * FROM family WHERE id = ?", (fid,)).fetchone()
        if family:
            membership = db.execute(
                "SELECT * FROM family_membership WHERE user_id = ? AND family_id = ?",
                (session['user_id'], fid),
            ).fetchone()
            if membership:
                g.family = family
                g.membership = membership
                g.is_admin = membership['role'] == 'admin'

    return render_template('settings.html')


# --- Family-scoped routes ---

# Tree

@app.route('/family/<int:fid>')
@family_view_required
def family_tree(fid):
    db = get_db()
    has_people = db.execute("SELECT 1 FROM person WHERE family_id = ? LIMIT 1", (fid,)).fetchone() is not None
    return render_template('tree.html', people=has_people, fid=fid)


@app.route('/family/<int:fid>/api/tree')
@family_view_required
def api_tree(fid):
    db = get_db()
    people = {row['id']: dict(row) for row in db.execute(
        "SELECT * FROM person WHERE family_id = ?", (fid,)).fetchall()}
    rels = db.execute("SELECT * FROM relationship WHERE family_id = ?", (fid,)).fetchall()

    if not people:
        return jsonify(None)

    def _person_info(pid):
        p = people[pid]
        return {
            'id': pid,
            'name': f"{p['first_name']} {p['last_name']}",
            'birth_year': p['date_of_birth'][:4] if p['date_of_birth'] else None,
            'photo_path': p['photo_path'],
            'status': p['status'],
        }

    nodes = [_person_info(pid) for pid in people]

    couple_set = set()
    unions = []
    for r in rels:
        if r['rel_type'] in ('spouse', 'divorced'):
            p1, p2 = min(r['person1_id'], r['person2_id']), max(r['person1_id'], r['person2_id'])
            key = (p1, p2)
            if key not in couple_set:
                couple_set.add(key)
                unions.append({'uid': f"union_{p1}_{p2}", 'p1': p1, 'p2': p2})

    parents_of = defaultdict(list)
    for r in rels:
        if r['rel_type'] in ('parent_child', 'adopted_parent_child'):
            parents_of[r['person2_id']].append(r['person1_id'])

    edges = []
    for child_id, parent_ids in parents_of.items():
        if len(parent_ids) >= 2:
            p1, p2 = min(parent_ids[0], parent_ids[1]), max(parent_ids[0], parent_ids[1])
            if (p1, p2) in couple_set:
                edges.append({'from': f"union_{p1}_{p2}", 'child': child_id})
            else:
                for pid in parent_ids:
                    edges.append({'from': pid, 'child': child_id})
        else:
            edges.append({'from': parent_ids[0], 'child': child_id})

    return jsonify({'nodes': nodes, 'unions': unions, 'edges': edges})


@app.route('/family/<int:fid>/api/history')
@login_required
@family_access_required()
def api_history(fid):
    db = get_db()
    rows = db.execute(
        """SELECT al.action, al.entity_type, al.description, al.created_at,
                  u.display_name, u.username
           FROM audit_log al
           LEFT JOIN user u ON u.id = al.user_id
           WHERE al.family_id = ?
           ORDER BY al.id DESC LIMIT 200""",
        (fid,),
    ).fetchall()
    result = []
    for r in rows:
        entry = dict(r)
        entry['user'] = r['display_name'] or r['username'] or None
        del entry['display_name']
        del entry['username']
        result.append(entry)
    return jsonify(result)


# People

@app.route('/family/<int:fid>/people')
@family_view_required
def person_list(fid):
    search = request.args.get('q', '').strip()
    sort = request.args.get('sort', 'name')
    order = request.args.get('order', 'asc')

    allowed_sorts = {
        'name': 'last_name, first_name',
        'dob': 'date_of_birth',
        'place': 'place_of_birth',
    }
    order_clause = allowed_sorts.get(sort, 'last_name, first_name')
    direction = 'DESC' if order == 'desc' else 'ASC'
    order_sql = f"ORDER BY {order_clause} IS NULL, {order_clause} {direction}"

    db = get_db()
    if search:
        if g.get('view_only'):
            query = f"""
                SELECT * FROM person
                WHERE family_id = ? AND (
                    first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ?
                    OR birth_name_first LIKE ? OR birth_name_last LIKE ?
                    OR place_of_birth LIKE ?
                )
                {order_sql}
            """
            like = f'%{search}%'
            people = db.execute(query, (fid, like, like, like, like, like, like)).fetchall()
        else:
            query = f"""
                SELECT * FROM person
                WHERE family_id = ? AND (
                    first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ?
                    OR birth_name_first LIKE ? OR birth_name_last LIKE ?
                    OR place_of_birth LIKE ? OR email LIKE ?
                )
                {order_sql}
            """
            like = f'%{search}%'
            people = db.execute(query, (fid, like, like, like, like, like, like, like)).fetchall()
    else:
        people = db.execute(f"SELECT * FROM person WHERE family_id = ? {order_sql}", (fid,)).fetchall()
    return render_template('person_list.html', people=people, search=search,
                           sort=sort, order=order, fid=fid)


@app.route('/family/<int:fid>/person/new', methods=['GET', 'POST'])
@login_required
@family_access_required(role='admin')
def person_new(fid):
    if request.method == 'POST':
        return _save_person(fid, None)
    return render_template('person_form.html', person=None, fid=fid)




def _get_relationships_and_people(fid, person_id):
    """Return (relationships, all_people) for a given person within a family."""
    db = get_db()
    relationships = db.execute("""
        SELECT r.*,
            p1.first_name AS p1_first, p1.last_name AS p1_last,
            p2.first_name AS p2_first, p2.last_name AS p2_last
        FROM relationship r
        JOIN person p1 ON r.person1_id = p1.id
        JOIN person p2 ON r.person2_id = p2.id
        WHERE (r.person1_id = ? OR r.person2_id = ?) AND r.family_id = ?
        ORDER BY r.rel_type
    """, (person_id, person_id, fid)).fetchall()
    all_people = db.execute(
        "SELECT id, first_name, last_name FROM person WHERE id != ? AND family_id = ? ORDER BY last_name, first_name",
        (person_id, fid),
    ).fetchall()
    return relationships, all_people


def _rel_display_label(rel_type, person1_id, current_person_id):
    if rel_type == 'parent_child':
        return 'Parent' if person1_id == current_person_id else 'Child'
    elif rel_type == 'adopted_parent_child':
        return 'Adoptive parent' if person1_id == current_person_id else 'Adopted by'
    elif rel_type == 'spouse':
        return 'Spouse'
    elif rel_type == 'divorced':
        return 'Former spouse'
    return rel_type


def _person_is_linked(person_id, family_id):
    """Check if a person is already linked to a user account within a family."""
    db = get_db()
    row = db.execute(
        "SELECT id FROM family_membership WHERE person_id = ? AND family_id = ?", (person_id, family_id)
    ).fetchone()
    return row is not None


@app.route('/family/<int:fid>/person/<int:person_id>')
@login_required
@family_access_required()
def person_detail(fid, person_id):
    return redirect(url_for('person_edit', fid=fid, person_id=person_id))


def _can_edit_person(person_id):
    """Check if current user can edit this person (admin or linked to this person)."""
    if g.is_admin:
        return True
    return g.membership['person_id'] == person_id


@app.route('/family/<int:fid>/person/<int:person_id>/edit', methods=['GET', 'POST'])
@login_required
@family_access_required()
def person_edit(fid, person_id):
    if not _can_edit_person(person_id):
        abort(403)
    db = get_db()
    person = db.execute("SELECT * FROM person WHERE id = ? AND family_id = ?", (person_id, fid)).fetchone()
    if not person:
        flash('Person not found.', 'error')
        return redirect(url_for('person_list', fid=fid))
    if request.method == 'POST':
        return _save_person(fid, person_id)
    relationships, all_people = _get_relationships_and_people(fid, person_id)
    return render_template('person_form.html', person=person,
                           relationships=relationships, all_people=all_people, fid=fid)


@app.route('/family/<int:fid>/person/<int:person_id>/delete', methods=['POST'])
@login_required
@family_access_required(role='admin')
def person_delete(fid, person_id):
    db = get_db()
    person = db.execute("SELECT first_name, last_name FROM person WHERE id = ? AND family_id = ?",
                        (person_id, fid)).fetchone()
    name = f"{person['first_name']} {person['last_name']}" if person else f"#{person_id}"
    _audit(db, 'delete', 'person', person_id, f"Deleted {name}", family_id=fid)
    db.execute("DELETE FROM person WHERE id = ? AND family_id = ?", (person_id, fid))
    db.commit()
    flash('Person deleted.', 'success')
    return redirect(url_for('person_list', fid=fid))


def _save_person(fid, person_id):
    """Create or update a person from form data."""
    data = {
        'first_name': request.form.get('first_name', '').strip(),
        'middle_name': request.form.get('middle_name', '').strip() or None,
        'last_name': request.form.get('last_name', '').strip(),
        'birth_name_first': request.form.get('birth_name_first', '').strip() or None,
        'birth_name_last': request.form.get('birth_name_last', '').strip() or None,
        'date_of_birth': request.form.get('date_of_birth', '').strip() or None,
        'place_of_birth': request.form.get('place_of_birth', '').strip() or None,
        'email': request.form.get('email', '').strip() or None,
        'linkedin_url': request.form.get('linkedin_url', '').strip() or None,
        'notes': request.form.get('notes', '').strip() or None,
    }

    if not data['first_name'] or not data['last_name']:
        flash('First name and last name are required.', 'error')
        return render_template('person_form.html', person=data, fid=fid)

    photo_path = None
    file = request.files.get('photo')
    if file and file.filename and _allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filename = f"{secrets.token_hex(8)}_{filename}"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        photo_path = filename

    db = get_db()
    full_name = f"{data['first_name']} {data['last_name']}".strip()
    if person_id is None:
        cursor = db.execute(
            """INSERT INTO person (family_id, first_name, middle_name, last_name, birth_name_first,
                birth_name_last, date_of_birth, place_of_birth, email, linkedin_url, notes, photo_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (fid, data['first_name'], data['middle_name'], data['last_name'],
             data['birth_name_first'], data['birth_name_last'], data['date_of_birth'],
             data['place_of_birth'], data['email'], data['linkedin_url'], data['notes'],
             photo_path),
        )
        person_id = cursor.lastrowid
        _audit(db, 'add', 'person', person_id, f"Added {full_name}", family_id=fid)
    else:
        if photo_path:
            db.execute(
                """UPDATE person SET first_name=?, middle_name=?, last_name=?, birth_name_first=?,
                    birth_name_last=?, date_of_birth=?, place_of_birth=?, email=?, linkedin_url=?,
                    notes=?, photo_path=?, updated_at=datetime('now') WHERE id=? AND family_id=?""",
                (data['first_name'], data['middle_name'], data['last_name'],
                 data['birth_name_first'], data['birth_name_last'], data['date_of_birth'],
                 data['place_of_birth'], data['email'], data['linkedin_url'], data['notes'],
                 photo_path, person_id, fid),
            )
        else:
            db.execute(
                """UPDATE person SET first_name=?, middle_name=?, last_name=?, birth_name_first=?,
                    birth_name_last=?, date_of_birth=?, place_of_birth=?, email=?, linkedin_url=?,
                    notes=?, updated_at=datetime('now') WHERE id=? AND family_id=?""",
                (data['first_name'], data['middle_name'], data['last_name'],
                 data['birth_name_first'], data['birth_name_last'], data['date_of_birth'],
                 data['place_of_birth'], data['email'], data['linkedin_url'], data['notes'],
                 person_id, fid),
            )
        _audit(db, 'edit', 'person', person_id, f"Edited {full_name}", family_id=fid)
    db.commit()
    flash('Person saved.', 'success')
    return redirect(url_for('person_edit', fid=fid, person_id=person_id))


# --- Relationship routes ---

@app.route('/family/<int:fid>/relationship/add', methods=['POST'])
@login_required
@family_access_required(role='admin')
def relationship_add(fid):
    person_id = int(request.form['person_id'])
    other_id = int(request.form['other_id'])
    rel_type = request.form['rel_type']

    if rel_type == 'child':
        rel_type = 'parent_child'
        person1_id, person2_id = other_id, person_id
    elif rel_type == 'parent':
        rel_type = 'parent_child'
        person1_id, person2_id = person_id, other_id
    elif rel_type == 'adopted_child':
        rel_type = 'adopted_parent_child'
        person1_id, person2_id = other_id, person_id
    elif rel_type == 'adopted_parent':
        rel_type = 'adopted_parent_child'
        person1_id, person2_id = person_id, other_id
    else:
        person1_id, person2_id = min(person_id, other_id), max(person_id, other_id)

    wants_json = request.headers.get('Accept') == 'application/json'
    db = get_db()

    # Validate both persons belong to this family
    p1_check = db.execute("SELECT id FROM person WHERE id = ? AND family_id = ?", (person1_id, fid)).fetchone()
    p2_check = db.execute("SELECT id FROM person WHERE id = ? AND family_id = ?", (person2_id, fid)).fetchone()
    if not p1_check or not p2_check:
        if wants_json:
            return jsonify({"ok": False, "error": "Invalid person selection"}), 400
        flash('Invalid person selection.', 'error')
        return redirect(url_for('person_edit', fid=fid, person_id=person_id))

    try:
        db.execute(
            "INSERT INTO relationship (family_id, person1_id, person2_id, rel_type) VALUES (?, ?, ?, ?)",
            (fid, person1_id, person2_id, rel_type),
        )
        rel_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        other_id_val = person2_id if person1_id == person_id else person1_id
        p1 = db.execute("SELECT first_name, last_name FROM person WHERE id = ? AND family_id = ?", (person1_id, fid)).fetchone()
        p2 = db.execute("SELECT first_name, last_name FROM person WHERE id = ? AND family_id = ?", (person2_id, fid)).fetchone()
        p1_name = f"{p1['first_name']} {p1['last_name']}" if p1 else f"#{person1_id}"
        p2_name = f"{p2['first_name']} {p2['last_name']}" if p2 else f"#{person2_id}"
        _audit(db, 'add', 'relationship', rel_id,
               f"Added {rel_type.replace('_', ' ')}: {p1_name} → {p2_name}", family_id=fid)
        db.commit()
        if wants_json:
            other = db.execute("SELECT first_name, last_name FROM person WHERE id = ? AND family_id = ?",
                               (other_id_val, fid)).fetchone()
            return jsonify({
                "ok": True, "rel_id": rel_id,
                "label": _rel_display_label(rel_type, person1_id, person_id),
                "person_name": f"{other['first_name']} {other['last_name']}",
                "person_id": other_id_val,
            })
        flash('Relationship added.', 'success')
    except db.IntegrityError:
        if wants_json:
            return jsonify({"ok": False, "error": "Relationship already exists"}), 400
        flash('This relationship already exists.', 'error')
    return redirect(url_for('person_edit', fid=fid, person_id=person_id))


@app.route('/family/<int:fid>/relationship/<int:rel_id>/delete', methods=['POST'])
@login_required
@family_access_required(role='admin')
def relationship_delete(fid, rel_id):
    person_id = int(request.form.get('person_id', 0))
    db = get_db()
    rel = db.execute("""
        SELECT r.rel_type, p1.first_name AS p1f, p1.last_name AS p1l,
               p2.first_name AS p2f, p2.last_name AS p2l
        FROM relationship r
        JOIN person p1 ON r.person1_id = p1.id
        JOIN person p2 ON r.person2_id = p2.id
        WHERE r.id = ? AND r.family_id = ?""", (rel_id, fid)).fetchone()
    if rel:
        _audit(db, 'delete', 'relationship', rel_id,
               f"Removed {rel['rel_type'].replace('_', ' ')}: {rel['p1f']} {rel['p1l']} → {rel['p2f']} {rel['p2l']}",
               family_id=fid)
    db.execute("DELETE FROM relationship WHERE id = ? AND family_id = ?", (rel_id, fid))
    db.commit()
    if request.headers.get('Accept') == 'application/json':
        return jsonify({"ok": True})
    flash('Relationship removed.', 'success')
    return redirect(url_for('person_edit', fid=fid, person_id=person_id))


# --- Family settings ---

@app.route('/family/<int:fid>/settings', methods=['GET', 'POST'])
@login_required
@family_access_required(role='admin')
def family_settings(fid):
    db = get_db()
    if request.method == 'POST':
        name = request.form.get('name', '').strip()
        if name:
            db.execute("UPDATE family SET name = ? WHERE id = ?", (name, fid))
            db.commit()
            flash('Family name updated.', 'success')
        return redirect(url_for('family_settings', fid=fid))

    members = db.execute("""
        SELECT fm.*, u.username, u.display_name,
               p.first_name AS person_first, p.last_name AS person_last
        FROM family_membership fm
        JOIN user u ON u.id = fm.user_id
        LEFT JOIN person p ON p.id = fm.person_id
        WHERE fm.family_id = ?
        ORDER BY fm.role, u.username
    """, (fid,)).fetchall()
    share_token = db.execute(
        "SELECT * FROM family_share_token WHERE family_id = ?", (fid,)
    ).fetchone()
    return render_template('family_settings.html', fid=fid, members=members, share_token=share_token)


# --- Share link system ---

@app.route('/family/<int:fid>/share/generate', methods=['POST'])
@login_required
@family_access_required()
def share_generate(fid):
    token = secrets.token_urlsafe(32)
    db = get_db()
    db.execute(
        "INSERT INTO family_share_token (family_id, token, created_by) VALUES (?, ?, ?)"
        " ON CONFLICT(family_id) DO UPDATE SET token = excluded.token, created_by = excluded.created_by, created_at = datetime('now')",
        (fid, token, session['user_id']),
    )
    db.commit()
    share_url = url_for('join_family', token=token, _external=True)
    flash(f'Share link: {share_url}', 'success')
    return redirect(url_for('family_settings', fid=fid))


@app.route('/family/<int:fid>/share/rotate', methods=['POST'])
@login_required
@family_access_required(role='admin')
def share_rotate(fid):
    token = secrets.token_urlsafe(32)
    db = get_db()
    db.execute(
        "INSERT INTO family_share_token (family_id, token, created_by) VALUES (?, ?, ?)"
        " ON CONFLICT(family_id) DO UPDATE SET token = excluded.token, created_by = excluded.created_by, created_at = datetime('now')",
        (fid, token, session['user_id']),
    )
    db.commit()
    share_url = url_for('join_family', token=token, _external=True)
    flash(f'Link rotated. New link: {share_url}', 'success')
    return redirect(url_for('family_settings', fid=fid))


def _token_expired(row):
    """Check if a share token has expired."""
    if not row or not row['created_at']:
        return True
    created = datetime.fromisoformat(row['created_at'])
    age_days = (datetime.utcnow() - created).days
    return age_days > SHARE_TOKEN_MAX_AGE_DAYS


@app.route('/join/<token>')
def join_family(token):
    db = get_db()
    row = db.execute(
        "SELECT fst.*, f.name AS family_name FROM family_share_token fst JOIN family f ON f.id = fst.family_id WHERE fst.token = ?",
        (token,),
    ).fetchone()
    if not row or _token_expired(row):
        flash('Invalid or expired share link.', 'error')
        return redirect(url_for('login'))

    fid = row['family_id']
    user_id = session.get('user_id')
    if user_id:
        # Logged-in user: add as member if not already one
        existing = db.execute(
            "SELECT id FROM family_membership WHERE user_id = ? AND family_id = ?",
            (user_id, fid),
        ).fetchone()
        if not existing:
            db.execute(
                "INSERT INTO family_membership (user_id, family_id, role) VALUES (?, ?, 'member')",
                (user_id, fid),
            )
            db.commit()
            flash(f'Welcome to the {row["family_name"]} family tree!', 'success')
        return redirect(url_for('family_tree', fid=fid))

    # Not logged in — grant session-based view access
    view_access = session.get('family_view_access', {})
    view_access[str(fid)] = True
    session['family_view_access'] = view_access
    return redirect(url_for('family_tree', fid=fid))


@app.route('/join/<token>/register', methods=['GET', 'POST'])
def join_register(token):
    db = get_db()
    row = db.execute(
        "SELECT fst.*, f.name AS family_name FROM family_share_token fst JOIN family f ON f.id = fst.family_id WHERE fst.token = ?",
        (token,),
    ).fetchone()
    if not row or _token_expired(row):
        flash('Invalid or expired share link.', 'error')
        return redirect(url_for('login'))

    fid = row['family_id']

    if request.method == 'POST':
        action = request.form.get('action', 'register')
        user_id = None

        if action == 'register':
            username = request.form.get('username', '').strip()
            password = request.form.get('password', '')
            confirm = request.form.get('confirm_password', '')
            display_name = request.form.get('display_name', '').strip() or None

            if not username or len(username) < 3:
                flash('Username must be at least 3 characters.', 'error')
                return render_template('share_join.html', row=row, token=token)
            if len(password) < 8:
                flash('Password must be at least 8 characters.', 'error')
                return render_template('share_join.html', row=row, token=token)
            if password != confirm:
                flash('Passwords do not match.', 'error')
                return render_template('share_join.html', row=row, token=token)
            existing = db.execute("SELECT id FROM user WHERE username = ?", (username,)).fetchone()
            if existing:
                flash('Username already taken.', 'error')
                return render_template('share_join.html', row=row, token=token)
            cursor = db.execute(
                "INSERT INTO user (username, password_hash, display_name) VALUES (?, ?, ?)",
                (username, generate_password_hash(password), display_name),
            )
            user_id = cursor.lastrowid

        elif action == 'login':
            username = request.form.get('login_username', '').strip()
            password = request.form.get('login_password', '')
            user = db.execute("SELECT * FROM user WHERE username = ?", (username,)).fetchone()
            if not user or not check_password_hash(user['password_hash'], password):
                flash('Invalid username or password.', 'error')
                return render_template('share_join.html', row=row, token=token)
            user_id = user['id']

        if user_id:
            existing_mem = db.execute(
                "SELECT id FROM family_membership WHERE user_id = ? AND family_id = ?",
                (user_id, fid),
            ).fetchone()
            if not existing_mem:
                db.execute(
                    "INSERT INTO family_membership (user_id, family_id, role) VALUES (?, ?, 'member')",
                    (user_id, fid),
                )
            db.commit()
            session.clear()
            session['user_id'] = user_id
            flash(f'Welcome to the {row["family_name"]} family tree!', 'success')
            return redirect(url_for('family_tree', fid=fid))

    return render_template('share_join.html', row=row, token=token)


@app.route('/family/<int:fid>/link-person', methods=['GET', 'POST'])
@login_required
@family_access_required()
def link_person(fid):
    db = get_db()
    if request.method == 'POST':
        person_id = request.form.get('person_id', '').strip()
        if person_id:
            db.execute(
                "UPDATE family_membership SET person_id = ? WHERE user_id = ? AND family_id = ?",
                (int(person_id), session['user_id'], fid),
            )
            db.commit()
            flash('Profile linked.', 'success')
        return redirect(url_for('family_tree', fid=fid))

    # People not yet linked to any user account
    unlinked = db.execute("""
        SELECT p.id, p.first_name, p.last_name
        FROM person p
        WHERE p.family_id = ?
          AND p.id NOT IN (
              SELECT person_id FROM family_membership
              WHERE family_id = ? AND person_id IS NOT NULL
          )
        ORDER BY p.last_name, p.first_name
    """, (fid, fid)).fetchall()
    return render_template('link_person.html', unlinked=unlinked, fid=fid)


# --- Photo serving ---

@app.route('/uploads/<filename>')
@login_required
def uploaded_file(filename):
    from flask import send_from_directory
    db = get_db()
    person = db.execute("SELECT family_id FROM person WHERE photo_path = ?", (filename,)).fetchone()
    if not person:
        abort(404)
    membership = db.execute(
        "SELECT id FROM family_membership WHERE user_id = ? AND family_id = ?",
        (session['user_id'], person['family_id']),
    ).fetchone()
    if not membership:
        abort(403)
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


import os as _os

# Run on startup (both direct and via gunicorn)
init_db()
_ensure_secret_key()

if __name__ == '__main__':
    port = int(_os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
