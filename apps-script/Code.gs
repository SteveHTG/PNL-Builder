/**
 * PNL Builder — Google Apps Script JSON API backend
 * ---------------------------------------------------
 * Replaces the old google.script.run receipt page. This version exposes a
 * JSON API (via doPost) that the GitHub-hosted PWA calls with fetch().
 *
 * The Anthropic API key is read from a Script Property named ANTHROPIC_API_KEY.
 * It is NEVER hardcoded and never sent to the browser.
 *
 * Actions (POST body: {"action": "...", ...}):
 *   ping          -> health check
 *   scanReceipt   -> {base64Image, mimeType} -> extracted fields (no save)
 *   addExpense    -> {purchases,cost,date,vendor,reason,category,base64Image?,mimeType?}
 *   addIncome     -> {date, source, amount}
 *   getData       -> returns all expenses + income + categories
 *   setup         -> one-time: rebuild the Income tab into a clean table
 *
 * ANNUAL ROLLOVER: change YEAR below (and make sure the matching spreadsheet
 * "Steve_Horizon <YY> PNL" and Drive folder Horizon/Receipts/<YEAR> exist),
 * then redeploy a new version.
 */

// ======================= CONFIG =======================
var YEAR = 2026;
var SPREADSHEET_NAME = 'Steve_Horizon ' + String(YEAR).slice(2) + ' PNL'; // -> "Steve_Horizon 26 PNL"
var EXPENSES_SHEET = 'Expenses';
var INCOME_SHEET = 'Income';
var PL_SHEET = 'PL';
var DRIVE_FOLDER_PATH = ['Horizon', 'Receipts', String(YEAR)];
var CLAUDE_MODEL = 'claude-sonnet-4-6';

var CATEGORIES = [
  'Advertising',
  'Office Expenses',
  'Insurance',
  'Legal and Professional Services',
  'Travel',
  'Utilities',
  'Supplies',
  'Mortgage',
  'Subscriptions',
  'Dues and Fees',
  'Mail',
  'Internet',
  'Cell Phone',
  'Business Meeting'
];

// ======================= HTTP ENTRY POINTS =======================
function doGet(e) {
  // Hitting the web-app URL in a browser confirms the deployment is live.
  return json({ ok: true, service: 'PNL Builder API', year: YEAR, spreadsheet: SPREADSHEET_NAME });
}

function doPost(e) {
  try {
    var req = {};
    if (e && e.postData && e.postData.contents) {
      req = JSON.parse(e.postData.contents);
    }
    var action = req.action;
    var out;
    switch (action) {
      case 'ping':        out = { pong: true, year: YEAR }; break;
      case 'scanReceipt': out = scanReceipt(req); break;
      case 'addExpense':  out = addExpense(req); break;
      case 'addIncome':   out = addIncome(req); break;
      case 'getData':     out = getData(req); break;
      case 'setup':       out = setupWorkbook(req); break;
      default: throw new Error('Unknown action: ' + action);
    }
    return json({ ok: true, data: out });
  } catch (err) {
    return json({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ======================= RECEIPT SCAN (Claude) =======================
function scanReceipt(req) {
  var base64Image = req.base64Image;
  var mimeType = req.mimeType || 'image/jpeg';
  if (!base64Image) throw new Error('No image provided.');

  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY Script Property is not set.');

  // PDFs go in a "document" block; images (jpeg/png/gif/webp) in an "image" block.
  // No beta header is required for PDF document input.
  var mediaBlock = (mimeType === 'application/pdf')
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Image } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } };

  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        mediaBlock,
        { type: 'text', text:
'Analyze this receipt and extract the following information. Respond ONLY with a valid JSON object, no other text:\n' +
'{\n' +
'  "purchases": "brief description of what was purchased",\n' +
'  "cost": "amount as a number with 2 decimal places, no dollar sign",\n' +
'  "date": "date in YYYY-MM-DD format",\n' +
'  "vendor": "vendor or store name",\n' +
'  "reason": "brief business reason for this purchase",\n' +
'  "category": "best matching category from this list: ' + CATEGORIES.join(', ') + '"\n' +
'}' }
      ]
    }]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  var result = JSON.parse(response.getContentText());
  if (result.error) throw new Error(result.error.message);

  var text = result.content[0].text.trim().replace(/```json|```/g, '').trim();
  var parsed = JSON.parse(text);
  // Normalise date to YYYY-MM-DD for the PWA's date input.
  parsed.date = toIsoDate(parsed.date);
  // Make sure the category is one we recognise; otherwise leave blank for manual pick.
  if (CATEGORIES.indexOf(parsed.category) === -1) parsed.category = '';
  return parsed;
}

