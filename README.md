# Chowdhury Ancestry

A multi-user family tree web app, originally built for the Chowdhury-Noreika family.

## Features

- **Interactive family tree** — D3.js visualization with pan, zoom, and draggable nodes
- **Spouse-collapsing layout** — couples rendered as unified units with automatic positioning
- **Multi-user accounts** — register, login, role-based access (admin/member)
- **Multiple families** — each user can belong to multiple family trees
- **Invite system** — share links for view access; registering upgrades to full member
- **Person management** — name, birth name, date/place of birth, gender, email, LinkedIn, photo, notes
- **Relationship types** — spouse, divorced, parent/child, adopted parent/child
- **Family units** — explicit couple/union tracking with children linked to the correct parents
- **Layout persistence** — drag nodes to customize the tree; positions save per family
- **Audit log** — tracks all additions, edits, and deletions
- **Mobile-friendly** — responsive design with touch support

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python seed.py    # creates admin user (admin/admin) and sample family data
python app.py     # http://localhost:8080
```

## Stack

Flask, SQLite, D3.js, vanilla CSS (Source Sans 3)

## Deployment

Deployed on [Railway](https://railway.app) with a persistent volume for the SQLite database. See `railway-deploy.md` for details.

Migrations run automatically on app startup — no manual steps needed when deploying schema changes.
