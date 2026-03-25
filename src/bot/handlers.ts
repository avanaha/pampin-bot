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
  // Временное хранилище сессий в памяти (для отладки)
  private sessions: Map<string, UserSession> = new Map();

  constructor(token: string, groupId: number) {
    this.api = new MaxApi(token);
    this.groupId = groupId;
  }

  // Ключ для сессии
  private getSessionKey(userId: number, chatId: number): string {
    return `${userId}:${chatId}`;
  }

  // Получить сессию (сначала из памяти, потом из БД)
  private getSession(userId: number, chatId: number): UserSession {
    const key = this.getSessionKey(userId, chatId);
    
    // Сначала проверяем память
    if (this.sessions.has(key)) {
      console.log(`[SESSION] Found in MEMORY: ${key}`);
      return this.sessions.get(key)!;
    }
    
    // Потом БД
    const dbSession = getUserSession(userId, chatId);
    console.log(`[SESSION] From DB: ${key}, state=${dbSession.state}`);
    return dbSession;
  }

  // Сохранить сессию
  private saveSession(userId: number, chatId: number, session: Partial<UserSession>): UserSession {
    const key = this.getSessionKey(userId, chatId);
    
    // Сохраняем в память
    const current = this.getSession(userId, chatId);
    const updated: UserSession = {
      ...current,
      ...session,
      last_activity: new Date()
    };
    this.sessions.set(key, updated);
    
    // Также сохраняем в БД
    const dbSession = updateUserSession(userId, chatId, session);
    
    console.log(`[SESSION] SAVED: ${key}, state=${updated.state}`);
    return updated;
  }

  // Очистить сессию
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

  private async handleMessage(update: Update): Promise<void> {
    console.log('[MESSAGE] === START ===');
    console.log('[MESSAGE] FULL JSON:', JSON.stringify(update, null, 2));

    const anyUpdate = update as any;
    const message = update.message;

    if (!message) {
      console.log('[MESSAGE] No message!');
      return;
    }

    // ВАЖНО: При message_created в MAX API:
    // - message.sender - это отправитель сообщения (пользователь)
    // - message.recipient - это получатель (бот)

    // Извлекаем userId из sender (отправитель = пользователь)
    let userId = 0;
    if (message.sender?.user_id) {
      userId = message.sender.user_id;
      console.log('[MESSAGE] userId from message.sender.user_id:', userId);
    } else if (update.sender?.user_id) {
      userId = update.sender.user_id;
      console.log('[MESSAGE] userId from update.sender.user_id:', userId);
    }
    console.log('[MESSAGE] FINAL userId:', userId);

    // Извлекаем chatId из recipient
    let chatId = 0;
    if (message.recipient?.chat_id) {
      chatId = message.recipient.chat_id;
      console.log('[MESSAGE] chatId from message.recipient.chat_id:', chatId);
    } else if (message.chat_id) {
      chatId = message.chat_id;
      console.log('[MESSAGE] chatId from message.chat_id:', chatId);
    }
    console.log('[MESSAGE] FINAL chatId:', chatId);

    // Извлекаем текст
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

    // Обрабатываем команды
    if (text.trim().startsWith('/')) {
      await this.handleCommand(userId, chatId, text.trim());
      return;
    }

    // Получаем сессию
    const session = this.getSession(userId, chatId);
    console.log('[MESSAGE] Session state:', session.state);
    console.log('[MESSAGE] Session data:', JSON.stringify(session.data));

    // Обрабатываем по состоянию
    switch (session.state) {
      case 'waiting_for_title':
        console.log('[MESSAGE] -> Calling handleTitleInput');
        await this.handleTitleInput(userId, chatId, text.trim(), session);
        break;
      case 'waiting_for_date':
        console.log('[MESSAGE] -> Calling handleDateInput');
        await this.handleDateInput(userId, chatId, text.trim(), session);
        break;
      case 'waiting_for_time':
        console.log('[MESSAGE] -> Calling handleTimeInput');
        await this.handleTimeInput(userId, chatId, text.trim(), session);
        break;
      case 'waiting_for_description':
        console.log('[MESSAGE] -> Calling handleDescriptionInput');
        await this.handleDescriptionInput(userId, chatId, text.trim(), session);
        break;
      default:
        console.log('[MESSAGE] -> Default: showing main menu');
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

    // ВАЖНО: При message_callback в MAX API:
    // - update.message_callback.user - это пользователь, нажавший кнопку
    // - update.sender - это БОТ (отправитель сообщения с кнопками)
    // Поэтому нужно брать userId из message_callback.user!

    // Извлекаем userId - ПРИОРИТЕТ: message_callback.user
    let userId = 0;
    if (update.message_callback?.user?.user_id) {
      userId = update.message_callback.user.user_id;
      console.log('[CALLBACK] userId from message_callback.user.user_id:', userId);
    } else if (anyUpdate.message_callback?.user?.user_id) {
      userId = anyUpdate.message_callback.user.user_id;
      console.log('[CALLBACK] userId from anyUpdate.message_callback.user.user_id:', userId);
    } else if (update.callback?.user?.user_id) {
      userId = update.callback.user.user_id;
      console.log('[CALLBACK] userId from callback.user.user_id:', userId);
    } else if (anyUpdate.user?.user_id) {
      userId = anyUpdate.user.user_id;
      console.log('[CALLBACK] userId from anyUpdate.user.user_id:', userId);
    }
    console.log('[CALLBACK] FINAL userId:', userId);

    // Извлекаем chatId - ПРИОРИТЕТ: message_callback.chat_id
    let chatId = 0;
    if (update.message_callback?.chat_id) {
      chatId = update.message_callback.chat_id;
      console.log('[CALLBACK] chatId from message_callback.chat_id:', chatId);
    } else if (anyUpdate.message_callback?.chat_id) {
      chatId = anyUpdate.message_callback.chat_id;
      console.log('[CALLBACK] chatId from anyUpdate.message_callback.chat_id:', chatId);
    } else if (anyUpdate.chat_id) {
      chatId = anyUpdate.chat_id;
      console.log('[CALLBACK] chatId from anyUpdate.chat_id:', chatId);
    }
    console.log('[CALLBACK] FINAL chatId:', chatId);

    // Извлекаем payload - ПРИОРИТЕТ: message_callback.payload
    let payload = '';
    if (update.message_callback?.payload) {
      payload = update.message_callback.payload;
      console.log('[CALLBACK] payload from message_callback.payload:', payload);
    } else if (anyUpdate.message_callback?.payload) {
      payload = anyUpdate.message_callback.payload;
      console.log('[CALLBACK] payload from anyUpdate.message_callback.payload:', payload);
    } else if (update.callback?.payload) {
      payload = update.callback.payload;
      console.log('[CALLBACK] payload from update.callback:', payload);
    } else if (anyUpdate.payload) {
      payload = anyUpdate.payload;
      console.log('[CALLBACK] payload from anyUpdate:', payload);
    }
    console.log('[CALLBACK] FINAL payload:', payload);

    // Извлекаем callback_id для ответа
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

    // Отвечаем на callback
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
        this.clearSession(userId, chatId);
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
• Повторять ежегодно`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('➕ Добавить напоминание', 'add_reminder')],
      [callbackButton('📋 Мои напоминания', 'list_reminders')],
      [callbackButton('⚙️ Настройки', 'settings')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async showMainMenu(chatId: number): Promise<void> {
    console.log('[MENU] chatId:', chatId);
    
    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('➕ Добавить напоминание', 'add_reminder')],
      [callbackButton('📋 Мои напоминания', 'list_reminders')],
      [callbackButton('⚙️ Настройки', 'settings')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, '🏠 *Главное меню*', buttons, 'markdown');
  }

  private async startAddReminder(userId: number, chatId: number): Promise<void> {
    console.log('[ADD] userId:', userId, 'chatId:', chatId);
    
    const settings = getUserSettings(userId, chatId);
    const tz = settings?.timezone || 'Europe/Moscow';

    // Сохраняем сессию
    this.saveSession(userId, chatId, {
      state: 'waiting_for_title',
      data: {
        temp_timezone: tz,
        temp_periods: [86400000],
        temp_repeat: false
      }
    });

    // Проверяем что сохранилось
    const check = this.getSession(userId, chatId);
    console.log('[ADD] After save, session state:', check.state);

    await this.api.sendMessageWithKeyboard(
      chatId,
      '📝 *Создание напоминания*\n\nВведите название:',
      [[callbackButton('❌ Отмена', 'cancel')]],
      'markdown'
    );
  }

  private async handleTitleInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log('[TITLE] userId:', userId, 'chatId:', chatId, 'text:', text);
    
    if (text.length < 2) {
      await this.api.sendText(chatId, 'Слишком короткое. Попробуйте ещё:');
      return;
    }

    // Сохраняем
    this.saveSession(userId, chatId, {
      state: 'waiting_for_date',
      data: { ...session.data, temp_title: text }
    });

    // Проверяем
    const check = this.getSession(userId, chatId);
    console.log('[TITLE] After save, session state:', check.state, 'title:', check.data?.temp_title);

    const today = getTodayFormatted(session.data?.temp_timezone || 'Europe/Moscow');
    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Название: *${text}*\n\n📅 Введите дату (DD/MM/YYYY):\n_Например: ${today}_`,
      [[callbackButton('❌ Отмена', 'cancel')]],
      'markdown'
    );
  }

  private async handleDateInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log('[DATE] userId:', userId, 'chatId:', chatId, 'text:', text);
    
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
          [callbackButton('✅ Да', `force_date:${toISODateString(date)}`)],
          [callbackButton('❌ Нет', 'cancel')]
        ]
      );
      return;
    }

    this.saveSession(userId, chatId, {
      state: 'waiting_for_time',
      data: { ...session.data, temp_date: toISODateString(date) }
    });

    const check = this.getSession(userId, chatId);
    console.log('[DATE] After save, session state:', check.state, 'date:', check.data?.temp_date);

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

  private async handleTimeInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log('[TIME] userId:', userId, 'chatId:', chatId, 'text:', text);
    
    const time = parseTime(text);
    if (!time) {
      await this.api.sendText(chatId, 'Не удалось распознать время. Формат: HH-MM');
      return;
    }

    this.saveSession(userId, chatId, {
      state: 'waiting_for_description',
      data: { ...session.data, temp_time: formatTime(time.hours, time.minutes) }
    });

    const check = this.getSession(userId, chatId);
    console.log('[TIME] After save, session state:', check.state, 'time:', check.data?.temp_time);

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

  private async handleDescriptionInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    console.log('[DESC] userId:', userId, 'chatId:', chatId, 'text:', text);
    
    this.saveSession(userId, chatId, {
      state: 'idle',
      data: { ...session.data, temp_description: text }
    });

    await this.showPreview(chatId, session.data);
  }

  private async skipTime(userId: number, chatId: number): Promise<void> {
    console.log('[SKIP_TIME] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    this.saveSession(userId, chatId, {
      state: 'waiting_for_description',
      data: { ...session.data, temp_time: undefined }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      '📝 Введите описание или пропустите:',
      [[callbackButton('⏭ Пропустить', 'skip_description')]]
    );
  }

  private async skipDescription(userId: number, chatId: number): Promise<void> {
    console.log('[SKIP_DESC] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    this.saveSession(userId, chatId, {
      state: 'idle',
      data: { ...session.data, temp_description: undefined }
    });

    await this.showPreview(chatId, session.data);
  }

  private async showPreview(chatId: number, data: UserSession['data']): Promise<void> {
    console.log('[PREVIEW] chatId:', chatId, 'data:', JSON.stringify(data));
    
    if (!data || !data.temp_title) {
      console.log('[PREVIEW] No data!');
      await this.api.sendText(chatId, 'Ошибка: данные потеряны. Попробуйте заново.');
      return;
    }
    
    const date = data.temp_date ? new Date(data.temp_date) : new Date();
    const periods = data.temp_periods || [86400000];
    const periodLabels = periods.map(p => formatPeriod(p)).join(', ');

    const text = `📋 *Проверка*

📌 *Название:* ${data.temp_title}
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

  private async showPeriodsMenu(userId: number, chatId: number): Promise<void> {
    console.log('[PERIODS] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const selected = session.data?.temp_periods || [];

    const buttons: InlineKeyboardButton[][] = PREDEFINED_PERIODS.map((p, i) => {
      const prefix = selected.includes(p.value) ? '✅ ' : '⬜ ';
      return [callbackButton(`${prefix}${p.label}`, `toggle_period:${i}`)];
    });
    buttons.push([callbackButton('✅ Готово', 'confirm_periods')]);

    await this.api.sendMessageWithKeyboard(chatId, '🔔 *Выберите периоды:*', buttons, 'markdown');
  }

  private async togglePeriod(userId: number, chatId: number, idx: number): Promise<void> {
    console.log('[TOGGLE_PERIOD] userId:', userId, 'chatId:', chatId, 'idx:', idx);
    const session = this.getSession(userId, chatId);
    const periods = [...(session.data?.temp_periods || [])];
    const val = PREDEFINED_PERIODS[idx].value;

    const i = periods.indexOf(val);
    if (i >= 0) periods.splice(i, 1);
    else { periods.push(val); periods.sort((a, b) => b - a); }

    this.saveSession(userId, chatId, { data: { ...session.data, temp_periods: periods } });
    await this.showPeriodsMenu(userId, chatId);
  }

  private async confirmPeriods(userId: number, chatId: number): Promise<void> {
    const session = this.getSession(userId, chatId);
    await this.showPreview(chatId, session.data);
  }

  private async toggleRepeat(userId: number, chatId: number): Promise<void> {
    console.log('[TOGGLE_REPEAT] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const newRepeat = !session.data?.temp_repeat;
    this.saveSession(userId, chatId, { data: { ...session.data, temp_repeat: newRepeat } });
    await this.showPreview(chatId, { ...session.data, temp_repeat: newRepeat });
  }

  private async saveReminder(userId: number, chatId: number): Promise<void> {
    console.log('[SAVE] userId:', userId, 'chatId:', chatId);
    const session = this.getSession(userId, chatId);
    const data = session.data;

    console.log('[SAVE] data:', JSON.stringify(data));

    if (!data?.temp_title || !data?.temp_date) {
      console.log('[SAVE] Missing data');
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

      console.log('[SAVE] Created:', reminder.id);
      
      this.clearSession(userId, chatId);

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

  private async showArchivedList(userId: number, chatId: number): Promise<void> {
    console.log('[ARCHIVE] userId:', userId, 'chatId:', chatId);
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

  private async doRestore(userId: number, chatId: number, id: string): Promise<void> {
    if (restoreReminder(id)) {
      await this.api.sendText(chatId, '✅ Восстановлено из архива.');
      await this.showRemindersList(userId, chatId);
    }
  }

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

  private async doDelete(userId: number, chatId: number, id: string): Promise<void> {
    if (deleteReminderPermanently(id)) {
      await this.api.sendText(chatId, '🗑 Удалено навсегда.');
      await this.showRemindersList(userId, chatId);
    }
  }

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

  private async showTimezoneMenu(chatId: number): Promise<void> {
    const buttons: InlineKeyboardButton[][] = SUPPORTED_TIMEZONES.map(tz => [
      callbackButton(tz.label, `set_timezone:${tz.value}`)
    ]);
    buttons.push([callbackButton('◀️ Назад', 'settings')]);

    await this.api.sendMessageWithKeyboard(chatId, '🌐 *Выберите часовой пояс:*', buttons, 'markdown');
  }

  private async doSetTimezone(userId: number, chatId: number, tz: string): Promise<void> {
    upsertUserSettings({ user_id: userId, chat_id: chatId, timezone: tz });
    await this.showSettings(userId, chatId);
  }

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
