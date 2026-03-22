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
    console.log(`[Bot] Update: ${update.update_type}`);
    
    try {
      if (update.update_type === 'message_created' && update.message) {
        await this.onMessage(update.message);
      } else if (update.update_type === 'message_callback' && update.message_callback) {
        await this.onCallback(update.message_callback);
      } else if (update.update_type === 'bot_started') {
        // При запуске бота отправляем в группу
        await this.sendToGroup('👋 Бот PamPin запущен!');
      }
    } catch (e) {
      console.error('[Bot] Error:', e);
    }
  }

  // Отправка в ГРУППУ
  async sendToGroup(text: string): Promise<void> {
    console.log(`[Bot] Sending to GROUP ${this.groupId}`);
    try {
      await this.api.sendToChat(this.groupId, text);
      console.log(`[Bot] ✅ Sent to group OK`);
    } catch (e) {
      console.error(`[Bot] ❌ Send to group FAILED:`, e);
    }
  }

  private async onMessage(msg: Message): Promise<void> {
    const userId = msg.sender?.user_id;
    const chatId = msg.recipient?.chat_id;
    const text = msg.body?.text;

    console.log(`[Bot] Msg from userId=${userId} in chatId=${chatId}: "${text}"`);

    if (!text || !userId) return;

    // ЛЮБОЕ сообщение отправляем в ГРУППУ
    await this.sendToGroup(`📩 Сообщение от пользователя ${userId}:\n"${text}"`);
  }

  private async onCallback(cb: MessageCallback): Promise<void> {
    console.log(`[Bot] Callback: ${cb.payload}`);
    try { await this.api.answerCallback(cb.callback_id); } catch {}
  }
}
