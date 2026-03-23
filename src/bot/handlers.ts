import { MaxApi, callbackButton } from './maxApi';
import { Update, Message, MessageCallback, InlineKeyboardButton } from '../types/max-api';
import {
  getRemindersByUser,
  createReminder,
  deleteReminder,
  getUserSession,
  updateUserSession,
  clearUserSession
} from '../db/database';
import { parseDate, parseTime, formatDate, toISODateString } from '../utils/dateUtils';

// Периоды напоминания
const REMINDER_PERIODS = [
  { value: 7776000000, label: 'за 3 месяца' },
  { value: 2592000000, label: 'за 1 месяц' },
  { value: 604800000, label: 'за 1 неделю' },
  { value: 86400000, label: 'за 1 день' },
  { value: 3600000, label: 'за 1 час' },
];

export class PamPinBot {
  private api: MaxApi;
  private groupId: number;

  constructor(token: string, groupId: number) {
    this.api = new MaxApi(token);
    this.groupId = groupId;
    console.log(`[Bot] Ready, groupId=${groupId}`);
  }

  async processUpdate(update: Update): Promise<void> {
    console.log(`[Bot] ========== UPDATE: ${update.update_type} ==========`);
    
    try {
      if (update.update_type === 'message_created' && update.message) {
        await this.onMessage(update.message);
      } else if (update.update_type === 'message_callback' && update.message_callback) {
        await this.onCallback(update.message_callback);
      } else if (update.update_type === 'bot_started') {
        const userId = update.user?.user_id;
        console.log(`[Bot] bot_started userId=${userId}`);
        if (userId) {
          await this.sendMenu(userId);
        }
      }
    } catch (e) {
      console.error('[Bot] Error:', e);
    }
  }

  private async send(userId: number, text: string, buttons?: InlineKeyboardButton[][]): Promise<void> {
    console.log(`[Bot] >>> SEND to userId=${userId}`);
    try {
      await this.api.sendToUser(userId, text, buttons);
      console.log(`[Bot] <<< SENT OK`);
    } catch (e) {
      console.error(`[Bot] <<< SEND FAILED:`, e);
    }
  }

  async sendToGroup(text: string): Promise<void> {
    console.log(`[Bot] sendToGroup ${this.groupId}`);
    try {
      await this.api.sendToChat(this.groupId, text);
      console.log(`[Bot] Sent to group OK`);
    } catch (e) {
      console.error(`[Bot] Send to group FAILED:`, e);
    }
  }

  private async sendMenu(userId: number): Promise<void> {
    await this.send(userId, '👋 PamPin - бот-напоминалка\n\n/add - добавить напоминание\n/list - список', [
      [callbackButton('➕ Добавить', 'add')],
      [callbackButton('📋 Список', 'list')]
    ]);
  }

  private async onMessage(msg: Message): Promise<void> {
    const userId = msg.sender?.user_id;
    const text = msg.body?.text;

    console.log(`[Bot] MSG: userId=${userId} text="${text}"`);

    if (!text || !userId) {
      console.log(`[Bot] Skipping - no text or userId`);
      return;
    }

    // Команды
    if (text === '/start') { 
      await this.sendMenu(userId); 
      return; 
    }
    if (text === '/list') { 
      await this.showList(userId); 
      return; 
    }
    if (text === '/add') { 
      await this.startAdd(userId); 
      return; 
    }

    // Получаем сессию
    const sess = getUserSession(userId, userId);
    console.log(`[Bot] SESSION: state="${sess.state}" data=`, JSON.stringify(sess.data));

    // Обработка по состоянию
    if (sess.state === 'title') {
      console.log(`[Bot] -> Processing as TITLE`);
      await this.processTitle(userId, text, sess);
    } else if (sess.state === 'date') {
      console.log(`[Bot] -> Processing as DATE`);
      await this.processDate(userId, text, sess);
    } else if (sess.state === 'time') {
      console.log(`[Bot] -> Processing as TIME`);
      await this.processTime(userId, text, sess);
    } else {
      console.log(`[Bot] -> Unknown state, showing menu`);
      await this.sendMenu(userId);
    }
  }

