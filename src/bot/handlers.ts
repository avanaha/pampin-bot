import { MaxApi, callbackButton } from './maxApi';
import { Update, Message, InlineKeyboardButton } from '../types/max-api';
import {
  getReminderById,
  getRemindersByUser,
  getArchivedRemindersByUser,
  createReminder,
  archiveReminder,
  restoreReminder,
  deleteReminderPermanently,
  updateReminder,
  getUserSettings,
  upsertUserSettings,
  getUserSession,
  updateUserSession,
  clearUserSession
} from '../db/database';
import {
  parseDate,
  parseDateWithFeedback,
  parseTime,
  formatDate,
  formatTime,
  formatPeriod,
  isDateInPast,
  isDateTimeInPast,
  SUPPORTED_TIMEZONES,
  toISODateString,
  getCurrentDateTimeInTimezone,
  getTimezoneOffset,
  getDayOfWeek,
  addDays,
  addMonths,
  addYears,
  createDateInTimezone,
  calculateNotificationTime,
  utcToLocalTime
} from '../utils/dateUtils';
import { Reminder, UserSession, RepeatType, PREDEFINED_PERIODS, REPEAT_OPTIONS, WEEKDAYS } from '../types';

export class PamPinBot {
  private api: MaxApi;
  private groupId: number;
  private sessions: Map<string, UserSession> = new Map();

  constructor(token: string, groupId: number) {
    this.api = new MaxApi(token);
    this.groupId = groupId;
  }

  private getSessionKey(userId: number, chatId: number): string {
    return `${userId}:${chatId}`;
  }

  private getSession(userId: number, chatId: number): UserSession {
    const key = this.getSessionKey(userId, chatId);
    if (this.sessions.has(key)) {
      console.log(`[SESSION] Found in MEMORY: ${key}`);
      return this.sessions.get(key)!;
    }
    const dbSession = getUserSession(userId, chatId);
    console.log(`[SESSION] From DB: ${key}, state=${dbSession.state}`);
    return dbSession;
  }

  private saveSession(userId: number, chatId: number, session: Partial<UserSession>): UserSession {
    const key = this.getSessionKey(userId, chatId);
    const current = this.getSession(userId, chatId);
    const updated: UserSession = {
      ...current,
      ...session,
      data: { ...current.data, ...session.data },
      last_activity: new Date()
    };
    this.sessions.set(key, updated);
    updateUserSession(userId, chatId, { state: updated.state, data: updated.data });
    console.log(`[SESSION] SAVED: ${key}, state=${updated.state}`);
    return updated;
  }

  private clearSession(userId: number, chatId: number): void {
    const key = this.getSessionKey(userId, chatId);
    this.sessions.delete(key);
    clearUserSession(userId, chatId);
    console.log(`[SESSION] CLEARED: ${key}`);
  }

  async processUpdate(update: Update): Promise<void> {
    console.log('');
    console.log('============================================================');
    console.log('[PROCESS] UPDATE RECEIVED');
    console.log('[PROCESS] update_type:', update?.update_type);
    console.log('[PROCESS] FULL JSON:', JSON.stringify(update, null, 2));
    console.log('============================================================');

    try {
      const updateType = update?.update_type;
      if (!updateType) {
        console.log('[PROCESS] ERROR: No update_type!');
        return;
      }

      switch (updateType) {
        case 'message_created':
          await this.handleMessage(update);
          break;
        case 'message_callback':
          await this.handleCallback(update);
          break;
        case 'bot_started':
          await this.handleBotStarted(update);
          break;
        default:
          console.log('[PROCESS] Unknown type:', updateType);
      }
    } catch (error) {
      console.error('[PROCESS] ERROR:', error);
    }
  }

  private async handleBotStarted(update: Update): Promise<void> {
    console.log('[BOT_STARTED]');
    const anyUpdate = update as any;
    const userId = update.sender?.user_id || anyUpdate.user?.user_id || 0;
    const chatId = anyUpdate.chat_id || 0;
    console.log('[BOT_STARTED] userId:', userId, 'chatId:', chatId);

    const text = `👋 *Добро пожаловать в PamPin!*

📅 Я помогу вам не забыть о важных датах.

*Что я умею:*
• Добавлять напоминания
• Напоминать за нужный период
• Повторять по расписанию`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('➕ Добавить напоминание', 'add_reminder')],
      [callbackButton('📋 Мои напоминания', 'list_reminders')],
      [callbackButton('📦 Архив', 'archived_reminders')],
      [callbackButton('⚙️ Настройки', 'settings')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async handleMessage(update: Update): Promise<void> {
    console.log('[MESSAGE] === START ===');
    console.log('[MESSAGE] FULL JSON:', JSON.stringify(update, null, 2));

    const message = update.message;
    if (!message) {
      console.log('[MESSAGE] No message!');
      return;
    }

    let userId = 0;
    if (message.sender?.user_id) {
      userId = message.sender.user_id;
      console.log('[MESSAGE] userId from message.sender.user_id:', userId);
    } else if (update.sender?.user_id) {
      userId = update.sender.user_id;
      console.log('[MESSAGE] userId from update.sender.user_id:', userId);
    }
    console.log('[MESSAGE] FINAL userId:', userId);

    let chatId = 0;
    if (message.recipient?.chat_id) {
      chatId = message.recipient.chat_id;
      console.log('[MESSAGE] chatId from message.recipient.chat_id:', chatId);
    } else if (message.chat_id) {
      chatId = message.chat_id;
      console.log('[MESSAGE] chatId from message.chat_id:', chatId);
    }
    console.log('[MESSAGE] FINAL chatId:', chatId);

    let text = '';
    if (message.body?.text) {
      text = message.body.text;
    } else if (message.text) {
      text = message.text;
    }
    console.log('[MESSAGE] text:', text);

    if (!text || !text.trim()) {
      console.log('[MESSAGE] Empty text, skip');
      return;
    }

    if (text.trim().startsWith('/')) {
      await this.handleCommand(userId, chatId, text.trim());
      return;
    }

    const session = this.getSession(userId, chatId);
    console.log('[MESSAGE] Session state:', session.state);
    console.log('[MESSAGE] Session data:', JSON.stringify(session.data));

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
      case 'waiting_for_month_day':
        await this.handleMonthDayInput(userId, chatId, text.trim(), session);
        break;
      case 'editing_title':
        await this.handleEditTitle(userId, chatId, text.trim(), session);
        break;
      case 'editing_date':
        await this.handleEditDate(userId, chatId, text.trim(), session);
        break;
      case 'editing_time':
        await this.handleEditTime(userId, chatId, text.trim(), session);
        break;
      case 'editing_description':
        await this.handleEditDescription(userId, chatId, text.trim(), session);
        break;
      case 'editing_month_day':
        await this.handleEditMonthDay(userId, chatId, text.trim(), session);
        break;
      default:
        await this.showMainMenu(chatId);
    }
  }

  private async handleCommand(userId: number, chatId: number, text: string): Promise<void> {
    const cmd = text.toLowerCase().split(' ')[0];
    console.log('[COMMAND]', cmd, 'userId:', userId, 'chatId:', chatId);

    try {
      switch (cmd) {
        case '/start':
          await this.sendWelcome(chatId);
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
          await this.api.sendText(chatId, 'Неизвестная команда. Введите /help');
      }
    } catch (error) {
      console.error('[COMMAND] Error:', error);
      await this.api.sendText(chatId, 'Ошибка. Попробуйте ещё раз.');
    }
  }

