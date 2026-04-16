# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Family Treat — a multi-user family tree web app built with Flask + SQLite + D3.js. Supports multiple families with invite-based membership, user accounts with roles (admin/member), and interactive tree visualization. Server-rendered Jinja2 templates, vanilla CSS (no framework).

## Development

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py           # runs at http://localhost:8080
```

There is no seed script. Register a user at `/register`, then create a family at `/family/new`.

No test suite exists. No linter is configured.

To import the production database locally:
```bash
railway ssh base64 /app/data/family.db > /tmp/prod.b64
base64 -d -i /tmp/prod.b64 -o family.db
```

## Deployment

Deployed on Railway via nixpacks. Gunicorn serves the app (`gunicorn app:app`). Config lives in `railway.toml` and `Procfile`. See `railway-deploy.md` for deployment notes.

The database path in `db.py` auto-selects `/app/data/family.db` when the Railway volume is mounted, otherwise uses the local project directory. Photos are stored in `uploads/`.

Migrations run automatically on startup via `migrate.py` (called from `app.py` after `init_db()`). Migrations are idempotent.

## Architecture

- **`app.py`** — All Flask routes (~20): auth (register/login), person CRUD, relationship management, family unit management, tree API, layout persistence, family settings, share links, audit history. Schema is auto-initialized, migrations run, and secret key is generated on module load.
- **`db.py`** — SQLite connection helper with `get_db()` (enables foreign keys) and `init_db()` (runs `schema.sql`)
- **`migrate.py`** — Idempotent migration script for existing databases. Adds `family_unit` table, `gender` column to person, `family_unit_id`/`birth_order` to relationship. Backfills family units from existing spouse relationships. Called automatically on app startup.
- **`schema.sql`** — Tables: `user`, `family`, `family_membership`, `family_share_token`, `person`, `family_unit`, `relationship`, `app_config`, `audit_log`, `tree_layout`
- **`static/style.css`** — All styles. Vanilla CSS with custom properties. No CSS framework.
- **`static/tree.js`** — D3.js tree visualization with spouse-collapsing layout algorithm, button-based zoom, row-locked dragging, and layout persistence.
- **`static/form.js`** — Form tab switching and AJAX relationship add/remove on the person edit page.
- **`templates/`** — Jinja2 templates extending `base.html`

### Data Model

- **`family_unit`** is the source of truth for couples/unions. Each family unit has two partners (or one for single-parent units) and a type (marriage, divorced, partnership, single_parent).
- **`relationship`** rows reference a `family_unit_id` for parent_child relationships, linking children to their parents' union.
- **Relationships are directional for parent_child** (person1=parent, person2=child), symmetric for spouse/divorced.
- **Spouse/divorced pairs are normalized** so person1_id < person2_id for consistency.
- **Siblings are derived** (share a parent), not stored.
- Relationship types: `spouse`, `divorced`, `parent_child`, `adopted_parent_child`
- **`person`** has an optional `gender` field (male, female, other, unknown) used as a layout hint for spouse positioning.
- **`birth_order`** on relationship controls sibling left-to-right ordering.

### Tree Layout Algorithm

The tree API (`/family/<fid>/api/tree`) returns nodes, unions (from `family_unit`), and edges (from parent_child relationships with deduplication). The D3.js layout uses **spouse-collapsing**:

1. Each couple is collapsed into a single wide virtual node for `d3.tree()`
2. After layout, couple nodes are split back into two person positions
3. Gender hints determine left/right placement within a couple
4. Birth order controls sibling ordering, with cross-family heuristics as fallback
5. Bidirectional overlap resolution treats coupled pairs as rigid units
6. Cross-family spouses are pulled toward each other (70% pull)
7. Nodes are row-locked (drag only moves horizontally)
8. Dragged positions persist to `tree_layout` table and override the algorithm on reload

### Auth Model

- Multi-user with username/password registration
- Families have members with roles: `admin` (full CRUD) or `member` (view + edit linked person)
- Share tokens allow public view access and registration into a family
- CSRF protection via session tokens

## UI / Styling

**You MUST read `STYLE_GUIDE.md` before writing or modifying any CSS, templates, or front-end code.** It contains all color tokens, component patterns, layout rules, and constraints.

Key constraints:
- **Vanilla CSS only** — no CSS frameworks (no Pico, Bootstrap, Tailwind)
- **No inline styles** in templates — everything in `static/style.css`
- **No `!important`** — fix selector specificity instead
- **Use CSS custom properties** (`--bg-page`, `--accent`, etc.) — never hardcode colors
- **Source Sans 3** is the only font
