import { MaxApi, callbackButton, getMaxApi } from './maxApi';
import { Update, Message, MessageCallback, InlineKeyboardButton } from '../types/max-api';
import { Reminder } from '../types';
import {
  getRemindersByUser,
  createReminder,
  deleteReminder,
  getUserSession,
  updateUserSession,
  clearUserSession
} from '../db/database';
import { parseDate, parseTime, formatDate, toISODateString } from '../utils/dateUtils';

export class PamPinBot {
  private api: MaxApi;
  private groupId: number;

  constructor(token: string, groupId: number) {
    this.api = new MaxApi(token);
    this.groupId = groupId;
    console.log(`[Bot] Ready, groupId=${groupId}`);
  }

  async processUpdate(update: Update): Promise<void> {
    console.log(`[Bot] Update: ${update.update_type}`, JSON.stringify(update).substring(0, 300));
    
    try {
      if (update.update_type === 'message_created' && update.message) {
        await this.onMessage(update.message);
      } else if (update.update_type === 'message_callback' && update.message_callback) {
        await this.onCallback(update.message_callback);
      } else if (update.update_type === 'bot_started') {
        // bot_started приходит с user_id в update.user
        const userId = update.user?.user_id;
        console.log(`[Bot] bot_started from user_id=${userId}`);
        if (userId) {
          await this.sendMenu(userId);
        }
      }
    } catch (e) {
      console.error('[Bot] Error:', e);
    }
  }

  // Отправка в личку пользователю
  private async sendToUser(userId: number, text: string, buttons?: InlineKeyboardButton[][]): Promise<void> {
    console.log(`[Bot] sendToUser userId=${userId}`);
    try {
      await this.api.sendToUser(userId, text, buttons);
      console.log(`[Bot] Sent OK`);
    } catch (e) {
      console.error(`[Bot] Send FAILED:`, e);
    }
  }

  // Отправка в групповой чат
  async sendToGroup(text: string): Promise<void> {
    console.log(`[Bot] sendToGroup chatId=${this.groupId}`);
    try {
      await this.api.sendToChat(this.groupId, text);
      console.log(`[Bot] Sent to group OK`);
    } catch (e) {
      console.error(`[Bot] Send to group FAILED:`, e);
    }
  }

  private async sendMenu(userId: number): Promise<void> {
    await this.sendToUser(userId, '👋 PamPin\n\n/add - добавить напоминание\n/list - список', [
      [callbackButton('➕ Добавить', 'add')],
      [callbackButton('📋 Список', 'list')]
    ]);
  }

  private async onMessage(msg: Message): Promise<void> {
    const userId = msg.sender?.user_id;
    const chatId = msg.recipient?.chat_id;
    const text = msg.body?.text;

    console.log(`[Bot] Msg: userId=${userId} chatId=${chatId} text="${text?.substring(0, 30)}"`);

    if (!text || !userId) return;

    // Используем user_id для сессии и ответов
    const sessionId = userId; 

    if (text === '/start') { 
      await this.sendMenu(userId); 
      return; 
    }
    if (text === '/list') { 
      await this.showList(userId, sessionId); 
      return; 
    }
    if (text === '/add') { 
      await this.startAdd(userId, sessionId); 
      return; 
    }

    const sess = getUserSession(userId, sessionId);
    console.log(`[Bot] Session state: ${sess.state}`);

    if (sess.state === 'title') {
      await this.setTitle(userId, sessionId, text, sess);
    } else if (sess.state === 'date') {
      await this.setDate(userId, sessionId, text, sess);
    } else if (sess.state === 'time') {
      await this.setTime(userId, sessionId, text, sess);
    } else {
      await this.sendMenu(userId);
    }
  }

  private async onCallback(cb: MessageCallback): Promise<void> {
    const userId = cb.user?.user_id;
    const payload = cb.payload;

    console.log(`[Bot] Callback: ${payload} userId=${userId}`);

    if (!userId) return;

    try { await this.api.answerCallback(cb.callback_id); } catch {}

    const sessionId = userId;

    if (payload === 'add') await this.startAdd(userId, sessionId);
    else if (payload === 'list') await this.showList(userId, sessionId);
    else if (payload === 'cancel') { 
      clearUserSession(userId, sessionId); 
      await this.sendMenu(userId); 
    }
    else if (payload === 'confirm') await this.doCreate(userId, sessionId);
    else if (payload.startsWith('del:')) { 
      deleteReminder(payload.split(':')[1]); 
      await this.sendToUser(userId, '✅ Удалено'); 
    }
  }

