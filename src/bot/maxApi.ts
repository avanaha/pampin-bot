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
    
    console.log(`[MaxApi] ${method} ${endpoint}`);
    
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
    console.log(`[MaxApi] Body: ${responseText.substring(0, 200)}`);

    if (!response.ok) {
      let errorData: any = {};
      try { errorData = JSON.parse(responseText); } catch (e) {}
      console.error(`[MaxApi] Error:`, errorData);
      throw new MaxApiError(errorData.code || String(response.status), errorData.message || 'API error');
    }

    return JSON.parse(responseText) as T;
  }

  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    return this.requestRaw<T>(method, endpoint, body);
  }

  async getMe(): Promise<User> {
    return this.request<User>('GET', '/me');
  }

  async sendText(chatId: number, text: string, format: 'plain' | 'markdown' | 'html' = 'plain'): Promise<any> {
    console.log(`[MaxApi] sendText to ${chatId}`);
    return this.request('POST', '/messages', {
      chat_id: chatId,
      body: { text, format }
    });
  }

  async sendMessageWithKeyboard(
    chatId: number, 
    text: string, 
    buttons: InlineKeyboardButton[][], 
    format: 'plain' | 'markdown' | 'html' = 'plain'
  ): Promise<any> {
    console.log(`[MaxApi] sendWithKeyboard to ${chatId}`);
    return this.request('POST', '/messages', {
      chat_id: chatId,
      body: {
        text,
        format,
        attachments: [{
          type: 'inline_keyboard',
          payload: { buttons }
        }]
      }
    });
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    console.log(`[MaxApi] answerCallback ${callbackId}`);
    await this.request('POST', '/answers', {
      callback_id: callbackId,
      text: text || ''
    });
  }

  async subscribeWebhook(url: string, types?: string[]): Promise<any> {
    return this.request('POST', '/subscriptions', { url, types });
  }

  async unsubscribeWebhook(): Promise<void> {
    await this.request('DELETE', '/subscriptions');
  }

  async getUpdates(marker?: number, types?: string[]): Promise<UpdatesResponse> {
    const params = new URLSearchParams();
    params.append('limit', '100');
    params.append('timeout', '30');
    if (marker !== undefined) params.append('marker', String(marker));
    if (types) params.append('types', types.join(','));
    
    return this.request<UpdatesResponse>('GET', `/updates?${params.toString()}`);
  }
}

export function callbackButton(text: string, payload: string): InlineKeyboardButton {
  return { type: 'callback', text, payload };
}

export function linkButton(text: string, url: string): InlineKeyboardButton {
  return { type: 'link', text, url };
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
