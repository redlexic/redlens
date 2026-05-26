-- Migration 001: remove UNIQUE constraint from docs.doc_no
-- doc_no uniqueness is enforced by the atlas itself; having it in D1 causes
-- SQLITE_CONSTRAINT_UNIQUE when docs are renumbered (a doc_no moves to a
-- different UUID, colliding before ON CONFLICT(id) can fire).
--
-- SQLite does not support DROP CONSTRAINT, so we rebuild the table.
-- Guard: only run this file when sqlite_master still shows UNIQUE on doc_no.

DROP TABLE IF EXISTS docs_new;
CREATE TABLE docs_new (
  id         TEXT PRIMARY KEY,
  doc_no     TEXT NOT NULL,
  title      TEXT NOT NULL,
  type       TEXT NOT NULL,
  depth      INTEGER NOT NULL DEFAULT 0,
  parent_id  TEXT,
  content    TEXT NOT NULL DEFAULT '',
  ord        INTEGER NOT NULL DEFAULT 0,
  atlas_hash TEXT,
  updated_at TEXT
);
INSERT INTO docs_new SELECT id,doc_no,title,type,depth,parent_id,content,ord,atlas_hash,updated_at FROM docs;
DROP TABLE IF EXISTS docs_fts;
DROP TABLE docs;
ALTER TABLE docs_new RENAME TO docs;
CREATE INDEX IF NOT EXISTS idx_docs_doc_no ON docs(doc_no);
CREATE INDEX IF NOT EXISTS idx_docs_parent ON docs(parent_id);
CREATE INDEX IF NOT EXISTS idx_docs_type   ON docs(type);
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  id UNINDEXED,
  doc_no,
  title,
  type,
  content,
  content=docs,
  content_rowid=rowid
);
