import cron from 'node-cron';
import { getAllActiveReminders } from '../db/database';
import { formatDate, formatPeriod } from '../utils/dateUtils';
import { Reminder } from '../types';
import { getMaxApi } from './maxApi';

export class ReminderScheduler {
  private cronJob: cron.ScheduledTask | null = null;
  private groupId: number;

  constructor(groupId: number = 0) {
    this.groupId = groupId;
  }

  start(): void {
    console.log('📅 Starting reminder scheduler...');
    this.cronJob = cron.schedule('* * * * *', () => this.checkReminders());
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
      const now = new Date();

      for (const reminder of reminders) {
        if (reminder.reminder_periods && reminder.reminder_periods.length > 0) {
          for (const periodMs of reminder.reminder_periods) {
            await this.processReminder(reminder, now, periodMs);
          }
        }
      }
    } catch (error) {
      console.error('[Scheduler] Error:', error);
    }
  }

  private async processReminder(reminder: Reminder, now: Date, periodMs: number): Promise<void> {
    const eventDate = new Date(reminder.event_date);
    const scheduledTime = new Date(eventDate.getTime() - periodMs);

    const diffMs = Math.abs(now.getTime() - scheduledTime.getTime());
    if (diffMs > 60000) return;

    if (scheduledTime < now && diffMs > 120000) return;

    console.log(`[Scheduler] Sending reminder for "${reminder.title}"`);

    try {
      const api = getMaxApi();
      const text = `🔔 Напоминание!\n\n📌 ${reminder.title}\n📅 ${formatDate(eventDate, 'full')}\n\n⏰ Напоминаю ${formatPeriod(periodMs)}`;
      
      await api.sendText(reminder.chat_id, text, 'plain');
      console.log(`[Scheduler] Reminder sent to chat ${reminder.chat_id}`);
    } catch (error) {
      console.error('[Scheduler] Failed to send reminder:', error);
    }
  }
}
