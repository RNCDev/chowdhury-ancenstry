import os
import sqlite3
from flask import g

# Use /app/data if the Railway volume is mounted there, otherwise local
_DATA_DIR = '/app/data' if os.path.isdir('/app/data') else os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(_DATA_DIR, 'family.db')


def get_db():
    """Get a cached database connection for the current request context."""
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(exception=None):
    """Close the database connection at the end of the request."""
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    """Initialize the database from schema.sql if tables don't exist."""
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')
    with open(schema_path, 'r') as f:
        db.executescript(f.read())
    db.close()
