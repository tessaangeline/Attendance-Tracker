// push.js — Web Push notification helpers

const webpush = require('web-push');
const db = require('./database');

function initWebPush() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️  VAPID keys missing. Run "npm run setup" first.');
    return false;
  }
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'attendance@company.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return true;
}

// Send notification to a single employee (by employee_id)
async function sendPushToEmployee(employeeId, payload) {
  if (!initWebPush()) return { sent: 0, failed: 0 };
  const subs = db.getAllSubscriptions().filter(s => s.employee_id === employeeId);
  let sent = 0, failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription), JSON.stringify(payload));
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.removeSubscription(sub.id); // Stale subscription — clean up
      }
    }
  }
  return { sent, failed };
}

// Broadcast today's attendance prompt to every subscribed employee
async function sendPushToAll() {
  if (!initWebPush()) return { sent: 0, failed: 0, total: 0 };

  const today = getTodayDate();
  const subs  = db.getAllSubscriptions();
  let sent = 0, failed = 0;

  for (const sub of subs) {
    const payload = {
      type:  'attendance',
      title: `Attendance — ${formatDate(today)}`,
      body:  'Tap ✅ Present or 🌴 On Leave to mark your status.',
      token: sub.token,
      date:  today,
    };
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription), JSON.stringify(payload));
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.removeSubscription(sub.id);
      }
    }
  }

  console.log(`[Push] Sent: ${sent}  Failed: ${failed}  Total subs: ${subs.length}`);
  return { sent, failed, total: subs.length };
}

// ── Helpers ───────────────────────────────────────────────────
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'short'
  });
}

module.exports = { sendPushToEmployee, sendPushToAll };
