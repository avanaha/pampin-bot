// MAX Bot API Types
// Documentation: https://dev.max.ru/

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
  sender?: User;
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
  callback_id?: string;
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
  /** User who clicked the button */
  user?: User;
}

export interface Update {
  update_type: string;
  update_id?: number;
  timestamp?: number;
  user_locale?: string;
  message?: Message;
  message_callback?: MessageCallback;
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

export interface MessageCallback {
  callback_id: string;
  user: User;
  chat_id: number;
  message?: Message;
  payload: string;
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
