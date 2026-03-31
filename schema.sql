CREATE TABLE IF NOT EXISTS user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS family (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS family_membership (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    family_id INTEGER NOT NULL REFERENCES family(id) ON DELETE CASCADE,
    person_id INTEGER REFERENCES person(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, family_id)
);

CREATE TABLE IF NOT EXISTS invite_token (
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

CREATE TABLE IF NOT EXISTS person (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER REFERENCES family(id) ON DELETE CASCADE,
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
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stub')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relationship (
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

CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES user(id),
    family_id INTEGER REFERENCES family(id),
    action TEXT NOT NULL CHECK (action IN ('add', 'edit', 'delete')),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'relationship')),
    entity_id INTEGER,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_person_family ON person(family_id);
CREATE INDEX IF NOT EXISTS idx_membership_user ON family_membership(user_id);
CREATE INDEX IF NOT EXISTS idx_invite_person ON invite_token(person_id);
CREATE INDEX IF NOT EXISTS idx_invite_family ON invite_token(family_id);
CREATE INDEX IF NOT EXISTS idx_audit_family ON audit_log(family_id);
CREATE INDEX IF NOT EXISTS idx_relationship_family ON relationship(family_id);
