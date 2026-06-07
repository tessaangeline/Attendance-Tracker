// sheets.js — Optional Google Sheets sync
// If GOOGLE_SHEET_ID is not set in .env, all functions are no-ops.

const { google } = require('googleapis');
const path = require('path');

const SHEETS_ENABLED = () =>
  !!(process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_CREDENTIALS_FILE);

async function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(process.env.GOOGLE_CREDENTIALS_FILE),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

// ── Sync a single attendance mark to the sheet ────────────────
// Sheet layout: Row 1 = headers (Name | date1 | date2 | …)
//               Col A = employee names, subsequent cols = dates
async function syncAttendanceToSheets(employeeName, date, status) {
  if (!SHEETS_ENABLED()) return;

  try {
    const auth   = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID;

    // Fetch entire sheet (row 1 = header, col A = names)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Attendance!A:ZZ',
    });
    const rows = res.data.values || [['Name']];

    // Find / create employee row
    let empRowIdx = rows.findIndex((r, i) => i > 0 && r[0] === employeeName);
    if (empRowIdx === -1) {
      empRowIdx = rows.length;
      rows.push([employeeName]);
    }

    // Find / create date column
    const header = rows[0];
    let dateColIdx = header.findIndex((h, i) => i > 0 && h === date);
    if (dateColIdx === -1) {
      dateColIdx = header.length;
      header.push(date);
    }

    // Write the value
    while (rows[empRowIdx].length <= dateColIdx) rows[empRowIdx].push('');
    rows[empRowIdx][dateColIdx] = status === 'present' ? 'P' : 'L';

    // Push the whole range back (simpler than targeted updates for a small sheet)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Attendance!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    console.log(`📊 Sheets synced: ${employeeName} | ${date} = ${status.toUpperCase()[0]}`);
  } catch (err) {
    console.error('Google Sheets sync error:', err.message);
  }
}

// ── Write a full month summary to a Summary tab ───────────────
async function syncMonthSummaryToSheets(monthData) {
  if (!SHEETS_ENABLED()) return;

  try {
    const auth   = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID;

    const header = ['Name', 'Present Days', 'Leave Days', 'Leaves Remaining', 'Over Limit'];
    const rows   = [header];

    for (const emp of monthData) {
      rows.push([
        emp.name,
        emp.presentDays,
        emp.leaveDays,
        emp.leavesRemaining,
        emp.leavesOverLimit > 0 ? `⚠️ ${emp.leavesOverLimit} extra` : '—',
      ]);
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Summary!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    console.log(`📊 Summary sheet updated (${monthData.length} employees)`);
  } catch (err) {
    console.error('Google Sheets summary error:', err.message);
  }
}

module.exports = { syncAttendanceToSheets, syncMonthSummaryToSheets };
