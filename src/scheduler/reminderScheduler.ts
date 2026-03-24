import { getAllActiveReminders, updateReminder } from '../db/database';
import { calculateNextNotification, shouldSendNotification } from '../utils/dateUtils';
import { PamPinBot } from '../bot/handlers';
import { Reminder } from '../types';

export class ReminderScheduler {
  private interval: NodeJS.Timeout | null = null;
  private bot: PamPinBot | null = null;
  private checkIntervalMs: number = 60000; // Check every minute

  setBot(bot: PamPinBot): void {
    this.bot = bot;
  }

  start(): void {
    console.log('⏰ Reminder scheduler started');
    
    // Check immediately
    this.checkReminders();
    
    // Then check every minute
    this.interval = setInterval(() => {
      this.checkReminders();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('⏰ Reminder scheduler stopped');
  }

  private async checkReminders(): Promise<void> {
    try {
      const reminders = getAllActiveReminders();
      const now = new Date();

      for (const reminder of reminders) {
        await this.processReminder(reminder, now);
      }
    } catch (error) {
      console.error('Error checking reminders:', error);
    }
  }

  private async processReminder(reminder: Reminder, now: Date): Promise<void> {
    const eventDate = new Date(reminder.event_date);
    
    // Parse event time if set
    if (reminder.event_time) {
      const [hours, minutes] = reminder.event_time.split('-').map(Number);
      if (!isNaN(hours) && !isNaN(minutes)) {
        eventDate.setHours(hours, minutes, 0, 0);
      }
    } else {
      eventDate.setHours(9, 0, 0, 0); // Default to 9 AM
    }

    // Check each reminder period
    for (const periodMs of reminder.reminder_periods) {
      const notificationTime = calculateNextNotification(eventDate, periodMs, reminder.timezone);
      
      // Check if we should send notification
      if (shouldSendNotification(notificationTime, reminder.timezone)) {
        // Check if we already sent this notification
        const lastNotification = reminder.last_notification;
        
        if (!lastNotification || this.shouldResend(lastNotification, periodMs)) {
          await this.sendNotification(reminder, periodMs);
          
          // Update last notification time
          updateReminder(reminder.id, {
            last_notification: now
          });
        }
      }
    }

    // Check if event has passed and should be repeated next year
    if (reminder.repeat_yearly && eventDate < now) {
      const nextYear = new Date(eventDate);
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      
      // Update event date to next year
      const nextYearStr = nextYear.toISOString().split('T')[0];
      updateReminder(reminder.id, {
        event_date: nextYearStr,
        last_notification: undefined
      });
      
      console.log(`📅 Reminder "${reminder.title}" moved to next year: ${nextYearStr}`);
    }
  }

  private shouldResend(lastNotification: Date, periodMs: number): boolean {
    // Don't resend within the same period window
    const now = new Date();
    const timeSinceLastNotification = now.getTime() - lastNotification.getTime();
    
    // Resend only if enough time has passed (more than the period itself)
    return timeSinceLastNotification > periodMs;
  }

  private async sendNotification(reminder: Reminder, periodMs: number): Promise<void> {
    if (!this.bot) {
      console.error('Bot not set in scheduler');
      return;
    }

    try {
      await this.bot.sendReminderNotification(reminder, periodMs);
      console.log(`🔔 Notification sent for "${reminder.title}" (${periodMs}ms before)`);
    } catch (error) {
      console.error(`Failed to send notification for "${reminder.title}":`, error);
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
