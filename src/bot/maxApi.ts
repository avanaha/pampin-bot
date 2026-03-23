import { 
  User, 
  Chat, 
  Message, 
  Update, 
  NewMessageBody, 
  SendMessageRequest,
  InlineKeyboardButton,
  Subscription,
  ApiResponse 
} from '../types/max-api';

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
  }

  /**
   * Make API request
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    console.log(`[API] ${method} ${endpoint}`);
    if (body) {
      console.log(`[API] Body:`, JSON.stringify(body, null, 2));
    }

    const headers: Record<string, string> = {
      'Authorization': this.token,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const responseText = await response.text();
      
      console.log(`[API] Response status: ${response.status}`);
      console.log(`[API] Response: ${responseText.substring(0, 500)}`);

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { raw: responseText };
      }

      if (!response.ok) {
        throw new MaxApiError(
          data.code || String(response.status),
          data.message || 'API request failed'
        );
      }

      return data;
    } catch (error) {
      if (error instanceof MaxApiError) {
        throw error;
      }
      throw new MaxApiError('NETWORK_ERROR', `Network error: ${error}`);
    }
  }

  /**
   * Get bot information
   */
  async getMe(): Promise<User> {
    return this.request<User>('GET', '/me');
  }

  /**
   * Get all chats
   */
  async getChats(): Promise<Chat[]> {
    return this.request<Chat[]>('GET', '/chats');
  }

  /**
   * Get chat by ID
   */
  async getChat(chatId: number): Promise<Chat> {
    return this.request<Chat>('GET', `/chats/${chatId}`);
  }

  /**
   * Send message to chat (chat_id in query params)
   */
  async sendMessage(chatId: number, body: NewMessageBody): Promise<Message> {
    // chat_id must be in query params, not body!
    const endpoint = `/messages?chat_id=${chatId}`;
    return this.request<Message>('POST', endpoint, body);
  }

  /**
   * Send message to user by user_id (user_id in query params)
   */
  async sendToUser(userId: number, body: NewMessageBody): Promise<Message> {
    // user_id must be in query params, not body!
    const endpoint = `/messages?user_id=${userId}`;
    return this.request<Message>('POST', endpoint, body);
  }

  /**
   * Send simple text message to chat
   */
  async sendText(
    chatId: number, 
    text: string, 
    format: 'plain' | 'markdown' | 'html' = 'plain'
  ): Promise<Message> {
    return this.sendMessage(chatId, { text, format });
  }

  /**
   * Send text message to user
   */
  async sendTextToUser(
    userId: number, 
    text: string, 
    format: 'plain' | 'markdown' | 'html' = 'plain'
  ): Promise<Message> {
    return this.sendToUser(userId, { text, format });
  }

  /**
   * Send message with inline keyboard to chat
   */
  async sendMessageWithKeyboard(
    chatId: number,
    text: string,
    buttons: InlineKeyboardButton[][],
    format: 'plain' | 'markdown' | 'html' = 'plain'
  ): Promise<Message> {
    return this.sendMessage(chatId, {
      text,
      format,
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons }
        }
      ]
    });
  }

  /**
   * Send message with inline keyboard to user
   */
  async sendMessageWithKeyboardToUser(
    userId: number,
    text: string,
    buttons: InlineKeyboardButton[][],
    format: 'plain' | 'markdown' | 'html' = 'plain'
  ): Promise<Message> {
    return this.sendToUser(userId, {
      text,
      format,
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons }
        }
      ]
    });
  }

  /**
   * Edit message
   */
  async editMessage(
    chatId: number,
    messageId: number,
    body: NewMessageBody
  ): Promise<Message> {
    return this.request<Message>('PUT', `/messages?chat_id=${chatId}&message_id=${messageId}`, body);
  }

  /**
   * Delete message
   */
  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    await this.request<void>('DELETE', `/messages?chat_id=${chatId}&message_id=${messageId}`);
  }

  /**
   * Answer callback (callback_id in query params)
   */
  async answerCallback(callbackId: string, notificationText?: string): Promise<void> {
    // callback_id must be in query params!
    let endpoint = `/answers?callback_id=${encodeURIComponent(callbackId)}`;
    
    console.log(`[API] Answering callback: ${callbackId}`);
    
    // Send empty body - notification text is optional
    await this.request<void>('POST', endpoint, {});
  }

  /**
   * Get updates (Long Polling)
   */
  async getUpdates(
    limit: number = 100,
    timeout: number = 30,
    marker: number | null = null,
    updateTypes?: string[]
  ): Promise<{ updates: Update[]; marker: number }> {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    params.append('timeout', String(timeout));
    if (marker !== null) {
      params.append('marker', String(marker));
    }
    if (updateTypes) {
      params.append('types', updateTypes.join(','));
    }
    
    return this.request<{ updates: Update[]; marker: number }>('GET', `/updates?${params.toString()}`);
  }

  /**
   * Subscribe to webhook
   */
  async subscribeWebhook(
    url: string,
    updateTypes?: string[]
  ): Promise<Subscription> {
    return this.request<Subscription>('POST', '/subscriptions', {
      url,
      types: updateTypes
    });
  }

  /**
   * Unsubscribe from webhook
   */
  async unsubscribeWebhook(): Promise<void> {
    await this.request<void>('DELETE', '/subscriptions');
  }

  /**
   * Get current subscriptions
   */
  async getSubscriptions(): Promise<Subscription[]> {
    return this.request<Subscription[]>('GET', '/subscriptions');
  }

  /**
   * Send bot action (typing, etc.)
   */
  async sendAction(chatId: number, action: 'typing' | 'sending'): Promise<void> {
    await this.request<void>('POST', `/chats/${chatId}/actions`, { action });
  }

  /**
   * Get chat members
   */
  async getChatMembers(chatId: number): Promise<User[]> {
    return this.request<User[]>('GET', `/chats/${chatId}/members`);
  }

  /**
   * Get chat administrators
   */
  async getChatAdmins(chatId: number): Promise<User[]> {
    return this.request<User[]>('GET', `/chats/${chatId}/members/admins`);
  }
}

// Helper function to create inline keyboard buttons
export function callbackButton(text: string, payload: string): InlineKeyboardButton {
  return { type: 'callback', text, payload };
}

export function linkButton(text: string, url: string): InlineKeyboardButton {
  return { type: 'link', text, url };
}

export function messageButton(text: string, message: string): InlineKeyboardButton {
  return { type: 'message', text, payload: message };
}

// Export singleton instance
let maxApiInstance: MaxApi | null = null;

export function getMaxApi(token?: string): MaxApi {
  if (!maxApiInstance && token) {
    maxApiInstance = new MaxApi(token);
  }
  if (!maxApiInstance) {
    throw new Error('MAX API not initialized. Call getMaxApi with token first.');
  }
  return maxApiInstance;
}
