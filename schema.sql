CREATE TABLE IF NOT EXISTS person (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    birth_name_first TEXT,
    birth_name_last TEXT,
    date_of_birth TEXT,
    place_of_birth TEXT,
    email TEXT,
    linkedin_url TEXT,
    photo_path TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relationship (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person1_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    person2_id INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    rel_type TEXT NOT NULL CHECK (rel_type IN (
        'spouse', 'divorced', 'parent_child', 'adopted_parent_child'
    )),
    start_date TEXT,
    end_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(person1_id, person2_id, rel_type)
);

CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL CHECK (action IN ('add', 'edit', 'delete')),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'relationship')),
    entity_id INTEGER,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
