import Database from 'better-sqlite3';
import path from 'path';

export const db = new Database('database.sqlite', { verbose: console.log });

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
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(vk_id) ON DELETE CASCADE
    );
  `);

  try {
    db.exec(`ALTER TABLE filters ADD COLUMN url TEXT;`);
  } catch (e) {
    // Column already exists
  }

  console.log('Database initialized successfully.');
}