  private async startAdd(userId: number, sessionId: number): Promise<void> {
    updateUserSession(userId, sessionId, { state: 'title', data: {} });
    await this.sendToUser(userId, '📝 Введите название:', [[callbackButton('❌ Отмена', 'cancel')]]);
  }

  private async setTitle(userId: number, sessionId: number, text: string, sess: any): Promise<void> {
    if (text.length < 2) { await this.sendToUser(userId, 'Слишком коротко. Введите название:'); return; }
    updateUserSession(userId, sessionId, { state: 'date', data: { ...sess.data, title: text } });
    await this.sendToUser(userId, `✅ ${text}\n\n📅 Введите дату (например: 25.12.2025):`, [[callbackButton('❌ Отмена', 'cancel')]]);
  }

  private async setDate(userId: number, sessionId: number, text: string, sess: any): Promise<void> {
    const date = parseDate(text, 'Europe/Moscow');
    if (!date) { await this.sendToUser(userId, 'Не понял дату. Напишите: 25.12.2025'); return; }
    updateUserSession(userId, sessionId, { state: 'time', data: { ...sess.data, date: toISODateString(date) } });
    await this.sendToUser(userId, `✅ ${formatDate(date, 'long')}\n\n🕐 Введите время (например: 14:30) или "нет":`, [[callbackButton('❌ Отмена', 'cancel')]]);
  }

  private async setTime(userId: number, sessionId: number, text: string, sess: any): Promise<void> {
    let time = '';
    if (text.toLowerCase() !== 'нет' && text.toLowerCase() !== 'skip') {
      const parsed = parseTime(text);
      if (!parsed) { await this.sendToUser(userId, 'Не понял время. Напишите: 14:30 или "нет"'); return; }
      time = `${parsed.hours.toString().padStart(2,'0')}:${parsed.minutes.toString().padStart(2,'0')}`;
    }
    
    updateUserSession(userId, sessionId, { state: 'idle', data: { ...sess.data, time } });
    
    const d = sess.data;
    await this.sendToUser(userId, `📋 Проверка:\n\n📌 ${d.title}\n📅 ${formatDate(new Date(d.date), 'long')}${time ? ` в ${time}` : ''}\n\nСоздать напоминание?`, [
      [callbackButton('✅ Создать', 'confirm')],
      [callbackButton('❌ Отмена', 'cancel')]
    ]);
  }

  private async doCreate(userId: number, sessionId: number): Promise<void> {
    const sess = getUserSession(userId, sessionId);
    const d = sess.data;

    if (!d.title || !d.date) { await this.sendToUser(userId, 'Ошибка создания'); return; }

    createReminder({
      user_id: userId, 
      chat_id: sessionId, 
      title: d.title, 
      event_date: d.date, 
      event_time: d.time,
      timezone: 'Europe/Moscow', 
      reminder_periods: [86400000], 
      repeat_yearly: false, 
      is_active: true
    });

    clearUserSession(userId, sessionId);
    await this.sendToUser(userId, `✅ "${d.title}" создано!`, [
      [callbackButton('📋 Список', 'list')], 
      [callbackButton('➕ Ещё', 'add')]
    ]);
  }

  private async showList(userId: number, sessionId: number): Promise<void> {
    const list = getRemindersByUser(userId, sessionId);
    if (!list.length) { 
      await this.sendToUser(userId, '📭 Напоминаний нет', [[callbackButton('➕ Создать', 'add')]]); 
      return; 
    }

    let txt = '📋 Ваши напоминания:\n\n';
    list.slice(0, 5).forEach((r, i) => { 
      txt += `${i + 1}. ${r.title}\n   📅 ${formatDate(new Date(r.event_date), 'short')}\n`; 
    });

    const btns: InlineKeyboardButton[][] = list.slice(0, 5).map(r => [callbackButton(`🗑 ${r.title}`, `del:${r.id}`)]);
    btns.push([callbackButton('➕ Добавить', 'add')]);
    await this.sendToUser(userId, txt, btns);
  }
}
