"""
Migration 001: Replace invite_token with family_share_token

Run once before deploying the simplified sharing update:
    python migrate_001.py [path/to/family.db]

Defaults to the same DB path logic used by db.py.
"""
import os
import sys
import sqlite3
import secrets

def get_db_path():
    if len(sys.argv) > 1:
        return sys.argv[1]
    volume = '/app/data'
    if os.path.isdir(volume):
        return os.path.join(volume, 'family.db')
    return os.path.join(os.path.dirname(__file__), 'family.db')

def run(db_path):
    print(f"Migrating: {db_path}")
    if not os.path.exists(db_path):
        print("DB not found — nothing to migrate.")
        return

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = OFF")  # allow structural changes

    # Check if invite_token table exists
    has_invite = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='invite_token'"
    ).fetchone()

    if not has_invite:
        print("invite_token table not found — already migrated or fresh install.")
    else:
        # 1. Activate stubs that were already claimed
        result = con.execute("""
            UPDATE person SET status = 'active'
            WHERE status = 'stub'
              AND id IN (SELECT person_id FROM invite_token WHERE accepted_at IS NOT NULL)
        """)
        print(f"  Activated {result.rowcount} claimed stub person(s).")

        # 2. Report unclaimed stubs (manual decision)
        unclaimed = con.execute("""
            SELECT COUNT(*) FROM person
            WHERE status = 'stub'
              AND id NOT IN (SELECT person_id FROM invite_token WHERE accepted_at IS NOT NULL)
        """).fetchone()[0]
        if unclaimed:
            print(f"  WARNING: {unclaimed} unclaimed stub person(s) remain in the database.")
            print("  These were never claimed via invite. Review them manually if needed.")
            print("  They will remain visible in the tree (as stub-status records).")

        # 3. Drop old indexes and table
        con.execute("DROP INDEX IF EXISTS idx_invite_person")
        con.execute("DROP INDEX IF EXISTS idx_invite_family")
        con.execute("DROP TABLE IF EXISTS invite_token")
        print("  Dropped invite_token table.")

    # 4. Create family_share_token if it doesn't exist
    con.execute("""
        CREATE TABLE IF NOT EXISTS family_share_token (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id  INTEGER NOT NULL UNIQUE REFERENCES family(id) ON DELETE CASCADE,
            token      TEXT NOT NULL UNIQUE,
            created_by INTEGER REFERENCES user(id) ON DELETE SET NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_share_token_family ON family_share_token(family_id)
    """)
    print("  Created family_share_token table.")

    # 5. Auto-generate share tokens for all existing families that don't have one
    families = con.execute("SELECT id FROM family").fetchall()
    inserted = 0
    for row in families:
        fid = row['id']
        exists = con.execute(
            "SELECT 1 FROM family_share_token WHERE family_id = ?", (fid,)
        ).fetchone()
        if not exists:
            token = secrets.token_urlsafe(32)
            con.execute(
                "INSERT INTO family_share_token (family_id, token) VALUES (?, ?)",
                (fid, token)
            )
            inserted += 1
    print(f"  Generated share tokens for {inserted} existing family/families.")

    con.execute("PRAGMA foreign_keys = ON")
    con.commit()
    con.close()
    print("Migration complete.")

if __name__ == '__main__':
    run(get_db_path())
