import os
import sqlite3

# Use /app/data if the Railway volume is mounted there, otherwise local
_DATA_DIR = '/app/data' if os.path.isdir('/app/data') else os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(_DATA_DIR, 'family.db')


def get_db():
    """Get a database connection with row factory enabled."""
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
    """Initialize the database from schema.sql if tables don't exist."""
    db = get_db()
    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')
    with open(schema_path, 'r') as f:
        db.executescript(f.read())
    db.close()
