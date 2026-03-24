import 'dotenv/config';
import { initDatabase, closeDatabase } from './db/database';
import { MaxApi } from './bot/maxApi';
import { PamPinBot } from './bot/handlers';
import { ReminderScheduler } from './scheduler/reminderScheduler';
import { Update } from './types/max-api';

// Configuration
const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const GROUP_ID = parseInt(process.env.GROUP_ID || '0');
const DATABASE_PATH = process.env.DATABASE_PATH || './data/pampin.db';
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = parseInt(process.env.PORT || '3000');
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log('========================================');
console.log('🤖 PamPin Bot Starting...');
console.log('========================================');
console.log('NODE_ENV:', NODE_ENV);
console.log('GROUP_ID:', GROUP_ID);
console.log('DATABASE_PATH:', DATABASE_PATH);
console.log('BOT_TOKEN exists:', !!BOT_TOKEN);
console.log('========================================');

if (!BOT_TOKEN) {
  console.error('❌ MAX_BOT_TOKEN is required');
  process.exit(1);
}

// Initialize API
const api = new MaxApi(BOT_TOKEN);

// Initialize bot
const bot = new PamPinBot(BOT_TOKEN, GROUP_ID);

// Initialize scheduler
const scheduler = new ReminderScheduler();

/**
 * Start bot in Long Polling mode
 */
async function startLongPolling(): Promise<void> {
  console.log('🔄 Starting Long Polling mode...');
  
  let marker: number | null = null;
  
  const poll = async () => {
    try {
      // Get updates
      const response = await api.getUpdates(100, 30, marker);
      
      const updates = response.updates || [];
      
      if (updates.length > 0) {
        console.log(`\n📥 Received ${updates.length} updates`);
        
        // Update marker from response
        if (response.marker) {
          marker = response.marker;
        }
        
        // Process updates
        for (const update of updates) {
          try {
            await bot.processUpdate(update);
          } catch (error) {
            console.error('Error processing update:', error);
          }
        }
      } else {
        // Update marker even for empty responses
        if (response.marker) {
          marker = response.marker;
        }
      }
      
      // Continue polling immediately
      setImmediate(poll);
    } catch (error) {
      console.error('Polling error:', error);
      // Wait and retry
      setTimeout(poll, 5000);
    }
  };
  
  // Start polling
  poll();
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log('📦 Initializing database...');
  initDatabase(DATABASE_PATH);
  console.log('✅ Database initialized');
  
  // Get bot info
  try {
    const me = await api.getMe();
    console.log(`✅ Connected as: ${me.name} (user_id: ${me.user_id})`);
  } catch (error) {
    console.error('❌ Failed to get bot info:', error);
    process.exit(1);
  }
  
  // Start scheduler
  console.log('⏰ Starting reminder scheduler...');
  scheduler.start();
  
  // Start bot
  await startLongPolling();
  
  console.log('✅ PamPin Bot is running!');
}

// Handle shutdown
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

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
