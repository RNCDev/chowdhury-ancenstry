"""
Migration script: apply schema improvements to an existing database.

Safe to run multiple times (idempotent). Run before deploying:
    python migrate.py

Changes applied:
  1. Add performance indexes (safe with IF NOT EXISTS)
  2. Recreate invite_token with ON DELETE SET NULL on created_by/accepted_by
  3. Recreate relationship table with CHECK (person1_id != person2_id)
"""
import sqlite3
import os

_DATA_DIR = '/app/data' if os.path.isdir('/app/data') else os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(_DATA_DIR, 'family.db')


def run():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = OFF")  # must be OFF during table recreation

    print(f"Migrating: {DATABASE}")

    # 1. Add indexes (safe, IF NOT EXISTS)
    print("  Adding indexes...")
    db.executescript("""
        CREATE INDEX IF NOT EXISTS idx_person_family ON person(family_id);
        CREATE INDEX IF NOT EXISTS idx_membership_user ON family_membership(user_id);
        CREATE INDEX IF NOT EXISTS idx_invite_person ON invite_token(person_id);
        CREATE INDEX IF NOT EXISTS idx_invite_family ON invite_token(family_id);
        CREATE INDEX IF NOT EXISTS idx_audit_family ON audit_log(family_id);
        CREATE INDEX IF NOT EXISTS idx_relationship_family ON relationship(family_id);
    """)

    # 2. Recreate invite_token with correct FK cascades
    # Check if already migrated by inspecting the CREATE TABLE sql
    row = db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='invite_token'"
    ).fetchone()
    if row and 'ON DELETE SET NULL' not in row['sql']:
        print("  Migrating invite_token table (FK cascades)...")
        db.executescript("""
            CREATE TABLE invite_token_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                family_id INTEGER NOT NULL REFERENCES family(id) ON DELETE CASCADE,
                person_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
                created_by INTEGER REFERENCES user(id) ON DELETE SET NULL,
                expires_at TEXT NOT NULL,
                accepted_by INTEGER REFERENCES user(id) ON DELETE SET NULL,
                accepted_at TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO invite_token_new
                SELECT id, token, family_id, person_id, created_by, expires_at,
                       accepted_by, accepted_at, created_at
                FROM invite_token;
            DROP TABLE invite_token;
            ALTER TABLE invite_token_new RENAME TO invite_token;
        """)
    else:
        print("  invite_token already migrated, skipping.")

    # 3. Recreate relationship with self-reference check
    row = db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='relationship'"
    ).fetchone()
    if row and 'person1_id != person2_id' not in row['sql']:
        print("  Migrating relationship table (self-reference check)...")
        db.executescript("""
            CREATE TABLE relationship_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                family_id INTEGER REFERENCES family(id) ON DELETE CASCADE,
                person1_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
                person2_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
                rel_type TEXT NOT NULL CHECK (rel_type IN (
                    'spouse', 'divorced', 'parent_child', 'adopted_parent_child'
                )),
                start_date TEXT,
                end_date TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(person1_id, person2_id, rel_type),
                CHECK (person1_id != person2_id)
            );
            INSERT INTO relationship_new
                SELECT id, family_id, person1_id, person2_id, rel_type,
                       start_date, end_date, created_at
                FROM relationship
                WHERE person1_id != person2_id;
            DROP TABLE relationship;
            ALTER TABLE relationship_new RENAME TO relationship;
        """)
    else:
        print("  relationship already migrated, skipping.")

    db.execute("PRAGMA foreign_keys = ON")
    db.commit()
    db.close()
    print("Migration complete.")


if __name__ == '__main__':
    run()
