import os
import secrets
from functools import wraps

from flask import (
    Flask, flash, g, jsonify, redirect, render_template, request, session, url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from db import get_db, init_db

app = Flask(__name__)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB


def _ensure_secret_key():
    """Load or generate the Flask secret key from the database."""
    db = get_db()
    row = db.execute("SELECT value FROM app_config WHERE key = 'secret_key'").fetchone()
    if row:
        app.secret_key = row['value']
    else:
        key = secrets.token_hex(32)
        db.execute("INSERT INTO app_config (key, value) VALUES ('secret_key', ?)", (key,))
        db.commit()
        app.secret_key = key
    db.close()


def _password_is_set():
    db = get_db()
    row = db.execute("SELECT value FROM app_config WHERE key = 'password_hash'").fetchone()
    db.close()
    return row is not None


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('authenticated'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


def _allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# --- Auth routes ---

@app.route('/login', methods=['GET', 'POST'])
def login():
    has_password = _password_is_set()
    if request.method == 'POST':
        password = request.form.get('password', '')
        if not has_password:
            # First-time setup: set the password
            if len(password) < 4:
                flash('Password must be at least 4 characters.', 'error')
                return render_template('login.html', setup=True)
            db = get_db()
            db.execute(
                "INSERT INTO app_config (key, value) VALUES ('password_hash', ?)",
                (generate_password_hash(password),),
            )
            db.commit()
            db.close()
            session['authenticated'] = True
            flash('Password set successfully!', 'success')
            return redirect(url_for('tree'))
        else:
            db = get_db()
            row = db.execute("SELECT value FROM app_config WHERE key = 'password_hash'").fetchone()
            db.close()
            if row and check_password_hash(row['value'], password):
                session['authenticated'] = True
                return redirect(url_for('tree'))
            flash('Incorrect password.', 'error')
    return render_template('login.html', setup=not has_password)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


# --- Person CRUD routes ---

@app.route('/people')
@login_required
def person_list():
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
    # NULLs go last
    order_sql = f"ORDER BY {order_clause} IS NULL, {order_clause} {direction}"

    db = get_db()
    if search:
        query = f"""
            SELECT * FROM person
            WHERE first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ?
                OR birth_name_first LIKE ? OR birth_name_last LIKE ?
                OR place_of_birth LIKE ? OR email LIKE ?
            {order_sql}
        """
        like = f'%{search}%'
        people = db.execute(query, (like, like, like, like, like, like, like)).fetchall()
    else:
        people = db.execute(f"SELECT * FROM person {order_sql}").fetchall()
    db.close()
    return render_template('person_list.html', people=people, search=search,
                           sort=sort, order=order)


@app.route('/person/new', methods=['GET', 'POST'])
@login_required
def person_new():
    if request.method == 'POST':
        return _save_person(None)
    return render_template('person_form.html', person=None)


def _get_relationships_and_people(person_id):
    """Return (relationships, all_people) for a given person."""
    db = get_db()
    relationships = db.execute("""
        SELECT r.*,
            p1.first_name AS p1_first, p1.last_name AS p1_last,
            p2.first_name AS p2_first, p2.last_name AS p2_last
        FROM relationship r
        JOIN person p1 ON r.person1_id = p1.id
        JOIN person p2 ON r.person2_id = p2.id
        WHERE r.person1_id = ? OR r.person2_id = ?
        ORDER BY r.rel_type
    """, (person_id, person_id)).fetchall()
    all_people = db.execute(
        "SELECT id, first_name, last_name FROM person WHERE id != ? ORDER BY last_name, first_name",
        (person_id,),
    ).fetchall()
    db.close()
    return relationships, all_people


def _rel_display_label(rel_type, person1_id, current_person_id):
    """Return the human-readable label for a relationship from the current person's perspective."""
    if rel_type == 'parent_child':
        return 'Parent' if person1_id == current_person_id else 'Child'
    elif rel_type == 'adopted_parent_child':
        return 'Adoptive parent' if person1_id == current_person_id else 'Adopted by'
    elif rel_type == 'spouse':
        return 'Spouse'
    elif rel_type == 'divorced':
        return 'Former spouse'
    return rel_type


@app.route('/person/<int:person_id>')
@login_required
def person_detail(person_id):
    db = get_db()
    person = db.execute("SELECT * FROM person WHERE id = ?", (person_id,)).fetchone()
    db.close()
    if not person:
        flash('Person not found.', 'error')
        return redirect(url_for('person_list'))

    relationships, all_people = _get_relationships_and_people(person_id)

    return render_template(
        'person_detail.html', person=person, relationships=relationships,
        all_people=all_people,
    )


@app.route('/person/<int:person_id>/edit', methods=['GET', 'POST'])
@login_required
def person_edit(person_id):
    db = get_db()
    person = db.execute("SELECT * FROM person WHERE id = ?", (person_id,)).fetchone()
    db.close()
    if not person:
        flash('Person not found.', 'error')
        return redirect(url_for('person_list'))
    if request.method == 'POST':
        return _save_person(person_id)
    relationships, all_people = _get_relationships_and_people(person_id)
    return render_template('person_form.html', person=person,
                           relationships=relationships, all_people=all_people)


@app.route('/person/<int:person_id>/delete', methods=['POST'])
@login_required
def person_delete(person_id):
    db = get_db()
    db.execute("DELETE FROM person WHERE id = ?", (person_id,))
    db.commit()
    db.close()
    flash('Person deleted.', 'success')
    return redirect(url_for('person_list'))


def _save_person(person_id):
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
        return render_template('person_form.html', person=data)

    # Handle photo upload
    photo_path = None
    file = request.files.get('photo')
    if file and file.filename and _allowed_file(file.filename):
        filename = secure_filename(file.filename)
        # Prefix with person id or timestamp to avoid collisions
        filename = f"{secrets.token_hex(8)}_{filename}"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        photo_path = filename

    db = get_db()
    if person_id is None:
        cursor = db.execute(
            """INSERT INTO person (first_name, middle_name, last_name, birth_name_first,
                birth_name_last, date_of_birth, place_of_birth, email, linkedin_url, notes, photo_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (data['first_name'], data['middle_name'], data['last_name'],
             data['birth_name_first'], data['birth_name_last'], data['date_of_birth'],
             data['place_of_birth'], data['email'], data['linkedin_url'], data['notes'],
             photo_path),
        )
        person_id = cursor.lastrowid
    else:
        if photo_path:
            db.execute(
                """UPDATE person SET first_name=?, middle_name=?, last_name=?, birth_name_first=?,
                    birth_name_last=?, date_of_birth=?, place_of_birth=?, email=?, linkedin_url=?,
                    notes=?, photo_path=?, updated_at=datetime('now') WHERE id=?""",
                (data['first_name'], data['middle_name'], data['last_name'],
                 data['birth_name_first'], data['birth_name_last'], data['date_of_birth'],
                 data['place_of_birth'], data['email'], data['linkedin_url'], data['notes'],
                 photo_path, person_id),
            )
        else:
            db.execute(
                """UPDATE person SET first_name=?, middle_name=?, last_name=?, birth_name_first=?,
                    birth_name_last=?, date_of_birth=?, place_of_birth=?, email=?, linkedin_url=?,
                    notes=?, updated_at=datetime('now') WHERE id=?""",
                (data['first_name'], data['middle_name'], data['last_name'],
                 data['birth_name_first'], data['birth_name_last'], data['date_of_birth'],
                 data['place_of_birth'], data['email'], data['linkedin_url'], data['notes'],
                 person_id),
            )
    db.commit()
    db.close()
    flash('Person saved.', 'success')
    return redirect(url_for('person_edit', person_id=person_id))


# --- Relationship routes ---

@app.route('/relationship/add', methods=['POST'])
@login_required
def relationship_add():
    person_id = int(request.form['person_id'])
    other_id = int(request.form['other_id'])
    rel_type = request.form['rel_type']

    # Normalize direction: for parent_child and adopted_parent_child,
    # person1 is always the parent
    if rel_type == 'child':
        # "This person is a child of other" → other is parent
        rel_type = 'parent_child'
        person1_id, person2_id = other_id, person_id
    elif rel_type == 'parent':
        # "This person is a parent of other" → this person is parent
        rel_type = 'parent_child'
        person1_id, person2_id = person_id, other_id
    elif rel_type == 'adopted_child':
        rel_type = 'adopted_parent_child'
        person1_id, person2_id = other_id, person_id
    elif rel_type == 'adopted_parent':
        rel_type = 'adopted_parent_child'
        person1_id, person2_id = person_id, other_id
    else:
        # spouse, divorced — order by smaller id for consistency
        person1_id, person2_id = min(person_id, other_id), max(person_id, other_id)

    wants_json = request.headers.get('Accept') == 'application/json'
    db = get_db()
    try:
        db.execute(
            "INSERT INTO relationship (person1_id, person2_id, rel_type) VALUES (?, ?, ?)",
            (person1_id, person2_id, rel_type),
        )
        db.commit()
        if wants_json:
            rel_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
            other_id_val = person2_id if person1_id == person_id else person1_id
            other = db.execute("SELECT first_name, last_name FROM person WHERE id = ?",
                               (other_id_val,)).fetchone()
            db.close()
            return jsonify({
                "ok": True, "rel_id": rel_id,
                "label": _rel_display_label(rel_type, person1_id, person_id),
                "person_name": f"{other['first_name']} {other['last_name']}",
                "person_id": other_id_val,
            })
        flash('Relationship added.', 'success')
    except db.IntegrityError:
        if wants_json:
            db.close()
            return jsonify({"ok": False, "error": "Relationship already exists"}), 400
        flash('This relationship already exists.', 'error')
    db.close()
    return redirect(url_for('person_detail', person_id=person_id))


@app.route('/relationship/<int:rel_id>/delete', methods=['POST'])
@login_required
def relationship_delete(rel_id):
    person_id = int(request.form.get('person_id', 0))
    db = get_db()
    db.execute("DELETE FROM relationship WHERE id = ?", (rel_id,))
    db.commit()
    db.close()
    if request.headers.get('Accept') == 'application/json':
        return jsonify({"ok": True})
    flash('Relationship removed.', 'success')
    return redirect(url_for('person_detail', person_id=person_id))


# --- Tree API ---

@app.route('/api/tree')
@login_required
def api_tree():
    db = get_db()

    people = {row['id']: dict(row) for row in db.execute("SELECT * FROM person").fetchall()}
    rels = db.execute("SELECT * FROM relationship").fetchall()
    db.close()

    if not people:
        return jsonify(None)

    # Build adjacency
    children_of = {}  # parent_id → [child_id, ...]
    spouses_of = {}   # person_id → [spouse_id, ...]

    for r in rels:
        rt = r['rel_type']
        p1, p2 = r['person1_id'], r['person2_id']
        if rt in ('parent_child', 'adopted_parent_child'):
            children_of.setdefault(p1, []).append(p2)
        elif rt in ('spouse', 'divorced'):
            spouses_of.setdefault(p1, []).append(p2)
            spouses_of.setdefault(p2, []).append(p1)

    # Find the topmost ancestor: walk up parent links from any person
    all_children = set()
    for kids in children_of.values():
        all_children.update(kids)

    # Pick a parentless person; prefer one with children (i.e. not a lone spouse)
    parentless = [pid for pid in people if pid not in all_children]
    root_id = None
    for pid in parentless:
        if pid in children_of or any(pid in children_of for s in spouses_of.get(pid, [])):
            root_id = pid
            break
    if root_id is None:
        root_id = parentless[0] if parentless else next(iter(people))

    # Build tree recursively
    built = set()

    def _person_info(pid):
        p = people[pid]
        return {
            'id': pid,
            'name': f"{p['first_name']} {p['last_name']}",
            'birth_year': p['date_of_birth'][:4] if p['date_of_birth'] else None,
            'photo_path': p['photo_path'],
        }

    def build_node(pid):
        if pid in built or pid not in people:
            return None
        built.add(pid)
        node = _person_info(pid)
        node['spouses'] = []
        node['children'] = []

        # Spouses shown as annotations
        spouse_ids = []
        for sid in spouses_of.get(pid, []):
            if sid in people:
                node['spouses'].append(_person_info(sid))
                spouse_ids.append(sid)
                built.add(sid)

        # Children from this person and their spouses
        seen_children = set()
        for parent_id in [pid] + spouse_ids:
            for cid in children_of.get(parent_id, []):
                if cid not in seen_children:
                    seen_children.add(cid)
                    child_node = build_node(cid)
                    if child_node:
                        node['children'].append(child_node)
        return node

    tree = build_node(root_id)
    return jsonify({'root': tree})


# --- Tree page ---

@app.route('/')
@login_required
def tree():
    db = get_db()
    has_people = db.execute("SELECT 1 FROM person LIMIT 1").fetchone() is not None
    db.close()
    return render_template('tree.html', people=has_people)


# --- Photo serving ---

@app.route('/uploads/<filename>')
@login_required
def uploaded_file(filename):
    from flask import send_from_directory
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


import os as _os

# Run on startup (both direct and via gunicorn)
init_db()
_ensure_secret_key()

if __name__ == '__main__':
    port = int(_os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
