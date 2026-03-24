import cron from 'node-cron';
import { getAllActiveReminders, updateReminder, createNotification, getPendingNotifications, updateNotificationStatus, getReminderById } from '../db/database';
import { 
  calculateNextNotification, 
  formatDate, 
  formatPeriod,
  getTimezoneOffset,
  getCurrentDateTimeInTimezone
} from '../utils/dateUtils';
import { Reminder, Notification } from '../types';
import { getMaxApi } from '../bot/maxApi';

export class ReminderScheduler {
  private cronJob: cron.ScheduledTask | null = null;

  start(): void {
    console.log('📅 Starting reminder scheduler...');

    this.cronJob = cron.schedule('* * * * *', () => {
      this.checkReminders();
    });

    setTimeout(() => this.checkReminders(), 5000);

    console.log('✅ Reminder scheduler started');
  }

  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    console.log('🛑 Reminder scheduler stopped');
  }

  private async checkReminders(): Promise<void> {
    try {
      const reminders = getAllActiveReminders();

      for (const reminder of reminders) {
        await this.processReminder(reminder);
      }

      await this.processPendingNotifications();
    } catch (error) {
      console.error('Error checking reminders:', error);
    }
  }

  private async processReminder(reminder: Reminder): Promise<void> {
    const timezone = reminder.timezone || 'Europe/Moscow';
    const now = getCurrentDateTimeInTimezone(timezone);
    
    const eventDateTime = this.parseEventDateTime(reminder, timezone);
    
    if (!eventDateTime) {
      console.error(`Invalid date for reminder ${reminder.id}`);
      return;
    }

    for (const periodMs of reminder.reminder_periods) {
      const scheduledTime = calculateNextNotification(eventDateTime, periodMs, timezone);
      
      if (this.shouldScheduleNotification(scheduledTime, now, reminder, periodMs)) {
        await this.scheduleNotification(reminder, scheduledTime, periodMs);
      }
    }

    if (reminder.repeat_yearly && eventDateTime < now) {
      await this.handleYearlyRepeat(reminder, eventDateTime, timezone);
    }
  }

  private parseEventDateTime(reminder: Reminder, timezone: string): Date | null {
    try {
      const [year, month, day] = reminder.event_date.split('-').map(Number);
      
      let hours = 0, minutes = 0;
      if (reminder.event_time) {
        const timeParts = reminder.event_time.split(/[:-]/).map(Number);
        hours = timeParts[0] || 0;
        minutes = timeParts[1] || 0;
      }

      const offset = getTimezoneOffset(timezone);
      const utcDate = new Date(Date.UTC(year, month - 1, day, hours - offset, minutes, 0, 0));
      
      return utcDate;
    } catch (error) {
      console.error('Error parsing date:', error);
      return null;
    }
  }

  private shouldScheduleNotification(
    scheduledTime: Date,
    now: Date,
    reminder: Reminder,
    periodMs: number
  ): boolean {
    if (scheduledTime > now) {
      return false;
    }

    const diffMs = now.getTime() - scheduledTime.getTime();
    if (diffMs > 3600000) {
      return false;
    }

    if (reminder.last_notification) {
      const lastNotifTime = new Date(reminder.last_notification).getTime();
      const scheduledTimeMs = scheduledTime.getTime();
      
      if (Math.abs(lastNotifTime - scheduledTimeMs) < periodMs / 2) {
        return false;
      }
    }

    return true;
  }

  private async scheduleNotification(
    reminder: Reminder,
    scheduledTime: Date,
    periodMs: number
  ): Promise<void> {
    try {
      createNotification({
        reminder_id: reminder.id,
        scheduled_at: scheduledTime,
        status: 'pending',
        period_ms: periodMs
      });

      updateReminder(reminder.id, {
        last_notification: new Date()
      });

      console.log(`📬 Notification scheduled for reminder ${reminder.id} (${formatPeriod(periodMs)})`);
    } catch (error) {
      console.error('Error scheduling notification:', error);
    }
  }

  private async processPendingNotifications(): Promise<void> {
    const pending = getPendingNotifications();
    
    if (pending.length === 0) {
      return;
    }
    
    console.log(`[SCHEDULER] Processing ${pending.length} pending notifications`);
    
    const api = getMaxApi();

    for (const notification of pending) {
      try {
        const reminder = getReminderById(notification.reminder_id);
        
        if (!reminder || !reminder.is_active) {
          updateNotificationStatus(notification.id, 'failed', 'Reminder not found or inactive');
          continue;
        }

        await this.sendNotification(api, reminder, notification);
        
        updateNotificationStatus(notification.id, 'sent');
        
        console.log(`✅ Notification sent for reminder ${reminder.id}`);
      } catch (error) {
        console.error(`Error sending notification ${notification.id}:`, error);
        updateNotificationStatus(notification.id, 'failed', String(error));
      }
    }
  }

  private async sendNotification(
    api: ReturnType<typeof getMaxApi>,
    reminder: Reminder,
    notification: Notification
  ): Promise<void> {
    const timezone = reminder.timezone || 'Europe/Moscow';
    const eventDateTime = this.parseEventDateTime(reminder, timezone);
    const periodLabel = formatPeriod(notification.period_ms);
    
    const text = `
🔔 *НАПОМИНАНИЕ!*

📌 *${reminder.title}*
📅 ${eventDateTime ? formatDate(eventDateTime, 'full') : reminder.event_date}
 ${reminder.description ? `\n📝 ${reminder.description}` : ''}

⏰ Напоминаю *${periodLabel}*
`;

    await api.sendText(reminder.chat_id, text, 'markdown');

    const groupId = parseInt(process.env.GROUP_ID || '0');
    if (groupId) {
      try {
        await api.sendText(groupId, `📤 Напоминание отправлено:\n\n${text}`, 'markdown');
      } catch (error) {
        console.error('Failed to send to group:', error);
      }
    }
  }

  private async handleYearlyRepeat(reminder: Reminder, eventDateTime: Date, timezone: string): Promise<void> {
    const now = getCurrentDateTimeInTimezone(timezone);
    
    const dayAfterEvent = new Date(eventDateTime);
    dayAfterEvent.setDate(dayAfterEvent.getDate() + 1);
    
    if (now > dayAfterEvent) {
      const nextYear = new Date(eventDateTime);
      nextYear.setFullYear(now.getFullYear() + 1);
      
      const nextYearStr = nextYear.toISOString().split('T')[0];
      
      updateReminder(reminder.id, {
        event_date: nextYearStr,
        last_notification: undefined
      });

      console.log(`🔄 Reminder ${reminder.id} renewed for next year: ${nextYearStr}`);
    }
  }
}
