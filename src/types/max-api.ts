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
  chat_type?: string;
  status: 'active' | 'left' | 'kicked';
  title?: string;
}

export interface MessageRecipient {
  chat_id: number;
  chat_type: string;
  user_id: number;
}

export interface MessageBody {
  mid: string;
  seq: number;
  text?: string;
}

export interface Message {
  recipient: MessageRecipient;
  timestamp: number;
  body: MessageBody;
  sender: User;
}

export interface InlineKeyboardButton {
  type: 'callback' | 'link' | 'message';
  text: string;
  payload?: string;
  url?: string;
}

export interface MessageCallback {
  callback_id: string;
  user: User;
  chat_id: number;
  message: Message;
  payload: string;
}

export interface Update {
  update_type: string;
  timestamp?: number;
  message?: Message;
  message_callback?: MessageCallback;
  user?: User;
  user_id?: number;
  chat_id?: number;
}

export interface UpdatesResponse {
  updates: Update[];
  marker: number;
}
