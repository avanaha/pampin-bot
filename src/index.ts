import 'dotenv/config';
import { initDatabase, closeDatabase } from './db/database';
import { MaxApi } from './bot/maxApi';
import { PamPinBot } from './bot/handlers';
import { ReminderScheduler } from './scheduler/reminderScheduler';
import { Update } from './types/max-api';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const GROUP_ID = parseInt(process.env.GROUP_ID || '0');
const DATABASE_PATH = process.env.DATABASE_PATH || './data/pampin.db';
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = parseInt(process.env.PORT || '3000');
const NODE_ENV = process.env.NODE_ENV || 'development';

if (!BOT_TOKEN) {
  console.error('❌ MAX_BOT_TOKEN is required');
  process.exit(1);
}

const api = new MaxApi(BOT_TOKEN);
const bot = new PamPinBot(BOT_TOKEN, GROUP_ID);
const scheduler = new ReminderScheduler();

async function startLongPolling(): Promise<void> {
  console.log('🔄 Starting in Long Polling mode...');
  
  let marker: number | null = null;
  
  const poll = async () => {
    try {
      const response = await api.getUpdates(100, 30, marker);
      const updates = response.updates || [];
      
      if (updates.length > 0) {
        console.log(`📥 Received ${updates.length} updates`);
        
        if (response.marker) {
          marker = response.marker;
        }
        
        for (const update of updates) {
          try {
            await bot.processUpdate(update);
          } catch (error) {
            console.error('Error processing update:', error);
          }
        }
      }
      
      setImmediate(poll);
    } catch (error) {
      console.error('Polling error:', error);
      setTimeout(poll, 5000);
    }
  };
  
  poll();
}

async function startWebhook(): Promise<void> {
  console.log('🔗 Starting in Webhook mode...');
  
  const http = await import('http');
  
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
      let body = '';
      
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          const update = JSON.parse(body);
          await bot.processUpdate(update);
          res.writeHead(200);
          res.end('OK');
        } catch (error) {
          console.error('Webhook error:', error);
          res.writeHead(500);
          res.end('Error');
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  
  server.listen(PORT, () => {
    console.log(`🌐 Webhook server listening on port ${PORT}`);
  });
  
  if (WEBHOOK_URL) {
    try {
      await api.subscribeWebhook(WEBHOOK_URL, [
        'message_created',
        'message_callback',
        'bot_started'
      ]);
      console.log(`✅ Webhook registered: ${WEBHOOK_URL}`);
    } catch (error) {
      console.error('Failed to register webhook:', error);
    }
  }
}

async function main(): Promise<void> {
  console.log('🤖 PamPin Bot starting...');
  console.log(`📍 Environment: ${NODE_ENV}`);
  console.log(`📍 Group ID: ${GROUP_ID}`);
  
  console.log('📦 Initializing database...');
  initDatabase(DATABASE_PATH);
  
  try {
    const me = await api.getMe();
    console.log(`✅ Connected as: ${me.name} (@${me.username})`);
  } catch (error) {
    console.error('❌ Failed to get bot info:', error);
    process.exit(1);
  }
  
  console.log('⏰ Starting reminder scheduler...');
  scheduler.start();
  
  if (NODE_ENV === 'production' && WEBHOOK_URL) {
    await startWebhook();
  } else {
    await startLongPolling();
  }
  
  console.log('✅ PamPin Bot is running!');
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
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
