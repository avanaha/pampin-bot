// MAX Bot API Types

export interface User {
  user_id: number;
  name?: string;
  first_name?: string;
  username?: string;
  is_bot?: boolean;
  last_activity_time?: number;
}

export interface Chat {
  chat_id: number;
  type: 'dialog' | 'chat' | 'channel';
  status: 'active' | 'left' | 'kicked';
  title?: string;
  icon?: string;
  description?: string;
  members_count?: number;
  owner_id?: number;
  administrators?: number[];
  pinned_message?: Message;
}

export interface MessageRecipient {
  chat_id: number;
  chat_type: string;
  user_id: number;
}

export interface MessageBody {
  mid: string;
  text: string;
  seq?: number;
}

export interface Message {
  message_id?: number;
  mid?: string;
  chat_id?: number;
  recipient?: MessageRecipient;
  sender: User;
  timestamp?: number;
  body?: MessageBody;
  text?: string;
  attachments?: Attachment[];
  link?: MessageLink;
  format?: 'plain' | 'markdown' | 'html';
  markup?: any[];
}

export interface MessageLink {
  type: 'reply' | 'forward';
  message?: Message;
}

export interface Attachment {
  type: string;
  payload: any;
}

export interface InlineKeyboardButton {
  type: 'callback' | 'link' | 'request_contact' | 'request_geo_location' | 'open_app' | 'message';
  text: string;
  payload?: string;
  url?: string;
  intent?: string;
}

export interface InlineKeyboardAttachment {
  type: 'inline_keyboard';
  payload: {
    buttons: InlineKeyboardButton[][];
  };
}

export interface NewMessageBody {
  text?: string;
  attachments?: Attachment[];
  format?: 'plain' | 'markdown' | 'html';
  disable_web_page_preview?: boolean;
}

export interface SendMessageRequest {
  chat_id: number;
  body: NewMessageBody;
}

/**
 * Callback object structure from MAX API
 * When a user clicks a callback button, MAX sends this structure
 */
export interface Callback {
  /** Unique identifier for this callback */
  id: string;
  /** Payload from the button that was clicked */
  payload: string;
}

/**
 * Message Callback update structure
 * This is the structure sent when a user clicks an inline button
 * 
 * According to MAX API documentation:
 * https://dev.max.ru/rest-api/messages/callbacks/
 * 
 * When user clicks callback button, you receive:
 * {
 *   "update_type": "message_callback",
 *   "callback": {
 *     "id": "callback_id_string",
 *     "payload": "button_payload_string"
 *   },
 *   "timestamp": 1234567890,
 *   "sender": { "user_id": 123, ... },
 *   "message": { ... original message ... }
 * }
 */
export interface MessageCallbackUpdate {
  update_type: 'message_callback';
  callback: Callback;
  timestamp: number;
  sender: User;
  message?: Message;
}

// Legacy types kept for backward compatibility
export interface MessageCallback {
  callback_id: string;
  user: User;
  chat_id: number;
  message?: Message;
  payload: string;
  timestamp?: number;
}

export interface MaxCallback {
  id?: string;
  payload?: string;
  data?: string;
}

export interface Update {
  update_type: string;
  update_id?: number;
  timestamp?: number;
  user_locale?: string;
  message?: Message;
  message_callback?: MessageCallback;
  // Primary callback field - this is where MAX sends callback data
  callback?: Callback;
  sender?: User;
  bot_started?: BotStarted;
  user_added?: UserAdded;
  chat_created?: ChatCreated;
}

export interface BotStarted {
  user: User;
  chat_id: number;
  payload?: string;
}

export interface UserAdded {
  user: User;
  chat_id: number;
  inviter: User;
}

export interface ChatCreated {
  chat: Chat;
  user: User;
}

// Subscription types
export interface Subscription {
  url?: string;
  time: number;
  update_types?: string[];
}

// API Response
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
