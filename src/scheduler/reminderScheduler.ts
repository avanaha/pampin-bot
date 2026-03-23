import cron from 'node-cron';
import { getAllActiveReminders, updateReminder, createNotification, getPendingNotifications, updateNotificationStatus, getReminderById } from '../db/database';
import { 
  calculateNextNotification, 
  shouldSendNotification, 
  formatDate, 
  formatPeriod,
  getTimezoneOffset,
  getCurrentDateTimeInTimezone
} from '../utils/dateUtils';
import { Reminder, Notification } from '../types';
import { getMaxApi } from '../bot/maxApi';

export class ReminderScheduler {
  private cronJob: cron.ScheduledTask | null = null;
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Start the scheduler
   */
  start(): void {
    console.log('📅 Starting reminder scheduler...');

    // Check every minute for due notifications
    this.cronJob = cron.schedule('* * * * *', () => {
      this.checkReminders();
    });

    // Also run initial check
    setTimeout(() => this.checkReminders(), 5000);

    console.log('✅ Reminder scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('🛑 Reminder scheduler stopped');
  }

  /**
   * Check all active reminders
   */
  private async checkReminders(): Promise<void> {
    try {
      const reminders = getAllActiveReminders();

      for (const reminder of reminders) {
        await this.processReminder(reminder);
      }

      // Also process pending notifications
      await this.processPendingNotifications();
    } catch (error) {
      console.error('Error checking reminders:', error);
    }
  }

  /**
   * Process a single reminder
   */
  private async processReminder(reminder: Reminder): Promise<void> {
    const timezone = reminder.timezone || 'Europe/Moscow';
    const now = getCurrentDateTimeInTimezone(timezone);
    
    // Parse event date and time
    const eventDateTime = this.parseEventDateTime(reminder, timezone);
    
    if (!eventDateTime) {
      console.error(`Invalid date for reminder ${reminder.id}`);
      return;
    }

    console.log(`[SCHEDULER] Checking reminder "${reminder.title}" - event: ${eventDateTime.toISOString()}, now: ${now.toISOString()}`);

    // For each reminder period, check if we need to send notification
    for (const periodMs of reminder.reminder_periods) {
      const scheduledTime = calculateNextNotification(eventDateTime, periodMs, timezone);
      
      // Check if this notification should be sent now
      if (this.shouldScheduleNotification(scheduledTime, now, reminder, periodMs)) {
        await this.scheduleNotification(reminder, scheduledTime, periodMs);
      }
    }

    // Check if event has passed and needs yearly repeat
    if (reminder.repeat_yearly && eventDateTime < now) {
      await this.handleYearlyRepeat(reminder, eventDateTime, timezone);
    }
  }

  /**
   * Parse event date and time in user's timezone
   */
  private parseEventDateTime(reminder: Reminder, timezone: string): Date | null {
    try {
      const [year, month, day] = reminder.event_date.split('-').map(Number);
      
      let hours = 0, minutes = 0;
      if (reminder.event_time) {
        // Support both HH:MM and HH-MM formats
        const timeParts = reminder.event_time.split(/[:-]/).map(Number);
        hours = timeParts[0] || 0;
        minutes = timeParts[1] || 0;
      }

      // Create date in UTC and adjust for timezone
      const offset = getTimezoneOffset(timezone);
      const utcDate = new Date(Date.UTC(year, month - 1, day, hours - offset, minutes, 0, 0));
      
      return utcDate;
    } catch (error) {
      console.error('Error parsing date:', error);
      return null;
    }
  }

  /**
   * Check if notification should be scheduled
   */
  private shouldScheduleNotification(
    scheduledTime: Date,
    now: Date,
    reminder: Reminder,
    periodMs: number
  ): boolean {
    // Check if scheduled time is in the future
    if (scheduledTime > now) {
      return false;
    }

    // Check if scheduled time is too far in the past (more than 1 hour)
    const diffMs = now.getTime() - scheduledTime.getTime();
    if (diffMs > 3600000) {
      return false;
    }

    // Check if we already sent this notification
    if (reminder.last_notification) {
      const lastNotifTime = new Date(reminder.last_notification).getTime();
      const scheduledTimeMs = scheduledTime.getTime();
      
      // If we already sent notification around this time, skip
      if (Math.abs(lastNotifTime - scheduledTimeMs) < periodMs / 2) {
        return false;
      }
    }

    return true;
  }

  /**
   * Schedule a notification
   */
  private async scheduleNotification(
    reminder: Reminder,
    scheduledTime: Date,
    periodMs: number
  ): Promise<void> {
    try {
      // Create notification record
      createNotification({
        reminder_id: reminder.id,
        scheduled_at: scheduledTime,
        status: 'pending',
        period_ms: periodMs
      });

      // Update reminder's last notification time
      updateReminder(reminder.id, {
        last_notification: new Date()
      });

      console.log(`📬 Notification scheduled for reminder ${reminder.id} (${formatPeriod(periodMs)})`);
    } catch (error) {
      console.error('Error scheduling notification:', error);
    }
  }

  /**
   * Process pending notifications
   */
  private async processPendingNotifications(): Promise<void> {
    const pending = getPendingNotifications();
    
    if (pending.length === 0) {
      return;
    }
    
    console.log(`[SCHEDULER] Processing ${pending.length} pending notifications`);
    
    const api = getMaxApi();

    for (const notification of pending) {
      try {
        // Get reminder details
        const reminder = getReminderById(notification.reminder_id);
        
        if (!reminder || !reminder.is_active) {
          updateNotificationStatus(notification.id, 'failed', 'Reminder not found or inactive');
          continue;
        }

        // Send notification
        await this.sendNotification(api, reminder, notification);
        
        // Mark as sent
        updateNotificationStatus(notification.id, 'sent');
        
        console.log(`✅ Notification sent for reminder ${reminder.id}`);
      } catch (error) {
        console.error(`Error sending notification ${notification.id}:`, error);
        updateNotificationStatus(notification.id, 'failed', String(error));
      }
    }
  }

  /**
   * Send notification
   */
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

    // Send to user
    await api.sendText(reminder.chat_id, text, 'markdown');

    // Send to group
    const groupId = parseInt(process.env.GROUP_ID || '0');
    if (groupId) {
      try {
        await api.sendText(groupId, `📤 Напоминание отправлено:\n\n${text}`, 'markdown');
      } catch (error) {
        console.error('Failed to send to group:', error);
      }
    }
  }

  /**
   * Handle yearly repeat
   */
  private async handleYearlyRepeat(reminder: Reminder, eventDateTime: Date, timezone: string): Promise<void> {
    const now = getCurrentDateTimeInTimezone(timezone);
    
    // Check if event was more than 1 day ago
    const dayAfterEvent = new Date(eventDateTime);
    dayAfterEvent.setDate(dayAfterEvent.getDate() + 1);
    
    if (now > dayAfterEvent) {
      // Update reminder for next year
      const nextYear = new Date(eventDateTime);
      nextYear.setFullYear(now.getFullYear() + 1);
      
      // Format date as YYYY-MM-DD
      const nextYearStr = nextYear.toISOString().split('T')[0];
      
      updateReminder(reminder.id, {
        event_date: nextYearStr,
        last_notification: undefined // Reset notifications
      });

      console.log(`🔄 Reminder ${reminder.id} renewed for next year: ${nextYearStr}`);
    }
  }
}

// Singleton instance
let schedulerInstance: ReminderScheduler | null = null;

export function getScheduler(): ReminderScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new ReminderScheduler();
  }
  return schedulerInstance;
}
