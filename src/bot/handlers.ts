import { MaxApi, callbackButton } from './maxApi';
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
        const chatId = update.chat_id;
        console.log(`[Bot] bot_started chat_id=${chatId}`);
        if (chatId) {
          await this.sendMenu(chatId);
        }
      }
    } catch (e) {
      console.error('[Bot] Error:', e);
    }
  }

  private async send(chatId: number, text: string, buttons?: InlineKeyboardButton[][]): Promise<void> {
    console.log(`[Bot] send to chatId=${chatId}`);
    try {
      await this.api.sendToChat(chatId, text, buttons);
      console.log(`[Bot] Sent OK`);
    } catch (e) {
      console.error(`[Bot] Send FAILED:`, e);
    }
  }

  async sendToGroup(text: string): Promise<void> {
    console.log(`[Bot] sendToGroup chatId=${this.groupId}`);
    try {
      await this.api.sendToChat(this.groupId, text);
      console.log(`[Bot] Sent to group OK`);
    } catch (e) {
      console.error(`[Bot] Send to group FAILED:`, e);
    }
  }

  private async sendMenu(chatId: number): Promise<void> {
    await this.send(chatId, '👋 PamPin\n\n/add - добавить напоминание\n/list - список', [
      [callbackButton('➕ Добавить', 'add')],
      [callbackButton('📋 Список', 'list')]
    ]);
  }

  private async onMessage(msg: Message): Promise<void> {
    const userId = msg.sender?.user_id;
    const chatId = msg.recipient?.chat_id;
    const text = msg.body?.text;

    console.log(`[Bot] Msg: userId=${userId} chatId=${chatId} text="${text?.substring(0, 30)}"`);

    if (!text || !userId || !chatId) return;

    if (text === '/start') { 
      await this.sendMenu(chatId);
      return; 
    }
    if (text === '/list') { 
      await this.showList(userId, chatId); 
      return; 
    }
    if (text === '/add') { 
      await this.startAdd(userId, chatId); 
      return; 
    }

    const sess = getUserSession(userId, chatId);
    console.log(`[Bot] Session state: ${sess.state}`);

    if (sess.state === 'title') {
      await this.setTitle(userId, chatId, text, sess);
    } else if (sess.state === 'date') {
      await this.setDate(userId, chatId, text, sess);
    } else if (sess.state === 'time') {
      await this.setTime(userId, chatId, text, sess);
    } else {
      await this.sendMenu(chatId);
    }
  }

  private async onCallback(cb: MessageCallback): Promise<void> {
    const userId = cb.user?.user_id;
    const chatId = cb.chat_id;
    const payload = cb.payload;

    console.log(`[Bot] Callback: ${payload} userId=${userId} chatId=${chatId}`);

    if (!userId || !chatId) return;

    try { await this.api.answerCallback(cb.callback_id); } catch {}

    if (payload === 'add') await this.startAdd(userId, chatId);
    else if (payload === 'list') await this.showList(userId, chatId);
    else if (payload === 'cancel') { 
      clearUserSession(userId, chatId); 
      await this.sendMenu(chatId); 
    }
    else if (payload === 'confirm') await this.doCreate(userId, chatId);
    else if (payload.startsWith('del:')) { 
      deleteReminder(payload.split(':')[1]); 
      await this.send(chatId, '✅ Удалено'); 
    }
  }

  private async startAdd(userId: number, chatId: number): Promise<void> {
    updateUserSession(userId, chatId, { state: 'title', data: {} });
    await this.send(chatId, '📝 Введите название:', [[callbackButton('❌ Отмена', 'cancel')]]);
  }

  private async setTitle(userId: number, chatId: number, text: string, sess: any): Promise<void> {
    if (text.length < 2) { await this.send(chatId, 'Слишком коротко. Введите название:'); return; }
    updateUserSession(userId, chatId, { state: 'date', data: { ...sess.data, title: text } });
    await this.send(chatId, `✅ ${text}\n\n📅 Введите дату (например: 25.12.2025):`, [[callbackButton('❌ Отмена', 'cancel')]]);
  }

  private async setDate(userId: number, chatId: number, text: string, sess: any): Promise<void> {
    const date = parseDate(text, 'Europe/Moscow');
    if (!date) { await this.send(chatId, 'Не понял дату. Напишите: 25.12.2025'); return; }
    updateUserSession(userId, chatId, { state: 'time', data: { ...sess.data, date: toISODateString(date) } });
    await this.send(chatId, `✅ ${formatDate(date, 'long')}\n\n🕐 Введите время (например: 14:30) или "нет":`, [[callbackButton('❌ Отмена', 'cancel')]]);
  }

  private async setTime(userId: number, chatId: number, text: string, sess: any): Promise<void> {
    let time = '';
    if (text.toLowerCase() !== 'нет' && text.toLowerCase() !== 'skip') {
      const parsed = parseTime(text);
      if (!parsed) { await this.send(chatId, 'Не понял время. Напишите: 14:30 или "нет"'); return; }
      time = `${parsed.hours.toString().padStart(2,'0')}:${parsed.minutes.toString().padStart(2,'0')}`;
    }
    
    updateUserSession(userId, chatId, { state: 'idle', data: { ...sess.data, time } });
    
    const d = sess.data;
    await this.send(chatId, `📋 Проверка:\n\n📌 ${d.title}\n📅 ${formatDate(new Date(d.date), 'long')}${time ? ` в ${time}` : ''}\n\nСоздать?`, [
      [callbackButton('✅ Создать', 'confirm')],
      [callbackButton('❌ Отмена', 'cancel')]
    ]);
  }

  private async doCreate(userId: number, chatId: number): Promise<void> {
    const sess = getUserSession(userId, chatId);
    const d = sess.data;

    if (!d.title || !d.date) { await this.send(chatId, 'Ошибка создания'); return; }

    createReminder({
      user_id: userId, 
      chat_id: chatId, 
      title: d.title, 
      event_date: d.date, 
      event_time: d.time,
      timezone: 'Europe/Moscow', 
      reminder_periods: [86400000], 
      repeat_yearly: false, 
      is_active: true
    });

    clearUserSession(userId, chatId);
    await this.send(chatId, `✅ "${d.title}" создано!`, [
      [callbackButton('📋 Список', 'list')], 
      [callbackButton('➕ Ещё', 'add')]
    ]);
  }

  private async showList(userId: number, chatId: number): Promise<void> {
    const list = getRemindersByUser(userId, chatId);
    if (!list.length) { 
      await this.send(chatId, '📭 Напоминаний нет', [[callbackButton('➕ Создать', 'add')]]); 
      return; 
    }

    let txt = '📋 Ваши напоминания:\n\n';
    list.slice(0, 5).forEach((r, i) => { 
      txt += `${i + 1}. ${r.title}\n   📅 ${formatDate(new Date(r.event_date), 'short')}\n`; 
    });

    const btns: InlineKeyboardButton[][] = list.slice(0, 5).map(r => [callbackButton(`🗑 ${r.title}`, `del:${r.id}`)]);
    btns.push([callbackButton('➕ Добавить', 'add')]);
    await this.send(chatId, txt, btns);
  }
}
