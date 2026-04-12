// ── SQLite Database Manager (sql.js + .db file) ──────────────────────────────
//
// Read:  fetch('justball.db') → sql.js in-memory
// Write: POST /__api/save-db → dev server writes .db file to disk
//
import initSqlJs from 'sql.js';

let db = null;

// ── DB initialization ────────────────────────────────────────────────────────

export async function initDB() {
  const SQL = await initSqlJs({
    locateFile: () => `${import.meta.env.BASE_URL}sql-wasm.wasm`,
  });

  // Load pre-built DB file
  const res = await fetch(`${import.meta.env.BASE_URL}justball.db`);
  if (res.ok) {
    const buf = await res.arrayBuffer();
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    // Fallback: empty DB (should not happen if prebuild ran)
    db = new SQL.Database();
    db.run(`
      CREATE TABLE IF NOT EXISTS stages (
        name TEXT PRIMARY KEY, filename TEXT, data TEXT NOT NULL,
        source TEXT DEFAULT 'user', level INTEGER DEFAULT 0, locked INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS progress (key TEXT PRIMARY KEY, value TEXT);
      INSERT OR IGNORE INTO progress (key, value) VALUES ('maxClearedLevel', '0');
    `);
  }

  return db;
}

// ── Persist: export DB and send to dev server ────────────────────────────────

export function persistDB() {
  if (!db) return Promise.resolve();
  const data = db.export();
  return fetch('/__api/save-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data,
  }).catch(() => { /* dev server not available in production */ });
}

// ── Query helper ─────────────────────────────────────────────────────────────

function _query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// ── Stage CRUD ───────────────────────────────────────────────────────────────

export function getAllStages() {
  if (!db) return [];
  return _query('SELECT name, filename, data, source, level, locked FROM stages ORDER BY level ASC, name ASC')
    .map(row => ({
      name: row.name,
      filename: row.filename || null,
      data: JSON.parse(row.data),
      source: row.source,
      level: row.level,
      locked: row.locked === 1,
    }));
}

export function getStageByName(name) {
  if (!db) return null;
  const rows = _query('SELECT name, filename, data, source, level, locked FROM stages WHERE name = ?', [name]);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    name: row.name,
    filename: row.filename || null,
    data: JSON.parse(row.data),
    source: row.source,
    level: row.level,
    locked: row.locked === 1,
  };
}

export function saveStage(name, data, source = 'user', filename = null) {
  if (!db) return;
  // Auto-assign level: max existing level + 1 (unless data already has a level)
  let level = data.level || 0;
  if (!level) {
    const rows = _query('SELECT MAX(level) as maxLv FROM stages');
    level = (rows.length > 0 && rows[0].maxLv != null) ? rows[0].maxLv + 1 : 1;
  }
  const locked = data.locked ? 1 : 0;
  db.run(
    `INSERT OR REPLACE INTO stages (name, filename, data, source, level, locked)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, filename, JSON.stringify(data), source, level, locked]
  );
}

export function deleteStage(name) {
  if (!db) return;
  db.run('DELETE FROM stages WHERE name = ?', [name]);
}

// ── Progress ─────────────────────────────────────────────────────────────────

export function getProgress() {
  if (!db) return 0;
  const rows = _query("SELECT value FROM progress WHERE key = 'maxClearedLevel'");
  return rows.length > 0 ? parseInt(rows[0].value, 10) || 0 : 0;
}

export function saveProgress(level) {
  if (!db) return;
  const current = getProgress();
  if (level > current) {
    db.run(
      "INSERT OR REPLACE INTO progress (key, value) VALUES ('maxClearedLevel', ?)",
      [String(level)]
    );
  }
}
