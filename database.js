// database.js — All SQLite operations for the attendance tracker

const Database = require('better-sqlite3');
const path = require('path');

let db;

// ── Initialise DB and create tables ───────────────────────────
function init() {
  db = new Database(path.join(__dirname, 'attendance.db'));
  db.pragma('journal_mode = WAL'); // Better concurrent read performance

  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      token      TEXT    UNIQUE NOT NULL,
      created_at TEXT    DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      subscription TEXT   NOT NULL,
      created_at  TEXT   DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date        TEXT    NOT NULL,      -- YYYY-MM-DD
      status      TEXT    NOT NULL CHECK(status IN ('present', 'leave')),
      over_limit  INTEGER DEFAULT 0,    -- 1 if taken > 4 leaves this month
      marked_at   TEXT    DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, date),
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );
  `);

  console.log('✅ Database ready (attendance.db)');
  return db;
}

// ── Employees ─────────────────────────────────────────────────
function createEmployee(name, token) {
  const stmt = db.prepare('INSERT INTO employees (name, token) VALUES (?, ?)');
  const result = stmt.run(name, token);
  return { id: result.lastInsertRowid, name, token };
}

function getEmployeeByToken(token) {
  return db.prepare('SELECT * FROM employees WHERE token = ?').get(token);
}

function getEmployeeById(id) {
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
}

function getAllEmployees() {
  return db.prepare('SELECT * FROM employees ORDER BY name COLLATE NOCASE').all();
}

function removeEmployee(id) {
  db.prepare('DELETE FROM attendance         WHERE employee_id = ?').run(id);
  db.prepare('DELETE FROM push_subscriptions WHERE employee_id = ?').run(id);
  db.prepare('DELETE FROM employees          WHERE id = ?').run(id);
}

// ── Push Subscriptions ────────────────────────────────────────
function saveSubscription(employeeId, subscriptionJson) {
  // One subscription per employee (replace if re-subscribing)
  db.prepare('DELETE FROM push_subscriptions WHERE employee_id = ?').run(employeeId);
  db.prepare('INSERT INTO push_subscriptions (employee_id, subscription) VALUES (?, ?)')
    .run(employeeId, subscriptionJson);
}

function getAllSubscriptions() {
  return db.prepare(`
    SELECT ps.id, ps.employee_id, ps.subscription, e.name, e.token
    FROM   push_subscriptions ps
    JOIN   employees e ON ps.employee_id = e.id
  `).all();
}

function removeSubscription(id) {
  db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
}

// ── Attendance ────────────────────────────────────────────────
function getAttendanceRecord(employeeId, date) {
  return db.prepare(
    'SELECT * FROM attendance WHERE employee_id = ? AND date = ?'
  ).get(employeeId, date);
}

function markAttendance(employeeId, date, status, overLimit = false) {
  db.prepare(`
    INSERT INTO attendance (employee_id, date, status, over_limit)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(employee_id, date) DO UPDATE
      SET status     = excluded.status,
          over_limit = excluded.over_limit,
          marked_at  = CURRENT_TIMESTAMP
  `).run(employeeId, date, status, overLimit ? 1 : 0);
}

function getLeavesThisMonth(employeeId, month) {
  const result = db.prepare(`
    SELECT COUNT(*) AS count FROM attendance
    WHERE employee_id = ? AND date LIKE ? AND status = 'leave'
  `).get(employeeId, `${month}%`);
  return result.count;
}

function getMonthlySummary(employeeId, month) {
  const present = db.prepare(`
    SELECT COUNT(*) AS c FROM attendance
    WHERE employee_id = ? AND date LIKE ? AND status = 'present'
  `).get(employeeId, `${month}%`).c;

  const leave = db.prepare(`
    SELECT COUNT(*) AS c FROM attendance
    WHERE employee_id = ? AND date LIKE ? AND status = 'leave'
  `).get(employeeId, `${month}%`).c;

  return {
    presentDays:     present,
    leaveDays:       leave,
    leavesRemaining: Math.max(0, 4 - leave),
    leavesOverLimit: Math.max(0, leave - 4),
  };
}

function getMonthlyRecords(employeeId, month) {
  return db.prepare(`
    SELECT date, status, over_limit FROM attendance
    WHERE employee_id = ? AND date LIKE ?
    ORDER BY date ASC
  `).all(employeeId, `${month}%`);
}

module.exports = {
  init,
  createEmployee,
  getEmployeeByToken,
  getEmployeeById,
  getAllEmployees,
  removeEmployee,
  saveSubscription,
  getAllSubscriptions,
  removeSubscription,
  getAttendanceRecord,
  markAttendance,
  getLeavesThisMonth,
  getMonthlySummary,
  getMonthlyRecords,
};
