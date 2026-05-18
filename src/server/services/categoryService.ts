import { db } from '../database';

export interface Category {
  id: number;
  user_id: number;
  category_code: string;
  title: string;
  is_initialized: number;
}

export interface Filter {
  id: number;
  category_id: number;
  min_price: number | null;
  max_price: number | null;
  condition: string; // 'all', 'new', 'used'
  search_query: string | null;
  url: string | null;
}

export function getUserCategories(vkId: number): Category[] {
  const stmt = db.prepare('SELECT * FROM categories WHERE user_id = ?');
  return stmt.all(vkId) as Category[];
}

export function addCategory(vkId: number, categoryCode: string, title: string, customUrl?: string): Category {
  const stmt = db.prepare('INSERT INTO categories (user_id, category_code, title) VALUES (?, ?, ?)');
  const info = stmt.run(vkId, categoryCode, title);
  
  // Create default filters
  const filterStmt = db.prepare('INSERT INTO filters (category_id, url) VALUES (?, ?)');
  filterStmt.run(info.lastInsertRowid, customUrl || null);
  
  return { id: info.lastInsertRowid as number, user_id: vkId, category_code: categoryCode, title };
}

export function removeCategory(categoryId: number, vkId: number) {
  // Check ownership
  const checkStmt = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?');
  const cat = checkStmt.get(categoryId, vkId);
  if (cat) {
    const stmt = db.prepare('DELETE FROM categories WHERE id = ?');
    stmt.run(categoryId);
  }
}

export function removeAllCategories(vkId: number) {
  const stmt = db.prepare('DELETE FROM categories WHERE user_id = ?');
  stmt.run(vkId);
}

export function getCategoryFilters(categoryId: number): Filter | undefined {
  const stmt = db.prepare('SELECT * FROM filters WHERE category_id = ?');
  return stmt.get(categoryId) as Filter | undefined;
}

export function updateFilter(categoryId: number, filterObj: Partial<Filter>) {
  const existing = getCategoryFilters(categoryId);
  if (!existing) return;
  
  const updated = { ...existing, ...filterObj };
  
  const stmt = db.prepare(`
    UPDATE filters 
    SET min_price = ?, max_price = ?, condition = ?, search_query = ?
    WHERE category_id = ?
  `);
  stmt.run(
    updated.min_price, 
    updated.max_price, 
    updated.condition, 
    updated.search_query, 
    categoryId
  );
}

export function resetFilters(categoryId: number) {
  const stmt = db.prepare(`
    UPDATE filters 
    SET min_price = NULL, max_price = NULL, condition = 'all', search_query = NULL
    WHERE category_id = ?
  `);
  stmt.run(categoryId);
}
