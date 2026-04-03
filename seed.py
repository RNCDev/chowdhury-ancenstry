"""Seed the database with initial Chowdhury family data and an admin user."""

import sqlite3

from werkzeug.security import generate_password_hash

from db import DATABASE, init_db


def seed():
    init_db()
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")

    # Check if data already exists
    count = db.execute("SELECT COUNT(*) FROM person").fetchone()[0]
    if count > 0:
        print(f"Database already has {count} people. Skipping seed.")
        db.close()
        return

    # Create admin user
    cursor = db.execute(
        "INSERT INTO user (username, password_hash, display_name) VALUES (?, ?, ?)",
        ("admin", generate_password_hash("admin"), "Admin"),
    )
    admin_id = cursor.lastrowid

    # Create family
    cursor = db.execute("INSERT INTO family (name) VALUES (?)", ("Chowdhury",))
    family_id = cursor.lastrowid

    # Make admin a member
    db.execute(
        "INSERT INTO family_membership (user_id, family_id, role) VALUES (?, ?, 'admin')",
        (admin_id, family_id),
    )

    # Insert people
    people = [
        ("Prodiptya", None, "Chowdhury"),
        ("Sangeeta", None, "Chowdhury"),
        ("Ritujoy", None, "Chowdhury"),
        ("Joseph", None, "Noreika"),
        ("Joanne", None, "Keane"),
        ("Sarah", "Elizabeth", "Norieka"),
        ("Livia", "Elizabeth", "Chowdhury"),
    ]

    ids = {}
    for first, middle, last in people:
        cursor = db.execute(
            "INSERT INTO person (family_id, first_name, middle_name, last_name) VALUES (?, ?, ?, ?)",
            (family_id, first, middle, last),
        )
        ids[f"{first} {last}"] = cursor.lastrowid

    # Create family units
    fu_cursor = db.execute(
        "INSERT INTO family_unit (family_id, partner1_id, partner2_id, union_type) VALUES (?, ?, ?, 'marriage')",
        (family_id, ids["Prodiptya Chowdhury"], ids["Sangeeta Chowdhury"]),
    )
    fu_chowdhury = fu_cursor.lastrowid

    fu_cursor = db.execute(
        "INSERT INTO family_unit (family_id, partner1_id, partner2_id, union_type) VALUES (?, ?, ?, 'marriage')",
        (family_id, ids["Joseph Noreika"], ids["Joanne Keane"]),
    )
    fu_noreika = fu_cursor.lastrowid

    fu_cursor = db.execute(
        "INSERT INTO family_unit (family_id, partner1_id, partner2_id, union_type) VALUES (?, ?, ?, 'marriage')",
        (family_id, ids["Ritujoy Chowdhury"], ids["Sarah Norieka"]),
    )
    fu_ritujoy = fu_cursor.lastrowid

    # Insert relationships (spouse pairs + parent_child with family_unit_id)
    relationships = [
        (ids["Prodiptya Chowdhury"], ids["Sangeeta Chowdhury"], "spouse", None, None),
        (ids["Joseph Noreika"], ids["Joanne Keane"], "spouse", None, None),
        (ids["Ritujoy Chowdhury"], ids["Sarah Norieka"], "spouse", None, None),
        # Parent-child with family_unit_id and birth_order
        (ids["Prodiptya Chowdhury"], ids["Ritujoy Chowdhury"], "parent_child", fu_chowdhury, 1),
        (ids["Sangeeta Chowdhury"], ids["Ritujoy Chowdhury"], "parent_child", fu_chowdhury, 1),
        (ids["Joseph Noreika"], ids["Sarah Norieka"], "parent_child", fu_noreika, 1),
        (ids["Joanne Keane"], ids["Sarah Norieka"], "parent_child", fu_noreika, 1),
        (ids["Ritujoy Chowdhury"], ids["Livia Chowdhury"], "parent_child", fu_ritujoy, 1),
        (ids["Sarah Norieka"], ids["Livia Chowdhury"], "parent_child", fu_ritujoy, 1),
    ]

    for person1_id, person2_id, rel_type, fu_id, birth_ord in relationships:
        db.execute(
            "INSERT INTO relationship (family_id, person1_id, person2_id, rel_type, family_unit_id, birth_order) VALUES (?, ?, ?, ?, ?, ?)",
            (family_id, person1_id, person2_id, rel_type, fu_id, birth_ord),
        )

    db.commit()
    db.close()
    print("Seeded 7 people, 3 family units, 9 relationships, 1 family, and admin user (admin/admin).")


if __name__ == "__main__":
    seed()
