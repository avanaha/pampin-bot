// MAX Bot API Types

export interface User {
  user_id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot: boolean;
  last_activity_time: number;
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
}

export interface MessageBody {
  mid: string;
  seq: number;
  text?: string;
  attachments?: Attachment[];
}

export interface Message {
  message_id?: number;
  mid?: string;
  chat_id?: number;
  recipient?: {
    chat_id: number;
    chat_type: string;
    user_id: number;
  };
  sender: User;
  timestamp: number;
  body?: MessageBody;
  text?: string;
  attachments?: Attachment[];
  format?: 'plain' | 'markdown' | 'html';
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
}

export interface NewMessageBody {
  text?: string;
  attachments?: Attachment[];
  format?: 'plain' | 'markdown' | 'html';
}

export interface Update {
  update_type: string;
  timestamp?: number;
  message?: Message;
  message_callback?: MessageCallback;
  bot_started?: BotStarted;
  user?: User;
  user_id?: number;
  chat_id?: number;
}

export interface MessageCallback {
  callback_id: string;
  user: User;
  chat_id: number;
  message: Message;
  payload: string;
  timestamp?: number;
}

export interface BotStarted {
  user: User;
  user_id: number;
  chat_id: number;
  payload?: string;
  timestamp?: number;
}

export interface Subscription {
  url?: string;
  time: number;
  update_types?: string[];
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