// ======================= ADD EXPENSE =======================
function addExpense(req) {
  var purchases = String(req.purchases || '').trim();
  var cost = parseFloat(req.cost);
  var vendor = String(req.vendor || '').trim();
  var reason = String(req.reason || '').trim();
  var category = String(req.category || '').trim();
  var d = parseDate(req.date);

  if (isNaN(cost)) throw new Error('Cost is not a valid number.');
  if (!category) throw new Error('Category is required.');
  if (!d) throw new Error('Date is missing or invalid.');

  var quarter = quarterOf(d);
  var ss = openSpreadsheet();
  var sheet = ss.getSheetByName(EXPENSES_SHEET);
  if (!sheet) throw new Error('Sheet not found: ' + EXPENSES_SHEET);

  // Columns: Purchases | Cost | Date | Vendor | Reason | Category | Quarter
  sheet.appendRow([purchases, cost, d, vendor, reason, category, quarter]);

  var savedFile = null;
  if (req.base64Image) {
    savedFile = saveReceiptImage(req.base64Image, req.mimeType || 'image/jpeg', vendor, d);
  }

  return { quarter: quarter, savedFile: savedFile };
}

function saveReceiptImage(base64Image, mimeType, vendor, dateObj) {
  var folder = DriveApp.getRootFolder();
  for (var i = 0; i < DRIVE_FOLDER_PATH.length; i++) {
    var folders = folder.getFoldersByName(DRIVE_FOLDER_PATH[i]);
    if (!folders.hasNext()) throw new Error('Drive folder not found: ' + DRIVE_FOLDER_PATH[i]);
    folder = folders.next();
  }
  var ext = (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  var safeVendor = (vendor || 'receipt').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  var fileName = safeVendor + '_' + isoLocal(dateObj) + '.' + ext;
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Image), mimeType, fileName);
  folder.createFile(blob);
  return fileName;
}

// ======================= ADD INCOME =======================
function addIncome(req) {
  var source = String(req.source || '').trim();
  var amount = parseFloat(req.amount);
  var d = parseDate(req.date);
  if (isNaN(amount)) throw new Error('Amount is not a valid number.');
  if (!d) throw new Error('Date is missing or invalid.');

  var ss = openSpreadsheet();
  var sheet = ss.getSheetByName(INCOME_SHEET);
  if (!sheet) throw new Error('Income sheet not found. Run the one-time "setup" action first.');
  if (!isNewIncomeLayout(sheet)) {
    throw new Error('Income tab has not been rebuilt yet. Run the one-time "setup" action first.');
  }

  var quarter = quarterOf(d);
  // Columns: Date | Source | Amount | Quarter
  sheet.appendRow([d, source, amount, quarter]);
  return { quarter: quarter };
}

// ======================= GET DATA (for dashboard/reports/PNL) =======================
function getData(req) {
  var ss = openSpreadsheet();
  var expenses = readTable(ss.getSheetByName(EXPENSES_SHEET), 3, 7, function (row) {
    if (row[1] === '' || row[1] === null) return null; // no cost -> skip empty row
    return {
      purchases: str(row[0]),
      cost: num(row[1]),
      date: toIsoDate(row[2]),
      vendor: str(row[3]),
      reason: str(row[4]),
      category: str(row[5]),
      quarter: str(row[6])
    };
  });

  var incomeSheet = ss.getSheetByName(INCOME_SHEET);
  var income = [];
  if (incomeSheet && isNewIncomeLayout(incomeSheet)) {
    income = readTable(incomeSheet, 3, 4, function (row) {
      if ((row[2] === '' || row[2] === null) && !row[0]) return null;
      return {
        date: toIsoDate(row[0]),
        source: str(row[1]),
        amount: num(row[2]),
        quarter: str(row[3])
      };
    });
  }

  return { expenses: expenses, income: income, categories: CATEGORIES, year: YEAR, incomeReady: income !== null };
}

