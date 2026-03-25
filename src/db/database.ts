import Database from 'better-sqlite3';
import { Reminder, UserSettings, UserSession, Notification, RepeatType } from '../types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

/**
 * Initialize database
 */
export function initDatabase(dbPath: string): Database.Database {
  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  createTables();
  
  return db;
}

/**
 * Get database instance
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Create all tables
 */
function createTables(): void {
  const db = getDb();

  // Reminders table
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
      reminder_periods TEXT NOT NULL DEFAULT '[]',
      repeat_type TEXT NOT NULL DEFAULT 'none',
      repeat_days TEXT,
      repeat_month_day INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_notification TEXT,
      next_notification TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_chat_id ON reminders(chat_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_event_date ON reminders(event_date);
    CREATE INDEX IF NOT EXISTS idx_reminders_is_active ON reminders(is_active);
  `);

  // User settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
      language TEXT NOT NULL DEFAULT 'ru',
      default_periods TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, chat_id)
    );
  `);

  // User sessions table
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

  // Notifications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      reminder_id TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      sent_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      period_ms INTEGER NOT NULL,
      error_message TEXT,
      FOREIGN KEY (reminder_id) REFERENCES reminders(id)
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_reminder_id ON notifications(reminder_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_at ON notifications(scheduled_at);
  `);

  // Миграция: добавляем новые колонки если их нет
  try {
    db.exec(`ALTER TABLE reminders ADD COLUMN repeat_type TEXT NOT NULL DEFAULT 'none'`);
  } catch (e) { /* колонка уже существует */ }
  
  try {
    db.exec(`ALTER TABLE reminders ADD COLUMN repeat_days TEXT`);
  } catch (e) { /* колонка уже существует */ }
  
  try {
    db.exec(`ALTER TABLE reminders ADD COLUMN repeat_month_day INTEGER`);
  } catch (e) { /* колонка уже существует */ }
}
// Reminder operations
export function createReminder(reminder: Omit<Reminder, 'id' | 'created_at' | 'updated_at'>): Reminder {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO reminders (
      id, user_id, chat_id, title, description, event_date, event_time,
      timezone, reminder_periods, repeat_type, repeat_days, repeat_month_day,
      created_at, updated_at, is_active, last_notification, next_notification
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    reminder.user_id,
    reminder.chat_id,
    reminder.title,
    reminder.description || null,
    reminder.event_date,
    reminder.event_time || null,
    reminder.timezone,
    JSON.stringify(reminder.reminder_periods),
    reminder.repeat_type || 'none',
    reminder.repeat_days ? JSON.stringify(reminder.repeat_days) : null,
    reminder.repeat_month_day || null,
    now,
    now,
    reminder.is_active ? 1 : 0,
    reminder.last_notification?.toISOString() || null,
    reminder.next_notification?.toISOString() || null
  );

  return { ...reminder, id, created_at: new Date(now), updated_at: new Date(now) };
}

export function getReminderById(id: string): Reminder | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM reminders WHERE id = ?');
  const row = stmt.get(id) as any;
  
  if (!row) return null;
  return rowToReminder(row);
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

export function updateReminder(id: string, updates: Partial<Reminder>): Reminder | null {
  const db = getDb();
  const now = new Date().toISOString();
  
  const fields: string[] = ['updated_at = ?'];
  const values: any[] = [now];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.event_date !== undefined) {
    fields.push('event_date = ?');
    values.push(updates.event_date);
  }
  if (updates.event_time !== undefined) {
    fields.push('event_time = ?');
    values.push(updates.event_time);
  }
  if (updates.timezone !== undefined) {
    fields.push('timezone = ?');
    values.push(updates.timezone);
  }
  if (updates.reminder_periods !== undefined) {
    fields.push('reminder_periods = ?');
    values.push(JSON.stringify(updates.reminder_periods));
  }
  if (updates.repeat_type !== undefined) {
    fields.push('repeat_type = ?');
    values.push(updates.repeat_type);
  }
  if (updates.repeat_days !== undefined) {
    fields.push('repeat_days = ?');
    values.push(updates.repeat_days ? JSON.stringify(updates.repeat_days) : null);
  }
  if (updates.repeat_month_day !== undefined) {
    fields.push('repeat_month_day = ?');
    values.push(updates.repeat_month_day || null);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active ? 1 : 0);
  }
  if (updates.last_notification !== undefined) {
    fields.push('last_notification = ?');
    values.push(updates.last_notification?.toISOString() || null);
  }
  if (updates.next_notification !== undefined) {
    fields.push('next_notification = ?');
    values.push(updates.next_notification?.toISOString() || null);
  }

  values.push(id);

  const stmt = db.prepare(`UPDATE reminders SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return getReminderById(id);
}

export function deleteReminder(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('UPDATE reminders SET is_active = 0 WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// Archive reminder (soft delete with is_active = 0)
export function archiveReminder(id: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE reminders SET is_active = 0, updated_at = ? WHERE id = ?');
  const result = stmt.run(now, id);
  return result.changes > 0;
}

// Restore reminder from archive (set is_active = 1)
export function restoreReminder(id: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE reminders SET is_active = 1, updated_at = ? WHERE id = ?');
  const result = stmt.run(now, id);
  return result.changes > 0;
}

// Get archived reminders by user
export function getArchivedRemindersByUser(userId: number, chatId: number): Reminder[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM reminders WHERE user_id = ? AND chat_id = ? AND is_active = 0 ORDER BY event_date DESC');
  const rows = stmt.all(userId, chatId) as any[];
  return rows.map(rowToReminder);
}

// Permanently delete reminder
export function deleteReminderPermanently(id: string): boolean {
  const db = getDb();
  // First delete related notifications
  const deleteNotifications = db.prepare('DELETE FROM notifications WHERE reminder_id = ?');
  deleteNotifications.run(id);
  
  // Then delete the reminder
  const stmt = db.prepare('DELETE FROM reminders WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}
