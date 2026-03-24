// MAX Bot API Types - Real API structure

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
  administrators?: number[];
  pinned_message?: Message;
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
  link?: MessageLink;
  format?: 'plain' | 'markdown' | 'html';
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

// Real update structure from MAX API
export interface Update {
  update_type: string;
  timestamp?: number;
  marker?: number;
  message?: Message;           // For message_created
  message_callback?: MessageCallback;
  bot_started?: BotStarted;
  user_added?: UserAdded;
  chat_created?: ChatCreated;
  user_id?: number;            // For bot_started
  chat_id?: number;            // For bot_started  
  user?: User;                 // For bot_started
  user_locale?: string;
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
  user_locale?: string;
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