  private async onCallback(cb: MessageCallback): Promise<void> {
    const userId = cb.user?.user_id;
    const payload = cb.payload;

    console.log(`[Bot] CALLBACK: userId=${userId} payload="${payload}"`);

    if (!userId) return;

    // Отвечаем на callback
    try {
      await this.api.answerCallback(cb.callback_id);
    } catch (e) {
      console.error(`[Bot] answerCallback error:`, e);
    }

    // Обработка периодов напоминания (period:VALUE)
    if (payload.startsWith('period:')) {
      const periodValue = parseInt(payload.split(':')[1]);
      await this.processPeriod(userId, periodValue);
      return;
    }

    // Обработка
    if (payload === 'add') {
      await this.startAdd(userId);
    } else if (payload === 'list') {
      await this.showList(userId);
    } else if (payload === 'cancel') {
      clearUserSession(userId, userId);
      await this.sendMenu(userId);
    } else if (payload === 'confirm') {
      await this.doCreate(userId);
    } else if (payload.startsWith('del:')) {
      const id = payload.split(':')[1];
      deleteReminder(id);
      await this.send(userId, '✅ Напоминание удалено');
    }
  }

  // === СОЗДАНИЕ НАПОМИНАНИЯ ===

  private async startAdd(userId: number): Promise<void> {
    console.log(`[Bot] startAdd: setting state=title for userId=${userId}`);
    
    updateUserSession(userId, userId, { 
      state: 'title', 
      data: {} 
    });
    
    await this.send(userId, '📝 Введите название напоминания:', [
      [callbackButton('❌ Отмена', 'cancel')]
    ]);
  }

  private async processTitle(userId: number, text: string, sess: any): Promise<void> {
    if (text.length < 2) {
      await this.send(userId, 'Слишком коротко. Введите название:');
      return;
    }
    
    console.log(`[Bot] processTitle: "${text}" -> setting state=date`);
    
    const newData = { ...sess.data, title: text };
    updateUserSession(userId, userId, { state: 'date', data: newData });
    
    await this.send(userId, `✅ "${text}"\n\n📅 Введите дату события (например: 25.12.2025):`, [
      [callbackButton('❌ Отмена', 'cancel')]
    ]);
  }

  private async processDate(userId: number, text: string, sess: any): Promise<void> {
    const date = parseDate(text, 'Europe/Moscow');
    
    if (!date) {
      await this.send(userId, '❌ Не понял дату. Напишите: 25.12.2025');
      return;
    }
    
    console.log(`[Bot] processDate: ${text} -> setting state=time`);
    
    const newData = { ...sess.data, date: toISODateString(date) };
    updateUserSession(userId, userId, { state: 'time', data: newData });
    
    await this.send(userId, `✅ ${formatDate(date, 'long')}\n\n🕐 Введите время события (например: 14:30) или напишите "нет":`, [
      [callbackButton('❌ Отмена', 'cancel')]
    ]);
  }

  private async processTime(userId: number, text: string, sess: any): Promise<void> {
    let time = '';
    
    if (text.toLowerCase() !== 'нет' && text.toLowerCase() !== 'skip') {
      const parsed = parseTime(text);
      if (!parsed) {
        await this.send(userId, '❌ Не понял время. Напишите: 14:30 или "нет"');
        return;
      }
      time = `${parsed.hours.toString().padStart(2, '0')}:${parsed.minutes.toString().padStart(2, '0')}`;
    }
    
    console.log(`[Bot] processTime: ${time || 'no time'} -> asking for period`);
    
    const newData = { ...sess.data, time };
    updateUserSession(userId, userId, { state: 'period', data: newData });
    
    // Спрашиваем за сколько напомнить
    await this.send(userId, '⏰ За сколько напомнить?', [
      [
        callbackButton('3 месяца', 'period:7776000000'),
        callbackButton('1 месяц', 'period:2592000000')
      ],
      [
        callbackButton('1 неделя', 'period:604800000'),
        callbackButton('1 день', 'period:86400000')
      ],
      [
        callbackButton('1 час', 'period:3600000')
      ],
      [callbackButton('❌ Отмена', 'cancel')]
    ]);
  }

