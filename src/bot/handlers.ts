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
  SessionState 
} from '../types';
import {
  getReminderById,
  getRemindersByUser,
  createReminder,
  deleteReminder,
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

  async processUpdate(update: Update): Promise<void> {
    const updateType = update.update_type;
    console.log(`[PROCESS] Update type: ${updateType}`);
    
    try {
      if (updateType === 'message_created' && update.message) {
        // Skip messages from bot itself
        if (update.message.sender?.is_bot === true) {
          console.log('[PROCESS] Skipping message from bot');
          return;
        }
        await this.handleMessage(update.message);
      } else if (updateType === 'message_callback' && update.message_callback) {
        console.log('[PROCESS] Callback data:', JSON.stringify(update.message_callback, null, 2));
        await this.handleCallback(update.message_callback);
      } else if (updateType === 'bot_started') {
        const userId = update.user?.user_id || update.user_id || 0;
        const chatId = update.chat_id || 0;
        console.log(`[PROCESS] Bot started: user_id=${userId}, chat_id=${chatId}`);
        await this.handleBotStarted(
          update.user || { user_id: userId, name: 'User', is_bot: false, last_activity_time: 0 }, 
          chatId
        );
      }
    } catch (error) {
      console.error('[PROCESS] Error:', error);
    }
  }

  private getUserTimezone(userId: number, chatId: number, sessionData?: UserSession['data']): string {
    const settings = getUserSettings(userId, chatId);
    return settings?.timezone || sessionData?.temp_timezone || 'Europe/Moscow';
  }

  private async handleBotStarted(user: any, chatId: number): Promise<void> {
    console.log(`[BOT_STARTED] Chat ID: ${chatId}`);
    
    const welcomeText = `
👋 *Добро пожаловать в PamPin!*

📅 PamPin — твой календарь важных дат. Я напомню обо всём, что ты расскажешь.

*Что я умею:*
• Добавлять напоминания о важных датах
• Напоминать за нужный период (за 3 месяца, за день, за час и т.д.)
• Повторять напоминания ежегодно
• Работать с разными часовыми поясами

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

  private async handleMessage(message: Message): Promise<void> {
    const userId = message.sender?.user_id || 0;
    const chatId = message.recipient?.chat_id || message.chat_id || 0;
    const text = (message.body?.text || message.text || '').trim();
    
    console.log(`[MESSAGE] User: ${userId}, Chat: ${chatId}, Text: "${text}"`);

    if (!text) return;

    const session = getUserSession(userId, chatId);

    if (text.startsWith('/')) {
      await this.handleCommand(userId, chatId, text);
      return;
    }

    switch (session.state) {
      case 'waiting_for_title':
        await this.handleTitleInput(userId, chatId, text, session);
        break;
      case 'waiting_for_date':
        await this.handleDateInput(userId, chatId, text, session);
        break;
      case 'waiting_for_time':
        await this.handleTimeInput(userId, chatId, text, session);
        break;
      case 'waiting_for_description':
        await this.handleDescriptionInput(userId, chatId, text, session);
        break;
      default:
        await this.showMainMenu(chatId);
    }
  }

  private async handleCommand(userId: number, chatId: number, command: string): Promise<void> {
    const cmd = command.toLowerCase().split(' ')[0].trim();
    console.log(`[COMMAND] "${cmd}" from user ${userId}`);

    switch (cmd) {
      case '/start':
        await this.handleBotStarted({ user_id: userId, name: 'User', is_bot: false, last_activity_time: 0 }, chatId);
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

  private async handleCallback(callback: MessageCallback): Promise<void> {
    const userId = callback.user?.user_id || 0;
    const chatId = callback.chat_id || 0;
    const payload = callback.payload || '';

    console.log(`[CALLBACK] User: ${userId}, Chat: ${chatId}, Payload: "${payload}"`);

    // Answer callback first
    try {
      await this.api.answerCallback(callback.callback_id);
      console.log('[CALLBACK] Answered callback');
    } catch (e) {
      console.error('[CALLBACK] Failed to answer:', e);
    }

    // Parse callback data
    const parts = payload.split(':');
    const action = parts[0] || '';
    const params = parts.slice(1);

    console.log(`[CALLBACK] Action: "${action}", Params:`, params);

    switch (action) {
      case 'add_reminder':
        await this.startAddReminder(userId, chatId);
        break;
      case 'list_reminders':
        await this.showRemindersList(userId, chatId);
        break;
      case 'view_reminder':
        await this.showReminderDetails(chatId, params[0]);
        break;
      case 'edit_reminder':
        await this.startEditReminder(userId, chatId, params[0]);
        break;
      case 'delete_reminder':
        await this.confirmDeleteReminder(chatId, params[0]);
        break;
      case 'confirm_delete':
        await this.executeDeleteReminder(userId, chatId, params[0]);
        break;
      case 'archive_reminder':
        await this.archiveReminder(userId, chatId, params[0]);
        break;
      case 'restore_reminder':
        await this.restoreReminder(userId, chatId, params[0]);
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
        await this.togglePeriod(userId, chatId, parseInt(params[0]) || 0);
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
      default:
        console.log(`[CALLBACK] Unknown action: ${action}`);
    }
  }

  private async startAddReminder(userId: number, chatId: number): Promise<void> {
    const timezone = this.getUserTimezone(userId, chatId);
    
    updateUserSession(userId, chatId, { 
      state: 'waiting_for_title',
      data: { 
        temp_periods: [86400000],
        temp_timezone: timezone,
        temp_repeat: false
      }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `📝 *Создание напоминания*\n\nВведите название события:`,
      [[callbackButton('❌ Отмена', 'cancel')]],
      'markdown'
    );
  }

  private async handleTitleInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    if (text.length < 2 || text.length > 200) {
      await this.api.sendText(chatId, 'Название должно быть от 2 до 200 символов. Попробуйте ещё раз:');
      return;
    }

    const timezone = this.getUserTimezone(userId, chatId, session.data);
    const todayStr = getTodayFormatted(timezone);

    updateUserSession(userId, chatId, {
      state: 'waiting_for_date',
      data: { ...session.data, temp_title: text }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Название: *${text}*\n\n📅 Теперь введите дату события:\n\n_Формат: DD/MM/YYYY_\n_Например: ${todayStr}_`,
      [[callbackButton('❌ Отмена', 'cancel')]],
      'markdown'
    );
  }

  private async handleDateInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    const timezone = this.getUserTimezone(userId, chatId, session.data);
    
    const date = parseDate(text, timezone);
    
    if (!date) {
      const todayStr = getTodayFormatted(timezone);
      await this.api.sendText(chatId, `Не удалось распознать дату. Попробуйте ещё раз.\n\nФормат: DD/MM/YYYY\nНапример: ${todayStr}`);
      return;
    }

    if (isDateInPast(date, timezone)) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '⚠️ Эта дата уже прошла. Хотите создать напоминание на следующий год?',
        [
          [callbackButton('Да, на следующий год', `set_next_year:${date.toISOString()}`)],
          [callbackButton('Ввести другую дату', 'retry_date')],
          [callbackButton('❌ Отмена', 'cancel')]
        ]
      );
      return;
    }

    updateUserSession(userId, chatId, {
      state: 'waiting_for_time',
      data: { 
        ...session.data, 
        temp_date: toISODateString(date)
      }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Дата: *${formatDate(date, 'long')}*\n\n🕐 Введите время события:\n\n_Формат: HH-MM_\n_Например: 14-30 (14:30)_`,
      [
        [callbackButton('⏭ Пропустить', 'skip_time')],
        [callbackButton('❌ Отмена', 'cancel')]
      ],
      'markdown'
    );
  }

  private async handleTimeInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    const time = parseTime(text);

    if (!time) {
      await this.api.sendText(chatId, 'Не удалось распознать время. Введите в формате HH-MM (например: 14-30):');
      return;
    }

    updateUserSession(userId, chatId, {
      state: 'waiting_for_description',
      data: { 
        ...session.data, 
        temp_time: formatTime(time.hours, time.minutes)
      }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Время: *${formatTime(time.hours, time.minutes)}*\n\n📝 Добавьте описание (необязательно) или пропустите:`,
      [
        [callbackButton('⏭ Пропустить', 'skip_description')],
        [callbackButton('❌ Отмена', 'cancel')]
      ],
      'markdown'
    );
  }

  private async handleDescriptionInput(userId: number, chatId: number, text: string, session: UserSession): Promise<void> {
    updateUserSession(userId, chatId, {
      state: 'idle',
      data: { ...session.data, temp_description: text }
    });

    await this.showReminderPreview(chatId, session.data);
  }

  private async showReminderPreview(chatId: number, sessionData: UserSession['data']): Promise<void> {
    const date = sessionData.temp_date ? new Date(sessionData.temp_date) : new Date();
    const timeStr = sessionData.temp_time || '';
    const periods = sessionData.temp_periods || [];
    const periodLabels = periods.map((p: number) => formatPeriod(p)).join(', ');

    const text = `
📋 *Проверьте напоминание*

📌 *Название:* ${sessionData.temp_title}
📅 *Дата:* ${formatDate(date, 'long')}${timeStr ? ` в ${timeStr}` : ''}
📝 *Описание:* ${sessionData.temp_description || 'нет'}
🔔 *Напомнить:* ${periodLabels || 'не выбрано'}
🔄 *Повторять ежегодно:* ${sessionData.temp_repeat ? 'да' : 'нет'}

Всё верно?
`;

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

  private async showPeriodSelection(userId: number, chatId: number): Promise<void> {
    const session = getUserSession(userId, chatId);
    const selectedPeriods = session.data.temp_periods || [];

    const buttons: InlineKeyboardButton[][] = PREDEFINED_PERIODS.map((period, index) => {
      const isSelected = selectedPeriods.includes(period.value);
      const prefix = isSelected ? '✅ ' : '⬜ ';
      return [callbackButton(`${prefix}${period.label}`, `toggle_period:${index}`)];
    });

    buttons.push([callbackButton('✅ Готово', 'confirm_periods')]);
    buttons.push([callbackButton('❌ Отмена', 'cancel')]);

    await this.api.sendMessageWithKeyboard(
      chatId,
      '🔔 *Выберите периоды напоминаний*\n\nМожно выбрать несколько:',
      buttons,
      'markdown'
    );
  }

  private async togglePeriod(userId: number, chatId: number, periodIndex: number): Promise<void> {
    const session = getUserSession(userId, chatId);
    const periods = [...(session.data.temp_periods || [])];
    const periodValue = PREDEFINED_PERIODS[periodIndex]?.value;

    if (!periodValue) return;

    const existingIndex = periods.indexOf(periodValue);
    if (existingIndex >= 0) {
      periods.splice(existingIndex, 1);
    } else {
      periods.push(periodValue);
      periods.sort((a, b) => b - a);
    }

    updateUserSession(userId, chatId, {
      data: { ...session.data, temp_periods: periods }
    });

    await this.showPeriodSelection(userId, chatId);
  }

  private async confirmPeriods(userId: number, chatId: number): Promise<void> {
    const session = getUserSession(userId, chatId);
    const periods = session.data.temp_periods || [];

    if (periods.length === 0) {
      await this.api.sendText(chatId, 'Выберите хотя бы один период напоминания.');
      return;
    }

    await this.showReminderPreview(chatId, session.data);
  }

  private async toggleRepeat(userId: number, chatId: number): Promise<void> {
    const session = getUserSession(userId, chatId);
    const newRepeat = !session.data.temp_repeat;

    updateUserSession(userId, chatId, {
      data: { ...session.data, temp_repeat: newRepeat }
    });

    await this.showReminderPreview(chatId, { ...session.data, temp_repeat: newRepeat });
  }

  private async confirmReminder(userId: number, chatId: number): Promise<void> {
    const session = getUserSession(userId, chatId);
    const data = session.data;

    console.log('[CONFIRM] Creating reminder with data:', JSON.stringify(data, null, 2));

    if (!data.temp_title || !data.temp_date) {
      await this.api.sendText(chatId, 'Ошибка: недостаточно данных для создания напоминания.');
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

      console.log('[CONFIRM] Reminder created:', reminder.id);

      clearUserSession(userId, chatId);

      await this.api.sendMessageWithKeyboard(
        chatId,
        `✅ *Напоминание создано!*\n\n📌 ${reminder.title}\n📅 ${formatDate(new Date(reminder.event_date), 'full')}\n\nЯ напомню вам вовремя!`,
        [
          [callbackButton('📋 Мои напоминания', 'list_reminders')],
          [callbackButton('➕ Добавить ещё', 'add_reminder')]
        ],
        'markdown'
      );

      await this.notifyGroup(reminder);
    } catch (error) {
      console.error('[CONFIRM] Error:', error);
      await this.api.sendText(chatId, 'Ошибка при создании напоминания. Попробуйте ещё раз.');
    }
  }

  private async showRemindersList(userId: number, chatId: number): Promise<void> {
    const reminders = getRemindersByUser(userId, chatId);
    console.log(`[LIST] Found ${reminders.length} reminders for user ${userId}`);

    if (reminders.length === 0) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '📭 *У вас пока нет напоминаний.*\n\nХотите создать первое?',
        [[callbackButton('➕ Добавить напоминание', 'add_reminder')]],
        'markdown'
      );
      return;
    }

    let text = '📋 *Ваши напоминания:*\n\n';
    
    reminders.slice(0, 10).forEach((reminder, index) => {
      const date = new Date(reminder.event_date);
      const timeStr = reminder.event_time ? ` в ${reminder.event_time}` : '';
      text += `${index + 1}. ${reminder.title}\n   📅 ${formatDate(date, 'short')}${timeStr}\n\n`;
    });

    if (reminders.length > 10) {
      text += `_... и ещё ${reminders.length - 10} напоминаний_`;
    }

    const buttons: InlineKeyboardButton[][] = reminders.slice(0, 5).map(r => [
      callbackButton(`📌 ${r.title}`, `view_reminder:${r.id}`)
    ]);
    buttons.push([callbackButton('➕ Добавить', 'add_reminder')]);

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async showReminderDetails(chatId: number, reminderId: string): Promise<void> {
    const reminder = getReminderById(reminderId);
    
    if (!reminder) {
      await this.api.sendText(chatId, 'Напоминание не найдено.');
      return;
    }

    const date = new Date(reminder.event_date);
    const now = new Date();
    const timeUntil = date.getTime() - now.getTime();
    const periodLabels = reminder.reminder_periods.map(p => formatPeriod(p)).join(', ');

    const text = `
📌 *${reminder.title}*

📅 *Дата:* ${formatDate(date, 'long')}${reminder.event_time ? ` в ${reminder.event_time}` : ''}
📝 *Описание:* ${reminder.description || 'нет'}
🔔 *Напомнить:* ${periodLabels}
🔄 *Повторять ежегодно:* ${reminder.repeat_yearly ? 'да' : 'нет'}
🌍 *Часовой пояс:* ${reminder.timezone}
⏳ *Осталось:* ${timeUntil > 0 ? formatTimeRemaining(timeUntil) : 'событие прошло'}
`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('✏️ Редактировать', `edit_reminder:${reminderId}`)],
      [callbackButton('📦 В архив', `archive_reminder:${reminderId}`)],
      [callbackButton('🗑 Удалить', `delete_reminder:${reminderId}`)],
      [callbackButton('◀️ Назад', 'list_reminders')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async confirmDeleteReminder(chatId: number, reminderId: string): Promise<void> {
    const reminder = getReminderById(reminderId);
    
    if (!reminder) {
      await this.api.sendText(chatId, 'Напоминание не найдено.');
      return;
    }

    await this.api.sendMessageWithKeyboard(
      chatId,
      `⚠️ *Удалить напоминание?*\n\n"${reminder.title}"\n\nЭто действие необратимо.`,
      [
        [callbackButton('✅ Да, удалить', `confirm_delete:${reminderId}`)],
        [callbackButton('❌ Отмена', `view_reminder:${reminderId}`)]
      ],
      'markdown'
    );
  }

  private async executeDeleteReminder(userId: number, chatId: number, reminderId: string): Promise<void> {
    const success = deleteReminder(reminderId);
    
    if (success) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '✅ Напоминание удалено.',
        [
          [callbackButton('📋 Мои напоминания', 'list_reminders')],
          [callbackButton('➕ Добавить новое', 'add_reminder')]
        ]
      );
    } else {
      await this.api.sendText(chatId, 'Ошибка при удалении напоминания.');
    }
  }

  private async archiveReminder(userId: number, chatId: number, reminderId: string): Promise<void> {
    // For now, same as delete (is_active = 0)
    const success = deleteReminder(reminderId);
    
    if (success) {
      await this.api.sendMessageWithKeyboard(
        chatId,
        '📦 Напоминание отправлено в архив.',
        [
          [callbackButton('📋 Мои напоминания', 'list_reminders')],
          [callbackButton('➕ Добавить новое', 'add_reminder')]
        ]
      );
    } else {
      await this.api.sendText(chatId, 'Ошибка при архивации напоминания.');
    }
  }

  private async restoreReminder(userId: number, chatId: number, reminderId: string): Promise<void> {
    // TODO: Implement restore from archive
    await this.api.sendText(chatId, 'Функция восстановления пока не реализована.');
  }

  private async showSettings(userId: number, chatId: number): Promise<void> {
    const settings = getUserSettings(userId, chatId);
    const timezone = settings?.timezone || 'Europe/Moscow';
    const tzInfo = SUPPORTED_TIMEZONES.find(t => t.value === timezone);

    const now = getCurrentDateTimeInTimezone(timezone);
    const currentTime = `${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}`;

    const text = `
⚙️ *Настройки*

🌐 *Часовой пояс:* ${tzInfo?.label || timezone}
🕐 *Текущее время:* ${currentTime}
`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('🌐 Изменить часовой пояс', 'change_timezone')],
      [callbackButton('◀️ В меню', 'main_menu')]
    ];

    await this.api.sendMessageWithKeyboard(chatId, text, buttons, 'markdown');
  }

  private async showTimezoneSelection(chatId: number): Promise<void> {
    const buttons: InlineKeyboardButton[][] = SUPPORTED_TIMEZONES.map(tz => [
      callbackButton(tz.label, `set_timezone:${tz.value}`)
    ]);
    buttons.push([callbackButton('◀️ Назад', 'settings')]);

    await this.api.sendMessageWithKeyboard(
      chatId,
      '🌐 *Выберите часовой пояс:*',
      buttons,
      'markdown'
    );
  }

  private async setTimezone(userId: number, chatId: number, timezone: string): Promise<void> {
    upsertUserSettings({ user_id: userId, chat_id: chatId, timezone });
    await this.showSettings(userId, chatId);
  }

  private async showMainMenu(chatId: number): Promise<void> {
    await this.api.sendMessageWithKeyboard(
      chatId,
      '🏠 *Главное меню*\n\nВыберите действие:',
      [
        [callbackButton('➕ Добавить напоминание', 'add_reminder')],
        [callbackButton('📋 Мои напоминания', 'list_reminders')],
        [callbackButton('⚙️ Настройки', 'settings')]
      ],
      'markdown'
    );
  }

  private async showHelp(chatId: number): Promise<void> {
    const text = `
📚 *Справка по PamPin*

*Что я умею:*
• Создавать напоминания о важных датах
• Напоминать за указанный период
• Повторять напоминания ежегодно
• Поддерживать разные часовые пояса

*Как создать напоминание:*
1. Нажмите "➕ Добавить напоминание"
2. Введите название события
3. Укажите дату (формат: DD/MM/YYYY)
4. Укажите время (формат: HH-MM)
5. Выберите периоды напоминаний

*Форматы даты:*
• 25/03/2026 — 25 марта 2026
• 25.03.2026 — альтернатива

*Форматы времени:*
• 14-30 — 14:30 (основной)

*Команды:*
/start — главное меню
/list — список напоминаний
/settings — настройки
/help — эта справка
`;

    await this.api.sendMessageWithKeyboard(
      chatId,
      text,
      [[callbackButton('🏠 В меню', 'main_menu')]],
      'markdown'
    );
  }

  private async notifyGroup(reminder: Reminder): Promise<void> {
    const date = new Date(reminder.event_date);
    const timeStr = reminder.event_time ? ` в ${reminder.event_time}` : '';
    
    const text = `
🔔 *Новое напоминание создано*

📌 ${reminder.title}
📅 ${formatDate(date, 'long')}${timeStr}
 ${reminder.description ? `📝 ${reminder.description}` : ''}
`;

    try {
      await this.api.sendText(this.groupId, text, 'markdown');
    } catch (error) {
      console.error('Failed to notify group:', error);
    }
  }

  async sendReminderNotification(reminder: Reminder, periodMs: number): Promise<void> {
    const date = new Date(reminder.event_date);
    const timeStr = reminder.event_time ? ` в ${reminder.event_time}` : '';
    const periodLabel = formatPeriod(periodMs);
    
    const text = `
🔔 *Напоминание!*

📌 ${reminder.title}
📅 ${formatDate(date, 'long')}${timeStr}
 ${reminder.description ? `📝 ${reminder.description}` : ''}

⏰ *Напоминаю ${periodLabel}*
`;

    const buttons: InlineKeyboardButton[][] = [
      [callbackButton('✅ Понял', 'dismiss')],
      [callbackButton('📋 Все напоминания', 'list_reminders')]
    ];

    try {
      await this.api.sendMessageWithKeyboard(reminder.chat_id, text, buttons, 'markdown');
      await this.api.sendText(this.groupId, `📤 Напоминание отправлено пользователю:\n\n${text}`, 'markdown');
    } catch (error) {
      console.error('Failed to send reminder notification:', error);
    }
  }

  private async skipTime(userId: number, chatId: number): Promise<void> {
    const session = getUserSession(userId, chatId);
    updateUserSession(userId, chatId, {
      state: 'waiting_for_description',
      data: { ...session.data, temp_time: undefined }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      '📝 Добавьте описание (необязательно) или пропустите:',
      [
        [callbackButton('⏭ Пропустить', 'skip_description')],
        [callbackButton('❌ Отмена', 'cancel')]
      ]
    );
  }

  private async skipDescription(userId: number, chatId: number): Promise<void> {
    const session = getUserSession(userId, chatId);
    updateUserSession(userId, chatId, {
      state: 'idle',
      data: { ...session.data, temp_description: undefined }
    });

    await this.showReminderPreview(chatId, session.data);
  }

  private async setDateNextYear(userId: number, chatId: number, dateStr: string): Promise<void> {
    const session = getUserSession(userId, chatId);
    const originalDate = new Date(dateStr);
    const now = new Date();
    
    const nextYearDate = new Date(originalDate);
    nextYearDate.setFullYear(now.getFullYear());
    
    if (nextYearDate <= now) {
      nextYearDate.setFullYear(nextYearDate.getFullYear() + 1);
    }

    updateUserSession(userId, chatId, {
      state: 'waiting_for_time',
      data: { 
        ...session.data, 
        temp_date: toISODateString(nextYearDate),
        temp_repeat: true
      }
    });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `✅ Дата: *${formatDate(nextYearDate, 'long')}* (ежегодное повторение включено)\n\n🕐 Введите время события:\n\n_Формат: HH-MM_`,
      [
        [callbackButton('⏭ Пропустить', 'skip_time')],
        [callbackButton('❌ Отмена', 'cancel')]
      ],
      'markdown'
    );
  }

  private async retryDate(userId: number, chatId: number): Promise<void> {
    const timezone = this.getUserTimezone(userId, chatId);
    const todayStr = getTodayFormatted(timezone);
    
    updateUserSession(userId, chatId, { state: 'waiting_for_date' });

    await this.api.sendMessageWithKeyboard(
      chatId,
      `📅 Введите другую дату события:\n\n_Формат: DD/MM/YYYY_\n_Например: ${todayStr}_`,
      [[callbackButton('❌ Отмена', 'cancel')]],
      'markdown'
    );
  }

  private async startEditReminder(userId: number, chatId: number, reminderId: string): Promise<void> {
    const reminder = getReminderById(reminderId);
    
    if (!reminder) {
      await this.api.sendText(chatId, 'Напоминание не найдено.');
      return;
    }

    await this.api.sendMessageWithKeyboard(
      chatId,
      '⚠️ Редактирование пока не реализовано. Вы можете удалить напоминание и создать новое.',
      [
        [callbackButton('🗑 Удалить', `delete_reminder:${reminderId}`)],
        [callbackButton('◀️ Назад', `view_reminder:${reminderId}`)]
      ]
    );
  }
}
