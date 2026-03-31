"""Seed the database with initial Chowdhury family data and an admin user."""

from werkzeug.security import generate_password_hash

from db import get_db, init_db


def seed():
    init_db()
    db = get_db()

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

    # Insert relationships
    relationships = [
        (ids["Prodiptya Chowdhury"], ids["Sangeeta Chowdhury"], "spouse"),
        (ids["Joseph Noreika"], ids["Joanne Keane"], "spouse"),
        (ids["Ritujoy Chowdhury"], ids["Sarah Norieka"], "spouse"),
        (ids["Prodiptya Chowdhury"], ids["Ritujoy Chowdhury"], "parent_child"),
        (ids["Sangeeta Chowdhury"], ids["Ritujoy Chowdhury"], "parent_child"),
        (ids["Joseph Noreika"], ids["Sarah Norieka"], "parent_child"),
        (ids["Joanne Keane"], ids["Sarah Norieka"], "parent_child"),
        (ids["Ritujoy Chowdhury"], ids["Livia Chowdhury"], "parent_child"),
        (ids["Sarah Norieka"], ids["Livia Chowdhury"], "parent_child"),
    ]

    for person1_id, person2_id, rel_type in relationships:
        db.execute(
            "INSERT INTO relationship (family_id, person1_id, person2_id, rel_type) VALUES (?, ?, ?, ?)",
            (family_id, person1_id, person2_id, rel_type),
        )

    db.commit()
    db.close()
    print("Seeded 7 people, 9 relationships, 1 family, and admin user (admin/admin).")


if __name__ == "__main__":
    seed()
