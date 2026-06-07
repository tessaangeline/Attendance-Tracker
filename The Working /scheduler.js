// scheduler.js — Daily 9 AM weekday attendance notification

const schedule = require('node-schedule');
const { sendPushToAll } = require('./push');

function initScheduler() {
  // Cron: minute hour * * day-of-week (1-5 = Mon–Fri)
  // Fires every weekday at 09:00 AM server local time
  const job = schedule.scheduleJob('0 9 * * 1-5', async () => {
    const now = new Date().toISOString();
    console.log(`\n[${now}] ⏰ Daily attendance notification triggered`);
    try {
      const result = await sendPushToAll();
      console.log(`✅ Notifications — sent: ${result.sent}, failed: ${result.failed}\n`);
    } catch (err) {
      console.error('❌ Scheduler error:', err.message);
    }
  });

  console.log('⏰ Scheduler active — notifications will fire at 09:00 AM (Mon–Fri)');
  return job;
}

module.exports = { initScheduler };
