import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create the db file in the root directory
const dbPath = path.join(__dirname, 'restyle.db');
const db = new Database(dbPath);

// Initialize Tables
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    location TEXT,
    role TEXT DEFAULT 'user',
    credits INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export default db;
