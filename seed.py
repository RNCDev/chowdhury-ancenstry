"""Seed the database with initial Chowdhury family data."""

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

    # Insert people
    people = [
        ('Prodiptya', None, 'Chowdhury', None, None, None, None, None, None, None),
        ('Sangeeta', None, 'Chowdhury', None, None, None, None, None, None, None),
        ('Ritujoy', None, 'Chowdhury', None, None, None, None, None, None, None),
        ('Joseph', None, 'Noreika', None, None, None, None, None, None, None),
        ('Joanne', None, 'Keane', None, None, None, None, None, None, None),
        ('Sarah', 'Elizabeth', 'Norieka', None, 'Keane', None, None, None, None, None),
        ('Livia', 'Elizabeth', 'Chowdhury', None, None, None, None, None, None, None),
    ]

    ids = {}
    for p in people:
        cursor = db.execute(
            """INSERT INTO person (first_name, middle_name, last_name, birth_name_first,
                birth_name_last, date_of_birth, place_of_birth, email, linkedin_url, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            p,
        )
        ids[f"{p[0]} {p[2]}"] = cursor.lastrowid

    # Insert relationships
    relationships = [
        # Spouses (person1_id < person2_id for consistency)
        (ids['Prodiptya Chowdhury'], ids['Sangeeta Chowdhury'], 'spouse'),
        (ids['Joseph Noreika'], ids['Joanne Keane'], 'spouse'),
        (ids['Ritujoy Chowdhury'], ids['Sarah Norieka'], 'spouse'),
        # Parent → Child
        (ids['Prodiptya Chowdhury'], ids['Ritujoy Chowdhury'], 'parent_child'),
        (ids['Sangeeta Chowdhury'], ids['Ritujoy Chowdhury'], 'parent_child'),
        (ids['Joseph Noreika'], ids['Sarah Norieka'], 'parent_child'),
        (ids['Joanne Keane'], ids['Sarah Norieka'], 'parent_child'),
        (ids['Ritujoy Chowdhury'], ids['Livia Chowdhury'], 'parent_child'),
        (ids['Sarah Norieka'], ids['Livia Chowdhury'], 'parent_child'),
    ]

    for person1_id, person2_id, rel_type in relationships:
        db.execute(
            "INSERT INTO relationship (person1_id, person2_id, rel_type) VALUES (?, ?, ?)",
            (person1_id, person2_id, rel_type),
        )

    db.commit()
    db.close()
    print("Seeded 7 people and 9 relationships.")


if __name__ == '__main__':
    seed()
