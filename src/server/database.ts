import Database from 'better-sqlite3';
import path from 'path';

export const db = new Database('database.sqlite', { verbose: console.log });
db.pragma('foreign_keys = ON');

export function initDB() {
  // Enable Write-Ahead Log for better performance/concurrency
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      vk_id INTEGER PRIMARY KEY,
      is_active BOOLEAN DEFAULT false,
      state TEXT DEFAULT 'main_menu',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      category_code TEXT,
      title TEXT,
      FOREIGN KEY(user_id) REFERENCES users(vk_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      min_price INTEGER,
      max_price INTEGER,
      condition TEXT DEFAULT 'all',
      search_query TEXT,
      url TEXT,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS seen_ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      avito_id TEXT,
      category_id INTEGER,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(vk_id) ON DELETE CASCADE
    );
  `);

  try {
    db.prepare('ALTER TABLE categories ADD COLUMN is_initialized INTEGER DEFAULT 0').run();
  } catch(e) {
    // Column might already exist
  }

  try {
    db.prepare('ALTER TABLE seen_ads ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE').run();
  } catch(e) {
    // Column might already exist
  }

  try {
    db.exec(`ALTER TABLE filters ADD COLUMN url TEXT;`);
  } catch (e) {
    // Column already exists
  }
  
  // Clean up any orphaned records
  db.prepare('DELETE FROM seen_ads WHERE category_id IS NOT NULL AND category_id NOT IN (SELECT id FROM categories)').run();
  db.prepare('DELETE FROM filters WHERE category_id NOT IN (SELECT id FROM categories)').run();

  console.log('Database initialized successfully.');
}
