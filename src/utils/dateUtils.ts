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
 */
export function getCurrentDateTimeInTimezone(timezone: string): Date {
  const now = new Date();
  const offset = getTimezoneOffset(timezone);
  
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const tzTime = utcTime + (offset * 3600000);
  
  return new Date(tzTime);
}

/**
 * Parse date from various formats
 * Primary format: DD/MM/YYYY (e.g., 05/03/2026 = March 5, 2026)
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

  let day: number = 0;
  let month: number = 0;
  let year: number = 0;
  let matched = false;

  let match = trimmedInput.match(slashPattern);
  if (match) {
    day = parseInt(match[1], 10);
    month = parseInt(match[2], 10) - 1;
    year = parseInt(match[3], 10);
    matched = true;
  }

  if (!matched) {
    match = trimmedInput.match(dotPattern);
    if (match) {
      day = parseInt(match[1], 10);
      month = parseInt(match[2], 10) - 1;
      year = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (!matched) {
    match = trimmedInput.match(dashPattern);
    if (match) {
      day = parseInt(match[1], 10);
      month = parseInt(match[2], 10) - 1;
      year = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (!matched) {
    match = trimmedInput.match(isoPattern);
    if (match) {
      year = parseInt(match[1], 10);
      month = parseInt(match[2], 10) - 1;
      day = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (!matched) {
    match = trimmedInput.match(russianMonthPattern);
    if (match) {
      day = parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      month = monthNames.indexOf(monthName);
      year = parseInt(match[3], 10);
      matched = true;
    }
  }

  if (matched) {
    if (year < 100) {
      year += 2000;
    }
    
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31 && year >= 2020) {
      const date = createDateInTimezone(year, month, day, 0, 0, timezone);
      if (isValidDate(date)) {
        return date;
      }
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
 * Create a date in a specific timezone
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
  const utcDate = new Date(Date.UTC(year, month, day, hours - offset, minutes, 0, 0));
  return utcDate;
}

/**
 * Parse time from string
 * Format: HH-MM (e.g., 14-30 for 2:30 PM) or HH:MM
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
 * Check if date is in the past (considering timezone)
 */
export function isDateInPast(date: Date, timezone: string = 'Europe/Moscow'): boolean {
  const now = getCurrentDateTimeInTimezone(timezone);
  
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  return dateOnly < nowOnly;
}

/**
 * Check if date is today (considering timezone)
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
 * Format time for display (HH-MM)
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
 */
export function calculateNextNotification(eventDate: Date, periodMs: number, timezone: string): Date {
  const notificationTime = new Date(eventDate.getTime() - periodMs);
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
