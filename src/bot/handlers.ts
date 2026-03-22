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
  return msg.recipient?.chat_id || 0;
}

function getChatType(msg: Message): string {
  return msg.recipient?.chat_type || 'dialog';
}

function getText(msg: Message): string | undefined {
  return msg.body?.text;
}

function getUserId(msg: Message): number {
  return msg.sender?.user_id || 0;
}

// Куда отправлять ответ: для диалога - user_id, для чата - chat_id
function getReplyTarget(msg: Message): { id: number; type: 'user_id' | 'chat_id' } {
  const chatType = getChatType(msg);
  const userId = getUserId(msg);
  const chatId = getChatId(msg);
  
  if (chatType === 'dialog') {
    // В личном диалоге отвечаем на user_id отправителя
    return { id: userId, type: 'user_id' };
  } else {
    // В групповом чате отвечаем на chat_id
    return { id: chatId, type: 'chat_id' };
  }
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
        // bot_started приходит с user_id и chat_id в самом update
        const userId = update.user?.user_id || update.user_id;
        const chatId = update.chat_id;
        if (userId) {
          await this.sendMenu(userId, 'user_id');
        } else if (chatId) {
          await this.sendMenu(chatId, 'chat_id');
        }
      }
    } catch (e) {
      console.error('[Bot] Error:', e);
    }
  }

  private async send(targetId: number, targetType: 'user_id' | 'chat_id', text: string, buttons?: InlineKeyboardButton[][]): Promise<void> {
    console.log(`[Bot] Send to ${targetType}=${targetId}: ${text.substring(0, 30)}...`);
    try {
      const body: any = {
        body: { text, format: 'plain' }
      };
      
      // Ключевое различие: user_id для диалогов, chat_id для чатов
      if (targetType === 'user_id') {
        body.user_id = targetId;
      } else {
        body.chat_id = targetId;
      }
      
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

  private async sendMenu(targetId: number, targetType: 'user_id' | 'chat_id'): Promise<void> {
    await this.send(targetId, targetType, '👋 PamPin\n\n/add - добавить\n/list - список', [
      [callbackButton('➕ Добавить', 'add')],
      [callbackButton('📋 Список', 'list')]
    ]);
  }

  private async onMessage(msg: Message): Promise<void> {
    const uid = getUserId(msg);
    const cid = getChatId(msg);
    const txt = getText(msg);
    const target = getReplyTarget(msg);
    const chatType = getChatType(msg);

    console.log(`[Bot] Msg: uid=${uid} cid=${cid} type=${chatType} target=${target.type}=${target.id} txt="${txt?.substring(0, 20)}"`);

    if (!txt || !uid) return;

    // Сохраняем target в сессии для последующих ответов
    const sessionTarget = { targetId: target.id, targetType: target.type };

    if (txt === '/start') { 
      await this.sendMenu(target.id, target.type); 
      return; 
    }
    if (txt === '/list') { 
      await this.showList(uid, cid, target.id, target.type); 
      return; 
    }
    if (txt === '/add') { 
      await this.startAdd(uid, cid, target.id, target.type); 
      return; 
    }

    const sess = getUserSession(uid, cid);
    console.log(`[Bot] Session state: ${sess.state}`);

    // Получаем сохраненный target из сессии или используем текущий
    const t = sess.data.targetId ? 
      { id: sess.data.targetId, type: sess.data.targetType as 'user_id' | 'chat_id' } : 
      target;

    if (sess.state === 'title') {
      await this.setTitle(uid, cid, txt, sess, t.id, t.type);
    } else if (sess.state === 'date') {
      await this.setDate(uid, cid, txt, sess, t.id, t.type);
    } else if (sess.state === 'time') {
      await this.setTime(uid, cid, txt, sess, t.id, t.type);
    } else {
      await this.sendMenu(target.id, target.type);
    }
  }

  private async onCallback(cb: MessageCallback): Promise<void> {
    const uid = cb.user?.user_id;
    const cid = cb.chat_id;
    const pl = cb.payload;

    console.log(`[Bot] Callback: ${pl}`);

    // Для callback в личке chat_id - это chat_id диалога, нужно отвечать на user_id
    const targetType: 'user_id' | 'chat_id' = 'user_id';
    const targetId = uid || 0;

    if (!uid) return;

    try { await this.api.answerCallback(cb.callback_id); } catch {}

    if (pl === 'add') await this.startAdd(uid, cid, targetId, targetType);
    else if (pl === 'list') await this.showList(uid, cid, targetId, targetType);
    else if (pl === 'cancel') { 
      clearUserSession(uid, cid); 
      await this.sendMenu(targetId, targetType); 
    }
    else if (pl === 'confirm') await this.doCreate(uid, cid, targetId, targetType);
    else if (pl.startsWith('del:')) { 
      deleteReminder(pl.split(':')[1]); 
      await this.send(targetId, targetType, '✅ Удалено'); 
    }
  }

  private async startAdd(uid: number, cid: number, targetId: number, targetType: 'user_id' | 'chat_id'): Promise<void> {
    updateUserSession(uid, cid, { 
      state: 'title', 
      data: { targetId, targetType } 
    });
    await this.send(targetId, targetType, '📝 Название:', [[callbackButton('❌', 'cancel')]]);
  }

  private async setTitle(uid: number, cid: number, txt: string, sess: any, targetId: number, targetType: 'user_id' | 'chat_id'): Promise<void> {
    if (txt.length < 2) { await this.send(targetId, targetType, 'Коротко. Ещё:'); return; }
    updateUserSession(uid, cid, { state: 'date', data: { ...sess.data, title: txt } });
    await this.send(targetId, targetType, `✅ ${txt}\n\n📅 Дата (25.12.2025):`, [[callbackButton('❌', 'cancel')]]);
  }

  private async setDate(uid: number, cid: number, txt: string, sess: any, targetId: number, targetType: 'user_id' | 'chat_id'): Promise<void> {
    const d = parseDate(txt, 'Europe/Moscow');
    if (!d) { await this.send(targetId, targetType, 'Не понял. Напишите: 25.12.2025'); return; }
    updateUserSession(uid, cid, { state: 'time', data: { ...sess.data, date: toISODateString(d) } });
    await this.send(targetId, targetType, `✅ ${formatDate(d, 'long')}\n\n🕐 Время (14:30) или "нет":`, [[callbackButton('❌', 'cancel')]]);
  }

  private async setTime(uid: number, cid: number, txt: string, sess: any, targetId: number, targetType: 'user_id' | 'chat_id'): Promise<void> {
    let time = '';
    if (txt.toLowerCase() !== 'нет' && txt.toLowerCase() !== 'skip') {
      const p = parseTime(txt);
      if (!p) { await this.send(targetId, targetType, 'Не понял. Напишите: 14:30 или "нет"'); return; }
      time = `${p.hours.toString().padStart(2,'0')}:${p.minutes.toString().padStart(2,'0')}`;
    }
    
    updateUserSession(uid, cid, { state: 'idle', data: { ...sess.data, time } });
    
    const d = sess.data;
    await this.send(targetId, targetType, `📋 Проверка:\n\n📌 ${d.title}\n📅 ${formatDate(new Date(d.date), 'long')}${time ? ` в ${time}` : ''}\n\nСоздать?`, [
      [callbackButton('✅ Создать', 'confirm')],
      [callbackButton('❌', 'cancel')]
    ]);
  }

  private async doCreate(uid: number, cid: number, targetId: number, targetType: 'user_id' | 'chat_id'): Promise<void> {
    const sess = getUserSession(uid, cid);
    const d = sess.data;

    if (!d.title || !d.date) { await this.send(targetId, targetType, 'Ошибка'); return; }

    createReminder({
      user_id: uid, chat_id: cid, title: d.title, event_date: d.date, event_time: d.time,
      timezone: 'Europe/Moscow', reminder_periods: [86400000], repeat_yearly: false, is_active: true
    });

    clearUserSession(uid, cid);
    await this.send(targetId, targetType, `✅ "${d.title}" создано!`, [[callbackButton('📋 Список', 'list')], [callbackButton('➕ Ещё', 'add')]]);
  }

  private async showList(uid: number, cid: number, targetId: number, targetType: 'user_id' | 'chat_id'): Promise<void> {
    const list = getRemindersByUser(uid, cid);
    if (!list.length) { await this.send(targetId, targetType, '📭 Пусто', [[callbackButton('➕', 'add')]]); return; }

    let txt = '📋:\n\n';
    list.slice(0, 5).forEach((r, i) => { txt += `${i + 1}. ${r.title}\n   ${formatDate(new Date(r.event_date), 'short')}\n`; });

    const btns: InlineKeyboardButton[][] = list.slice(0, 5).map(r => [callbackButton(`🗑 ${r.title}`, `del:${r.id}`)]);
    btns.push([callbackButton('➕', 'add')]);
    await this.send(targetId, targetType, txt, btns);
  }
}
