import { User, InlineKeyboardButton, UpdatesResponse } from '../types/max-api';

const MAX_API_BASE = 'https://platform-api.max.ru';

export class MaxApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'MaxApiError';
  }
}

export class MaxApi {
  private token: string;
  private baseUrl: string;

  constructor(token: string, baseUrl: string = MAX_API_BASE) {
    this.token = token;
    this.baseUrl = baseUrl;
    console.log(`[MaxApi] Initialized`);
  }

  async requestRaw<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    console.log(`[MaxApi] ${method} ${url}`);
    console.log(`[MaxApi] Body:`, body ? JSON.stringify(body) : 'none');
    
    const headers: Record<string, string> = {
      'Authorization': this.token,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = { method, headers };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const responseText = await response.text();
    
    console.log(`[MaxApi] Status: ${response.status}`);
    console.log(`[MaxApi] Response: ${responseText.substring(0, 300)}`);

    if (!response.ok) {
      let errorData: any = {};
      try { errorData = JSON.parse(responseText); } catch (e) {}
      throw new MaxApiError(errorData.code || String(response.status), errorData.message || 'API error');
    }

    return JSON.parse(responseText) as T;
  }

  async getMe(): Promise<User> {
    return this.requestRaw<User>('GET', '/me');
  }

  async sendToUser(userId: number, text: string, buttons?: InlineKeyboardButton[][]): Promise<any> {
    console.log(`[MaxApi] sendToUser userId=${userId}`);
    
    const body: any = {
      text: text
    };
    
    if (buttons?.length) {
      body.attachments = [{
        type: 'inline_keyboard',
        payload: { buttons }
      }];
    }
    
    return this.requestRaw('POST', `/messages?user_id=${userId}`, body);
  }

  async sendToChat(chatId: number, text: string, buttons?: InlineKeyboardButton[][]): Promise<any> {
    console.log(`[MaxApi] sendToChat chatId=${chatId}`);
    
    const body: any = {
      text: text
    };
    
    if (buttons?.length) {
      body.attachments = [{
        type: 'inline_keyboard',
        payload: { buttons }
      }];
    }
    
    return this.requestRaw('POST', `/messages?chat_id=${chatId}`, body);
  }

  async answerCallback(callbackId: string, notificationText?: string): Promise<void> {
    console.log(`[MaxApi] answerCallback ${callbackId}`);
    await this.requestRaw('POST', '/answers', {
      callback_id: callbackId,
      notification: notificationText || ''
    });
  }

  async unsubscribeWebhook(): Promise<void> {
    try {
      await this.requestRaw('DELETE', '/subscriptions');
    } catch (e) {}
  }

  async getUpdates(marker?: number, types?: string[]): Promise<UpdatesResponse> {
    const params = new URLSearchParams();
    params.append('limit', '100');
    params.append('timeout', '30');
    if (marker !== undefined) params.append('marker', String(marker));
    if (types) params.append('types', types.join(','));
    
    return this.requestRaw<UpdatesResponse>('GET', `/updates?${params.toString()}`);
  }
}

export function callbackButton(text: string, payload: string): InlineKeyboardButton {
  return { type: 'callback', text, payload };
}

let maxApiInstance: MaxApi | null = null;

export function initMaxApi(token: string): MaxApi {
  maxApiInstance = new MaxApi(token);
  return maxApiInstance;
}

export function getMaxApi(): MaxApi {
  if (!maxApiInstance) {
    throw new Error('MaxApi not initialized');
  }
  return maxApiInstance;
}