  private async processPeriod(userId: number, periodMs: number): Promise<void> {
    const sess = getUserSession(userId, userId);
    const d = sess.data;
    
    console.log(`[Bot] processPeriod: ${periodMs}ms -> showing confirmation`);
    
    // Находим название периода
    const periodLabel = REMINDER_PERIODS.find(p => p.value === periodMs)?.label || 'выбранное время';
    
    const newData = { ...d, period: periodMs };
    updateUserSession(userId, userId, { state: 'confirm', data: newData });
    
    const dateStr = d.date ? formatDate(new Date(d.date), 'long') : 'дата не указана';
    const timeStr = d.time ? ` в ${d.time}` : '';
    const titleStr = d.title || 'без названия';
    
    await this.send(userId, 
      `📋 Проверка:\n\n` +
      `📌 ${titleStr}\n` +
      `📅 ${dateStr}${timeStr}\n` +
      `⏰ Напомнить ${periodLabel}\n\n` +
      `Создать напоминание?`, 
      [
        [callbackButton('✅ Создать', 'confirm')],
        [callbackButton('❌ Отмена', 'cancel')]
      ]
    );
  }

  private async doCreate(userId: number): Promise<void> {
    const sess = getUserSession(userId, userId);
    const d = sess.data;

    console.log(`[Bot] doCreate: data=`, JSON.stringify(d));

    if (!d.title || !d.date) {
      await this.send(userId, '❌ Ошибка. Попробуйте /add');
      return;
    }

    // Если период не выбран - ставим 1 день по умолчанию
    const period = d.period || 86400000;

    createReminder({
      user_id: userId,
      chat_id: userId,
      title: d.title,
      event_date: d.date,
      event_time: d.time,
      timezone: 'Europe/Moscow',
      reminder_periods: [period],
      repeat_yearly: false,
      is_active: true
    });

    clearUserSession(userId, userId);
    
    // Находим название периода
    const periodLabel = REMINDER_PERIODS.find(p => p.value === period)?.label || 'за 1 день';
    
    // В группу
    await this.sendToGroup(
      `🆕 Новое напоминание:\n` +
      `📌 ${d.title}\n` +
      `📅 ${formatDate(new Date(d.date), 'long')}\n` +
      `⏰ Напомнить ${periodLabel}`
    );
    
    await this.send(userId, `✅ Напоминание "${d.title}" создано!\n\nНапомню ${periodLabel}`, [
      [callbackButton('📋 Список', 'list')],
      [callbackButton('➕ Ещё', 'add')]
    ]);
  }

  private async showList(userId: number): Promise<void> {
    const list = getRemindersByUser(userId, userId);
    
    console.log(`[Bot] showList: ${list.length} reminders`);
    
    if (!list.length) {
      await this.send(userId, '📭 Напоминаний нет', [
        [callbackButton('➕ Создать', 'add')]
      ]);
      return;
    }

    let txt = '📋 Ваши напоминания:\n\n';
    list.forEach((r, i) => {
      const periodLabel = REMINDER_PERIODS.find(p => p.value === r.reminder_periods[0])?.label || 'за 1 день';
      txt += `${i + 1}. ${r.title}\n   📅 ${formatDate(new Date(r.event_date), 'short')} (${periodLabel})\n`;
    });

    const btns: InlineKeyboardButton[][] = list.map(r => [
      callbackButton(`🗑 ${r.title.substring(0, 15)}${r.title.length > 15 ? '...' : ''}`, `del:${r.id}`)
    ]);
    btns.push([callbackButton('➕ Добавить', 'add')]);
    
    await this.send(userId, txt, btns);
  }
}
