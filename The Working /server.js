// server.js — Main Express server for the Attendance Tracker

require('dotenv').config();
const express  = require('express');
const path     = require('path');
const cors     = require('cors');
const { v4: uuidv4 } = require('uuid');

const db        = require('./database');
const { sendPushToAll } = require('./push');
const { syncAttendanceToSheets, syncMonthSummaryToSheets } = require('./sheets');
const { initScheduler } = require('./scheduler');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend folder as static files
app.use(express.static(path.join(__dirname, 'frontend')));

// ── Init ──────────────────────────────────────────────────────
db.init();
initScheduler();

// ── Helpers ───────────────────────────────────────────────────
const today   = () => new Date().toISOString().split('T')[0];
const month   = (d) => d.substring(0, 7);
const isWeekend = (dateStr) => {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay() === 0 || d.getDay() === 6;
};

function getWeekdaysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const days = [];
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    if (d.getDay() !== 0 && d.getDay() !== 6)
      days.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function requireAdmin(req, res) {
  const token =
    req.query.adminToken ||
    req.body?.adminToken ||
    req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_SECRET) {
    res.status(403).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ═════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═════════════════════════════════════════════════════════════

// ── VAPID public key (needed by frontend to subscribe) ────────
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// ── Register employee ─────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2)
    return res.status(400).json({ error: 'Name must be at least 2 characters.' });

  const token    = uuidv4();
  const employee = db.createEmployee(name.trim(), token);

  res.json({
    success:      true,
    employeeId:   employee.id,
    name:         employee.name,
    token,
    dashboardUrl: `/employee.html?token=${token}`,
  });
});

// ── Save push subscription ────────────────────────────────────
app.post('/api/subscribe', (req, res) => {
  const { token, subscription } = req.body;
  const emp = db.getEmployeeByToken(token);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });

  db.saveSubscription(emp.id, JSON.stringify(subscription));
  res.json({ success: true, name: emp.name });
});

// ── Mark attendance ───────────────────────────────────────────
app.post('/api/mark', (req, res) => {
  const { token, status, date: reqDate } = req.body;

  if (!token || !['present', 'leave'].includes(status))
    return res.status(400).json({ error: 'Invalid request.' });

  const emp = db.getEmployeeByToken(token);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });

  const markDate = reqDate || today();

  if (isWeekend(markDate))
    return res.status(400).json({ error: 'Weekends are automatically counted as off — no need to mark.' });

  const existing = db.getAttendanceRecord(emp.id, markDate);
  if (existing) {
    return res.status(409).json({
      alreadyMarked: true,
      status:        existing.status,
      message:       `Already marked as ${existing.status} for ${markDate}.`,
    });
  }

  const m           = month(markDate);
  const leavesTaken = db.getLeavesThisMonth(emp.id, m);
  const overLimit   = status === 'leave' && leavesTaken >= 4;

  db.markAttendance(emp.id, markDate, status, overLimit);

  // Fire-and-forget Google Sheets sync
  syncAttendanceToSheets(emp.name, markDate, status).catch(() => {});

  const summary = db.getMonthlySummary(emp.id, m);
  res.json({
    success: true,
    status,
    date: markDate,
    overLimit,
    ...summary,
  });
});

// ── Employee status / personal dashboard data ─────────────────
app.get('/api/status', (req, res) => {
  const { token, month: reqMonth } = req.query;
  const emp = db.getEmployeeByToken(token);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });

  const targetMonth  = reqMonth || month(today());
  const summary      = db.getMonthlySummary(emp.id, targetMonth);
  const records      = db.getMonthlyRecords(emp.id, targetMonth);
  const todayRec     = db.getAttendanceRecord(emp.id, today());

  res.json({
    name:        emp.name,
    employeeId:  emp.id,
    month:       targetMonth,
    todayStatus: todayRec?.status || null,
    ...summary,
    records,
  });
});

// ═════════════════════════════════════════════════════════════
// ADMIN ROUTES  (require ADMIN_SECRET)
// ═════════════════════════════════════════════════════════════

// ── Verify admin secret ───────────────────────────────────────
app.post('/api/admin/verify', (req, res) => {
  const { adminToken } = req.body;
  if (adminToken !== process.env.ADMIN_SECRET)
    return res.status(403).json({ error: 'Wrong admin secret.' });
  res.json({ success: true });
});

// ── Full team report ──────────────────────────────────────────
app.get('/api/report', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const targetMonth = req.query.month || month(today());
  const employees   = db.getAllEmployees();

  const report = employees.map((emp) => {
    const summary    = db.getMonthlySummary(emp.id, targetMonth);
    const records    = db.getMonthlyRecords(emp.id, targetMonth);
    const todayRec   = db.getAttendanceRecord(emp.id, today());
    return {
      id:          emp.id,
      name:        emp.name,
      todayStatus: todayRec?.status || null,
      ...summary,
      records,
    };
  });

  res.json({ month: targetMonth, employees: report });
});

// ── Export CSV ────────────────────────────────────────────────
app.get('/api/export', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const targetMonth = req.query.month || month(today());
  const employees   = db.getAllEmployees();
  const weekdays    = getWeekdaysInMonth(targetMonth);

  let csv = 'Name,' + weekdays.join(',') + ',Present Days,Leave Days,Leaves Remaining\n';

  for (const emp of employees) {
    const records = db.getMonthlyRecords(emp.id, targetMonth);
    const map     = {};
    records.forEach((r) => { map[r.date] = r.status === 'present' ? 'P' : 'L'; });

    const row = [emp.name];
    weekdays.forEach((d) => row.push(map[d] || '-'));

    const s = db.getMonthlySummary(emp.id, targetMonth);
    row.push(s.presentDays, s.leaveDays, s.leavesRemaining);
    csv += row.join(',') + '\n';
  }

  // Optional: sync full summary to Google Sheets
  const summaryData = employees.map((e) => ({
    name: e.name,
    ...db.getMonthlySummary(e.id, targetMonth),
  }));
  syncMonthSummaryToSheets(summaryData).catch(() => {});

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${targetMonth}.csv"`);
  res.send(csv);
});

// ── Send notification now (manual trigger) ────────────────────
app.post('/api/notify', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await sendPushToAll();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List all employees ────────────────────────────────────────
app.get('/api/employees', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const emps = db.getAllEmployees().map((e) => ({
    id:          e.id,
    name:        e.name,
    dashboardUrl: `/employee.html?token=${e.token}`,
    createdAt:   e.created_at,
  }));
  res.json(emps);
});

// ── Remove employee ───────────────────────────────────────────
app.delete('/api/employees/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  db.removeEmployee(req.params.id);
  res.json({ success: true });
});

// ── Add employee (admin-side) ─────────────────────────────────
app.post('/api/employees', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { name } = req.body;
  if (!name || name.trim().length < 2)
    return res.status(400).json({ error: 'Name too short.' });

  const token = uuidv4();
  const emp   = db.createEmployee(name.trim(), token);
  res.json({
    success:      true,
    id:           emp.id,
    name:         emp.name,
    dashboardUrl: `/employee.html?token=${token}`,
  });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   🏢  Attendance Tracker — Running        ║
╠═══════════════════════════════════════════╣
║  App:    http://localhost:${PORT}            ║
║  Admin:  http://localhost:${PORT}/admin.html ║
╚═══════════════════════════════════════════╝
  `);
});
