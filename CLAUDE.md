# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A family tree web app for the Chowdhury family, built with Flask + SQLite + D3.js. Simple password-only auth (set on first visit), server-rendered Jinja2 templates, Pico CSS for styling.

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
- **`static/tree.js`** — D3.js tree visualization with pan/zoom and multi-root support
- **`templates/`** — Jinja2 templates extending `base.html`

### Data Model

- **Relationships are directional for parent_child** (person1=parent, person2=child), symmetric for spouse/divorced
- **Spouse/divorced pairs are normalized** so person1_id < person2_id for consistency
- **Siblings are derived** (share a parent), not stored
- Relationship types: `spouse`, `divorced`, `parent_child`, `adopted_parent_child`
- The tree API (`/api/tree`) builds a single JSON hierarchy by walking from the topmost ancestor. Spouses appear as annotations on nodes, not as separate tree nodes.

## UI Style Guide

All UI must follow the style guide documented at the top of `static/style.css`. Key rules:

- **One font**: Source Sans 3 (400/500/600/700) — used everywhere, including headings, tree nodes, forms
- **Dark green theme**: deep green backgrounds (`--bg-deep`, `--bg-surface`, `--bg-raised`), muted green text hierarchy (`--text-primary`, `--text-secondary`, `--text-muted`)
- **No inline styles in templates** — all styling goes in `static/style.css` using the CSS variables defined there
- **Tables**: dark surface background with `--bg-raised` header, no white/light backgrounds
- **Pico CSS**: loaded for layout utilities (grid, etc.) but all colors/borders are overridden by our theme variables
- **Radius**: 8px for inputs/buttons, 12px for cards, 14px for zoom controls
- **Transitions**: 0.15s ease on interactive elements (hover, focus)
