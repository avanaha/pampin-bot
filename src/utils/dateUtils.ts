import * as chrono from 'chrono-node';

export const SUPPORTED_TIMEZONES = [
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)', offset: 3 },
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)', offset: 2 },
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

export function parseDate(input: string, timezone: string = 'Europe/Moscow'): Date | null {
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

  const patterns = [
    /^(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{2,4})$/,
    /^(\d{4})[\-](\d{1,2})[\-](\d{1,2})$/,
    /^(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{2,4})$/i,
  ];

  const monthNames = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];

  for (const pattern of patterns) {
    const match = input.trim().match(pattern);
    if (match) {
      let day: number, month: number, year: number;

      if (pattern === patterns[0]) {
        day = parseInt(match[1], 10);
        month = parseInt(match[2], 10) - 1;
        year = parseInt(match[3], 10);
        if (year < 100) year += 2000;
      } else if (pattern === patterns[1]) {
        year = parseInt(match[1], 10);
        month = parseInt(match[2], 10) - 1;
        day = parseInt(match[3], 10);
      } else {
        day = parseInt(match[1], 10);
        const monthName = match[2].toLowerCase();
        month = monthNames.indexOf(monthName);
        year = parseInt(match[3], 10);
        if (year < 100) year += 2000;
      }

      if (month >= 0 && month <= 11 && day >= 1 && day <= 31 && year >= 2020) {
        const date = new Date(year, month, day, 0, 0, 0, 0);
        if (isValidDate(date)) {
          return date;
        }
      }
    }
  }

  return null;
}

export function parseTime(input: string): { hours: number; minutes: number } | null {
  const match = input.trim().match(/^(\d{1,2})[:\.\-](\d{2})$/);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes };
    }
  }
  return null;
}

export function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

export function isDateInPast(date: Date, timezone: string = 'Europe/Moscow'): boolean {
  const now = new Date();
  return date < now;
}

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
      return `${day.toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${year}`;
    case 'long':
      return `${day} ${month} ${year}`;
    case 'full':
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${day} ${month} ${year} в ${hours}:${minutes}`;
  }
}

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

export function formatPeriod(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `за ${years} ${pluralize(years, 'год', 'года', 'лет')}`;
  if (months > 0) return `за ${months} ${pluralize(months, 'месяц', 'месяца', 'месяцев')}`;
  if (weeks > 0) return `за ${weeks} ${pluralize(weeks, 'неделю', 'недели', 'недель')}`;
  if (days > 0) return `за ${days} ${pluralize(days, 'день', 'дня', 'дней')}`;
  if (hours > 0) return `за ${hours} ${pluralize(hours, 'час', 'часа', 'часов')}`;
  if (minutes > 0) return `за ${minutes} ${pluralize(minutes, 'минуту', 'минуты', 'минут')}`;
  return 'сразу';
}

export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function toISODateString(date: Date): string {
  return date.toISOString().split('T')[0];
}
