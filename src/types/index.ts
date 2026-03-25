// PamPin Application Types

// Типы повторения напоминания
export type RepeatType = 
  | 'none'           // Не повторять
  | 'daily'          // Ежедневно
  | 'weekdays'       // По будням (пн-пт)
  | 'weekends'       // По выходным (сб-вс)
  | 'weekly'         // Еженедельно (в тот же день недели)
  | 'monthly'        // Ежемесячно (в то же число)
  | 'yearly'         // Ежегодно
  | 'custom_days'    // Выбранные дни недели
  | 'monthly_day';   // Каждого N-го числа месяца

export interface Reminder {
  id: string;
  user_id: number;
  chat_id: number;
  title: string;
  description?: string;
  event_date: string; // ISO date string YYYY-MM-DD
  event_time?: string; // HH:mm
  timezone: string;
  reminder_periods: number[]; // periods in milliseconds before event
  repeat_type: RepeatType; // Тип повторения
  repeat_days?: number[]; // Дни недели для custom_days (0=Вс, 1=Пн, ..., 6=Сб)
  repeat_month_day?: number; // Число месяца для monthly_day (1-28)
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

// Predefined reminder periods (сколько времени ДО события)
export const PREDEFINED_PERIODS: { value: number; label: string }[] = [
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

// Варианты повторения
export const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
  { value: 'none', label: 'Не повторять' },
  { value: 'daily', label: 'Ежедневно' },
  { value: 'weekdays', label: 'По будням (пн-пт)' },
  { value: 'weekends', label: 'По выходным (сб-вс)' },
  { value: 'weekly', label: 'Еженедельно' },
  { value: 'monthly', label: 'Ежемесячно' },
  { value: 'yearly', label: 'Ежегодно' },
  { value: 'custom_days', label: 'Выбрать дни недели' },
  { value: 'monthly_day', label: 'Каждого N-го числа' },
];

// Дни недели
export const WEEKDAYS = [
  { value: 1, label: 'Понедельник', short: 'Пн' },
  { value: 2, label: 'Вторник', short: 'Вт' },
  { value: 3, label: 'Среда', short: 'Ср' },
  { value: 4, label: 'Четверг', short: 'Чт' },
  { value: 5, label: 'Пятница', short: 'Пт' },
  { value: 6, label: 'Суббота', short: 'Сб' },
  { value: 0, label: 'Воскресенье', short: 'Вс' },
];

// Bot states for conversation flow
export type BotState = 
  | 'idle'
  | 'waiting_for_title'
  | 'waiting_for_date'
  | 'waiting_for_time'
  | 'waiting_for_description'
  | 'waiting_for_period'
  | 'waiting_for_repeat'
  | 'waiting_for_repeat_days'
  | 'waiting_for_month_day'
  | 'waiting_for_periods'
  | 'waiting_for_timezone'
  | 'editing_reminder'
  | 'selecting_reminder'
  | 'preview'
  | 'editing_title'
  | 'editing_date'
  | 'editing_time'
  | 'editing_description'
  | 'editing_month_day'
  | 'editing_period'
  | 'editing_repeat';

export interface UserSession {
  user_id: number;
  chat_id: number;
  state: BotState;
  data: {
    editing_reminder_id?: string;
    temp_title?: string;
    temp_date?: string;
    temp_time?: string;
    temp_description?: string;
    temp_period?: number;
    temp_repeat_type?: RepeatType;
    temp_repeat_days?: number[];
    temp_month_day?: number;
    temp_timezone?: string;
  };
  last_activity: Date;
}
