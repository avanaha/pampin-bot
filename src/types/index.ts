// PamPin Application Types

export interface Reminder {
  id: string;
  user_id: number;
  chat_id: number;
  title: string;
  description?: string;
  event_date: string;
  event_time?: string;
  timezone: string;
  reminder_periods: number[];
  repeat_yearly: boolean;
  created_at: Date;
  updated_at: Date;
  is_active: boolean;
  is_archived: boolean;
}

export interface UserSettings {
  user_id: number;
  chat_id: number;
  timezone: string;
  created_at: Date;
  updated_at: Date;
}

export type SessionState = 'idle' | 'title' | 'date' | 'time' | 'period' | 'confirm' | 'edit_select' | 'edit_field';

export interface UserSession {
  user_id: number;
  chat_id: number;
  state: SessionState;
  data: {
    title?: string;
    date?: string;
    time?: string;
    period?: number;
    edit_id?: string;
    edit_field?: string;
    description?: string;
    [key: string]: any;
  };
  last_activity: Date;
}

// Периоды напоминания в миллисекундах
export const REMINDER_PERIODS: { value: number; label: string }[] = [
  { value: 7776000000, label: 'за 3 месяца' },
  { value: 2592000000, label: 'за 1 месяц' },
  { value: 604800000, label: 'за 1 неделю' },
  { value: 86400000, label: 'за 1 день' },
  { value: 3600000, label: 'за 1 час' },
  { value: 1800000, label: 'за 30 минут' },
];