  private async handleCallback(update: Update): Promise<void> {
    console.log('[CALLBACK] === START ===');
    console.log('[CALLBACK] FULL JSON:', JSON.stringify(update, null, 2));

    const anyUpdate = update as any;

    let userId = 0;
    if (update.message_callback?.user?.user_id) {
      userId = update.message_callback.user.user_id;
    } else if (anyUpdate.message_callback?.user?.user_id) {
      userId = anyUpdate.message_callback.user.user_id;
    } else if (update.callback?.user?.user_id) {
      userId = update.callback.user.user_id;
    } else if (anyUpdate.user?.user_id) {
      userId = anyUpdate.user.user_id;
    }
    console.log('[CALLBACK] FINAL userId:', userId);

    let chatId = 0;
    if (update.message_callback?.chat_id) {
      chatId = update.message_callback.chat_id;
    } else if (anyUpdate.message_callback?.chat_id) {
      chatId = anyUpdate.message_callback.chat_id;
    } else if (update.callback?.chat_id) {
      chatId = update.callback.chat_id;
    } else if (anyUpdate.callback?.chat_id) {
      chatId = anyUpdate.callback.chat_id;
    } else if (update.callback?.message?.recipient?.chat_id) {
      chatId = update.callback.message.recipient.chat_id;
    } else if (anyUpdate.callback?.message?.recipient?.chat_id) {
      chatId = anyUpdate.callback.message.recipient.chat_id;
    } else if (update.message?.recipient?.chat_id) {
      chatId = update.message.recipient.chat_id;
    } else if (anyUpdate.message?.recipient?.chat_id) {
      chatId = anyUpdate.message.recipient.chat_id;
    } else if (anyUpdate.chat_id) {
      chatId = anyUpdate.chat_id;
    }
    console.log('[CALLBACK] FINAL chatId:', chatId);

    let payload = '';
    if (update.message_callback?.payload) {
      payload = update.message_callback.payload;
    } else if (anyUpdate.message_callback?.payload) {
      payload = anyUpdate.message_callback.payload;
    } else if (update.callback?.payload) {
      payload = update.callback.payload;
    } else if (anyUpdate.payload) {
      payload = anyUpdate.payload;
    }
    console.log('[CALLBACK] FINAL payload:', payload);

    let callbackId = '';
    if (update.message_callback?.callback_id) {
      callbackId = update.message_callback.callback_id;
    } else if (anyUpdate.message_callback?.callback_id) {
      callbackId = anyUpdate.message_callback.callback_id;
    } else if (update.callback?.id) {
      callbackId = update.callback.id;
    } else if (anyUpdate.callback_id) {
      callbackId = anyUpdate.callback_id;
    }
    console.log('[CALLBACK] callback_id:', callbackId);

    if (callbackId) {
      try {
        await this.api.answerCallback(callbackId);
        console.log('[CALLBACK] Answered OK');
      } catch (e) {
        console.error('[CALLBACK] Answer failed:', e);
      }
    }

    if (!payload) {
      console.log('[CALLBACK] No payload');
      if (chatId) {
        await this.api.sendText(chatId, 'Ошибка: действие не определено');
      }
      return;
    }

    if (!chatId) {
      console.log('[CALLBACK] No chatId');
      return;
    }

    const [action, ...params] = payload.split(':');
    console.log('[CALLBACK] Action:', action, 'Params:', params);
    console.log('[CALLBACK] Will use userId:', userId, 'chatId:', chatId);

    try {
      await this.executeAction(userId, chatId, action, params);
    } catch (error) {
      console.error('[CALLBACK] Error:', error);
      await this.api.sendText(chatId, 'Ошибка.');
    }
  }

  private async executeAction(userId: number, chatId: number, action: string, params: string[]): Promise<void> {
    console.log('[ACTION]', action, 'userId:', userId, 'chatId:', chatId);
    
    switch (action) {
      case 'add_reminder':
        await this.startAddReminder(userId, chatId);
        break;
      case 'list_reminders':
        await this.showRemindersList(userId, chatId);
        break;
      case 'archived_reminders':
        await this.showArchivedList(userId, chatId);
        break;
      case 'view_reminder':
        await this.showReminderDetails(userId, chatId, params[0]);
        break;
      case 'archive_reminder':
        await this.confirmArchive(userId, chatId, params[0]);
        break;
      case 'confirm_archive':
        await this.doArchive(userId, chatId, params[0]);
        break;
      case 'restore_reminder':
        await this.confirmRestore(userId, chatId, params[0]);
        break;
      case 'confirm_restore':
        await this.doRestore(userId, chatId, params[0]);
        break;
      case 'delete_reminder':
        await this.confirmDelete(userId, chatId, params[0]);
        break;
      case 'confirm_delete':
        await this.doDelete(userId, chatId, params[0]);
        break;
      case 'cancel_delete':
        await this.showReminderDetails(userId, chatId, params[0]);
        break;
      case 'settings':
        await this.showSettings(userId, chatId);
        break;
      case 'change_timezone':
        await this.showTimezoneMenu(chatId);
        break;
      case 'set_timezone':
        await this.doSetTimezone(userId, chatId, params[0]);
        break;
      case 'select_period':
        await this.showPeriodMenu(userId, chatId);
        break;
      case 'set_period':
        await this.setPeriod(userId, chatId, parseInt(params[0]));
        break;
      case 'select_repeat':
        await this.showRepeatMenu(userId, chatId);
        break;
      case 'set_repeat':
        await this.setRepeat(userId, chatId, params[0] as RepeatType);
        break;
      case 'toggle_repeat_day':
        await this.toggleRepeatDay(userId, chatId, parseInt(params[0]));
        break;
      case 'confirm_repeat_days':
        await this.confirmRepeatDays(userId, chatId);
        break;
      case 'confirm_reminder':
        await this.saveReminder(userId, chatId);
        break;
      case 'edit_reminder':
        await this.showEditMenu(userId, chatId);
        break;
      case 'edit_existing_reminder':
        await this.showEditExistingMenu(userId, chatId, params[0]);
        break;
      case 'edit_title':
        await this.startEditTitle(userId, chatId);
        break;
      case 'edit_date':
        await this.startEditDate(userId, chatId);
        break;
      case 'edit_time':
        await this.startEditTime(userId, chatId);
        break;
      case 'edit_description':
        await this.startEditDescription(userId, chatId);
        break;
      case 'edit_period':
        await this.showPeriodMenu(userId, chatId);
        break;
      case 'edit_repeat':
        await this.showRepeatMenu(userId, chatId);
        break;
      case 'edit_existing_title':
        await this.startEditExistingTitle(userId, chatId, params[0]);
        break;
      case 'edit_existing_date':
        await this.startEditExistingDate(userId, chatId, params[0]);
        break;
      case 'edit_existing_time':
        await this.startEditExistingTime(userId, chatId, params[0]);
        break;
      case 'edit_existing_description':
        await this.startEditExistingDescription(userId, chatId, params[0]);
        break;
      case 'edit_existing_period':
        await this.startEditExistingPeriod(userId, chatId, params[0]);
        break;
      case 'edit_existing_repeat':
        await this.startEditExistingRepeat(userId, chatId, params[0]);
        break;
      case 'main_menu':
        await this.showMainMenu(chatId);
        break;
      case 'cancel':
        this.clearSession(userId, chatId);
        await this.showMainMenu(chatId);
        break;
      case 'skip_description':
        await this.skipDescription(userId, chatId);
        break;
      case 'dismiss':
        break;
      case 'test_notification':
        await this.sendTestNotification(userId, chatId, params[0]);
        break;
      case 'confirm_edit_reminder':
        await this.saveEditedReminder(userId, chatId);
        break;
      default:
        console.log('[ACTION] Unknown:', action);
        await this.showMainMenu(chatId);
    }
  }

