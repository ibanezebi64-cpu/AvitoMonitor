import { db } from '../database';

export interface User {
  vk_id: number;
  is_active: boolean;
  state: string;
  created_at: string;
}

export function getUser(vkId: number): User | undefined {
  const stmt = db.prepare('SELECT * FROM users WHERE vk_id = ?');
  const user = stmt.get(vkId) as User | undefined;
  // Convert 1/0 to boolean for is_active
  if (user) {
    user.is_active = Boolean(user.is_active);
  }
  return user;
}

export function createUser(vkId: number): User {
  const stmt = db.prepare('INSERT INTO users (vk_id, is_active, state) VALUES (?, ?, ?)');
  stmt.run(vkId, 0, 'main_menu');
  return getUser(vkId)!;
}

export function getOrCreateUser(vkId: number): User {
  let user = getUser(vkId);
  if (!user) {
    user = createUser(vkId);
  }
  return user;
}

export function updateUserState(vkId: number, state: string) {
  const stmt = db.prepare('UPDATE users SET state = ? WHERE vk_id = ?');
  stmt.run(state, vkId);
}

export function toggleUserTracking(vkId: number): boolean {
  const user = getUser(vkId);
  if (!user) return false;
  
  const newState = user.is_active ? 0 : 1;
  const stmt = db.prepare('UPDATE users SET is_active = ? WHERE vk_id = ?');
  stmt.run(newState, vkId);
  
  if (newState === 0) {
    // If tracking is stopped, delete all seen ads and reset category initialization
    db.prepare('DELETE FROM seen_ads WHERE user_id = ?').run(vkId);
    db.prepare('UPDATE categories SET is_initialized = 0 WHERE user_id = ?').run(vkId);
  }
  
  return Boolean(newState);
}

export function getAllActiveUsers(): User[] {
  const stmt = db.prepare('SELECT * FROM users WHERE is_active = 1');
  const users = stmt.all() as User[];
  return users.map(u => ({...u, is_active: true}));
}
