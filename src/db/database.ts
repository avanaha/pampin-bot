import Database from 'better-sqlite3';
import { Reminder, UserSettings, UserSession } from '../types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

export function initDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  createTables();
  
  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function createTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      event_date TEXT NOT NULL,
      event_time TEXT,
      timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
      reminder_periods TEXT NOT NULL DEFAULT '[86400000]',
      repeat_yearly INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_notification TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_chat_id ON reminders(chat_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_is_active ON reminders(is_active);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, chat_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'idle',
      data TEXT NOT NULL DEFAULT '{}',
      last_activity TEXT NOT NULL,
      PRIMARY KEY (user_id, chat_id)
    );
  `);
}

export function createReminder(input: {
  user_id: number;
  chat_id: number;
  title: string;
  description?: string;
  event_date: string;
  event_time?: string;
  timezone?: string;
  reminder_periods?: number[];
  repeat_yearly?: boolean;
  is_active?: boolean;
}): Reminder {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO reminders (
      id, user_id, chat_id, title, description, event_date, event_time,
      timezone, reminder_periods, repeat_yearly, created_at, updated_at, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.user_id,
    input.chat_id,
    input.title,
    input.description || null,
    input.event_date,
    input.event_time || null,
    input.timezone || 'Europe/Moscow',
    JSON.stringify(input.reminder_periods || [86400000]),
    input.repeat_yearly ? 1 : 0,
    now,
    now,
    input.is_active !== false ? 1 : 0
  );

  console.log(`[DB] Created reminder ${id}: "${input.title}"`);

  return {
    id,
    user_id: input.user_id,
    chat_id: input.chat_id,
    title: input.title,
    description: input.description,
    event_date: input.event_date,
    event_time: input.event_time,
    timezone: input.timezone || 'Europe/Moscow',
    reminder_periods: input.reminder_periods || [86400000],
    repeat_yearly: input.repeat_yearly || false,
    created_at: new Date(now),
    updated_at: new Date(now),
    is_active: input.is_active !== false
  };
}

export function getReminderById(id: string): Reminder | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM reminders WHERE id = ?');
  const row = stmt.get(id) as any;
  return row ? rowToReminder(row) : null;
}

export function getRemindersByUser(userId: number, chatId: number): Reminder[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM reminders WHERE user_id = ? AND chat_id = ? AND is_active = 1 ORDER BY event_date ASC');
  const rows = stmt.all(userId, chatId) as any[];
  return rows.map(rowToReminder);
}

export function getAllActiveReminders(): Reminder[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM reminders WHERE is_active = 1 ORDER BY event_date ASC');
  const rows = stmt.all() as any[];
  return rows.map(rowToReminder);
}

export function deleteReminder(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('UPDATE reminders SET is_active = 0 WHERE id = ?');
  const result = stmt.run(id);
  console.log(`[DB] Deleted reminder ${id}`);
  return result.changes > 0;
}

export function getUserSettings(userId: number, chatId: number): UserSettings | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM user_settings WHERE user_id = ? AND chat_id = ?');
  const row = stmt.get(userId, chatId) as any;
  
  if (!row) return null;
  return {
    user_id: row.user_id,
    chat_id: row.chat_id,
    timezone: row.timezone,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at)
  };
}

export function upsertUserSettings(input: Partial<UserSettings> & { user_id: number; chat_id: number }): UserSettings {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getUserSettings(input.user_id, input.chat_id);

  if (existing) {
    const stmt = db.prepare('UPDATE user_settings SET timezone = ?, updated_at = ? WHERE user_id = ? AND chat_id = ?');
    stmt.run(input.timezone || existing.timezone, now, input.user_id, input.chat_id);
  } else {
    const stmt = db.prepare('INSERT INTO user_settings (user_id, chat_id, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    stmt.run(input.user_id, input.chat_id, input.timezone || 'Europe/Moscow', now, now);
  }

  return getUserSettings(input.user_id, input.chat_id)!;
}

export function getUserSession(userId: number, chatId: number): UserSession {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM user_sessions WHERE user_id = ? AND chat_id = ?');
  const row = stmt.get(userId, chatId) as any;
  
  if (row) {
    return {
      user_id: row.user_id,
      chat_id: row.chat_id,
      state: row.state as UserSession['state'],
      data: JSON.parse(row.data || '{}'),
      last_activity: new Date(row.last_activity)
    };
  }

  const now = new Date().toISOString();
  const insertStmt = db.prepare('INSERT INTO user_sessions (user_id, chat_id, state, data, last_activity) VALUES (?, ?, ?, ?, ?)');
  insertStmt.run(userId, chatId, 'idle', '{}', now);

  return { user_id: userId, chat_id: chatId, state: 'idle', data: {}, last_activity: new Date(now) };
}

export function updateUserSession(userId: number, chatId: number, updates: Partial<UserSession>): UserSession {
  const db = getDb();
  const now = new Date().toISOString();

  const fields: string[] = ['last_activity = ?'];
  const values: any[] = [now];

  if (updates.state !== undefined) { fields.push('state = ?'); values.push(updates.state); }
  if (updates.data !== undefined) { fields.push('data = ?'); values.push(JSON.stringify(updates.data)); }

  values.push(userId, chatId);
  const stmt = db.prepare(`UPDATE user_sessions SET ${fields.join(', ')} WHERE user_id = ? AND chat_id = ?`);
  stmt.run(...values);

  return getUserSession(userId, chatId);
}

export function clearUserSession(userId: number, chatId: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare("UPDATE user_sessions SET state = 'idle', data = '{}', last_activity = ? WHERE user_id = ? AND chat_id = ?");
  stmt.run(now, userId, chatId);
}

function rowToReminder(row: any): Reminder {
  return {
    id: row.id,
    user_id: row.user_id,
    chat_id: row.chat_id,
    title: row.title,
    description: row.description || undefined,
    event_date: row.event_date,
    event_time: row.event_time || undefined,
    timezone: row.timezone,
    reminder_periods: JSON.parse(row.reminder_periods || '[86400000]'),
    repeat_yearly: row.repeat_yearly === 1,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    is_active: row.is_active === 1
  };
}
