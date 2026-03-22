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

export class PamPinBot {
  private api: MaxApi;
  private groupId: number;

  constructor(token: string, groupId: number) {
    this.api = new MaxApi(token);
    this.groupId = groupId;
    console.log(`[Bot] Ready, groupId=${groupId}`);
  }

  async processUpdate(update: Update): Promise<void> {
    console.log(`[Bot] Update: ${update.update_type}`, JSON.stringify(update).substring(0, 500));
    
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
    console.log(`[Bot] send to userId=${userId}: ${text.substring(0, 30)}...`);
    try {
      await this.api.sendToUser(userId, text, buttons);
      console.log(`[Bot] Sent OK`);
    } catch (e) {
      console.error(`[Bot] Send FAILED:`, e);
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
    await this.send(userId, '👋 PamPin - бот-напоминалка\n\n/add - добавить напоминание\n/list - список напоминаний', [
      [callbackButton('➕ Добавить', 'add')],
      [callbackButton('📋 Список', 'list')]
    ]);
  }

  private async onMessage(msg: Message): Promise<void> {
    const userId = msg.sender?.user_id;
    const text = msg.body?.text;

    console.log(`[Bot] Msg: userId=${userId} text="${text}"`);

    if (!text || !userId) return;

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

    console.log(`[Bot] ========== CALLBACK ==========`);
    console.log(`[Bot] payload: "${payload}"`);
    console.log(`[Bot] userId: ${userId}`);
    console.log(`[Bot] callback_id: ${cb.callback_id}`);
    console.log(`[Bot] Full callback:`, JSON.stringify(cb).substring(0, 300));

    if (!userId) {
      console.log(`[Bot] No userId in callback, skipping`);
      return;
    }

    // Сначала отвечаем на callback
    try {
      await this.api.answerCallback(cb.callback_id);
      console.log(`[Bot] Callback answered`);
    } catch (e) {
      console.error(`[Bot] Failed to answer callback:`, e);
    }

    const sessionId = userId;

    // Обрабатываем payload
    if (payload === 'add') {
      console.log(`[Bot] Processing: add`);
      await this.startAdd(userId, sessionId);
    } else if (payload === 'list') {
      console.log(`[Bot] Processing: list`);
      await this.showList(userId, sessionId);
    } else if (payload === 'cancel') {
      console.log(`[Bot] Processing: cancel`);
      clearUserSession(userId, sessionId); 
      await this.sendMenu(userId);
    } else if (payload === 'confirm') {
      console.log(`[Bot] Processing: confirm`);
      await this.doCreate(userId, sessionId);
    } else if (payload.startsWith('del:')) {
      console.log(`[Bot] Processing: delete`);
      const reminderId = payload.split(':')[1];
      deleteReminder(reminderId); 
      await this.send(userId, '✅ Напоминание удалено');
    } else {
      console.log(`[Bot] Unknown payload: ${payload}`);
    }
  }

  private async startAdd(userId: number, sessionId: number): Promise<void> {
    console.log(`[Bot] startAdd for userId=${userId}`);
    updateUserSession(userId, sessionId, { state: 'title', data: {} });
    await this.send(userId, '📝 Введите название напоминания:', [
      [callbackButton('❌ Отмена', 'cancel')]
    ]);
  }

  private async setTitle(userId: number, sessionId: number, text: string, sess: any): Promise<void> {
    if (text.length < 2) { 
      await this.send(userId, 'Слишком коротко. Введите название:'); 
      return; 
    }
    updateUserSession(userId, sessionId, { state: 'date', data: { ...sess.data, title: text } });
    await this.send(userId, `✅ "${text}"\n\n📅 Введите дату (например: 25.12.2025):`, [
      [callbackButton('❌ Отмена', 'cancel')]
    ]);
  }

  private async setDate(userId: number, sessionId: number, text: string, sess: any): Promise<void> {
    const date = parseDate(text, 'Europe/Moscow');
    if (!date) { 
      await this.send(userId, 'Не понял дату. Напишите в формате: 25.12.2025'); 
      return; 
    }
    updateUserSession(userId, sessionId, { state: 'time', data: { ...sess.data, date: toISODateString(date) } });
    await this.send(userId, `✅ ${formatDate(date, 'long')}\n\n🕐 Введите время (например: 14:30) или напишите "нет":`, [
      [callbackButton('❌ Отмена', 'cancel')]
    ]);
  }

  private async setTime(userId: number, sessionId: number, text: string, sess: any): Promise<void> {
    let time = '';
    if (text.toLowerCase() !== 'нет' && text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'нет') {
      const parsed = parseTime(text);
      if (!parsed) { 
        await this.send(userId, 'Не понял время. Напишите: 14:30 или "нет"'); 
        return; 
      }
      time = `${parsed.hours.toString().padStart(2,'0')}:${parsed.minutes.toString().padStart(2,'0')}`;
    }
    
    updateUserSession(userId, sessionId, { state: 'idle', data: { ...sess.data, time } });
    
    const d = sess.data;
    const dateStr = formatDate(new Date(d.date), 'long');
    const timeStr = time ? ` в ${time}` : '';
    
    await this.send(userId, `📋 Проверка:\n\n📌 ${d.title}\n📅 ${dateStr}${timeStr}\n\nСоздать напоминание?`, [
      [callbackButton('✅ Создать', 'confirm')],
      [callbackButton('❌ Отмена', 'cancel')]
    ]);
  }

  private async doCreate(userId: number, sessionId: number): Promise<void> {
    const sess = getUserSession(userId, sessionId);
    const d = sess.data;

    if (!d.title || !d.date) { 
      await this.send(userId, '❌ Ошибка создания. Попробуйте заново /add'); 
      return; 
    }

    createReminder({
      user_id: userId, 
      chat_id: sessionId, 
      title: d.title, 
      event_date: d.date, 
      event_time: d.time,
      timezone: 'Europe/Moscow', 
      reminder_periods: [86400000], // за 1 день
      repeat_yearly: false, 
      is_active: true
    });

    clearUserSession(userId, sessionId);
    
    // Отправляем уведомление в группу
    await this.sendToGroup(`🆕 Создано новое напоминание:\n📌 ${d.title}\n📅 ${formatDate(new Date(d.date), 'long')}`);
    
    await this.send(userId, `✅ Напоминание "${d.title}" создано!`, [
      [callbackButton('📋 Список', 'list')], 
      [callbackButton('➕ Ещё', 'add')]
    ]);
  }

  private async showList(userId: number, sessionId: number): Promise<void> {
    const list = getRemindersByUser(userId, sessionId);
    
    if (!list.length) { 
      await this.send(userId, '📭 У вас пока нет напоминаний', [
        [callbackButton('➕ Создать', 'add')]
      ]); 
      return; 
    }

    let txt = '📋 Ваши напоминания:\n\n';
    list.slice(0, 5).forEach((r, i) => { 
      txt += `${i + 1}. ${r.title}\n   📅 ${formatDate(new Date(r.event_date), 'short')}\n`; 
    });

    const btns: InlineKeyboardButton[][] = list.slice(0, 5).map(r => [
      callbackButton(`🗑 ${r.title.substring(0, 20)}${r.title.length > 20 ? '...' : ''}`, `del:${r.id}`)
    ]);
    btns.push([callbackButton('➕ Добавить', 'add')]);
    
    await this.send(userId, txt, btns);
  }
}