  private async sendWelcome(chatId: number): Promise<void> {
    console.log('[WELCOME] chatId:', chatId);
    const text = `👋 *Добро пожаловать в PamPin!*

📅 Я помогу вам не забыть о важных датах.

*Что я умею:*
• Добавлять напоминания
• Напоминать за нужный период
• Повторять по расписанию`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('➕ Добавить напоминание', 'add_reminder')],
      [callbackButton('📋 Мои напоминания', 'list_reminders')],
      [callbackButton('📦 Архив', 'archived_reminders')],
      [callbackButton('⚙️ Настройки', 'settings')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  // ГЛАВНОЕ МЕНЮ - с кнопкой Архив
  private async showMainMenu(chatId: number): Promise<void> {
    console.log('[MENU] chatId:', chatId);
    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('➕ Добавить напоминание', 'add_reminder')],
      [callbackButton('📋 Мои напоминания', 'list_reminders')],
      [callbackButton('📦 Архив', 'archived_reminders')],
      [callbackButton('⚙️ Настройки', 'settings')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, '🏠 *Главное меню*', buttons, 'markdown');
  }

  private async startAddReminder(userId: number, chatId: number): Promise<void> {
    console.log('[ADD] userId:', userId, 'chatId:', chatId);
    const settings = getUserSettings(userId, chatId);
    const tz = settings?.timezone || 'Europe/Moscow';

    this.saveSession(userId, chatId, {
      state: 'waiting_for_title',
      data: {
        temp_timezone: tz,
        temp_multi_count: 1,
        temp_multi_interval: 5
      }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `📝 *Создание напоминания*

Введите название напоминания:
_Например: День рождения мамы_`,
      [[callbackButton('❌ Отмена', 'cancel')]],
      'markdown'
    );
  }

  private async handleTitleInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log('[TITLE] userId:', userId, 'chatId:', chatId, 'text:', text);
    
    if (text.length < 2) {
      await this.api.sendText(chatId, '❌ Слишком короткое название. Введите хотя бы 2 символа:');
      return;
    }

    this.saveSession(userId, chatId, {
      state: 'waiting_for_date',
      data: { ...session.data, temp_title: text }
    });

    const tz = session.data?.temp_timezone || 'Europe/Moscow';
    const today = this.getTodayString(tz);
    
    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Название: *${text}*

📅 Введите дату события:
_Формат: ДД/ММ/ГГГГ (например: ${today})_`,
      [[callbackButton('❌ Отмена', 'cancel')]],
      'markdown'
    );
  }

  private async handleDateInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log('[DATE] userId:', userId, 'chatId:', chatId, 'text:', text);
    
    const tz = session.data?.temp_timezone || 'Europe/Moscow';
    const result = parseDateWithFeedback(text, tz);

    if (!result.date) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        result.error || '❌ Не удалось распознать дату.',
        [[callbackButton('❌ Отмена', 'cancel')]],
        'markdown'
      );
      return;
    }

    // Проверяем, что дата не в прошлом (только дата, без времени)
    if (isDateInPast(result.date, tz)) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        `❌ Дата *${this.formatDateForUser(result.date, tz)}* уже прошла.

📅 Введите будущую дату:`,
        [[callbackButton('❌ Отмена', 'cancel')]],
        'markdown'
      );
      return;
    }

    this.saveSession(userId, chatId, {
      state: 'waiting_for_time',
      data: { ...session.data, temp_date: toISODateString(result.date) }
    });

    // ВРЕМЯ ОБЯЗАТЕЛЬНО - нет кнопки "Пропустить"
    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Дата: *${this.formatDateForUser(result.date, tz)}*

🕐 Введите время события:
_Формат: ЧЧ-ММ (например: 14-30)_`,
      [[callbackButton('❌ Отмена', 'cancel')]],
      'markdown'
    );
  }

  // ВРЕМЯ ОБЯЗАТЕЛЬНО - убрана возможность пропуска
  private async handleTimeInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log('[TIME] userId:', userId, 'chatId:', chatId, 'text:', text);
    
    const time = parseTime(text);
    if (!time) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        `❌ Не удалось распознать время.

🕐 Используйте формат: ЧЧ-ММ
_Например: 14-30 или 09-00_`,
        [[callbackButton('❌ Отмена', 'cancel')]],
        'markdown'
      );
      return;
    }

    // Проверяем, что дата-время не в прошлом
    const tz = session.data?.temp_timezone || 'Europe/Moscow';
    const dateStr = session.data?.temp_date;
    if (dateStr) {
      const [year, month, day] = dateStr.split('-').map(Number);
      const eventDate = new Date(year, month - 1, day);
      const timeStr = formatTime(time.hours, time.minutes);
      
      if (isDateTimeInPast(eventDate, timeStr, tz)) {
        const now = getCurrentDateTimeInTimezone(tz);
        await this.api.sendMessageWithKeyboard(
          chatId,
          `❌ Время *${timeStr}* уже прошло (сейчас ${now.getHours().toString().padStart(2,'0')}-${now.getMinutes().toString().padStart(2,'0')}).

🕐 Введите будущее время:`,
          [[callbackButton('❌ Отмена', 'cancel')]],
          'markdown'
        );
        return;
      }
    }

    this.saveSession(userId, chatId, {
      state: 'waiting_for_description',
      data: { ...session.data, temp_time: formatTime(time.hours, time.minutes) }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Время: *${formatTime(time.hours, time.minutes)}*

📝 Введите описание (о чём напомнить):
_Например: Купить торт и подарки_
Или пропустите, если описание не нужно:`,
      [
        [callbackButton('⏭ Пропустить описание', 'skip_description')],
        [callbackButton('❌ Отмена', 'cancel')]
      ],
      'markdown'
    );
  }

  private async handleDescriptionInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log('[DESC] userId:', userId, 'chatId:', chatId, 'text:', text);
    
    this.saveSession(userId, chatId, {
      state: 'waiting_for_period',
      data: { ...session.data, temp_description: text }
    });

    await this.showPeriodMenu(userId, chatId);
  }

  private async skipDescription(userId: number, chatId: number): Promise<void> {
    console.log('[SKIP_DESC] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    
    this.saveSession(userId, chatId, {
      state: 'waiting_for_period',
      data: { ...session.data, temp_description: undefined }
    });

    await this.showPeriodMenu(userId, chatId);
  }

  // ==================== PERIOD MENU ====================

  private async showPeriodMenu(userId: number, chatId: number): Promise<void> {
    console.log('[PERIOD_MENU] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const data = session.data;

    const title = data?.temp_title || 'Напоминание';
    const tz = data?.temp_timezone || 'Europe/Moscow';
    let dateStr = '';
    if (data?.temp_date) {
      const date = this.parseISODate(data.temp_date, tz);
      dateStr = this.formatDateForUser(date, tz);
      if (data.temp_time) {
        dateStr += ` в ${data.temp_time}`;
      }
    }

    const text = `🔔 *За сколько напомнить?*

📌 ${title}
📅 ${dateStr || 'дата не указана'}

Выберите один вариант:`;

    const buttons: InlineKeyboardButton[][] = PREDEFINED_PERIODS.map((p, i) => [
      callbackButton(p.label, `set_period:${i}`)
    ]);
    buttons.push([callbackButton('❌ Отмена', 'cancel')]);

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async setPeriod(userId: number, chatId: number, idx: number): Promise<void> {
    console.log('[SET_PERIOD] userId:', userId, 'chatId:', chatId, 'idx:', idx);
    const session = this.getSession(userId, chatId);
    const period = PREDEFINED_PERIODS[idx];

    this.saveSession(userId, chatId, {
      state: 'waiting_for_repeat',
      data: { ...session.data, temp_period: period.value }
    });

    await this.showRepeatMenu(userId, chatId);
  }

  // ==================== REPEAT MENU ====================

  private async showRepeatMenu(userId: number, chatId: number): Promise<void> {
    console.log('[REPEAT_MENU] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const data = session.data;

    const title = data?.temp_title || 'Напоминание';
    const tz = data?.temp_timezone || 'Europe/Moscow';
    let dateStr = '';
    if (data?.temp_date) {
      const date = this.parseISODate(data.temp_date, tz);
      dateStr = this.formatDateForUser(date, tz);
      if (data.temp_time) {
        dateStr += ` в ${data.temp_time}`;
      }
    }

    const text = `🔄 *Нужно ли повторять это напоминание?*

📌 ${title}
📅 ${dateStr || 'дата не указана'}

Выберите вариант повтора:`;

    const buttons: InlineKeyboardButton[][] = REPEAT_OPTIONS.map((r) => [
      callbackButton(r.label, `set_repeat:${r.value}`)
    ]);
    buttons.push([callbackButton('❌ Отмена', 'cancel')]);

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async setRepeat(userId: number, chatId: number, repeatType: RepeatType): Promise<void> {
    console.log('[SET_REPEAT] userId:', userId, 'chatId:', chatId, 'repeatType:', repeatType);
    const session = this.getSession(userId, chatId);

    if (repeatType === 'custom_days') {
      this.saveSession(userId, chatId, {
        state: 'waiting_for_repeat_days',
        data: { ...session.data, temp_repeat_type: repeatType, temp_repeat_days: [] }
      });
      await this.showRepeatDaysMenu(userId, chatId);
    } else if (repeatType === 'monthly_day') {
      this.saveSession(userId, chatId, {
        state: 'waiting_for_month_day',
        data: { ...session.data, temp_repeat_type: repeatType }
      });
      await this.api.sendMessageWithKeyboard(
        chatId,
        `📅 Введите число месяца (от 1 до 28):

Например: 18 — значит каждого 18-го числа`,
        [[callbackButton('◀️ Назад', 'select_repeat')]],
        'markdown'
      );
    } else {
      this.saveSession(userId, chatId, {
        state: 'preview',
        data: { ...session.data, temp_repeat_type: repeatType }
      });
      await this.showPreview(userId, chatId, session.data);
    }
  }

  private async showRepeatDaysMenu(userId: number, chatId: number): Promise<void> {
    console.log('[REPEAT_DAYS_MENU] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const selected = session.data?.temp_repeat_days || [];

    const text = `📆 *Выберите дни недели:*

(можно выбрать несколько)`;

    const buttons: InlineKeyboardButton[][] = WEEKDAYS.map((day) => {
      const isSelected = selected.includes(day.value);
      const prefix = isSelected ? '✅ ' : '⬜ ';
      return [callbackButton(`${prefix}${day.label}`, `toggle_repeat_day:${day.value}`)];
    });
    buttons.push([callbackButton('✅ Готово', 'confirm_repeat_days')]);
    buttons.push([callbackButton('◀️ Назад', 'select_repeat')]);

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async toggleRepeatDay(userId: number, chatId: number, dayValue: number): Promise<void> {
    console.log('[TOGGLE_REPEAT_DAY] userId:', userId, 'chatId:', chatId, 'day:', dayValue);
    const session = this.getSession(userId, chatId);
    const days = [...(session.data?.temp_repeat_days || [])];

    const idx = days.indexOf(dayValue);
    if (idx >= 0) {
      days.splice(idx, 1);
    } else {
      days.push(dayValue);
      days.sort((a, b) => a - b);
    }

    this.saveSession(userId, chatId, {
      data: { ...session.data, temp_repeat_days: days }
    });

    await this.showRepeatDaysMenu(userId, chatId);
  }

  private async confirmRepeatDays(userId: number, chatId: number): Promise<void> {
    console.log('[CONFIRM_REPEAT_DAYS] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const days = session.data?.temp_repeat_days || [];

    if (days.length === 0) {
      await this.api.sendText(chatId, '❌ Выберите хотя бы один день недели.');
      return;
    }

    this.saveSession(userId, chatId, {
      state: 'preview',
      data: { ...session.data }
    });

    await this.showPreview(userId, chatId, session.data);
  }

  private async handleMonthDayInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log('[MONTH_DAY] userId:', userId, 'chatId:', chatId, 'text:', text);
    
    const day = parseInt(text.trim(), 10);
    if (isNaN(day) || day < 1 || day > 28) {
      await this.api.sendText(chatId, '❌ Введите число от 1 до 28:');
      return;
    }

    this.saveSession(userId, chatId, {
      state: 'preview',
      data: { ...session.data, temp_month_day: day }
    });

    await this.showPreview(userId, chatId, session.data);
  }

  // ==================== PREVIEW ====================

  private async showPreview(userId: number, chatId: number, data: UserSession['data']): Promise<void> {
    console.log('[PREVIEW] chatId:', chatId, 'data:', JSON.stringify(data));
    
    // Check if editing existing reminder
    const isEditing = !!data?.editing_reminder_id;
    
    // If editing and missing temp data, load from existing reminder
    if (isEditing && (!data?.temp_title || !data?.temp_date)) {
      const reminder = getReminderById(data.editing_reminder_id!);
      if (reminder) {
        data = {
          ...data,
          temp_title: reminder.title,
          temp_description: reminder.description,
          temp_date: reminder.event_date,
          temp_time: reminder.event_time,
          temp_timezone: reminder.timezone,
          temp_period: reminder.reminder_periods?.[0],
          temp_repeat_type: reminder.repeat_type,
          temp_repeat_days: reminder.repeat_days,
          temp_month_day: reminder.repeat_month_day
        };
        console.log('[PREVIEW] Loaded data from existing reminder:', data.editing_reminder_id);
      }
    }
    
    if (!data || !data.temp_title || !data.temp_date || !data.temp_time) {
      console.log('[PREVIEW] No data!');
      await this.api.sendText(chatId, '❌ Ошибка: данные потеряны. Попробуйте заново.');
      return;
    }
    
    const tz = data.temp_timezone || 'Europe/Moscow';
    const date = data.temp_date ? this.parseISODate(data.temp_date, tz) : new Date();
    const period = data.temp_period || 86400000;
    const periodLabel = formatPeriod(period);
    const repeatLabel = this.getRepeatLabel(data.temp_repeat_type || 'none', data.temp_repeat_days, data.temp_month_day);

    // Рассчитываем время уведомления с учётом часового пояса
    const notificationTime = this.calculateNotificationTimeDisplay(data.temp_date, data.temp_time, period, tz);

    const text = `📋 *${isEditing ? 'Проверка изменений' : 'Проверка напоминания'}*

📌 *Название:* ${data.temp_title}
📅 *Дата:* ${this.formatDateForUser(date, tz)} в ${data.temp_time}
📝 *Описание:* ${data.temp_description || 'нет'}
🔔 *Напомнить:* ${periodLabel}
⏱ *Время уведомления:* ${notificationTime}
🔄 *Повтор:* ${repeatLabel}

Всё верно?`;

    // Show "Сохранить" for edit mode, "Создать" for new
    const confirmButton = isEditing
      ? callbackButton('💾 Сохранить изменения', 'confirm_edit_reminder')
      : callbackButton('✅ Создать напоминание', 'confirm_reminder');

    const buttons: InlineKeyboardButton[][] = [
      [confirmButton],
      [callbackButton('✏️ Редактировать', 'edit_reminder')],
      [callbackButton('❌ Отмена', 'cancel')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  // ИСПРАВЛЕННЫЙ расчёт времени уведомления
  private calculateNotificationTimeDisplay(dateStr: string, timeStr: string, periodMs: number, timezone: string): string {
    // Парсим дату и время
    const [year, month, day] = dateStr.split('-').map(Number);
    const timeParts = timeStr.split(/[:-]/).map(Number);
    const hours = timeParts[0] || 0;
    const minutes = timeParts[1] || 0;
    
    // Создаём datetime события в UTC (с учётом часового пояса)
    const eventDateTime = createDateInTimezone(year, month - 1, day, hours, minutes, timezone);
    
    // Вычитаем период
    const notificationTime = new Date(eventDateTime.getTime() - periodMs);
    
    // Конвертируем обратно в локальное время пользователя
    const localTime = utcToLocalTime(notificationTime, timezone);
    
    const now = getCurrentDateTimeInTimezone(timezone);
    const diffMs = notificationTime.getTime() - now.getTime();
    
    const monthNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    
    let relative = '';
    if (diffMs < 0) {
      relative = ' (прошло)';
    } else {
      const diffMins = Math.round(diffMs / 60000);
      const diffHours = Math.round(diffMs / 3600000);
      const diffDays = Math.round(diffMs / 86400000);
      
      if (diffMins < 60) {
        relative = ` (через ${diffMins} ${this.pluralizeRu(diffMins, 'минуту', 'минуты', 'минут')})`;
      } else if (diffHours < 24) {
        relative = ` (через ${diffHours} ${this.pluralizeRu(diffHours, 'час', 'часа', 'часов')})`;
      } else {
        relative = ` (через ${diffDays} ${this.pluralizeRu(diffDays, 'день', 'дня', 'дней')})`;
      }
    }
    
    return `${localTime.day} ${monthNames[localTime.month]} в ${localTime.hours.toString().padStart(2, '0')}:${localTime.minutes.toString().padStart(2, '0')}${relative}`;
  }

  private pluralizeRu(n: number, one: string, few: string, many: string): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  private getRepeatLabel(repeatType: RepeatType, days?: number[], monthDay?: number): string {
    switch (repeatType) {
      case 'none': return 'не повторять';
      case 'daily': return 'ежедневно';
      case 'weekly': return 'еженедельно';
      case 'monthly': return 'ежемесячно';
      case 'yearly': return 'ежегодно';
      case 'custom_days':
        if (days && days.length > 0) {
          const dayNames = days.map(d => WEEKDAYS.find(w => w.value === d)?.short || '').join(', ');
          return `по ${dayNames}`;
        }
        return 'выбранные дни';
      case 'monthly_day':
        return monthDay ? `каждого ${monthDay}-го числа` : 'каждого N-го числа';
      default: return 'не повторять';
    }
  }

  // ==================== EDIT MENU (при создании) ====================

  private async showEditMenu(userId: number, chatId: number): Promise<void> {
    console.log('[EDIT_MENU] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const data = session.data;

    if (!data) {
      await this.api.sendText(chatId, '❌ Данные потеряны.');
      return;
    }

    const text = `✏️ *Что хотите изменить?*

📌 *${data.temp_title}*`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('📝 Название', 'edit_title')],
      [callbackButton('📅 Дату', 'edit_date')],
      [callbackButton('🕐 Время', 'edit_time')],
      [callbackButton('📝 Описание', 'edit_description')],
      [callbackButton('🔔 Период', 'edit_period')],
      [callbackButton('🔄 Повтор', 'edit_repeat')],
      [callbackButton('✅ Готово', 'confirm_reminder')],
      [callbackButton('❌ Отмена', 'cancel')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async startEditTitle(userId: number, chatId: number): Promise<void> {
    console.log('[EDIT_TITLE] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    
    this.saveSession(userId, chatId, { state: 'editing_title' });
    
    await this.api.sendMessageWithKeyboard(
      chatId,
      `📝 Введите новое название:
_Текущее: ${session.data?.temp_title}_`,
      [[callbackButton('◀️ Назад', 'edit_reminder')]],
      'markdown'
    );
  }

  private async handleEditTitle(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    if (text.length < 2) {
      await this.api.sendText(chatId, '❌ Слишком короткое. Попробуйте ещё:');
      return;
    }
    
    const updatedSession = this.saveSession(userId, chatId, {
      state: 'preview',
      data: { ...session.data, temp_title: text }
    });
    
    await this.showPreview(userId, chatId, updatedSession.data);
  }

  private async startEditDate(userId: number, chatId: number): Promise<void> {
    console.log('[EDIT_DATE] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const tz = session.data?.temp_timezone || 'Europe/Moscow';
    
    this.saveSession(userId, chatId, { state: 'editing_date' });
    
    const currentDate = session.data?.temp_date 
      ? this.formatDateForUser(this.parseISODate(session.data.temp_date, tz), tz)
      : 'не указана';
    const today = this.getTodayString(tz);
    await this.api.sendMessageWithKeyboard(
      chatId,
      `📅 Введите новую дату:
_Текущая: ${currentDate}_
_Формат: ДД/ММ/ГГГГ (например: ${today})_`,
      [[callbackButton('◀️ Назад', 'edit_reminder')]],
      'markdown'
    );
  }

  private async handleEditDate(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    const tz = session.data?.temp_timezone || 'Europe/Moscow';
    const result = parseDateWithFeedback(text, tz);
    
    if (!result.date) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        result.error || '❌ Не удалось распознать дату.',
        [[callbackButton('◀️ Назад', 'edit_reminder')]],
        'markdown'
      );
      return;
    }

    // Проверяем, что дата не в прошлом
    if (isDateInPast(result.date, tz)) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        `❌ Дата уже прошла. Введите будущую дату:`,
        [[callbackButton('◀️ Назад', 'edit_reminder')]],
        'markdown'
      );
      return;
    }
    
    const updatedSession = this.saveSession(userId, chatId, {
      state: 'preview',
      data: { ...session.data, temp_date: toISODateString(result.date) }
    });
    
    await this.showPreview(userId, chatId, updatedSession.data);
  }

  private async startEditTime(userId: number, chatId: number): Promise<void> {
    console.log('[EDIT_TIME] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    
    this.saveSession(userId, chatId, { state: 'editing_time' });
    
    const currentTime = session.data?.temp_time || 'не указано';
    await this.api.sendMessageWithKeyboard(
      chatId,
      `🕐 Введите новое время:
_Текущее: ${currentTime}_
_Формат: ЧЧ-ММ (например: 14-30)_`,
      [[callbackButton('◀️ Назад', 'edit_reminder')]],
      'markdown'
    );
  }

  private async handleEditTime(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    const time = parseTime(text);
    if (!time) {
      await this.api.sendText(chatId, '❌ Не удалось распознать время. Формат: ЧЧ-ММ (например: 14-30)');
      return;
    }
    
    // Проверяем, что время не в прошлом
    const tz = session.data?.temp_timezone || 'Europe/Moscow';
    const dateStr = session.data?.temp_date;
    if (dateStr) {
      const [year, month, day] = dateStr.split('-').map(Number);
      const eventDate = new Date(year, month - 1, day);
      const timeStr = formatTime(time.hours, time.minutes);
      
      if (isDateTimeInPast(eventDate, timeStr, tz)) {
        await this.api.sendText(chatId, '❌ Это время уже прошло. Введите будущее время:');
        return;
      }
    }
    
    const updatedSession = this.saveSession(userId, chatId, {
      state: 'preview',
      data: { ...session.data, temp_time: formatTime(time.hours, time.minutes) }
    });
    
    await this.showPreview(userId, chatId, updatedSession.data);
  }

  private async startEditDescription(userId: number, chatId: number): Promise<void> {
    console.log('[EDIT_DESC] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    
    this.saveSession(userId, chatId, { state: 'editing_description' });
    
    await this.api.sendMessageWithKeyboard(
      chatId,
      `📝 Введите новое описание:
_Текущее: ${session.data?.temp_description || 'нет'}_
Или "нет" чтобы убрать описание:`,
      [[callbackButton('◀️ Назад', 'edit_reminder')]],
      'markdown'
    );
  }

  private async handleEditDescription(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    let description: string | undefined = text;
    if (text.toLowerCase() === 'нет' || text.toLowerCase() === 'без описания') {
      description = undefined;
    }
    
    const updatedSession = this.saveSession(userId, chatId, {
      state: 'preview',
      data: { ...session.data, temp_description: description }
    });
    
    await this.showPreview(userId, chatId, updatedSession.data);
  }

  private async handleEditMonthDay(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log('[EDIT_MONTH_DAY] userId:', userId, 'chatId:', chatId, 'text:', text);
    
    const day = parseInt(text.trim(), 10);
    if (isNaN(day) || day < 1 || day > 28) {
      await this.api.sendText(chatId, '❌ Введите число от 1 до 28:');
      return;
    }

    const updatedSession = this.saveSession(userId, chatId, {
      state: 'preview',
      data: { ...session.data, temp_month_day: day }
    });

    await this.showPreview(userId, chatId, updatedSession.data);
  }

  // ==================== SAVE REMINDER ====================

  private async saveReminder(userId: number, chatId: number): Promise<void> {
    console.log('[SAVE] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const data = session.data;

    console.log('[SAVE] data:', JSON.stringify(data));

    if (!data?.temp_title || !data?.temp_date || !data?.temp_time) {
      console.log('[SAVE] Missing data');
      await this.api.sendText(chatId, '❌ Ошибка: недостаточно данных.');
      return;
    }

    try {
      const reminder = createReminder({
        user_id: userId,
        chat_id: chatId,
        title: data.temp_title,
        description: data.temp_description,
        event_date: data.temp_date,
        event_time: data.temp_time,
        timezone: data.temp_timezone || 'Europe/Moscow',
        reminder_periods: [data.temp_period || 86400000],
        repeat_type: data.temp_repeat_type || 'none',
        repeat_days: data.temp_repeat_days,
        repeat_month_day: data.temp_month_day,
        multi_notify_count: data.temp_multi_count || 1,
        multi_notify_interval: data.temp_multi_interval || 5,
        is_active: true
      });

      console.log('[SAVE] Created:', reminder.id);
      
      this.clearSession(userId, chatId);

      const tz = data.temp_timezone || 'Europe/Moscow';
      const eventDate = this.parseISODate(reminder.event_date, tz);
      const period = reminder.reminder_periods[0];
      const notificationTime = this.calculateNotificationTimeDisplay(reminder.event_date, reminder.event_time, period, tz);
      const periodLabel = formatPeriod(period);
      const repeatLabel = this.getRepeatLabel(reminder.repeat_type, reminder.repeat_days, reminder.repeat_month_day);

      const text = `✅ *Напоминание создано!*

📌 *${reminder.title}*
📅 Дата: ${this.formatDateForUser(eventDate, tz)} в ${reminder.event_time}
📝 Описание: ${reminder.description || 'нет'}
🔔 Напомнить: ${periodLabel}
⏱ Время уведомления: ${notificationTime}
🔄 Повтор: ${repeatLabel}`;

      await this.api.sendMessageWithKeyboard(
        chatId,
        text,
        [
          [callbackButton('📋 Мои напоминания', 'list_reminders')],
          [callbackButton('➕ Добавить ещё', 'add_reminder')]
        ],
        'markdown'
      );
    } catch (error) {
      console.error('[SAVE] Error:', error);
      await this.api.sendText(chatId, '❌ Ошибка при сохранении.');
    }
  }

  // ==================== LIST REMINDERS ====================

  private async showRemindersList(userId: number, chatId: number): Promise<void> {
    console.log('[LIST] userId:', userId, 'chatId:', chatId);
    const reminders = getRemindersByUser(userId, chatId);
    console.log('[LIST] Found:', reminders.length);

    if (reminders.length === 0) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '📭 *У вас пока нет напоминаний.*\n\nХотите создать первое?',
        [
          [callbackButton('➕ Создать', 'add_reminder')],
          [callbackButton('🏠 Меню', 'main_menu')]
        ],
        'markdown'
      );
      return;
    }

    const settings = getUserSettings(userId, chatId);
    const tz = settings?.timezone || 'Europe/Moscow';

    let text = '📋 *Ваши напоминания:*\n\n';
    reminders.slice(0, 10).forEach((r, i) => {
      const d = this.parseISODate(r.event_date, tz);
      text += `${i + 1}. ${r.title}\n   📅 ${this.formatDateForUser(d, tz)} в ${r.event_time}\n\n`;
    });

    const buttons: InlineKeyboardButton[][] = reminders.slice(0, 5).map(r => [
      callbackButton(`📌 ${r.title}`, `view_reminder:${r.id}`)
    ]);
    buttons.push([
      callbackButton('➕ Добавить', 'add_reminder'),
      callbackButton('🏠 Меню', 'main_menu')
    ]);

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async showArchivedList(userId: number, chatId: number): Promise<void> {
    console.log('[ARCHIVE_LIST] userId:', userId, 'chatId:', chatId);
    const reminders = getArchivedRemindersByUser(userId, chatId);

    if (reminders.length === 0) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '📦 Архив пуст.',
        [
          [callbackButton('📋 Активные', 'list_reminders')],
          [callbackButton('🏠 Меню', 'main_menu')]
        ]
      );
      return;
    }

    let text = '📦 *Архив:*\n\n';
    reminders.slice(0, 10).forEach((r, i) => {
      text += `${i + 1}. ${r.title}\n`;
    });

    const buttons: InlineKeyboardButton[][] = reminders.slice(0, 5).map(r => [
      callbackButton(`📌 ${r.title}`, `view_reminder:${r.id}`)
    ]);
    buttons.push([callbackButton('📋 Активные', 'list_reminders')]);

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  // ==================== REMINDER DETAILS ====================

  private async showReminderDetails(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[DETAILS] id:', id);
    const r = getReminderById(id);
    if (!r) {
      await this.api.sendText(chatId, '❌ Напоминание не найдено.');
      return;
    }

    const settings = getUserSettings(userId, chatId);
    const tz = settings?.timezone || 'Europe/Moscow';
    const d = this.parseISODate(r.event_date, tz);
    const periodLabel = r.reminder_periods.map(p => formatPeriod(p)).join(', ');
    const repeatLabel = this.getRepeatLabel(r.repeat_type, r.repeat_days, r.repeat_month_day);

    // Calculate notification time
    const period = r.reminder_periods?.[0] || 86400000;
    const notificationTime = this.calculateNotificationTimeDisplay(r.event_date, r.event_time || '09-00', period, tz);
    
    // Status text
    let statusText = r.is_active ? '✅ Активно' : '📁 В архиве';
    
    // Created date
    const createdDate = r.created_at ? new Date(r.created_at) : null;
    const createdStr = createdDate 
      ? `${createdDate.getDate()} ${['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][createdDate.getMonth()]} ${createdDate.getFullYear()}`
      : 'неизвестно';

    const text = `📌 *${r.title}*

📅 *Дата:* ${this.formatDateForUser(d, tz)} в ${r.event_time}
📝 *Описание:* ${r.description || 'нет'}
🔔 *Напомнить:* ${periodLabel}
⏱ *Время уведомления:* ${notificationTime}
🔄 *Повтор:* ${repeatLabel}
📊 *Статус:* ${statusText}
📆 *Создано:* ${createdStr}`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('✏️ Редактировать', `edit_existing_reminder:${id}`)],
      [
        r.is_active
          ? callbackButton('📦 В архив', `archive_reminder:${id}`)
          : callbackButton('↩️ Восстановить', `restore_reminder:${id}`)
      ],
      [callbackButton('🔔 Тест уведомления', `test_notification:${id}`)],
      [callbackButton('🗑 Удалить', `delete_reminder:${id}`)],
      [callbackButton('◀️ Назад', 'list_reminders')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  // ==================== ARCHIVE / RESTORE / DELETE ====================

  private async confirmArchive(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[CONFIRM_ARCHIVE] id:', id);
    const r = getReminderById(id);
    if (!r) return;

    await this.api.sendMessageWithKeyboard(
      chatId,
      `📦 Переместить "*${r.title}*" в архив?`,
      [
        [callbackButton('✅ Да, в архив', `confirm_archive:${id}`)],
        [callbackButton('❌ Нет', `view_reminder:${id}`)]
      ],
      'markdown'
    );
  }

  private async doArchive(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[DO_ARCHIVE] id:', id);
    if (archiveReminder(id)) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '✅ *Напоминание перемещено в архив.*',
        [
          [callbackButton('📋 Активные', 'list_reminders')],
          [callbackButton('📦 Архив', 'archived_reminders')]
        ],
        'markdown'
      );
    } else {
      await this.api.sendText(chatId, '❌ Ошибка при архивации.');
    }
  }

  private async confirmRestore(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[CONFIRM_RESTORE] id:', id);
    const r = getReminderById(id);
    if (!r) return;

    await this.api.sendMessageWithKeyboard(
      chatId,
      `↩️ Восстановить "*${r.title}*" из архива?`,
      [
        [callbackButton('✅ Да, восстановить', `confirm_restore:${id}`)],
        [callbackButton('❌ Нет', `view_reminder:${id}`)]
      ],
      'markdown'
    );
  }

  private async doRestore(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[DO_RESTORE] id:', id);
    if (restoreReminder(id)) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '✅ *Напоминание восстановлено из архива.*',
        [
          [callbackButton('📋 Активные', 'list_reminders')],
          [callbackButton('📦 Архив', 'archived_reminders')]
        ],
        'markdown'
      );
    } else {
      await this.api.sendText(chatId, '❌ Ошибка при восстановлении.');
    }
  }

  private async confirmDelete(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[CONFIRM_DELETE] id:', id);
    const r = getReminderById(id);
    if (!r) return;

    await this.api.sendMessageWithKeyboard(
      chatId,
      `⚠️ Удалить "*${r.title}*" навсегда?

❌ Это действие нельзя отменить!`,
      [
        [callbackButton('🗑 Да, удалить', `confirm_delete:${id}`)],
        [callbackButton('❌ Нет', `cancel_delete:${id}`)]
      ],
      'markdown'
    );
  }

  private async doDelete(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[DO_DELETE] id:', id);
    if (deleteReminderPermanently(id)) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '🗑 *Напоминание удалено навсегда.*',
        [
          [callbackButton('📋 Мои напоминания', 'list_reminders')],
          [callbackButton('🏠 Меню', 'main_menu')]
        ],
        'markdown'
      );
    } else {
      await this.api.sendText(chatId, '❌ Ошибка при удалении.');
    }
  }

  // ==================== EDIT EXISTING REMINDER - РАСШИРЕННОЕ МЕНЮ ====================

  private async showEditExistingMenu(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[EDIT_EXISTING_MENU] id:', id);
    const r = getReminderById(id);
    if (!r) {
      await this.api.sendText(chatId, '❌ Напоминание не найдено.');
      return;
    }

    const text = `✏️ *Что хотите изменить?*

📌 *${r.title}*`;

    // РАСШИРЕННОЕ МЕНЮ с Периодом и Повтором
    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('📝 Название', `edit_existing_title:${id}`)],
      [callbackButton('📅 Дату', `edit_existing_date:${id}`)],
      [callbackButton('🕐 Время', `edit_existing_time:${id}`)],
      [callbackButton('📝 Описание', `edit_existing_description:${id}`)],
      [callbackButton('🔔 Период', `edit_existing_period:${id}`)],
      [callbackButton('🔄 Повтор', `edit_existing_repeat:${id}`)],
      [callbackButton('✅ Готово', `view_reminder:${id}`)],
      [callbackButton('❌ Отмена', `view_reminder:${id}`)]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async startEditExistingTitle(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[EDIT_EXISTING_TITLE] id:', id);
    const r = getReminderById(id);
    if (!r) return;

    this.saveSession(userId, chatId, {
      state: 'editing_title',
      data: { 
        editing_reminder_id: id,
        temp_title: r.title,
        temp_description: r.description,
        temp_date: r.event_date,
        temp_time: r.event_time,
        temp_timezone: r.timezone,
        temp_period: r.reminder_periods?.[0],
        temp_repeat_type: r.repeat_type,
        temp_repeat_days: r.repeat_days,
        temp_month_day: r.repeat_month_day
      }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `📝 Введите новое название:
_Текущее: ${r.title}_`,
      [[callbackButton('◀️ Назад', `edit_existing_reminder:${id}`)]],
      'markdown'
    );
  }

  private async startEditExistingDate(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[EDIT_EXISTING_DATE] id:', id);
    const r = getReminderById(id);
    if (!r) return;

    this.saveSession(userId, chatId, {
      state: 'editing_date',
      data: { 
        editing_reminder_id: id,
        temp_title: r.title,
        temp_description: r.description,
        temp_date: r.event_date,
        temp_time: r.event_time,
        temp_timezone: r.timezone,
        temp_period: r.reminder_periods?.[0],
        temp_repeat_type: r.repeat_type,
        temp_repeat_days: r.repeat_days,
        temp_month_day: r.repeat_month_day
      }
    });

    const today = this.getTodayString(r.timezone);
    const currentDate = r.event_date ? this.formatDateForUser(this.parseISODate(r.event_date, r.timezone), r.timezone) : 'не указана';
    await this.api.sendMessageWithKeyboard(
      chatId,
      `📅 Введите новую дату:
_Текущая: ${currentDate}_
_Формат: ДД/ММ/ГГГГ (например: ${today})_`,
      [[callbackButton('◀️ Назад', `edit_existing_reminder:${id}`)]],
      'markdown'
    );
  }

  private async startEditExistingTime(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[EDIT_EXISTING_TIME] id:', id);
    const r = getReminderById(id);
    if (!r) return;

    this.saveSession(userId, chatId, {
      state: 'editing_time',
      data: { 
        editing_reminder_id: id,
        temp_title: r.title,
        temp_description: r.description,
        temp_date: r.event_date,
        temp_time: r.event_time,
        temp_timezone: r.timezone,
        temp_period: r.reminder_periods?.[0],
        temp_repeat_type: r.repeat_type,
        temp_repeat_days: r.repeat_days,
        temp_month_day: r.repeat_month_day
      }
    });

    const currentTime = r.event_time || 'не указано';
    await this.api.sendMessageWithKeyboard(
      chatId,
      `🕐 Введите новое время:
_Текущее: ${currentTime}_
_Формат: ЧЧ-ММ (например: 14-30)_`,
      [[callbackButton('◀️ Назад', `edit_existing_reminder:${id}`)]],
      'markdown'
    );
  }

  private async startEditExistingDescription(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[EDIT_EXISTING_DESC] id:', id);
    const r = getReminderById(id);
    if (!r) return;

    this.saveSession(userId, chatId, {
      state: 'editing_description',
      data: { 
        editing_reminder_id: id,
        temp_title: r.title,
        temp_description: r.description,
        temp_date: r.event_date,
        temp_time: r.event_time,
        temp_timezone: r.timezone,
        temp_period: r.reminder_periods?.[0],
        temp_repeat_type: r.repeat_type,
        temp_repeat_days: r.repeat_days,
        temp_month_day: r.repeat_month_day
      }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `📝 Введите новое описание:
_Текущее: ${r.description || 'нет'}_
Или "нет" чтобы убрать описание:`,
      [[callbackButton('◀️ Назад', `edit_existing_reminder:${id}`)]],
      'markdown'
    );
  }

  // НОВЫЕ МЕТОДЫ для редактирования периода и повтора существующего напоминания
  private async startEditExistingPeriod(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[EDIT_EXISTING_PERIOD] id:', id);
    const r = getReminderById(id);
    if (!r) return;

    this.saveSession(userId, chatId, {
      state: 'waiting_for_period',
      data: { 
        editing_reminder_id: id,
        temp_title: r.title,
        temp_description: r.description,
        temp_date: r.event_date,
        temp_time: r.event_time,
        temp_timezone: r.timezone,
        temp_period: r.reminder_periods?.[0],
        temp_repeat_type: r.repeat_type,
        temp_repeat_days: r.repeat_days,
        temp_month_day: r.repeat_month_day
      }
    });

    await this.showPeriodMenu(userId, chatId);
  }

  private async startEditExistingRepeat(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[EDIT_EXISTING_REPEAT] id:', id);
    const r = getReminderById(id);
    if (!r) return;

    this.saveSession(userId, chatId, {
      state: 'waiting_for_repeat',
      data: { 
        editing_reminder_id: id,
        temp_title: r.title,
        temp_description: r.description,
        temp_date: r.event_date,
        temp_time: r.event_time,
        temp_timezone: r.timezone,
        temp_period: r.reminder_periods?.[0],
        temp_repeat_type: r.repeat_type,
        temp_repeat_days: r.repeat_days,
        temp_month_day: r.repeat_month_day
      }
    });

    await this.showRepeatMenu(userId, chatId);
  }

  // ==================== SETTINGS ====================

  private async showSettings(userId: number, chatId: number): Promise<void> {
    console.log('[SETTINGS] userId:', userId, 'chatId:', chatId);
    const settings = getUserSettings(userId, chatId);
    const tz = settings?.timezone || 'Europe/Moscow';
    const tzInfo = SUPPORTED_TIMEZONES.find(t => t.value === tz);

    const now = getCurrentDateTimeInTimezone(tz);
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const text = `⚙️ *Настройки*

🌍 *Часовой пояс:* ${tzInfo?.label || tz}
🕐 *Текущее время:* ${time}`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('🌍 Изменить часовой пояс', 'change_timezone')],
      [callbackButton('🏠 Меню', 'main_menu')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async showTimezoneMenu(chatId: number): Promise<void> {
    console.log('[TIMEZONE_MENU] chatId:', chatId);
    
    const text = `🌍 *Выберите часовой пояс:*`;

    const buttons: InlineKeyboardButton[][] = SUPPORTED_TIMEZONES.map((tz) => [
      callbackButton(tz.label, `set_timezone:${tz.value}`)
    ]);
    buttons.push([callbackButton('◀️ Назад', 'settings')]);

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async doSetTimezone(userId: number, chatId: number, timezone: string): Promise<void> {
    console.log('[SET_TIMEZONE] userId:', userId, 'chatId:', chatId, 'tz:', timezone);
    
    upsertUserSettings(userId, chatId, { timezone });

    const tzInfo = SUPPORTED_TIMEZONES.find(t => t.value === timezone);
    const now = getCurrentDateTimeInTimezone(timezone);
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ *Часовой пояс изменен*

🌍 ${tzInfo?.label || timezone}
🕐 Текущее время: ${time}`,
      [[callbackButton('⚙️ Настройки', 'settings')]],
      'markdown'
    );
  }

  // ==================== TEST NOTIFICATION ====================

  private async sendTestNotification(userId: number, chatId: number, id: string): Promise<void> {
    console.log('[TEST_NOTIF] id:', id);
    const r = getReminderById(id);
    if (!r) {
      await this.api.sendText(chatId, '❌ Напоминание не найдено.');
      return;
    }

    const tz = r.timezone || 'Europe/Moscow';
    const period = r.reminder_periods?.[0] || 86400000;
    const periodLabel = formatPeriod(period);
    
    // Рассчитываем реальное время уведомления
    const notificationTime = this.calculateNotificationTimeDisplay(r.event_date, r.event_time || '09-00', period, tz);

    // Отправляем тестовое уведомление
    const text = `
🔔 *ТЕСТОВОЕ УВЕДОМЛЕНИЕ*

📌 *${r.title}*
📅 ${r.event_date} в ${r.event_time}
 ${r.description ? `\n📝 ${r.description}` : ''}

⏰ Напоминаю *${periodLabel}*
📬 Реальное уведомление придёт: ${notificationTime}
`;

    await this.api.sendText(chatId, text, 'markdown');
  }

  // ==================== SAVE EDITED REMINDER ====================

  private async saveEditedReminder(userId: number, chatId: number): Promise<void> {
    console.log('[SAVE_EDIT] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const data = session.data;

    if (!data?.editing_reminder_id) {
      await this.api.sendText(chatId, '❌ Ошибка: ID напоминания потерян.');
      return;
    }

    if (!data?.temp_title || !data?.temp_date || !data?.temp_time) {
      await this.api.sendText(chatId, '❌ Ошибка: недостаточно данных.');
      return;
    }

    try {
      updateReminder(data.editing_reminder_id, {
        title: data.temp_title,
        description: data.temp_description,
        event_date: data.temp_date,
        event_time: data.temp_time,
        timezone: data.temp_timezone || 'Europe/Moscow',
        reminder_periods: [data.temp_period || 86400000],
        repeat_type: data.temp_repeat_type || 'none',
        repeat_days: data.temp_repeat_days,
        repeat_month_day: data.temp_month_day
      });

      this.clearSession(userId, chatId);

      const tz = data.temp_timezone || 'Europe/Moscow';
      const period = data.temp_period || 86400000;
      const notificationTime = this.calculateNotificationTimeDisplay(data.temp_date, data.temp_time, period, tz);

      await this.api.sendMessageWithKeyboard(
        chatId,
        `✅ *Напоминание обновлено!*

📌 ${data.temp_title}
📅 ${data.temp_date} в ${data.temp_time}
🔔 Напоминание придёт: ${notificationTime}`,
        [
          [callbackButton('📋 Мои напоминания', 'list_reminders')],
          [callbackButton('🏠 Меню', 'main_menu')]
        ],
        'markdown'
      );
    } catch (error) {
      console.error('[SAVE_EDIT] Error:', error);
      await this.api.sendText(chatId, '❌ Ошибка при сохранении.');
    }
  }

  // ==================== HELP ====================

  private async showHelp(chatId: number): Promise<void> {
    const text = `📖 *Справка по PamPin*

*Как создать напоминание:*
1. Нажмите "➕ Добавить напоминание"
2. Введите название
3. Введите дату (ДД/ММ/ГГГГ)
4. Введите время (ЧЧ-ММ) — обязательно!
5. Добавьте описание или пропустите
6. Выберите за сколько напомнить
7. Настройте повторение

*Форматы даты:*
• 01/04/2026
• 01.04.2026
• 1 апреля 2026

*Форматы времени:*
• 14-30
• 14:30
• 09-00

*Повторение:*
• Ежедневно / Еженедельно / Ежемесячно / Ежегодно
• Выбранные дни недели
• Каждого N-го числа месяца`;

    await this.api.sendMessageWithKeyboard(
      chatId,
      text,
      [[callbackButton('🏠 Меню', 'main_menu')]],
      'markdown'
    );
  }

  // ==================== UTILITY METHODS ====================

  private parseISODate(dateStr: string, timezone: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private formatDateForUser(date: Date, timezone: string): string {
    return formatDate(date, 'long');
  }

  private getTodayString(timezone: string): string {
    const today = getCurrentDateTimeInTimezone(timezone);
    const day = today.getDate().toString().padStart(2, '0');
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const year = today.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
