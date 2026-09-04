PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  email_verified_at TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_banned INTEGER NOT NULL DEFAULT 0,
  avatar TEXT,
  avatar_revision INTEGER NOT NULL DEFAULT 0,
  bio TEXT DEFAULT '',
  avatar_frame TEXT NOT NULL DEFAULT 'none',
  avatar_overlay TEXT NOT NULL DEFAULT 'none',
  equipped_title TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE problems (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL
);

CREATE TABLE submissions (
  id INTEGER PRIMARY KEY,
  problem_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  FOREIGN KEY (problem_id) REFERENCES problems (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

INSERT INTO users (
  id, name, password_hash, email, email_verified_at, is_admin, is_banned,
  avatar, bio, avatar_frame, avatar_overlay, equipped_title, created_at
) VALUES
  ('alice', 'Alice', 'fixture-hash-a', 'alice@example.test', '2026-01-01T00:00:00.000Z', 0, 0,
   'data:image/png;base64,fixture', 'hello', 'meteor', 'none', 'level:1', '2026-01-01T00:00:00.000Z'),
  ('banned', 'Banned', 'fixture-hash-b', 'banned@example.test', '2026-01-02T00:00:00.000Z', 0, 1,
   NULL, '', 'none', 'none', NULL, '2026-01-02T00:00:00.000Z');

INSERT INTO sessions (token, user_id, created_at) VALUES
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'alice', '2026-01-03T00:00:00.000Z'),
  ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'banned', '2026-01-03T00:00:00.000Z');

INSERT INTO problems (id, title) VALUES (1001, 'Fixture Problem');
INSERT INTO submissions (id, problem_id, user_id, status) VALUES (1, 1001, 'alice', 'AC');
