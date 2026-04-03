"""Migration: add family_unit table, gender column, birth_order column."""
import sqlite3
import os
from collections import defaultdict

_DATA_DIR = '/app/data' if os.path.isdir('/app/data') else os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(_DATA_DIR, 'family.db')


def migrate():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")

    # Add gender to person (ignore if already exists)
    try:
        db.execute("ALTER TABLE person ADD COLUMN gender TEXT CHECK (gender IN ('male', 'female', 'other', 'unknown'))")
    except sqlite3.OperationalError:
        pass

    # Create family_unit table
    db.execute("""
        CREATE TABLE IF NOT EXISTS family_unit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL REFERENCES family(id) ON DELETE CASCADE,
            partner1_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
            partner2_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
            union_type TEXT NOT NULL DEFAULT 'marriage'
                CHECK (union_type IN ('marriage', 'divorced', 'partnership', 'single_parent')),
            start_date TEXT,
            end_date TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_family_unit_family ON family_unit(family_id)")

    # Add family_unit_id and birth_order to relationship
    try:
        db.execute("ALTER TABLE relationship ADD COLUMN family_unit_id INTEGER REFERENCES family_unit(id) ON DELETE SET NULL")
    except sqlite3.OperationalError:
        pass
    try:
        db.execute("ALTER TABLE relationship ADD COLUMN birth_order INTEGER")
    except sqlite3.OperationalError:
        pass

    # --- Backfill: create family_units from existing spouse/divorced relationships ---
    spouse_rels = db.execute(
        "SELECT DISTINCT family_id, person1_id, person2_id, rel_type FROM relationship WHERE rel_type IN ('spouse', 'divorced')"
    ).fetchall()

    for rel in spouse_rels:
        fid, p1, p2, rtype = rel['family_id'], rel['person1_id'], rel['person2_id'], rel['rel_type']
        union_type = 'marriage' if rtype == 'spouse' else 'divorced'
        existing = db.execute(
            "SELECT id FROM family_unit WHERE family_id = ? AND partner1_id = ? AND partner2_id = ?",
            (fid, p1, p2)
        ).fetchone()
        if existing:
            fu_id = existing['id']
        else:
            cursor = db.execute(
                "INSERT INTO family_unit (family_id, partner1_id, partner2_id, union_type) VALUES (?, ?, ?, ?)",
                (fid, p1, p2, union_type)
            )
            fu_id = cursor.lastrowid

        children = db.execute("""
            SELECT r1.person2_id AS child_id
            FROM relationship r1
            JOIN relationship r2 ON r1.person2_id = r2.person2_id
            WHERE r1.person1_id = ? AND r2.person1_id = ?
              AND r1.rel_type IN ('parent_child', 'adopted_parent_child')
              AND r2.rel_type IN ('parent_child', 'adopted_parent_child')
              AND r1.family_id = ?
        """, (p1, p2, fid)).fetchall()

        for child in children:
            db.execute(
                "UPDATE relationship SET family_unit_id = ? WHERE person2_id = ? AND person1_id IN (?, ?) AND rel_type IN ('parent_child', 'adopted_parent_child') AND family_id = ?",
                (fu_id, child['child_id'], p1, p2, fid)
            )

    # Create single-parent family_units for parent_child rels with no family_unit assigned
    orphan_rels = db.execute(
        "SELECT DISTINCT family_id, person1_id, person2_id FROM relationship WHERE rel_type IN ('parent_child', 'adopted_parent_child') AND family_unit_id IS NULL"
    ).fetchall()

    single_parents = defaultdict(set)
    for rel in orphan_rels:
        single_parents[(rel['family_id'], rel['person1_id'])].add(rel['person2_id'])

    for (fid, parent_id), child_ids in single_parents.items():
        existing = db.execute(
            "SELECT id FROM family_unit WHERE family_id = ? AND partner1_id = ? AND partner2_id IS NULL AND union_type = 'single_parent'",
            (fid, parent_id)
        ).fetchone()
        if existing:
            fu_id = existing['id']
        else:
            cursor = db.execute(
                "INSERT INTO family_unit (family_id, partner1_id, partner2_id, union_type) VALUES (?, ?, NULL, 'single_parent')",
                (fid, parent_id)
            )
            fu_id = cursor.lastrowid

        for child_id in child_ids:
            db.execute(
                "UPDATE relationship SET family_unit_id = ? WHERE person1_id = ? AND person2_id = ? AND rel_type IN ('parent_child', 'adopted_parent_child') AND family_id = ?",
                (fu_id, parent_id, child_id, fid)
            )

    db.commit()
    db.close()
    print("Migration complete.")


if __name__ == "__main__":
    migrate()
