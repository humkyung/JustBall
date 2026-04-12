/**
 * Prebuild script: reads all stage JSON files from public/stages/
 * and creates public/justball.db (SQLite database).
 *
 * Usage: node scripts/prebuild-db.js
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stagesDir = path.resolve(__dirname, '../public/stages');
const dbPath = path.resolve(__dirname, '../public/justball.db');

// Remove old DB if exists
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const db = new Database(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS stages (
    name      TEXT PRIMARY KEY,
    filename  TEXT,
    data      TEXT NOT NULL,
    source    TEXT DEFAULT 'default',
    level     INTEGER DEFAULT 0,
    locked    INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS progress (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Insert default progress
db.prepare("INSERT INTO progress (key, value) VALUES ('maxClearedLevel', '0')").run();

// Read index.json
const indexPath = path.join(stagesDir, 'index.json');
const fileList = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

const insert = db.prepare(`
  INSERT OR REPLACE INTO stages (name, filename, data, source, level, locked)
  VALUES (?, ?, ?, 'default', ?, ?)
`);

let count = 0;
for (const filename of fileList) {
  const filePath = path.join(stagesDir, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`  SKIP: ${filename} (not found)`);
    continue;
  }
  const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  insert.run(
    json.name,
    filename,
    JSON.stringify(json.data),
    json.data.level || 0,
    json.data.locked ? 1 : 0,
  );
  count++;
}

db.close();

const size = (fs.statSync(dbPath).size / 1024).toFixed(1);
console.log(`justball.db created: ${count} stages, ${size} KB`);
