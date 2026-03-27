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

export function archiveReminder(id: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE reminders SET is_active = 0, updated_at = ? WHERE id = ?');
  const result = stmt.run(now, id);
  return result.changes > 0;
}

export function restoreReminder(id: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE reminders SET is_active = 1, updated_at = ? WHERE id = ?');
  const result = stmt.run(now, id);
  return result.changes > 0;
}

export function getArchivedRemindersByUser(userId: number, chatId: number): Reminder[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM reminders WHERE user_id = ? AND chat_id = ? AND is_active = 0 ORDER BY event_date DESC');
  const rows = stmt.all(userId, chatId) as any[];
  return rows.map(rowToReminder);
}

export function deleteReminderPermanently(id: string): boolean {
  const db = getDb();
  const deleteNotifications = db.prepare('DELETE FROM notifications WHERE reminder_id = ?');
  deleteNotifications.run(id);
  
  const stmt = db.prepare('DELETE FROM reminders WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// User settings operations
export function getUserSettings(userId: number, chatId: number): UserSettings | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM user_settings WHERE user_id = ? AND chat_id = ?');
  const row = stmt.get(userId, chatId) as any;
  
  if (!row) return null;
  return {
    user_id: row.user_id,
    chat_id: row.chat_id,
    timezone: row.timezone,
    language: row.language,
    default_periods: JSON.parse(row.default_periods),
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at)
  };
}

export function upsertUserSettings(settings: Partial<UserSettings> & { user_id: number; chat_id: number }): UserSettings {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getUserSettings(settings.user_id, settings.chat_id);

  if (existing) {
    const stmt = db.prepare(`
      UPDATE user_settings 
      SET timezone = ?, language = ?, default_periods = ?, updated_at = ?
      WHERE user_id = ? AND chat_id = ?
    `);
    stmt.run(
      settings.timezone || existing.timezone,
      settings.language || existing.language,
      JSON.stringify(settings.default_periods || existing.default_periods),
      now,
      settings.user_id,
      settings.chat_id
    );
  } else {
    const stmt = db.prepare(`
      INSERT INTO user_settings (user_id, chat_id, timezone, language, default_periods, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      settings.user_id,
      settings.chat_id,
      settings.timezone || 'Europe/Moscow',
      settings.language || 'ru',
      JSON.stringify(settings.default_periods || []),
      now,
      now
    );
  }

  return getUserSettings(settings.user_id, settings.chat_id)!;
}

// User session operations
export function getUserSession(userId: number, chatId: number): UserSession {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM user_sessions WHERE user_id = ? AND chat_id = ?');
  const row = stmt.get(userId, chatId) as any;
  
  if (row) {
    return {
      user_id: row.user_id,
      chat_id: row.chat_id,
      state: row.state as UserSession['state'],
      data: JSON.parse(row.data),
      last_activity: new Date(row.last_activity)
    };
  }

  const now = new Date().toISOString();
  const insertStmt = db.prepare(`
    INSERT INTO user_sessions (user_id, chat_id, state, data, last_activity)
    VALUES (?, ?, 'idle', '{}', ?)
  `);
  insertStmt.run(userId, chatId, now);

  return {
    user_id: userId,
    chat_id: chatId,
    state: 'idle',
    data: {},
    last_activity: new Date(now)
  };
}

export function updateUserSession(userId: number, chatId: number, updates: Partial<UserSession>): UserSession {
  const db = getDb();
  const now = new Date().toISOString();

  const fields: string[] = ['last_activity = ?'];
  const values: any[] = [now];

  if (updates.state !== undefined) {
    fields.push('state = ?');
    values.push(updates.state);
  }
  if (updates.data !== undefined) {
    fields.push('data = ?');
    values.push(JSON.stringify(updates.data));
  }

  values.push(userId, chatId);

  const stmt = db.prepare(`UPDATE user_sessions SET ${fields.join(', ')} WHERE user_id = ? AND chat_id = ?`);
  stmt.run(...values);

  return getUserSession(userId, chatId);
}

export function clearUserSession(userId: number, chatId: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`UPDATE user_sessions SET state = 'idle', data = '{}', last_activity = ? WHERE user_id = ? AND chat_id = ?`);
  stmt.run(now, userId, chatId);
}

// Notification operations
export function createNotification(notification: Omit<Notification, 'id'>): Notification {
  const db = getDb();
  const id = uuidv4();

  const stmt = db.prepare(`
    INSERT INTO notifications (id, reminder_id, scheduled_at, sent_at, status, period_ms, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    notification.reminder_id,
    notification.scheduled_at.toISOString(),
    notification.sent_at?.toISOString() || null,
    notification.status,
    notification.period_ms,
    notification.error_message || null
  );

  return { ...notification, id };
}

export function getPendingNotifications(): Notification[] {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM notifications WHERE status = 'pending' ORDER BY scheduled_at ASC");
  const rows = stmt.all() as any[];
  return rows.map(rowToNotification);
}

export function updateNotificationStatus(id: string, status: Notification['status'], errorMessage?: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE notifications 
    SET status = ?, sent_at = ?, error_message = ?
    WHERE id = ?
  `);
  stmt.run(status, status === 'sent' ? new Date().toISOString() : null, errorMessage || null, id);
}

// Helper functions
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
    reminder_periods: JSON.parse(row.reminder_periods || '[]'),
    repeat_type: (row.repeat_type as RepeatType) || 'none',
    repeat_days: row.repeat_days ? JSON.parse(row.repeat_days) : undefined,
    repeat_month_day: row.repeat_month_day || undefined,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    is_active: row.is_active === 1,
    last_notification: row.last_notification ? new Date(row.last_notification) : undefined,
    next_notification: row.next_notification ? new Date(row.next_notification) : undefined
  };
}

function rowToNotification(row: any): Notification {
  return {
    id: row.id,
    reminder_id: row.reminder_id,
    scheduled_at: new Date(row.scheduled_at),
    sent_at: row.sent_at ? new Date(row.sent_at) : undefined,
    status: row.status as Notification['status'],
    period_ms: row.period_ms,
    error_message: row.error_message || undefined
  };
}
