import { MaxApi, callbackButton, getMaxApi } from './maxApi';
import { 
  Update, 
  Message, 
  MessageCallback,
  InlineKeyboardButton 
} from '../types/max-api';
import { 
  Reminder, 
  UserSession, 
  PREDEFINED_PERIODS,
  BotState 
} from '../types';
import {
  getReminderById,
  getRemindersByUser,
  getArchivedRemindersByUser,
  createReminder,
  updateReminder,
  archiveReminder,
  restoreReminder,
  deleteReminderPermanently,
  getUserSettings,
  upsertUserSettings,
  getUserSession,
  updateUserSession,
  clearUserSession
} from '../db/database';
import {
  parseDate,
  parseTime,
  formatDate,
  formatTime,
  formatTimeRemaining,
  formatPeriod,
  isDateInPast,
  SUPPORTED_TIMEZONES,
  toISODateString,
  getCurrentDateTimeInTimezone,
  getTodayFormatted
} from '../utils/dateUtils';

export class PamPinBot {
  private api: MaxApi;
  private groupId: number;

  constructor(token: string, groupId: number) {
    this.api = new MaxApi(token);
    this.groupId = groupId;
  }

  /**
   * Process incoming update
   */
  async processUpdate(update: Update): Promise<void> {
    try {
      console.log(`[UPDATE] Full update:`, JSON.stringify(update, null, 2));
      console.log(`[UPDATE] update_type: ${update.update_type}`);

      if (update.update_type === 'message_created' && update.message) {
        await this.handleMessage(update.message);
      } else if (update.update_type === 'message_callback') {
        await this.handleCallback(update);
      } else if (update.update_type === 'bot_started') {
        const user = update.sender || update.bot_started?.user;
        const chatId = update.bot_started?.chat_id || update.message?.recipient?.chat_id || 0;
        if (user) {
          await this.handleBotStarted(user, chatId);
        }
      } else if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.message_callback) {
        await this.handleCallback(update);
      } else if (update.bot_started) {
        await this.handleBotStarted(update.bot_started.user, update.bot_started.chat_id);
      }
    } catch (error) {
      console.error('Error processing update:', error);
    }
  }

  /**
   * Get user's timezone from settings or session
   */
  private getUserTimezone(userId: number, chatId: number, sessionData?: UserSession['data']): string {
    const settings = getUserSettings(userId, chatId);
    return settings?.timezone || sessionData?.temp_timezone || 'Europe/Moscow';
  }

  /**
   * Handle bot started event
   */
  private async handleBotStarted(user: any, chatId: number): Promise<void> {
    console.log(`[BOT_STARTED] User: ${JSON.stringify(user)}, chatId: ${chatId}`);
    
    const welcomeText = `
👋 *Добро пожаловать в PamPin!*

📅 PamPin — твой календарь важных дат. Я напомню обо всём, что ты расскажешь.

*Что я умею:*
• Добавлять напоминания о важных датах
• Напоминать за нужный период (за 3 месяца, за день, за час и т.д.)
• Повторять напоминания ежегодно
• Работать с разными часовыми поясами

*Как создать напоминание:*
1. Нажми "➕ Добавить напоминание"
2. Введи название события
3. Укажи дату и время
4. Выбери периоды напоминаний

*Команды:*
/start — показать это сообщение
/list — список ваших напоминаний
/settings — настройки (часовой пояс)
/help — справка
`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('➕ Добавить напоминание', 'add_reminder')],
      [callbackButton('📋 Мои напоминания', 'list_reminders')],
      [callbackButton('⚙️ Настройки', 'settings')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, welcomeText, buttons, 'markdown');
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: Message): Promise<void> {
    // Извлекаем данные из правильных мест
    const userId = message.sender?.user_id || 0;
    // chat_id может быть в recipient.chat_id или напрямую в chat_id
    const chatId = message.recipient?.chat_id || message.chat_id || 0;
    // text может быть в body.text или напрямую в text
    const text = message.body?.text || message.text || '';
    
    console.log(`[MESSAGE] userId: ${userId}, chatId: ${chatId}, text: "${text}"`);

    if (!text.trim()) return;

    // Get user session
    const session = getUserSession(userId, chatId);

    // Handle commands
    if (text.startsWith('/')) {
      await this.handleCommand(userId, chatId, text.trim());
      return;
    }

    // Handle state-based input
    switch (session.state) {
      case 'waiting_for_title':
        await this.handleTitleInput(userId, chatId, text.trim(), session);
        break;
      case 'waiting_for_date':
        await this.handleDateInput(userId, chatId, text.trim(), session);
        break;
      case 'waiting_for_time':
        await this.handleTimeInput(userId, chatId, text.trim(), session);
        break;
      case 'waiting_for_description':
        await this.handleDescriptionInput(userId, chatId, text.trim(), session);
        break;
      case 'waiting_for_timezone':
        await this.handleTimezoneInput(userId, chatId, text.trim(), session);
        break;
      default:
        // Unknown input in idle state
        await this.showMainMenu(chatId);
    }
  }

  /**
   * Handle command
   */
  private async handleCommand(userId: number, chatId: number, command: string): Promise<void> {
    console.log(`[COMMAND] ${command} from user ${userId} in chat ${chatId}`);
    const cmd = command.toLowerCase().split(' ')[0];

    switch (cmd) {
      case '/start':
        await this.handleBotStarted({ user_id: userId }, chatId);
        break;
      case '/list':
        await this.showRemindersList(userId, chatId);
        break;
      case '/settings':
        await this.showSettings(userId, chatId);
        break;
      case '/help':
        await this.showHelp(chatId);
        break;
      default:
        await this.api.sendText(chatId, 'Неизвестная команда. Введите /help для справки.');
    }
  }

  /**
   * Handle callback query (button press)
   */
  private async handleCallback(update: Update): Promise<void> {
    console.log(`[CALLBACK] Processing callback update`);
    
    // Извлекаем данные из update
    const userId = update.sender?.user_id || update.message_callback?.user?.user_id || 0;
    const chatId = update.message?.recipient?.chat_id || 
                   update.message_callback?.chat_id ||
                   update.message?.chat_id || 0;
    
    // Payload может быть в разных местах
    const payload = update.callback?.payload || 
                    update.callback?.data ||
                    update.message_callback?.payload || '';
    
    // Callback ID для ответа
    const callbackId = update.callback?.id || 
                       update.message_callback?.callback_id || '';

    console.log(`[CALLBACK] userId: ${userId}, chatId: ${chatId}, payload: "${payload}", callbackId: "${callbackId}"`);

    // Answer callback to remove loading state
    if (callbackId) {
      try {
        await this.api.answerCallback(callbackId);
      } catch (e) {
        console.error('Failed to answer callback:', e);
      }
    }

    if (!payload) {
      console.log('[CALLBACK] No payload found, skipping');
      return;
    }

    // Parse callback data
    const [action, ...params] = payload.split(':');

    switch (action) {
      case 'add_reminder':
        await this.startAddReminder(userId, chatId);
        break;
      case 'list_reminders':
        await this.showRemindersList(userId, chatId);
        break;
      case 'archived_reminders':
        await this.showArchivedRemindersList(userId, chatId);
        break;
      case 'view_reminder':
        await this.showReminderDetails(userId, chatId, params[0]);
        break;
      case 'edit_reminder':
        await this.startEditReminder(userId, chatId, params[0]);
        break;
      case 'archive_reminder':
        await this.confirmArchiveReminder(chatId, params[0]);
        break;
      case 'confirm_archive':
        await this.executeArchiveReminder(userId, chatId, params[0]);
        break;
      case 'restore_reminder':
        await this.confirmRestoreReminder(chatId, params[0]);
        break;
      case 'confirm_restore':
        await this.executeRestoreReminder(userId, chatId, params[0]);
        break;
      case 'delete_reminder':
        await this.confirmDeleteReminder(chatId, params[0]);
        break;
      case 'confirm_delete':
        await this.executeDeleteReminder(userId, chatId, params[0]);
        break;
      case 'cancel':
        clearUserSession(userId, chatId);
        await this.showMainMenu(chatId);
        break;
      case 'settings':
        await this.showSettings(userId, chatId);
        break;
      case 'change_timezone':
        await this.showTimezoneSelection(chatId);
        break;
      case 'set_timezone':
        await this.setTimezone(userId, chatId, params[0]);
        break;
      case 'select_periods':
        await this.showPeriodSelection(userId, chatId);
        break;
      case 'toggle_period':
        await this.togglePeriod(userId, chatId, parseInt(params[0]));
        break;
      case 'confirm_periods':
        await this.confirmPeriods(userId, chatId);
        break;
      case 'toggle_repeat':
        await this.toggleRepeat(userId, chatId);
        break;
      case 'confirm_reminder':
        await this.confirmReminder(userId, chatId);
        break;
      case 'main_menu':
        await this.showMainMenu(chatId);
        break;
      case 'skip_time':
        await this.skipTime(userId, chatId);
        break;
      case 'skip_description':
        await this.skipDescription(userId, chatId);
        break;
      case 'set_next_year':
        await this.setDateNextYear(userId, chatId, params[0]);
        break;
      case 'retry_date':
        await this.retryDate(userId, chatId);
        break;
      case 'dismiss':
        break;
    }
  }

  // ... остальные методы handlers.ts (startAddReminder, handleTitleInput, и т.д.)
  // Полный код показан в предыдущем сообщении
}
