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

function getChatId(msg: Message): number {
  // chat_id из recipient - это ID диалога (личного или группового)
  return msg.recipient?.chat_id || 0;
}

function getText(msg: Message): string | undefined {
  return msg.body?.text;
}

function getUserId(msg: Message): number {
  return msg.sender?.user_id || 0;
}

export class PamPinBot {
  private api: MaxApi;
  private groupId: number;

  constructor(token: string, groupId: number) {
    this.api = new MaxApi(token);
    this.groupId = groupId;
    console.log(`[Bot] Ready`);
  }

  async processUpdate(update: Update): Promise<void> {
    console.log(`[Bot] Update: ${update.update_type}`);
    
    try {
      if (update.update_type === 'message_created' && update.message) {
        await this.onMessage(update.message);
      } else if (update.update_type === 'message_callback' && update.message_callback) {
        await this.onCallback(update.message_callback);
      } else if (update.update_type === 'bot_started') {
        // bot_started приходит напрямую с chat_id
        const chatId = update.chat_id;
        if (chatId) {
          await this.sendMenu(chatId);
        }
      }
    } catch (e) {
      console.error('[Bot] Error:', e);
    }
  }

  private async send(chatId: number, text: string, buttons?: InlineKeyboardButton[][]): Promise<void> {
    console.log(`[Bot] Send to chat_id=${chatId}: ${text.substring(0, 30)}...`);
    try {
      const body: any = {
        chat_id: chatId,
        body: { text, format: 'plain' }
      };
      
      if (buttons?.length) {
        body.body.attachments = [{
          type: 'inline_keyboard',
          payload: { buttons }
        }];
      }
      
      await this.api.requestRaw('POST', '/messages', body);
      console.log(`[Bot] Sent OK`);
    } catch (e) {
      console.error(`[Bot] Send FAILED:`, e);
    }
  }

  private async sendMenu(chatId: number): Promise<void> {
    await this.send(chatId, '👋 PamPin\n\n/add - добавить\n/list - список', [
      [callbackButton('➕ Добавить', 'add')],
      [callbackButton('📋 Список', 'list')]
    ]);
  }

  private async onMessage(msg: Message): Promise<void> {
    const uid = getUserId(msg);
    const cid = getChatId(msg);
    const txt = getText(msg);

    console.log(`[Bot] Msg: uid=${uid} chat_id=${cid} txt="${txt?.substring(0, 20)}"`);

    if (!txt || !uid || !cid) return;

    if (txt === '/start') { 
      await this.sendMenu(cid); 
      return; 
    }
    if (txt === '/list') { 
      await this.showList(uid, cid); 
      return; 
    }
    if (txt === '/add') { 
      await this.startAdd(uid, cid); 
      return; 
    }

    const sess = getUserSession(uid, cid);
    console.log(`[Bot] Session state: ${sess.state}`);

    if (sess.state === 'title') {
      await this.setTitle(uid, cid, txt, sess);
    } else if (sess.state === 'date') {
      await this.setDate(uid, cid, txt, sess);
    } else if (sess.state === 'time') {
      await this.setTime(uid, cid, txt, sess);
    } else {
      await this.sendMenu(cid);
    }
  }

  private async onCallback(cb: MessageCallback): Promise<void> {
    const uid = cb.user?.user_id;
    const cid = cb.chat_id;
    const pl = cb.payload;

    console.log(`[Bot] Callback: ${pl} chat_id=${cid}`);

    if (!cid || !uid) return;

    try { await this.api.answerCallback(cb.callback_id); } catch {}

    if (pl === 'add') await this.startAdd(uid, cid);
    else if (pl === 'list') await this.showList(uid, cid);
    else if (pl === 'cancel') { 
      clearUserSession(uid, cid); 
      await this.sendMenu(cid); 
    }
    else if (pl === 'confirm') await this.doCreate(uid, cid);
    else if (pl.startsWith('del:')) { 
      deleteReminder(pl.split(':')[1]); 
      await this.send(cid, '✅ Удалено'); 
    }
  }

  private async startAdd(uid: number, cid: number): Promise<void> {
    updateUserSession(uid, cid, { state: 'title', data: {} });
    await this.send(cid, '📝 Название:', [[callbackButton('❌', 'cancel')]]);
  }

  private async setTitle(uid: number, cid: number, txt: string, sess: any): Promise<void> {
    if (txt.length < 2) { await this.send(cid, 'Коротко. Ещё:'); return; }
    updateUserSession(uid, cid, { state: 'date', data: { ...sess.data, title: txt } });
    await this.send(cid, `✅ ${txt}\n\n📅 Дата (25.12.2025):`, [[callbackButton('❌', 'cancel')]]);
  }

  private async setDate(uid: number, cid: number, txt: string, sess: any): Promise<void> {
    const d = parseDate(txt, 'Europe/Moscow');
    if (!d) { await this.send(cid, 'Не понял. Напишите: 25.12.2025'); return; }
    updateUserSession(uid, cid, { state: 'time', data: { ...sess.data, date: toISODateString(d) } });
    await this.send(cid, `✅ ${formatDate(d, 'long')}\n\n🕐 Время (14:30) или "нет":`, [[callbackButton('❌', 'cancel')]]);
  }

  private async setTime(uid: number, cid: number, txt: string, sess: any): Promise<void> {
    let time = '';
    if (txt.toLowerCase() !== 'нет' && txt.toLowerCase() !== 'skip') {
      const p = parseTime(txt);
      if (!p) { await this.send(cid, 'Не понял. Напишите: 14:30 или "нет"'); return; }
      time = `${p.hours.toString().padStart(2,'0')}:${p.minutes.toString().padStart(2,'0')}`;
    }
    
    updateUserSession(uid, cid, { state: 'idle', data: { ...sess.data, time } });
    
    const d = sess.data;
    await this.send(cid, `📋 Проверка:\n\n📌 ${d.title}\n📅 ${formatDate(new Date(d.date), 'long')}${time ? ` в ${time}` : ''}\n\nСоздать?`, [
      [callbackButton('✅ Создать', 'confirm')],
      [callbackButton('❌', 'cancel')]
    ]);
  }

  private async doCreate(uid: number, cid: number): Promise<void> {
    const sess = getUserSession(uid, cid);
    const d = sess.data;

    if (!d.title || !d.date) { await this.send(cid, 'Ошибка'); return; }

    createReminder({
      user_id: uid, chat_id: cid, title: d.title, event_date: d.date, event_time: d.time,
      timezone: 'Europe/Moscow', reminder_periods: [86400000], repeat_yearly: false, is_active: true
    });

    clearUserSession(uid, cid);
    await this.send(cid, `✅ "${d.title}" создано!`, [[callbackButton('📋 Список', 'list')], [callbackButton('➕ Ещё', 'add')]]);
  }

  private async showList(uid: number, cid: number): Promise<void> {
    const list = getRemindersByUser(uid, cid);
    if (!list.length) { await this.send(cid, '📭 Пусто', [[callbackButton('➕', 'add')]]); return; }

    let txt = '📋:\n\n';
    list.slice(0, 5).forEach((r, i) => { txt += `${i + 1}. ${r.title}\n   ${formatDate(new Date(r.event_date), 'short')}\n`; });

    const btns: InlineKeyboardButton[][] = list.slice(0, 5).map(r => [callbackButton(`🗑 ${r.title}`, `del:${r.id}`)]);
    btns.push([callbackButton('➕', 'add')]);
    await this.send(cid, txt, btns);
  }
}
