import * as chrono from 'chrono-node';

// Timezone utilities
export const SUPPORTED_TIMEZONES = [
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)', offset: 2 },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)', offset: 3 },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)', offset: 4 },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)', offset: 5 },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)', offset: 6 },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)', offset: 7 },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)', offset: 8 },
  { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)', offset: 9 },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)', offset: 10 },
  { value: 'Asia/Magadan', label: 'Магадан (UTC+11)', offset: 11 },
  { value: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)', offset: 12 },
];

/**
 * Get timezone offset in hours
 */
export function getTimezoneOffset(timezone: string): number {
  const tz = SUPPORTED_TIMEZONES.find(t => t.value === timezone);
  return tz?.offset ?? 3; // Default to Moscow
}

/**
 * Get current date in timezone (without time part)
 */
export function getCurrentDateInTimezone(timezone: string): Date {
  const now = new Date();
  const offset = getTimezoneOffset(timezone);
  
  const utcHours = now.getUTCHours();
  const utcDate = now.getUTCDate();
  const utcMonth = now.getUTCMonth();
  const utcYear = now.getUTCFullYear();
  
  const tzDate = new Date(Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0, 0));
  tzDate.setUTCHours(utcHours + offset);
  
  return new Date(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate());
}

/**
 * Get current datetime in timezone
 * ВАЖНО: Возвращает локальное время пользователя в его часовом поясе
 */
export function getCurrentDateTimeInTimezone(timezone: string): Date {
  const now = new Date();
  const offset = getTimezoneOffset(timezone);
  
  // Получаем UTC время и добавляем смещение часового пояса
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const tzTime = utcTime + (offset * 3600000);
  
  return new Date(tzTime);
}

/**
 * Get days in month
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Check if year is leap year
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Validate date components
 */
export function validateDateComponents(day: number, month: number, year: number): { valid: boolean; error?: string } {
  if (year < 2020) {
    return { valid: false, error: `Год должен быть не меньше 2020. Вы ввели: ${year}` };
  }
  if (year > 2100) {
    return { valid: false, error: `Год должен быть не больше 2100. Вы ввели: ${year}` };
  }
  
  if (month < 1 || month > 12) {
    return { valid: false, error: `Месяц должен быть от 1 до 12. Вы ввели: ${month}` };
  }
  
  if (day < 1) {
    return { valid: false, error: `День должен быть не меньше 1. Вы ввели: ${day}` };
  }
  
  const daysInMonth = getDaysInMonth(year, month - 1);
  if (day > daysInMonth) {
    return { valid: false, error: `В ${getMonthName(month - 1)} ${year} года только ${daysInMonth} дней. Вы ввели: ${day}` };
  }
  
  return { valid: true };
}

/**
 * Get month name in Russian
 */
export function getMonthName(month: number): string {
  const months = [
    'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
    'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'
  ];
  return months[month];
}

/**
 * Parse date from various formats with strict validation
 */
