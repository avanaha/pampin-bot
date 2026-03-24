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
    // ЛОГИРОВАНИЕ С САМОГО НАЧАЛА
    console.log('');
    console.log('============================================================');
    console.log('[PROCESS] NEW UPDATE RECEIVED');
    console.log('[PROCESS] update_type:', update?.update_type);
    console.log('[PROCESS] FULL UPDATE JSON:');
    console.log(JSON.stringify(update, null, 2));
    console.log('============================================================');

    try {
      const updateType = update?.update_type;
      
      if (!updateType) {
        console.log('[PROCESS] ERROR: No update_type found!');
        return;
      }

      if (updateType === 'message_created') {
        console.log('[PROCESS] -> Calling handleMessage');
        await this.handleMessage(update);
      } else if (updateType === 'message_callback') {
        console.log('[PROCESS] -> Calling handleCallback');
        await this.handleCallback(update);
      } else if (updateType === 'bot_started') {
        console.log('[PROCESS] -> Calling handleBotStarted');
        await this.handleBotStarted(update);
      } else {
        console.log('[PROCESS] Unknown update_type:', updateType);
      }
    } catch (error) {
      console.error('[PROCESS] ERROR processing update:', error);
    }
    
    console.log('============================================================');
    console.log('');
  }

  /**
   * Handle bot started
   */
  private async handleBotStarted(update: Update): Promise<void> {
    console.log('[BOT_STARTED] === START ===');
    
    const anyUpdate = update as any;
    const userId = update.sender?.user_id || anyUpdate.user?.user_id || 0;
    const chatId = anyUpdate.chat_id || 0;
    
    console.log('[BOT_STARTED] userId:', userId);
    console.log('[BOT_STARTED] chatId:', chatId);

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

    try {
      await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
      console.log('[BOT_STARTED] Message sent OK');
    } catch (e) {
      console.error('[BOT_STARTED] Error:', e);
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(update: Update): Promise<void> {
    console.log('[MESSAGE] === START ===');
    
    const anyUpdate = update as any;
    const message = update.message;
    
    if (!message) {
      console.log('[MESSAGE] ERROR: No message in update!');
      return;
    }

    // Логируем структуру message
    console.log('[MESSAGE] message structure:');
    console.log(JSON.stringify(message, null, 2));

    // Извлекаем userId - пробуем разные пути
    let userId = 0;
    if (message.sender?.user_id) {
      userId = message.sender.user_id;
      console.log('[MESSAGE] userId from message.sender.user_id:', userId);
    } else if (message.from?.user_id) {
      userId = message.from.user_id;
      console.log('[MESSAGE] userId from message.from.user_id:', userId);
    } else if (anyUpdate.sender?.user_id) {
      userId = anyUpdate.sender.user_id;
      console.log('[MESSAGE] userId from update.sender.user_id:', userId);
    } else {
      console.log('[MESSAGE] WARNING: Could not find userId!');
    }

    // Извлекаем chatId - пробуем разные пути
    let chatId = 0;
    if (message.recipient?.chat_id) {
      chatId = message.recipient.chat_id;
      console.log('[MESSAGE] chatId from message.recipient.chat_id:', chatId);
    } else if (message.chat_id) {
      chatId = message.chat_id;
      console.log('[MESSAGE] chatId from message.chat_id:', chatId);
    } else if (anyUpdate.chat_id) {
      chatId = anyUpdate.chat_id;
      console.log('[MESSAGE] chatId from update.chat_id:', chatId);
    } else {
      console.log('[MESSAGE] WARNING: Could not find chatId!');
    }

    // Извлекаем текст - пробуем разные пути
    let text = '';
    if (message.body?.text) {
      text = message.body.text;
      console.log('[MESSAGE] text from message.body.text:', text);
    } else if (message.text) {
      text = message.text;
      console.log('[MESSAGE] text from message.text:', text);
    } else {
      console.log('[MESSAGE] WARNING: Could not find text!');
    }

    console.log('[MESSAGE] EXTRACTED: userId=' + userId + ', chatId=' + chatId + ', text="' + text + '"');

    if (!text || !text.trim()) {
      console.log('[MESSAGE] Empty text, skipping');
      return;
    }

    // Handle commands
    if (text.trim().startsWith('/')) {
      console.log('[MESSAGE] -> Detected command, calling handleCommand');
      await this.handleCommand(userId, chatId, text.trim());
      return;
    }

    // Handle state-based input
    console.log('[MESSAGE] Getting session for userId=' + userId + ', chatId=' + chatId);
    const session = getUserSession(userId, chatId);
    console.log('[MESSAGE] Session state:', session.state);
    console.log('[MESSAGE] Session data:', JSON.stringify(session.data));

    switch (session.state) {
      case 'waiting_for_title':
        console.log('[MESSAGE] -> calling handleTitleInput');
        await this.handleTitleInput(userId, chatId, text.trim(), session);
        break;
      case 'waiting_for_date':
        console.log('[MESSAGE] -> calling handleDateInput');
        await this.handleDateInput(userId, chatId, text.trim(), session);
        break;
      case 'waiting_for_time':
        console.log('[MESSAGE] -> calling handleTimeInput');
        await this.handleTimeInput(userId, chatId, text.trim(), session);
        break;
      case 'waiting_for_description':
        console.log('[MESSAGE] -> calling handleDescriptionInput');
        await this.handleDescriptionInput(userId, chatId, text.trim(), session);
        break;
      default:
        console.log('[MESSAGE] No active state, showing main menu');
        await this.showMainMenu(chatId);
    }
    
    console.log('[MESSAGE] === END ===');
  }

  /**
   * Handle command
   */
  private async handleCommand(userId: number, chatId: number, text: string): Promise<void> {
    console.log('[COMMAND] === START ===');
    console.log('[COMMAND] userId:', userId);
    console.log('[COMMAND] chatId:', chatId);
    console.log('[COMMAND] text:', text);

    const cmd = text.toLowerCase().split(' ')[0];
    console.log('[COMMAND] Parsed command:', cmd);

    try {
      if (cmd === '/start') {
        console.log('[COMMAND] -> Executing /start');
        await this.sendWelcome(chatId);
      } else if (cmd === '/list') {
        console.log('[COMMAND] -> Executing /list');
        await this.showRemindersList(userId, chatId);
      } else if (cmd === '/settings') {
        console.log('[COMMAND] -> Executing /settings');
        await this.showSettings(userId, chatId);
      } else if (cmd === '/help') {
        console.log('[COMMAND] -> Executing /help');
        await this.showHelp(chatId);
      } else {
        console.log('[COMMAND] -> Unknown command');
        await this.api.sendText(chatId, 'Неизвестная команда. Введите /help');
      }
    } catch (error) {
      console.error('[COMMAND] Error:', error);
      await this.api.sendText(chatId, 'Произошла ошибка. Попробуйте ещё раз.');
    }
    
    console.log('[COMMAND] === END ===');
  }

  /**
   * Handle callback (button press)
   */
  private async handleCallback(update: Update): Promise<void> {
    console.log('[CALLBACK] === START ===');
    
    const anyUpdate = update as any;
    
    // Ищем callback_id и payload в разных местах
    let callbackId: string = '';
    let payload: string = '';
    let userId = 0;
    let chatId = 0;
    
    // Путь 1: update.callback (ожидаемый формат MAX API)
    if (anyUpdate.callback) {
      callbackId = anyUpdate.callback.id || '';
      payload = anyUpdate.callback.payload || '';
      console.log('[CALLBACK] Found update.callback:', anyUpdate.callback);
    }
    
    // Путь 2: ищем в message.attachments[].callback_id
    if (!callbackId && anyUpdate.message?.attachments) {
      for (const att of anyUpdate.message.attachments) {
        if (att.callback_id) {
          callbackId = att.callback_id;
          console.log('[CALLBACK] Found callback_id in attachments:', callbackId);
        }
        // Payload может быть в нажатой кнопке
        if (att.payload?.clicked_button?.payload) {
          payload = att.payload.clicked_button.payload;
          console.log('[CALLBACK] Found payload in clicked_button:', payload);
        }
      }
    }
    
    // Путь 3: payload на верхнем уровне
    if (!payload && anyUpdate.payload) {
      payload = anyUpdate.payload;
      console.log('[CALLBACK] Found payload at top level:', payload);
    }
    
    // Извлекаем userId
    if (anyUpdate.sender?.user_id) {
      userId = anyUpdate.sender.user_id;
    } else if (anyUpdate.user?.user_id) {
      userId = anyUpdate.user.user_id;
    } else if (anyUpdate.message?.sender?.user_id) {
      userId = anyUpdate.message.sender.user_id;
    }
    console.log('[CALLBACK] userId:', userId);
    
    // Извлекаем chatId
    if (anyUpdate.chat_id) {
      chatId = anyUpdate.chat_id;
    } else if (anyUpdate.message?.recipient?.chat_id) {
      chatId = anyUpdate.message.recipient.chat_id;
    } else if (anyUpdate.message?.chat_id) {
      chatId = anyUpdate.message.chat_id;
    }
    console.log('[CALLBACK] chatId:', chatId);
    
    console.log('[CALLBACK] FINAL: callbackId=' + callbackId + ', payload=' + payload + ', userId=' + userId + ', chatId=' + chatId);

    // Отвечаем на callback
    if (callbackId) {
      try {
        await this.api.answerCallback(callbackId);
        console.log('[CALLBACK] Answer callback OK');
      } catch (e) {
        console.error('[CALLBACK] Failed to answer:', e);
      }
    }

    if (!payload) {
      console.log('[CALLBACK] No payload, searching recursively...');
      payload = this.findPayloadRecursive(anyUpdate, '') || '';
    }

    if (!payload || !chatId) {
      console.log('[CALLBACK] Missing payload or chatId, aborting');
      return;
    }

    // Выполняем действие
    const [action, ...params] = payload.split(':');
    console.log('[CALLBACK] Action:', action, 'Params:', params);

    try {
      await this.executeCallbackAction(userId, chatId, action, params);
    } catch (error) {
      console.error('[CALLBACK] Error:', error);
      await this.api.sendText(chatId, 'Произошла ошибка.');
    }
    
    console.log('[CALLBACK] === END ===');
  }

  /**
   * Execute callback action
   */
  private async executeCallbackAction(userId: number, chatId: number, action: string, params: string[]): Promise<void> {
    console.log('[ACTION] Executing:', action);
    
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
        console.log('[ACTION] Unknown action:', action);
        await this.showMainMenu(chatId);
    }
  }

  /**
   * Find payload recursively
   */
  private findPayloadRecursive(obj: any, path: string): string | null {
    if (!obj || typeof obj !== 'object') return null;
    
    if (typeof obj.payload === 'string' && obj.type !== 'callback' && obj.payload !== 'add_reminder') {
      // Пропускаем определения кнопок
      if (!obj.text) {
        console.log('[FIND] Found payload at', path + '.payload:', obj.payload);
        return obj.payload;
      }
    }
    
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
    console.log('[WELCOME] chatId:', chatId);
    
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
    console.log('[MENU] chatId:', chatId);
    
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
    console.log('[ADD_REMINDER] userId:', userId, 'chatId:', chatId);
    
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
    
    console.log('[ADD_REMINDER] Session updated to waiting_for_title');

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
    console.log('[TITLE_INPUT] text:', text);
    
    if (text.length < 2) {
      await this.api.sendText(chatId, 'Слишком короткое название. Попробуйте ещё:');
      return;
    }

    const newSession = updateUserSession(userId, chatId, {
      state: 'waiting_for_date',
      data: { ...session.data, temp_title: text }
    });
    
    console.log('[TITLE_INPUT] Session updated to waiting_for_date');
    console.log('[TITLE_INPUT] New session:', JSON.stringify(newSession));

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
    console.log('[DATE_INPUT] text:', text);
    
    const tz = session.data?.temp_timezone || 'Europe/Moscow';
    const date = parseDate(text, tz);

    if (!date) {
      await this.api.sendText(chatId, 'Не удалось распознать дату. Формат: DD/MM/YYYY');
      return;
    }

    if (isDateInPast(date, tz)) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '⚠️ Эта дата уже прошла. Всё равно создать?',
        [
          [callbackButton('✅ Да', `confirm_date:${toISODateString(date)}`)],
          [callbackButton('❌ Отмена', 'cancel')]
        ]
      );
      return;
    }

    updateUserSession(userId, chatId, {
      state: 'waiting_for_time',
      data: { ...session.data, temp_date: toISODateString(date) }
    });
    
    console.log('[DATE_INPUT] Session updated to waiting_for_time');

    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Дата: *${formatDate(date, 'long')}*\n\n🕐 Введите время (HH-MM) или пропустите:`,
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
    console.log('[TIME_INPUT] text:', text);
    
    const time = parseTime(text);
    if (!time) {
      await this.api.sendText(chatId, 'Не удалось распознать время. Формат: HH-MM');
      return;
    }

    updateUserSession(userId, chatId, {
      state: 'waiting_for_description',
      data: { ...session.data, temp_time: formatTime(time.hours, time.minutes) }
    });
    
    console.log('[TIME_INPUT] Session updated to waiting_for_description');

    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Время: *${formatTime(time.hours, time.minutes)}*\n\n📝 Введите описание или пропустите:`,
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
    console.log('[DESC_INPUT] text:', text);
    
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
    console.log('[SKIP_TIME]');
    const session = getUserSession(userId, chatId);
    updateUserSession(userId, chatId, {
      state: 'waiting_for_description',
      data: { ...session.data, temp_time: undefined }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      '📝 Введите описание или пропустите:',
      [[callbackButton('⏭ Пропустить', 'skip_description')]]
    );
  }

  /**
   * Skip description
   */
  private async skipDescription(userId: number, chatId: number): Promise<void> {
    console.log('[SKIP_DESC]');
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
    console.log('[PREVIEW] data:', JSON.stringify(data));
    
    if (!data) {
      console.log('[PREVIEW] ERROR: No data!');
      return;
    }
    
    const date = data.temp_date ? new Date(data.temp_date) : new Date();
    const periods = data.temp_periods || [86400000];
    const periodLabels = periods.map(p => formatPeriod(p)).join(', ');

    const text = `📋 *Проверка*

📌 *Название:* ${data.temp_title || 'не указано'}
📅 *Дата:* ${formatDate(date, 'long')}${data.temp_time ? ` в ${data.temp_time}` : ''}
📝 *Описание:* ${data.temp_description || 'нет'}
🔔 *Напомнить:* ${periodLabels}
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
    console.log('[PERIODS_MENU]');
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
    console.log('[TOGGLE_PERIOD] idx:', idx);
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
    await this.showPreview(chatId, session.data);
  }

  /**
   * Toggle repeat
   */
  private async toggleRepeat(userId: number, chatId: number): Promise<void> {
    console.log('[TOGGLE_REPEAT]');
    const session = getUserSession(userId, chatId);
    const newRepeat = !session.data?.temp_repeat;
    updateUserSession(userId, chatId, { data: { ...session.data, temp_repeat: newRepeat } });
    await this.showPreview(chatId, { ...session.data, temp_repeat: newRepeat });
  }

  /**
   * Save reminder
   */
  private async saveReminder(userId: number, chatId: number): Promise<void> {
    console.log('[SAVE] userId:', userId, 'chatId:', chatId);
    const session = getUserSession(userId, chatId);
    const data = session.data;

    console.log('[SAVE] Session data:', JSON.stringify(data));

    if (!data?.temp_title || !data?.temp_date) {
      console.log('[SAVE] ERROR: Missing title or date');
      await this.api.sendText(chatId, 'Ошибка: недостаточно данных. Начните заново.');
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

      console.log('[SAVE] Reminder created:', reminder.id);
      
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
      console.error('[SAVE] Error:', error);
      await this.api.sendText(chatId, 'Ошибка при сохранении.');
    }
  }

  /**
   * Show reminders list
   */
  private async showRemindersList(userId: number, chatId: number): Promise<void> {
    console.log('[LIST] userId:', userId, 'chatId:', chatId);
    
    const reminders = getRemindersByUser(userId, chatId);
    console.log('[LIST] Found', reminders.length, 'reminders');

    if (reminders.length === 0) {
      console.log('[LIST] No reminders, showing empty message');
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
      callbackButton('🏠 Меню', 'main_menu')
    ]);

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  /**
   * Show archived list
   */
  private async showArchivedList(userId: number, chatId: number): Promise<void> {
    console.log('[ARCHIVE_LIST]');
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
    console.log('[DETAILS] id:', id);
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
    console.log('[SETTINGS] userId:', userId, 'chatId:', chatId);
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

    await this.api.sendMessageWithKeyboard(chatId, '🌐 *Выберите часовой пояс:*', buttons, 'markdown');
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
• Дата: DD/MM/YYYY (например 25/12/2026)
• Время: HH-MM (например 14-30)`;

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
