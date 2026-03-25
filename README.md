# chowdhury-ancenstry

A family tree web app for the Chowdhury family, initially populated by Livia Elizabeth Chowdhury.

## Features

- Add and edit family members with name, date/place of birth, email, LinkedIn, photo, and notes
- Link relationships: spouse, parent/child, adopted parent/child
- Interactive D3.js family tree visualization with pan, zoom, and multi-lineage support
- Search across all people
- Simple password-only access

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python seed.py    # load initial Chowdhury/Norieka family data
python app.py     # http://localhost:5000
```

Set a password on first visit.

## Stack

Flask · SQLite · D3.js · Pico CSS
