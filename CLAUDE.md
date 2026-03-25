# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A family tree web app for the Chowdhury family, built with Flask + SQLite + D3.js. Simple password-only auth (set on first visit), server-rendered Jinja2 templates, vanilla CSS (no framework).

## Development

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python seed.py          # populate initial family data
python app.py           # runs at http://localhost:5000
```

No test suite exists. No linter is configured.

## Deployment

Deployed on Railway via nixpacks. Gunicorn serves the app (`gunicorn app:app`). Config lives in `railway.toml` and `Procfile`. See `railway-deploy.md` for deployment notes.

The database path in `db.py` auto-selects `/app/data/family.db` when the Railway volume is mounted, otherwise uses the local project directory. Photos are stored in `uploads/`.

## Architecture

- **`app.py`** — All Flask routes (~15): auth, person CRUD, relationship management, tree API, photo serving. Schema is auto-initialized and secret key is generated on module load (runs for both `python app.py` and gunicorn).
- **`db.py`** — SQLite connection helper with `get_db()` (enables foreign keys) and `init_db()` (runs `schema.sql`)
- **`schema.sql`** — Three tables: `person`, `relationship`, `app_config`
- **`seed.py`** — Populates the initial 7-person, 3-generation Chowdhury/Norieka family. Skips if data already exists.
- **`static/style.css`** — All styles. Vanilla CSS with custom properties. No CSS framework.
- **`static/tree.js`** — D3.js tree visualization with button-based zoom (no pinch/scroll zoom)
- **`templates/`** — Jinja2 templates extending `base.html`

### Data Model

- **Relationships are directional for parent_child** (person1=parent, person2=child), symmetric for spouse/divorced
- **Spouse/divorced pairs are normalized** so person1_id < person2_id for consistency
- **Siblings are derived** (share a parent), not stored
- Relationship types: `spouse`, `divorced`, `parent_child`, `adopted_parent_child`
- The tree API (`/api/tree`) builds a single JSON hierarchy by walking from the topmost ancestor. Spouses appear as annotations on nodes, not as separate tree nodes.

## UI / Styling

**You MUST read `STYLE_GUIDE.md` before writing or modifying any CSS, templates, or front-end code.** It contains all color tokens, component patterns, layout rules, and constraints.

Key constraints:
- **Vanilla CSS only** — no CSS frameworks (no Pico, Bootstrap, Tailwind)
- **No inline styles** in templates — everything in `static/style.css`
- **No `!important`** — fix selector specificity instead
- **Use CSS custom properties** (`--bg-deep`, `--accent`, etc.) — never hardcode colors
- **Source Sans 3** is the only font