// ======================= ONE-TIME SETUP: rebuild Income tab =======================
function setupWorkbook(req) {
  var ss = openSpreadsheet();
  var oldSheet = ss.getSheetByName(INCOME_SHEET);
  if (oldSheet && isNewIncomeLayout(oldSheet)) {
    return { alreadyDone: true, message: 'Income tab already uses the clean table layout.' };
  }

  // 1) Harvest existing income entries (date in col A + amount in col C) from the old layout.
  var migrated = [];
  if (oldSheet) {
    var values = oldSheet.getDataRange().getValues();
    for (var r = 0; r < values.length; r++) {
      var a = values[r][0];
      var c = values[r][2];
      if (a instanceof Date && typeof c === 'number' && c > 0) {
        migrated.push({ date: a, amount: c });
      }
    }
    // 2) Preserve the old sheet as a backup rather than deleting it.
    var backupName = 'Income (old)';
    if (ss.getSheetByName(backupName)) ss.getSheetByName(backupName).setName('Income (old ' + Date.now() + ')');
    oldSheet.setName(backupName);
  }

  // 3) Create the new clean Income table.
  var sheet = ss.insertSheet(INCOME_SHEET, 0);
  sheet.getRange(1, 1).setValue(YEAR + ' Income - Steve\'s Horizon');
  sheet.getRange(2, 1, 1, 4).setValues([['Date', 'Source', 'Amount', 'Quarter']]);
  sheet.getRange(2, 1, 1, 4).setFontWeight('bold');
  sheet.setFrozenRows(2);

  migrated.sort(function (x, y) { return x.date - y.date; });
  if (migrated.length) {
    var rows = migrated.map(function (m) { return [m.date, '', m.amount, quarterOf(m.date)]; });
    sheet.getRange(3, 1, rows.length, 4).setValues(rows);
  }
  sheet.getRange(3, 1, Math.max(migrated.length, 1) + 200, 1).setNumberFormat('m/d/yyyy');
  sheet.getRange(3, 3, Math.max(migrated.length, 1) + 200, 1).setNumberFormat('$#,##0.00');
  sheet.autoResizeColumns(1, 4);

  // 4) Repoint PL "Gross Income" to sum the new Amount column.
  var pl = ss.getSheetByName(PL_SHEET);
  if (pl) pl.getRange('C4').setFormula('=SUM(' + INCOME_SHEET + '!C3:C100000)');

  return {
    alreadyDone: false,
    migratedCount: migrated.length,
    message: 'Income tab rebuilt as Date | Source | Amount | Quarter. Old tab kept as "Income (old)". ' +
             'Migrated ' + migrated.length + ' ent(y/ies) with a blank Source for you to fill in.'
  };
}

// ======================= HELPERS =======================
function openSpreadsheet() {
  var files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (!files.hasNext()) throw new Error('Spreadsheet not found: ' + SPREADSHEET_NAME);
  return SpreadsheetApp.open(files.next());
}

// A rebuilt Income sheet has "Date" in A2.
function isNewIncomeLayout(sheet) {
  return String(sheet.getRange(2, 1).getValue()).trim().toLowerCase() === 'date';
}

function readTable(sheet, startRow, numCols, mapFn) {
  if (!sheet) return [];
  var last = sheet.getLastRow();
  if (last < startRow) return [];
  var values = sheet.getRange(startRow, 1, last - startRow + 1, numCols).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var mapped = mapFn(values[i]);
    if (mapped) out.push(mapped);
  }
  return out;
}

function parseDate(v) {
  if (v instanceof Date) return v;
  if (v === null || v === undefined || v === '') return null;
  var s = String(v).trim();
  var m;
  // YYYY-MM-DD
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  // M/D/YYYY  or  MM/DD/YYYY
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) {
    return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function quarterOf(dateObj) {
  var month = dateObj.getMonth() + 1; // 1-12
  return month <= 3 ? 'Q1' : month <= 6 ? 'Q2' : month <= 9 ? 'Q3' : 'Q4';
}

// Local (spreadsheet-timezone) ISO date, no time component.
function isoLocal(dateObj) {
  return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function toIsoDate(v) {
  var d = parseDate(v);
  return d ? isoLocal(d) : '';
}

function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function num(v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
