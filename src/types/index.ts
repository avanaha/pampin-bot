// PamPin Application Types

export interface Reminder {
  id: string;
  user_id: number;
  chat_id: number;
  title: string;
  description?: string;
  event_date: string; // ISO date string YYYY-MM-DD
  event_time?: string; // HH-mm or HH:mm
  timezone: string;
  reminder_periods: number[]; // periods in milliseconds before event
  repeat_yearly: boolean;
  created_at: Date;
  updated_at: Date;
  is_active: boolean;
  last_notification?: Date;
  next_notification?: Date;
}

export interface ReminderPeriod {
  id: string;
  reminder_id: string;
  period_ms: number; // period in milliseconds
  label: string; // human-readable label like "за 3 месяца", "за 1 день"
  is_custom: boolean;
}

export interface UserSettings {
  user_id: number;
  chat_id: number;
  timezone: string;
  language: string;
  default_periods: number[];
  created_at: Date;
  updated_at: Date;
}

export interface Notification {
  id: string;
  reminder_id: string;
  scheduled_at: Date;
  sent_at?: Date;
  status: 'pending' | 'sent' | 'failed';
  period_ms: number;
  error_message?: string;
}

// Predefined reminder periods
export const PREDEFINED_PERIODS: { value: number; label: string }[] = [
  { value: 365 * 24 * 60 * 60 * 1000, label: 'за 1 год' },
  { value: 6 * 30 * 24 * 60 * 60 * 1000, label: 'за 6 месяцев' },
  { value: 3 * 30 * 24 * 60 * 60 * 1000, label: 'за 3 месяца' },
  { value: 30 * 24 * 60 * 60 * 1000, label: 'за 1 месяц' },
  { value: 14 * 24 * 60 * 60 * 1000, label: 'за 2 недели' },
  { value: 7 * 24 * 60 * 60 * 1000, label: 'за 1 неделю' },
  { value: 3 * 24 * 60 * 60 * 1000, label: 'за 3 дня' },
  { value: 24 * 60 * 60 * 1000, label: 'за 1 день' },
  { value: 12 * 60 * 60 * 1000, label: 'за 12 часов' },
  { value: 6 * 60 * 60 * 1000, label: 'за 6 часов' },
  { value: 3 * 60 * 60 * 1000, label: 'за 3 часа' },
  { value: 1 * 60 * 60 * 1000, label: 'за 1 час' },
  { value: 30 * 60 * 1000, label: 'за 30 минут' },
];

// Session states for conversation flow
export type SessionState = 
  | 'idle'
  | 'waiting_for_title'
  | 'waiting_for_date'
  | 'waiting_for_time'
  | 'waiting_for_description'
  | 'waiting_for_periods'
  | 'waiting_for_timezone'
  | 'waiting_for_repeat';

export interface UserSession {
  user_id: number;
  chat_id: number;
  state: SessionState;
  data: {
    editing_reminder_id?: string;
    temp_title?: string;
    temp_date?: string;
    temp_time?: string;
    temp_description?: string;
    temp_periods?: number[];
    temp_timezone?: string;
    temp_repeat?: boolean;
  };
  last_activity: Date;
}
