// setup.js — Run once to generate keys and create your .env file
// Usage: node setup.js

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  console.log('\n⚠️  .env already exists. To regenerate, delete it first.\n');
  const existing = fs.readFileSync(envPath, 'utf8');
  const adminMatch = existing.match(/ADMIN_SECRET=(.+)/);
  if (adminMatch) {
    console.log(`Your current Admin Secret: ${adminMatch[1]}`);
  }
  process.exit(0);
}

console.log('\n🔧 Generating VAPID keys for push notifications...\n');
const vapidKeys = webpush.generateVAPIDKeys();
const adminSecret = uuidv4().replace(/-/g, '');

const envContent = `# ─────────────────────────────────────────────────────────────
# Attendance Tracker — Configuration
# Generated: ${new Date().toISOString()}
# ─────────────────────────────────────────────────────────────

PORT=3000

# Push Notification Keys (never share PRIVATE key)
VAPID_PUBLIC_KEY=${vapidKeys.publicKey}
VAPID_PRIVATE_KEY=${vapidKeys.privateKey}
VAPID_EMAIL=attendance@yourcompany.com

# Admin Secret — paste this into the admin dashboard login
ADMIN_SECRET=${adminSecret}

# ── Google Sheets (Optional) ───────────────────────────────────
# Leave blank to disable. Attendance still works without this.
# GOOGLE_SHEET_ID=your-sheet-id-here
# GOOGLE_CREDENTIALS_FILE=./google-credentials.json
GOOGLE_SHEET_ID=
GOOGLE_CREDENTIALS_FILE=
`;

fs.writeFileSync(envPath, envContent);

const line = '─'.repeat(52);
console.log(`┌${line}┐`);
console.log(`│  ✅ Setup complete!${' '.repeat(33)}│`);
console.log(`├${line}┤`);
console.log(`│  Admin Secret (paste into admin dashboard):   │`);
console.log(`│  ${adminSecret}  │`);
console.log(`└${line}┘`);
console.log('\n📋 Next steps:');
console.log('  1. npm install');
console.log('  2. npm start');
console.log('  3. Open http://localhost:3000');
console.log('  4. Register employees and share their personal links\n');
