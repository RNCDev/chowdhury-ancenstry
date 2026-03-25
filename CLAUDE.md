# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A family tree web app for the Chowdhury family, built with Flask + SQLite + D3.js. Simple password-only auth, server-rendered Jinja2 templates, Pico CSS for styling.

### Key Family Connections

- Ritujoy Chowdhury + Sarah Elizabeth Norieka → Livia Elizabeth Chowdhury
- Prodiptya Chowdhury + Sangeeta → Ritujoy Chowdhury
- Joseph Noreika + Joanne Keane → Sarah Elizabeth Norieka

## Development

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python seed.py          # populate initial family data
python app.py           # runs at http://localhost:5000
```

## Architecture

- **`app.py`** — All Flask routes (~15): auth, person CRUD, relationship management, tree API, photo serving
- **`db.py`** — SQLite connection helper and schema initialization
- **`schema.sql`** — Three tables: `person`, `relationship`, `app_config`
- **`seed.py`** — Populates the initial 7-person, 3-generation Chowdhury/Norieka family
- **`static/tree.js`** — D3.js tree visualization with pan/zoom and multi-root support
- **`templates/`** — Jinja2 templates extending `base.html`

### Data Model

- **Relationships are directional for parent_child** (person1=parent, person2=child), symmetric for spouse/divorced
- **Siblings are derived** (share a parent), not stored
- Relationship types: `spouse`, `divorced`, `parent_child`, `adopted_parent_child`
- The tree API (`/api/tree`) builds a JSON hierarchy from the graph, handling multiple root lineages and spouse annotations