export function parseDate(input: string, timezone: string = 'Europe/Moscow'): Date | null {
  const trimmedInput = input.trim();
  
  const slashPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  const dotPattern = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/;
  const dashPattern = /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/;
  const isoPattern = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const russianMonthPattern = /^(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{2,4})$/i;

  const monthNames = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];

  let day: number = 0, month: number = 0, year: number = 0;
  let matched = false;

  let match = trimmedInput.match(slashPattern);
  if (match) {
    day = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    year = parseInt(match[3], 10);
    matched = true;
  }

  if (!matched) {
    match = trimmedInput.match(dotPattern);
    if (match) {
      day = parseInt(match[1], 10);
      month = parseInt(match[2], 10);
      year = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (!matched) {
    match = trimmedInput.match(dashPattern);
    if (match) {
      day = parseInt(match[1], 10);
      month = parseInt(match[2], 10);
      year = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (!matched) {
    match = trimmedInput.match(isoPattern);
    if (match) {
      year = parseInt(match[1], 10);
      month = parseInt(match[2], 10);
      day = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (!matched) {
    match = trimmedInput.match(russianMonthPattern);
    if (match) {
      day = parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      month = monthNames.indexOf(monthName) + 1;
      year = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (matched) {
    if (year < 100) {
      year += 2000;
    }
    
    const validation = validateDateComponents(day, month, year);
    if (!validation.valid) {
      console.log(`[DATE] Validation failed: ${validation.error}`);
      return null;
    }
    
    const date = createDateInTimezone(year, month - 1, day, 0, 0, timezone);
    if (isValidDate(date)) {
      return date;
    }
  }

  try {
    const results = chrono.ru.parse(input, new Date(), { 
      forwardDate: true,
      timezones: { 'МСК': 180, 'MSK': 180 }
    });

    if (results.length > 0) {
      const result = results[0];
      const date = result.start.date();
      
      if (!result.start.isCertain('hour')) {
        date.setHours(0, 0, 0, 0);
      }
      
      return date;
    }
  } catch (e) {
    // chrono-node failed
  }

  return null;
}

/**
 * Parse date with detailed error message
 */
export function parseDateWithFeedback(input: string, timezone: string = 'Europe/Moscow'): { date: Date | null; error?: string } {
  const trimmedInput = input.trim();
  
  if (trimmedInput.length < 6) {
    return { 
      date: null, 
      error: `Слишком короткий ввод. Используйте формат: ДД/ММ/ГГГГ\nНапример: 01/04/2026` 
    };
  }
  
  const slashPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  const dotPattern = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/;
  const dashPattern = /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/;
  const isoPattern = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

  let day: number = 0, month: number = 0, year: number = 0;
  let matched = false;
  let match: RegExpMatchArray | null = null;

  match = trimmedInput.match(slashPattern);
  if (match) {
    day = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    year = parseInt(match[3], 10);
    matched = true;
  }

  if (!matched) {
    match = trimmedInput.match(dotPattern);
    if (match) {
      day = parseInt(match[1], 10);
      month = parseInt(match[2], 10);
      year = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (!matched) {
    match = trimmedInput.match(dashPattern);
    if (match) {
      day = parseInt(match[1], 10);
      month = parseInt(match[2], 10);
      year = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (!matched) {
    match = trimmedInput.match(isoPattern);
    if (match) {
      year = parseInt(match[1], 10);
      month = parseInt(match[2], 10);
      day = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (!matched) {
    return { 
      date: null, 
      error: `❌ Неверный формат даты.\n\n📅 Используйте формат: ДД/ММ/ГГГГ\nНапример: 01/04/2026\n\nВы ввели: ${trimmedInput}` 
    };
  }

  if (year < 100) {
    year += 2000;
  }
  
  const validation = validateDateComponents(day, month, year);
  if (!validation.valid) {
    return { 
      date: null, 
      error: `❌ ${validation.error}\n\n📅 Используйте формат: ДД/ММ/ГГГГ\nНапример: 01/04/2026` 
    };
  }
  
  const date = createDateInTimezone(year, month - 1, day, 0, 0, timezone);
  return { date };
}

/**
 * Create a date in a specific timezone
 * КРИТИЧЕСКИ ВАЖНО: Правильно создаёт дату-время в часовом поясе пользователя
 */
export function createDateInTimezone(
  year: number, 
  month: number, 
  day: number, 
  hours: number, 
  minutes: number, 
  timezone: string
): Date {
  const offset = getTimezoneOffset(timezone);
  
  // Создаём UTC дату, вычитая смещение часового пояса
  // Например, для Москвы (UTC+3) время 14:00 должно храниться как 11:00 UTC
  const utcHours = hours - offset;
  const utcDate = new Date(Date.UTC(year, month, day, utcHours, minutes, 0, 0));
  
  console.log(`[DATE_CREATE] ${year}-${month+1}-${day} ${hours}:${minutes} (${timezone}, offset=${offset}) -> UTC: ${utcDate.toISOString()}`);
  
  return utcDate;
}

/**
 * Parse time from string
 */
export function parseTime(input: string): { hours: number; minutes: number } | null {
  const trimmedInput = input.trim();
  
  const dashPattern = /^(\d{1,2})-(\d{2})$/;
  const colonPattern = /^(\d{1,2}):(\d{2})$/;
  const dotPattern = /^(\d{1,2})\.(\d{2})$/;
  
  let match = trimmedInput.match(dashPattern);
  if (!match) {
    match = trimmedInput.match(colonPattern);
  }
  if (!match) {
    match = trimmedInput.match(dotPattern);
  }
  
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes };
    }
  }
  return null;
}

/**
 * Check if date is valid
 */
export function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Check if date is in the past (с учётом времени)
 * ВАЖНО: Сравниваем полную дату-время, а не только дату
 */
export function isDateTimeInPast(date: Date, time: string, timezone: string): boolean {
  const now = getCurrentDateTimeInTimezone(timezone);
  
  // Парсим время
  const timeParts = time.split(/[:-]/).map(Number);
  const hours = timeParts[0] || 0;
  const minutes = timeParts[1] || 0;
  
  // Создаём полную дату-время события в часовом поясе пользователя
  const eventDateTime = createDateInTimezone(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
    timezone
  );
  
  return eventDateTime.getTime() < now.getTime();
}

/**
 * Check if date is in the past (только дата, без времени)
 */
export function isDateInPast(date: Date, timezone: string = 'Europe/Moscow'): boolean {
  const now = getCurrentDateTimeInTimezone(timezone);
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dateOnly < nowOnly;
}

/**
 * Check if date is today
 */
export function isToday(date: Date, timezone: string = 'Europe/Moscow'): boolean {
  const now = getCurrentDateTimeInTimezone(timezone);
  return date.getDate() === now.getDate() &&
         date.getMonth() === now.getMonth() &&
         date.getFullYear() === now.getFullYear();
}

/**
 * Format date for display
 */
export function formatDate(date: Date, format: 'short' | 'long' | 'full' = 'short'): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  switch (format) {
    case 'short':
      return `${day.toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${year}`;
    case 'long':
      return `${day} ${month} ${year}`;
    case 'full':
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${day} ${month} ${year} в ${hours}-${minutes}`;
  }
}

/**
 * Format time for display
 */
export function formatTime(hours: number, minutes: number): string {
  return `${hours.toString().padStart(2, '0')}-${minutes.toString().padStart(2, '0')}`;
}

/**
 * Format remaining time
 */
export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'уже наступило';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) {
    const remainingDays = days % 365;
    return `${years} ${pluralize(years, 'год', 'года', 'лет')}${remainingDays > 0 ? ` ${remainingDays} ${pluralize(remainingDays, 'день', 'дня', 'дней')}` : ''}`;
  }
  if (months > 0) {
    const remainingDays = days % 30;
    return `${months} ${pluralize(months, 'месяц', 'месяца', 'месяцев')}${remainingDays > 0 ? ` ${remainingDays} ${pluralize(remainingDays, 'день', 'дня', 'дней')}` : ''}`;
  }
  if (days > 0) {
    return `${days} ${pluralize(days, 'день', 'дня', 'дней')}`;
  }
  if (hours > 0) {
    return `${hours} ${pluralize(hours, 'час', 'часа', 'часов')}`;
  }
  if (minutes > 0) {
    return `${minutes} ${pluralize(minutes, 'минута', 'минуты', 'минут')}`;
  }
  return `${seconds} ${pluralize(seconds, 'секунда', 'секунды', 'секунд')}`;
}

/**
 * Format period for display
 */
export function formatPeriod(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) {
    return `за ${years} ${pluralize(years, 'год', 'года', 'лет')}`;
  }
  if (months > 0) {
    return `за ${months} ${pluralize(months, 'месяц', 'месяца', 'месяцев')}`;
  }
  if (weeks > 0) {
    return `за ${weeks} ${pluralize(weeks, 'неделю', 'недели', 'недель')}`;
  }
  if (days > 0) {
    return `за ${days} ${pluralize(days, 'день', 'дня', 'дней')}`;
  }
  if (hours > 0) {
    return `за ${hours} ${pluralize(hours, 'час', 'часа', 'часов')}`;
  }
  if (minutes > 0) {
    return `за ${minutes} ${pluralize(minutes, 'минуту', 'минуты', 'минут')}`;
  }
  return 'сразу';
}

/**
 * Pluralize Russian words
 */
export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod100 >= 11 && mod100 <= 19) {
    return many;
  }
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}

/**
 * Calculate next notification time
 * ВАЖНО: eventDate должен быть в UTC, periodMs - период в миллисекундах
 * Возвращает время уведомления в UTC
 */
export function calculateNextNotification(eventDate: Date, periodMs: number, timezone: string): Date {
  // Вычитаем период из времени события
  const notificationTime = new Date(eventDate.getTime() - periodMs);
  console.log(`[CALC_NEXT_NOTIF] event: ${eventDate.toISOString()}, period: ${periodMs}ms, notification: ${notificationTime.toISOString()}`);
  return notificationTime;
}

/**
 * Рассчитать время уведомления с учётом часового пояса
 * Принимает локальные компоненты даты/времени пользователя
 */
export function calculateNotificationTime(
  year: number, month: number, day: number,
  hours: number, minutes: number,
  periodMs: number,
  timezone: string
): Date {
  // Создаём datetime события в UTC (с учётом часового пояса)
  const eventDateTime = createDateInTimezone(year, month, day, hours, minutes, timezone);
  // Вычитаем период
  const notificationTime = new Date(eventDateTime.getTime() - periodMs);
  
  console.log(`[CALC_NOTIF_TIME] event: ${eventDateTime.toISOString()}, period: ${formatPeriod(periodMs)}, notification: ${notificationTime.toISOString()}`);
  
  return notificationTime;
}

/**
 * Check if notification should be sent
 */
export function shouldSendNotification(scheduledTime: Date, timezone: string): boolean {
  const now = getCurrentDateTimeInTimezone(timezone);
  const diff = scheduledTime.getTime() - now.getTime();
  return diff <= 60000 && diff > -60000;
}

/**
 * Get current time in timezone
 */
export function getCurrentTimeInTimezone(timezone: string): Date {
  return getCurrentDateTimeInTimezone(timezone);
}

/**
 * Convert date to ISO format (YYYY-MM-DD)
 */
export function toISODateString(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert time to HH:mm format
 */
export function toTimeString(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

/**
 * Get today's date formatted for display
 */
export function getTodayFormatted(timezone: string = 'Europe/Moscow'): string {
  const today = getCurrentDateTimeInTimezone(timezone);
  return formatDate(today, 'short');
}

/**
 * Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 */
export function getDayOfWeek(date: Date): number {
  return date.getDay();
}

/**
 * Get next occurrence of a specific day of week
 */
export function getNextDayOfWeek(dayOfWeek: number, timezone: string): Date {
  const now = getCurrentDateTimeInTimezone(timezone);
  const currentDay = now.getDay();
  let daysUntil = dayOfWeek - currentDay;
  if (daysUntil <= 0) {
    daysUntil += 7;
  }
  const nextDate = new Date(now);
  nextDate.setDate(nextDate.getDate() + daysUntil);
  return nextDate;
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add months to a date
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Add years to a date
 */
export function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

/**
 * Конвертировать UTC дату в локальное время пользователя
 * Возвращает объект с компонентами даты/времени в часовом поясе пользователя
 */
export function utcToLocalTime(utcDate: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  dayOfWeek: number;
} {
  const offset = getTimezoneOffset(timezone);
  
  // Получаем UTC компоненты
  const utcYear = utcDate.getUTCFullYear();
  const utcMonth = utcDate.getUTCMonth();
  const utcDay = utcDate.getUTCDate();
  const utcHours = utcDate.getUTCHours();
  const utcMinutes = utcDate.getUTCMinutes();
  
  // Создаём локальное время, добавляя смещение
  const localDate = new Date(utcDate.getTime() + offset * 3600000);
  
  return {
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth(),
    day: localDate.getUTCDate(),
    hours: localDate.getUTCHours(),
    minutes: localDate.getUTCMinutes(),
    dayOfWeek: localDate.getUTCDay()
  };
}
