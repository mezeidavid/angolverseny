-- Futtasd le egyszer a Neon SQL Editorában.

CREATE TABLE IF NOT EXISTS teams (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  school            TEXT NOT NULL DEFAULT '',
  member1           TEXT NOT NULL DEFAULT '',
  member2           TEXT NOT NULL DEFAULT '',
  member3           TEXT NOT NULL DEFAULT '',
  original_member1  TEXT NOT NULL DEFAULT '',
  original_member2  TEXT NOT NULL DEFAULT '',
  original_member3  TEXT NOT NULL DEFAULT '',
  presence          BOOLEAN            -- NULL = még nincs jelölve
);

CREATE TABLE IF NOT EXISTS tasks (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  max_score  INTEGER NOT NULL CHECK (max_score > 0)
);

CREATE TABLE IF NOT EXISTS scores (
  team_id  INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  score    INTEGER NOT NULL CHECK (score >= 0),
  PRIMARY KEY (team_id, task_id)
);
