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
import { Reminder, UserSession } from '../types';

// Предопределённые периоды напоминаний
const PREDEFINED_PERIODS = [
  { value: 365 * 24 * 60 * 60 * 1000, label: 'за 1 год' },
  { value: 6 * 30 * 24 * 60 * 60 * 1000, label: 'за 6 месяцев' },
  { value: 3 * 30 * 24 * 60 * 60 * 1000, label: 'за 3 месяца' },
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
    const updateType = update.update_type;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[PROCESS] update_type: "${updateType}"`);
    
    // Log FULL update structure for debugging
    console.log(`[PROCESS] FULL UPDATE: ${JSON.stringify(update, null, 2)}`);

    if (updateType === 'message_created') {
      await this.handleMessage(update);
    } else if (updateType === 'message_callback') {
      await this.handleCallback(update);
    } else if (updateType === 'bot_started') {
      await this.handleBotStarted(update);
    } else {
      console.log(`[PROCESS] Unknown update_type: ${updateType}`);
    }
    console.log(`${'='.repeat(60)}\n`);
  }

  /**
   * Handle bot started
   */
  private async handleBotStarted(update: Update): Promise<void> {
    console.log('[BOT_STARTED] Handling bot_started');
    
    const anyUpdate = update as any;
    const userId = update.sender?.user_id || anyUpdate.user?.user_id || 0;
    const chatId = anyUpdate.chat_id || 0;
    
    console.log(`[BOT_STARTED] userId: ${userId}, chatId: ${chatId}`);

    const text = `👋 *Добро пожаловать в PamPin!*

📅 PamPin — твой календарь важных дат.

*Команды:*
/start — главное меню
/list — список напоминаний
/settings — настройки`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('➕ Добавить напоминание', 'add_reminder')],
      [callbackButton('📋 Мои напоминания', 'list_reminders')],
      [callbackButton('⚙️ Настройки', 'settings')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(update: Update): Promise<void> {
    const anyUpdate = update as any;
    const message = update.message;
    
    if (!message) {
      console.log('[MESSAGE] No message in update');
      return;
    }

    const userId = message.sender?.user_id || 0;
    const chatId = message.recipient?.chat_id || message.chat_id || 0;
    const text = message.body?.text || message.text || '';

    console.log(`[MESSAGE] userId: ${userId}, chatId: ${chatId}, text: "${text}"`);

    if (!text.trim()) {
      console.log('[MESSAGE] Empty text, skipping');
      return;
    }

    // Handle commands
    if (text.startsWith('/')) {
      console.log(`[MESSAGE] Detected command: ${text}`);
      await this.handleCommand(userId, chatId, text.trim());
      return;
    }

    // Handle state-based input
    const session = getUserSession(userId, chatId);
    console.log(`[MESSAGE] Session state: ${session.state}`);

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
      default:
        console.log('[MESSAGE] No active state, showing main menu');
        await this.showMainMenu(chatId);
    }
  }

  /**
   * Handle command
   */
  private async handleCommand(userId: number, chatId: number, text: string): Promise<void> {
    const cmd = text.toLowerCase().split(' ')[0];
    console.log(`[COMMAND] Processing command: "${cmd}" for userId: ${userId}, chatId: ${chatId}`);

    try {
      switch (cmd) {
        case '/start':
          console.log('[COMMAND] Executing /start');
          await this.sendWelcome(chatId);
          break;
        case '/list':
          console.log('[COMMAND] Executing /list');
          await this.showRemindersList(userId, chatId);
          break;
        case '/settings':
          console.log('[COMMAND] Executing /settings');
          await this.showSettings(userId, chatId);
          break;
        case '/help':
          console.log('[COMMAND] Executing /help');
          await this.showHelp(chatId);
          break;
        default:
          console.log(`[COMMAND] Unknown command: ${cmd}`);
          await this.api.sendText(chatId, 'Неизвестная команда. Введите /help');
      }
    } catch (error) {
      console.error(`[COMMAND] Error executing ${cmd}:`, error);
      await this.api.sendText(chatId, 'Произошла ошибка. Попробуйте ещё раз.');
    }
  }

  /**
   * Handle callback (button press)
   */
  private async handleCallback(update: Update): Promise<void> {
    console.log('[CALLBACK] ===== START CALLBACK HANDLING =====');
    
    const anyUpdate = update as any;
    
    // Log the complete update structure
    console.log('[CALLBACK] Complete update object:');
    console.log(JSON.stringify(anyUpdate, null, 2));
    
    // Try to find callback object at various paths
    let callbackObj: any = null;
    let callbackId: string = '';
    let payload: string = '';
    
    // Path 1: update.callback (expected MAX API structure)
    if (anyUpdate.callback) {
      callbackObj = anyUpdate.callback;
      console.log('[CALLBACK] Found callback at update.callback:', callbackObj);
    }
    
    // Path 2: update.message_callback
    if (!callbackObj && anyUpdate.message_callback) {
      callbackObj = anyUpdate.message_callback;
      console.log('[CALLBACK] Found callback at update.message_callback:', callbackObj);
    }
    
    // Extract callback_id
    if (callbackObj) {
      callbackId = callbackObj.id || callbackObj.callback_id || '';
      payload = callbackObj.payload || callbackObj.data || '';
      console.log(`[CALLBACK] From callbackObj: id="${callbackId}", payload="${payload}"`);
    }
    
    // Try additional paths for callback_id
    if (!callbackId) {
      callbackId = anyUpdate.callback_id || '';
      console.log(`[CALLBACK] Trying update.callback_id: "${callbackId}"`);
    }
    
    // Try additional paths for payload
    if (!payload) {
      payload = anyUpdate.payload || '';
      console.log(`[CALLBACK] Trying update.payload: "${payload}"`);
    }
    
    // Try to find payload in message markup buttons
    if (!payload && anyUpdate.message?.markup) {
      console.log('[CALLBACK] Searching in message.markup...');
      const markup = anyUpdate.message.markup;
      if (Array.isArray(markup)) {
        for (const row of markup) {
          if (Array.isArray(row)) {
            for (const btn of row) {
              if (btn && btn.payload) {
                console.log(`[CALLBACK] Found payload in button: "${btn.payload}"`);
                // This is just the button definition, not the clicked one
              }
            }
          }
        }
      }
    }
    
    // Extract user_id
    let userId = 0;
    if (update.sender?.user_id) {
      userId = update.sender.user_id;
      console.log(`[CALLBACK] userId from sender: ${userId}`);
    } else if (anyUpdate.user?.user_id) {
      userId = anyUpdate.user.user_id;
      console.log(`[CALLBACK] userId from user: ${userId}`);
    } else if (anyUpdate.message?.sender?.user_id) {
      userId = anyUpdate.message.sender.user_id;
      console.log(`[CALLBACK] userId from message.sender: ${userId}`);
    }
    
    // Extract chat_id
    let chatId = 0;
    if (anyUpdate.chat_id) {
      chatId = anyUpdate.chat_id;
      console.log(`[CALLBACK] chatId from top-level: ${chatId}`);
    } else if (anyUpdate.message?.recipient?.chat_id) {
      chatId = anyUpdate.message.recipient.chat_id;
      console.log(`[CALLBACK] chatId from message.recipient: ${chatId}`);
    } else if (anyUpdate.message?.chat_id) {
      chatId = anyUpdate.message.chat_id;
      console.log(`[CALLBACK] chatId from message: ${chatId}`);
    }
    
    console.log(`[CALLBACK] FINAL VALUES: userId=${userId}, chatId=${chatId}, payload="${payload}", callbackId="${callbackId}"`);

    // Answer callback to remove loading state
    if (callbackId) {
      try {
        console.log(`[CALLBACK] Answering callback ${callbackId}...`);
        await this.api.answerCallback(callbackId);
        console.log(`[CALLBACK] Answer callback OK`);
      } catch (e) {
        console.error('[CALLBACK] Failed to answer callback:', e);
      }
    } else {
      console.log('[CALLBACK] No callbackId found - cannot answer callback');
    }

    // If no payload found, try to find it anywhere in the object
    if (!payload) {
      console.log('[CALLBACK] No payload found, searching recursively...');
      payload = this.findPayloadRecursive(anyUpdate, '') || '';
      if (payload) {
        console.log(`[CALLBACK] Found payload recursively: "${payload}"`);
      }
    }

    if (!payload) {
      console.log('[CALLBACK] No payload found anywhere, aborting');
      if (chatId) {
        await this.api.sendText(chatId, 'Ошибка: не удалось определить действие');
      }
      return;
    }

    if (!chatId) {
      console.log('[CALLBACK] No chatId, aborting');
      return;
    }

    // Parse action and params
    const [action, ...params] = payload.split(':');
    console.log(`[CALLBACK] Executing action: "${action}", params: [${params.join(', ')}]`);

    try {
      await this.executeCallbackAction(userId, chatId, action, params);
    } catch (error) {
      console.error(`[CALLBACK] Error executing action ${action}:`, error);
      await this.api.sendText(chatId, 'Произошла ошибка. Попробуйте ещё раз.');
    }
    
    console.log('[CALLBACK] ===== END CALLBACK HANDLING =====');
  }

  /**
   * Execute callback action
   */
  private async executeCallbackAction(userId: number, chatId: number, action: string, params: string[]): Promise<void> {
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
        await this.showReminderDetails(chatId, params[0]);
        break;
      case 'archive_reminder':
        await this.confirmArchive(chatId, params[0]);
        break;
      case 'confirm_archive':
        await this.doArchive(userId, chatId, params[0]);
        break;
      case 'restore_reminder':
        await this.confirmRestore(chatId, params[0]);
        break;
      case 'confirm_restore':
        await this.doRestore(userId, chatId, params[0]);
        break;
      case 'delete_reminder':
        await this.confirmDelete(chatId, params[0]);
        break;
      case 'confirm_delete':
        await this.doDelete(userId, chatId, params[0]);
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
      case 'select_periods':
        await this.showPeriodsMenu(userId, chatId);
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
        await this.saveReminder(userId, chatId);
        break;
      case 'main_menu':
        await this.showMainMenu(chatId);
        break;
      case 'cancel':
        clearUserSession(userId, chatId);
        await this.showMainMenu(chatId);
        break;
      case 'skip_time':
        await this.skipTime(userId, chatId);
        break;
      case 'skip_description':
        await this.skipDescription(userId, chatId);
        break;
      case 'dismiss':
        break;
      default:
        console.log(`[CALLBACK] Unknown action: ${action}`);
        await this.showMainMenu(chatId);
    }
  }

  /**
   * Find payload recursively in object
   */
  private findPayloadRecursive(obj: any, path: string): string | null {
    if (!obj || typeof obj !== 'object') return null;
    
    // Check for payload field (but not in button definitions which have type: 'callback')
    if (typeof obj.payload === 'string' && obj.type !== 'callback') {
      console.log(`[FIND] Found payload at ${path}.payload: "${obj.payload}"`);
      return obj.payload;
    }
    
    // Check for query field
    if (typeof obj.query === 'string') {
      console.log(`[FIND] Found query at ${path}.query: "${obj.query}"`);
      return obj.query;
    }
    
    // Check for data field (but not in button definitions)
    if (typeof obj.data === 'string' && obj.type !== 'callback') {
      console.log(`[FIND] Found data at ${path}.data: "${obj.data}"`);
      return obj.data;
    }
    
    // Recurse into children
    for (const key of Object.keys(obj)) {
      const result = this.findPayloadRecursive(obj[key], path ? `${path}.${key}` : key);
      if (result) return result;
    }
    
    return null;
  }

  /**
   * Send welcome message
   */
  private async sendWelcome(chatId: number): Promise<void> {
    console.log(`[WELCOME] Sending welcome to chatId: ${chatId}`);
    
    const text = `👋 *Добро пожаловать в PamPin!*

📅 Я помогу вам не забыть о важных датах.

*Что я умею:*
• Добавлять напоминания
• Напоминать за нужный период
• Повторять ежегодно`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('➕ Добавить напоминание', 'add_reminder')],
      [callbackButton('📋 Мои напоминания', 'list_reminders')],
      [callbackButton('⚙️ Настройки', 'settings')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  /**
   * Show main menu
   */
  private async showMainMenu(chatId: number): Promise<void> {
    console.log(`[MENU] Showing main menu to chatId: ${chatId}`);
    
    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('➕ Добавить напоминание', 'add_reminder')],
      [callbackButton('📋 Мои напоминания', 'list_reminders')],
      [callbackButton('⚙️ Настройки', 'settings')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, '🏠 *Главное меню*', buttons, 'markdown');
  }

  /**
   * Start add reminder flow
   */
  private async startAddReminder(userId: number, chatId: number): Promise<void> {
    console.log(`[ADD_REMINDER] Starting for userId: ${userId}, chatId: ${chatId}`);
    
    const settings = getUserSettings(userId, chatId);
    const tz = settings?.timezone || 'Europe/Moscow';

    updateUserSession(userId, chatId, {
      state: 'waiting_for_title',
      data: {
        temp_timezone: tz,
        temp_periods: [86400000],
        temp_repeat: false
      }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      '📝 *Создание напоминания*\n\nВведите название:',
      [[callbackButton('❌ Отмена', 'cancel')]],
      'markdown'
    );
  }

  /**
   * Handle title input
   */
  private async handleTitleInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log(`[TITLE_INPUT] Title: "${text}"`);
    
    if (text.length < 2) {
      await this.api.sendText(chatId, 'Слишком короткое название. Попробуйте ещё:');
      return;
    }

    updateUserSession(userId, chatId, {
      state: 'waiting_for_date',
      data: { ...session.data, temp_title: text }
    });

    const today = getTodayFormatted(session.data?.temp_timezone || 'Europe/Moscow');
    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Название: *${text}*\n\n📅 Введите дату (DD/MM/YYYY):\n_Например: ${today}_`,
      [[callbackButton('❌ Отмена', 'cancel')]],
      'markdown'
    );
  }

  /**
   * Handle date input
   */
  private async handleDateInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log(`[DATE_INPUT] Date: "${text}"`);
    
    const tz = session.data?.temp_timezone || 'Europe/Moscow';
    const date = parseDate(text, tz);

    if (!date) {
      await this.api.sendText(chatId, 'Не удалось распознать дату. Формат: DD/MM/YYYY');
      return;
    }

    if (isDateInPast(date, tz)) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '⚠️ Эта дата уже прошла. Создать на следующий год?',
        [
          [callbackButton('✅ Да', `set_next_year:${date.toISOString()}`)],
          [callbackButton('❌ Нет', 'cancel')]
        ]
      );
      return;
    }

    updateUserSession(userId, chatId, {
      state: 'waiting_for_time',
      data: { ...session.data, temp_date: toISODateString(date) }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Дата: *${formatDate(date, 'long')}*\n\n🕐 Введите время (HH-MM):`,
      [
        [callbackButton('⏭ Пропустить', 'skip_time')],
        [callbackButton('❌ Отмена', 'cancel')]
      ],
      'markdown'
    );
  }

  /**
   * Handle time input
   */
  private async handleTimeInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log(`[TIME_INPUT] Time: "${text}"`);
    
    const time = parseTime(text);
    if (!time) {
      await this.api.sendText(chatId, 'Не удалось распознать время. Формат: HH-MM');
      return;
    }

    updateUserSession(userId, chatId, {
      state: 'waiting_for_description',
      data: { ...session.data, temp_time: formatTime(time.hours, time.minutes) }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Время: *${formatTime(time.hours, time.minutes)}*\n\n📝 Описание (или пропустите):`,
      [
        [callbackButton('⏭ Пропустить', 'skip_description')],
        [callbackButton('❌ Отмена', 'cancel')]
      ],
      'markdown'
    );
  }

  /**
   * Handle description input
   */
  private async handleDescriptionInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log(`[DESC_INPUT] Description: "${text}"`);
    
    updateUserSession(userId, chatId, {
      state: 'idle',
      data: { ...session.data, temp_description: text }
    });

    await this.showPreview(chatId, session.data);
  }

  /**
   * Skip time
   */
  private async skipTime(userId: number, chatId: number): Promise<void> {
    const session = getUserSession(userId, chatId);
    updateUserSession(userId, chatId, {
      state: 'waiting_for_description',
      data: { ...session.data, temp_time: undefined }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      '📝 Описание (или пропустите):',
      [[callbackButton('⏭ Пропустить', 'skip_description')]]
    );
  }

  /**
   * Skip description
   */
  private async skipDescription(userId: number, chatId: number): Promise<void> {
    const session = getUserSession(userId, chatId);
    updateUserSession(userId, chatId, {
      state: 'idle',
      data: { ...session.data, temp_description: undefined }
    });

    await this.showPreview(chatId, session.data);
  }

  /**
   * Show reminder preview
   */
  private async showPreview(chatId: number, data: UserSession['data']): Promise<void> {
    console.log(`[PREVIEW] Showing preview`);
    
    const date = data.temp_date ? new Date(data.temp_date) : new Date();
    const periods = data.temp_periods || [];
    const periodLabels = periods.map(p => formatPeriod(p)).join(', ');

    const text = `📋 *Проверка*

📌 *Название:* ${data.temp_title}
📅 *Дата:* ${formatDate(date, 'long')}${data.temp_time ? ` в ${data.temp_time}` : ''}
📝 *Описание:* ${data.temp_description || 'нет'}
🔔 *Напомнить:* ${periodLabels || 'за 1 день'}
🔄 *Повторять:* ${data.temp_repeat ? 'да' : 'нет'}`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('✅ Создать', 'confirm_reminder')],
      [
        callbackButton('🔔 Периоды', 'select_periods'),
        callbackButton('🔄 Повтор', 'toggle_repeat')
      ],
      [callbackButton('❌ Отмена', 'cancel')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  /**
   * Show periods menu
   */
  private async showPeriodsMenu(userId: number, chatId: number): Promise<void> {
    console.log(`[PERIODS] Showing periods menu`);
    
    const session = getUserSession(userId, chatId);
    const selected = session.data?.temp_periods || [];

    const buttons: InlineKeyboardButton[][] = PREDEFINED_PERIODS.map((p, i) => {
      const prefix = selected.includes(p.value) ? '✅ ' : '⬜ ';
      return [callbackButton(`${prefix}${p.label}`, `toggle_period:${i}`)];
    });
    buttons.push([callbackButton('✅ Готово', 'confirm_periods')]);

    await this.api.sendMessageWithKeyboard(chatId, '🔔 *Выберите периоды:*', buttons, 'markdown');
  }

  /**
   * Toggle period
   */
  private async togglePeriod(userId: number, chatId: number, idx: number): Promise<void> {
    console.log(`[TOGGLE_PERIOD] Index: ${idx}`);
    
    const session = getUserSession(userId, chatId);
    const periods = [...(session.data?.temp_periods || [])];
    const val = PREDEFINED_PERIODS[idx].value;

    const i = periods.indexOf(val);
    if (i >= 0) periods.splice(i, 1);
    else { periods.push(val); periods.sort((a, b) => b - a); }

    updateUserSession(userId, chatId, { data: { ...session.data, temp_periods: periods } });
    await this.showPeriodsMenu(userId, chatId);
  }

  /**
   * Confirm periods
   */
  private async confirmPeriods(userId: number, chatId: number): Promise<void> {
    const session = getUserSession(userId, chatId);
    if ((session.data?.temp_periods?.length || 0) === 0) {
      await this.api.sendText(chatId, 'Выберите хотя бы один период.');
      return;
    }
    await this.showPreview(chatId, session.data);
  }

  /**
   * Toggle repeat
   */
  private async toggleRepeat(userId: number, chatId: number): Promise<void> {
    console.log(`[TOGGLE_REPEAT]`);
    
    const session = getUserSession(userId, chatId);
    const newRepeat = !session.data?.temp_repeat;
    updateUserSession(userId, chatId, { data: { ...session.data, temp_repeat: newRepeat } });
    await this.showPreview(chatId, { ...session.data, temp_repeat: newRepeat });
  }

  /**
   * Save reminder
   */
  private async saveReminder(userId: number, chatId: number): Promise<void> {
    console.log(`[SAVE] Saving reminder`);
    
    const session = getUserSession(userId, chatId);
    const data = session.data;

    if (!data?.temp_title || !data?.temp_date) {
      await this.api.sendText(chatId, 'Ошибка: недостаточно данных.');
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
        reminder_periods: data.temp_periods || [86400000],
        repeat_yearly: data.temp_repeat || false,
        is_active: true
      });

      clearUserSession(userId, chatId);

      await this.api.sendMessageWithKeyboard(
        chatId,
        `✅ *Напоминание создано!*\n\n📌 ${reminder.title}\n📅 ${formatDate(new Date(reminder.event_date), 'long')}`,
        [
          [callbackButton('📋 Мои напоминания', 'list_reminders')],
          [callbackButton('➕ Добавить ещё', 'add_reminder')]
        ],
        'markdown'
      );
    } catch (error) {
      console.error('Save error:', error);
      await this.api.sendText(chatId, 'Ошибка при сохранении.');
    }
  }

  /**
   * Show reminders list
   */
  private async showRemindersList(userId: number, chatId: number): Promise<void> {
    console.log(`[LIST] Showing reminders for userId: ${userId}, chatId: ${chatId}`);
    
    const reminders = getRemindersByUser(userId, chatId);
    console.log(`[LIST] Found ${reminders.length} reminders`);

    if (reminders.length === 0) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '📭 У вас нет напоминаний.\n\nСоздать первое?',
        [
          [callbackButton('➕ Добавить', 'add_reminder')],
          [callbackButton('📦 Архив', 'archived_reminders')]
        ]
      );
      return;
    }

    let text = '📋 *Ваши напоминания:*\n\n';
    reminders.slice(0, 10).forEach((r, i) => {
      const d = new Date(r.event_date);
      text += `${i + 1}. ${r.title}\n   📅 ${formatDate(d, 'short')}\n\n`;
    });

    const buttons: InlineKeyboardButton[][] = reminders.slice(0, 5).map(r => [
      callbackButton(`📌 ${r.title}`, `view_reminder:${r.id}`)
    ]);
    buttons.push([
      callbackButton('➕ Добавить', 'add_reminder'),
      callbackButton('📦 Архив', 'archived_reminders')
    ]);

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  /**
   * Show archived list
   */
  private async showArchivedList(userId: number, chatId: number): Promise<void> {
    console.log(`[ARCHIVE] Showing archived reminders`);
    
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

  /**
   * Show reminder details
   */
  private async showReminderDetails(chatId: number, id: string): Promise<void> {
    console.log(`[DETAILS] Showing reminder: ${id}`);
    
    const r = getReminderById(id);
    if (!r) {
      await this.api.sendText(chatId, 'Напоминание не найдено.');
      return;
    }

    const d = new Date(r.event_date);
    const periods = r.reminder_periods.map(p => formatPeriod(p)).join(', ');

    const text = `📌 *${r.title}*

📅 *Дата:* ${formatDate(d, 'long')}${r.event_time ? ` в ${r.event_time}` : ''}
📝 *Описание:* ${r.description || 'нет'}
🔔 *Напомнить:* ${periods}
🔄 *Повторять:* ${r.repeat_yearly ? 'да' : 'нет'}`;

    const buttons: InlineKeyboardButton[][] = [
      [
        r.is_active
          ? callbackButton('📦 В архив', `archive_reminder:${id}`)
          : callbackButton('↩️ Восстановить', `restore_reminder:${id}`)
      ],
      [callbackButton('🗑 Удалить', `delete_reminder:${id}`)],
      [callbackButton('◀️ Назад', 'list_reminders')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  /**
   * Confirm archive
   */
  private async confirmArchive(chatId: number, id: string): Promise<void> {
    const r = getReminderById(id);
    if (!r) return;

    await this.api.sendMessageWithKeyboard(
      chatId,
      `📦 Переместить "${r.title}" в архив?`,
      [
        [callbackButton('✅ Да', `confirm_archive:${id}`)],
        [callbackButton('❌ Нет', `view_reminder:${id}`)]
      ]
    );
  }

  /**
   * Do archive
   */
  private async doArchive(userId: number, chatId: number, id: string): Promise<void> {
    if (archiveReminder(id)) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '📦 Перемещено в архив.',
        [
          [callbackButton('📋 Активные', 'list_reminders')],
          [callbackButton('📦 Архив', 'archived_reminders')]
        ]
      );
    }
  }

  /**
   * Confirm restore
   */
  private async confirmRestore(chatId: number, id: string): Promise<void> {
    const r = getReminderById(id);
    if (!r) return;

    await this.api.sendMessageWithKeyboard(
      chatId,
      `↩️ Восстановить "${r.title}"?`,
      [
        [callbackButton('✅ Да', `confirm_restore:${id}`)],
        [callbackButton('❌ Нет', `view_reminder:${id}`)]
      ]
    );
  }

  /**
   * Do restore
   */
  private async doRestore(userId: number, chatId: number, id: string): Promise<void> {
    if (restoreReminder(id)) {
      await this.api.sendText(chatId, '✅ Восстановлено из архива.');
      await this.showRemindersList(userId, chatId);
    }
  }

  /**
   * Confirm delete
   */
  private async confirmDelete(chatId: number, id: string): Promise<void> {
    const r = getReminderById(id);
    if (!r) return;

    await this.api.sendMessageWithKeyboard(
      chatId,
      `⚠️ Удалить "${r.title}" навсегда?`,
      [
        [callbackButton('🗑 Да', `confirm_delete:${id}`)],
        [callbackButton('❌ Нет', `view_reminder:${id}`)]
      ]
    );
  }

  /**
   * Do delete
   */
  private async doDelete(userId: number, chatId: number, id: string): Promise<void> {
    if (deleteReminderPermanently(id)) {
      await this.api.sendText(chatId, '🗑 Удалено навсегда.');
      await this.showRemindersList(userId, chatId);
    }
  }

  /**
   * Show settings
   */
  private async showSettings(userId: number, chatId: number): Promise<void> {
    console.log(`[SETTINGS] Showing settings`);
    
    const settings = getUserSettings(userId, chatId);
    const tz = settings?.timezone || 'Europe/Moscow';
    const tzInfo = SUPPORTED_TIMEZONES.find(t => t.value === tz);

    const now = getCurrentDateTimeInTimezone(tz);
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const text = `⚙️ *Настройки*

🌐 *Часовой пояс:* ${tzInfo?.label || tz}
🕐 *Время:* ${time}`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('🌐 Изменить пояс', 'change_timezone')],
      [callbackButton('🏠 Меню', 'main_menu')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  /**
   * Show timezone menu
   */
  private async showTimezoneMenu(chatId: number): Promise<void> {
    const buttons: InlineKeyboardButton[][] = SUPPORTED_TIMEZONES.map(tz => [
      callbackButton(tz.label, `set_timezone:${tz.value}`)
    ]);
    buttons.push([callbackButton('◀️ Назад', 'settings')]);

    await this.api.sendMessageWithKeyboard(chatId, '🌐 *Выберите пояс:*', buttons, 'markdown');
  }

  /**
   * Set timezone
   */
  private async doSetTimezone(userId: number, chatId: number, tz: string): Promise<void> {
    upsertUserSettings({ user_id: userId, chat_id: chatId, timezone: tz });
    await this.showSettings(userId, chatId);
  }

  /**
   * Show help
   */
  private async showHelp(chatId: number): Promise<void> {
    const text = `📚 *Справка*

*Команды:*
/start — главное меню
/list — напоминания
/settings — настройки

*Форматы:*
• Дата: DD/MM/YYYY
• Время: HH-MM`;

    await this.api.sendMessageWithKeyboard(
      chatId,
      text,
      [[callbackButton('🏠 Меню', 'main_menu')]],
      'markdown'
    );
  }

  /**
   * Send reminder notification (for scheduler)
   */
  async sendReminderNotification(reminder: Reminder, periodMs: number): Promise<void> {
    const d = new Date(reminder.event_date);
    const label = formatPeriod(periodMs);

    const text = `🔔 *Напоминание!*

📌 ${reminder.title}
📅 ${formatDate(d, 'long')}${reminder.event_time ? ` в ${reminder.event_time}` : ''}

⏰ Напоминаю ${label}`;

    await this.api.sendMessageWithKeyboard(
      reminder.chat_id,
      text,
      [[callbackButton('✅ Понял', 'dismiss')]],
      'markdown'
    );
  }
}
