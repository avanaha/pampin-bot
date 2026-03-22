import 'dotenv/config';
import { initDatabase, closeDatabase } from './db/database';
import { MaxApi, initMaxApi } from './bot/maxApi';
import { PamPinBot } from './bot/handlers';
import { ReminderScheduler } from './scheduler/reminderScheduler';
import { UpdatesResponse } from './types/max-api';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const GROUP_ID = parseInt(process.env.GROUP_ID || '0');
const DATABASE_PATH = process.env.DATABASE_PATH || './data/pampin.db';

console.log('='.repeat(50));
console.log('🤖 PamPin Bot');
console.log(`   GROUP_ID: ${GROUP_ID}`);
console.log(`   DATABASE: ${DATABASE_PATH}`);
console.log(`   TOKEN: ${BOT_TOKEN ? '✅' : '❌'}`);
console.log('='.repeat(50));

if (!BOT_TOKEN) {
  console.error('❌ MAX_BOT_TOKEN is required');
  process.exit(1);
}

const api = initMaxApi(BOT_TOKEN);
const bot = new PamPinBot(BOT_TOKEN, GROUP_ID);
const scheduler = new ReminderScheduler(GROUP_ID);

async function startLongPolling(): Promise<void> {
  console.log('🔄 Starting Long Polling...');
  
  // Удаляем webhook
  try {
    await api.unsubscribeWebhook();
    console.log('✅ Webhook removed');
  } catch (e) {
    console.log('ℹ️ No webhook to remove');
  }
  
  let marker: number | null = null;
  let pollCount = 0;
  let isPolling = false;
  
  const poll = async () => {
    if (isPolling) {
      setImmediate(poll);
      return;
    }
    
    isPolling = true;
    pollCount++;
    
    try {
      const params = new URLSearchParams();
      params.append('limit', '100');
      params.append('timeout', '30');
      if (marker !== null) {
        params.append('marker', String(marker));
      }
      params.append('types', 'message_created,message_callback,bot_started');
      
      console.log(`[Poll #${pollCount}] marker=${marker}`);
      
      const response = await api.requestRaw<UpdatesResponse>('GET', `/updates?${params.toString()}`);
      
      const updates = response.updates || [];
      const newMarker = response.marker;
      
      console.log(`[Poll #${pollCount}] Got ${updates.length} updates, new marker=${newMarker}`);
      
      if (newMarker !== undefined) {
        marker = newMarker;
      }
      
      for (const update of updates) {
        console.log(`[Update] type=${update.update_type}`);
        try {
          await bot.processUpdate(update);
        } catch (error) {
          console.error(`[Update] Error:`, error);
        }
      }
      
      isPolling = false;
      setImmediate(poll);
    } catch (error) {
      console.error('[Poll] Error:', error);
      isPolling = false;
      setTimeout(poll, 5000);
    }
  };
  
  poll();
}

async function main(): Promise<void> {
  console.log('📦 Initializing database...');
  initDatabase(DATABASE_PATH);
  
  console.log('🔍 Checking bot...');
  try {
    const me = await api.getMe();
    console.log(`✅ Bot: ${me.name}`);
  } catch (error) {
    console.error('❌ Bot check failed:', error);
    process.exit(1);
  }
  
  console.log('⏰ Starting scheduler...');
  scheduler.start();
  
  console.log('🚀 Starting bot...');
  await startLongPolling();
  
  console.log('✅ Bot is running!');
}

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  scheduler.stop();
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down...');
  scheduler.stop();
  closeDatabase();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Rejection:', reason);
});

main().catch((error) => {
  console.error('❌ Fatal:', error);
  process.exit(1);
});
