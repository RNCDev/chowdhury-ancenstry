"""Migration script: single-password app → multi-user, multi-family.

Run once to migrate existing data. Creates a bootstrap admin user and
moves all existing people/relationships into family #1.

Usage:
    python migrate_v2.py
"""

import getpass
import os
import sqlite3
import sys

from werkzeug.security import generate_password_hash

# Use same DB path logic as db.py
_DATA_DIR = '/app/data' if os.path.isdir('/app/data') else os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(_DATA_DIR, 'family.db')


def migrate():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")

    # Check if already migrated
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if 'user' in tables:
        print("Migration already applied (user table exists). Skipping.")
        db.close()
        return

    print(f"Migrating database at {DATABASE}")

    # Step 1: Create new tables
    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')
    with open(schema_path, 'r') as f:
        db.executescript(f.read())

    # Step 2: Add new columns to existing tables (if not already present)
    # Check what columns person already has
    person_cols = [r[1] for r in db.execute("PRAGMA table_info(person)").fetchall()]

    if 'family_id' not in person_cols:
        db.execute("ALTER TABLE person ADD COLUMN family_id INTEGER REFERENCES family(id)")
    if 'status' not in person_cols:
        db.execute("ALTER TABLE person ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")

    rel_cols = [r[1] for r in db.execute("PRAGMA table_info(relationship)").fetchall()]
    if 'family_id' not in rel_cols:
        db.execute("ALTER TABLE relationship ADD COLUMN family_id INTEGER REFERENCES family(id)")

    audit_cols = [r[1] for r in db.execute("PRAGMA table_info(audit_log)").fetchall()]
    if 'user_id' not in audit_cols:
        db.execute("ALTER TABLE audit_log ADD COLUMN user_id INTEGER REFERENCES user(id)")
    if 'family_id' not in audit_cols:
        db.execute("ALTER TABLE audit_log ADD COLUMN family_id INTEGER REFERENCES family(id)")

    # Step 3: Create family #1
    existing_family = db.execute("SELECT id FROM family WHERE id = 1").fetchone()
    if not existing_family:
        family_name = input("Family name [Chowdhury]: ").strip() or "Chowdhury"
        db.execute("INSERT INTO family (id, name) VALUES (1, ?)", (family_name,))

    # Step 4: Backfill
    db.execute("UPDATE person SET family_id = 1 WHERE family_id IS NULL")
    db.execute("UPDATE person SET status = 'active' WHERE status IS NULL OR status = ''")
    db.execute("UPDATE relationship SET family_id = 1 WHERE family_id IS NULL")
    db.execute("UPDATE audit_log SET family_id = 1 WHERE family_id IS NULL")

    # Step 5: Create bootstrap admin
    print("\nCreate the admin account:")
    username = input("Username: ").strip()
    if not username:
        print("Username is required.")
        db.close()
        sys.exit(1)
    password = getpass.getpass("Password: ")
    if len(password) < 4:
        print("Password must be at least 4 characters.")
        db.close()
        sys.exit(1)

    display_name = input("Display name (optional): ").strip() or None

    cursor = db.execute(
        "INSERT INTO user (username, password_hash, display_name) VALUES (?, ?, ?)",
        (username, generate_password_hash(password), display_name),
    )
    user_id = cursor.lastrowid
    db.execute(
        "INSERT INTO family_membership (user_id, family_id, role) VALUES (?, 1, 'admin')",
        (user_id,),
    )

    # Step 6: Remove old password
    db.execute("DELETE FROM app_config WHERE key = 'password_hash'")

    db.commit()
    db.close()
    print(f"\nMigration complete! User '{username}' is admin of family #1.")


if __name__ == "__main__":
    migrate()
