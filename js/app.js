/* ============================================================
   PNL Builder — front-end logic
   ============================================================ */
'use strict';

const CATEGORIES = [
  'Advertising', 'Office Expenses', 'Insurance', 'Legal and Professional Services',
  'Travel', 'Utilities', 'Supplies', 'Mortgage', 'Subscriptions', 'Dues and Fees',
  'Mail', 'Internet', 'Cell Phone', 'Business Meeting'
];
const TAX_RATE = 0.30; // quarterly tax estimate

// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}/${y}`; };
const quarterOfISO = (iso) => { const m = Number((iso || '').split('-')[1]); return m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4'; };

function getUrl() { return (localStorage.getItem('pnl_url') || (window.PNL_CONFIG && window.PNL_CONFIG.WEB_APP_URL) || '').trim(); }

// ---------- overlay / toast ----------
function showOverlay(msg) { $('overlayMsg').textContent = msg || 'Working…'; $('overlay').hidden = false; }
function hideOverlay() { $('overlay').hidden = true; }
let toastTimer;
function toast(msg, kind) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ---------- API ----------
async function api(action, payload) {
  const url = getUrl();
  if (!url) throw new Error('Not connected. Add your Apps Script URL in Settings (⚙️).');
  // No custom headers => body is sent as text/plain => a "simple" CORS request (no preflight).
  const res = await fetch(url, { method: 'POST', redirect: 'follow', body: JSON.stringify(Object.assign({ action }, payload || {})) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Unexpected server response. Check the Web App URL and that it is deployed with access "Anyone".'); }
  if (!data.ok) throw new Error(data.error || 'Server error');
  return data.data;
}

// ============================================================
//  DATA (cached for offline)
// ============================================================
let DATA = { expenses: [], income: [], loadedAt: null };

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem('pnl_cache'));
    if (c && c.expenses) DATA = c;
  } catch (e) {}
}
async function refreshData() {
  const d = await api('getData');
  DATA = { expenses: d.expenses || [], income: d.income || [], loadedAt: Date.now() };
  localStorage.setItem('pnl_cache', JSON.stringify(DATA));
  return DATA;
}
function stampText() {
  if (!DATA.loadedAt) return 'No data loaded yet.';
  return 'Updated ' + new Date(DATA.loadedAt).toLocaleString();
}

// ============================================================
//  NAVIGATION
// ============================================================
function goto(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === screenId));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === screenId));
  if (screenId === 'screen-dashboard') renderDashboard();
}
document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => goto(b.dataset.screen)));

// ============================================================
//  ADD ENTRY
// ============================================================
let scanImage = null; // {base64, mime, name}

function initAdd() {
  $('entryDate').value = todayISO();
  const sel = $('e_category');
  CATEGORIES.forEach((c) => { const o = document.createElement('option'); o.textContent = c; sel.appendChild(o); });

  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    const isIncome = b.dataset.type === 'income';
    $('incomeForm').hidden = !isIncome;
    $('expenseForm').hidden = isIncome;
  }));

  $('takePhotoBtn').addEventListener('click', () => $('cameraInput').click());
  $('chooseFileBtn').addEventListener('click', () => $('fileInput').click());
  $('cameraInput').addEventListener('change', onFilePicked);
  $('fileInput').addEventListener('change', onFilePicked);
  $('scanBtn').addEventListener('click', doScan);
  $('saveExpenseBtn').addEventListener('click', saveExpense);
  $('saveIncomeBtn').addEventListener('click', saveIncome);
}

function onFilePicked(e) {
  const file = e.target.files[0];
  if (!file) return;
  const mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
  // Claude limits: ~32MB PDF, ~5MB image. Warn early rather than fail server-side.
  const maxMB = mime === 'application/pdf' ? 30 : 5;
  if (file.size > maxMB * 1024 * 1024) {
    return toast(`That file is ${(file.size / 1048576).toFixed(1)}MB — max ${maxMB}MB. Try a smaller scan.`, 'err');
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    scanImage = { base64: dataUrl.split(',')[1], mime: mime, name: file.name || 'receipt' };
    const img = $('preview');
    const chip = $('pdfChip');
    if (mime === 'application/pdf') {
      img.hidden = true; img.src = '';
      chip.textContent = '📄 ' + scanImage.name;
      chip.hidden = false;
    } else {
      chip.hidden = true;
      img.src = dataUrl; img.hidden = false;
    }
    $('scanBtn').hidden = false;
  };
  reader.readAsDataURL(file);
}

async function doScan() {
  if (!scanImage) return;
  showOverlay('🔍 Reading receipt with Claude…');
  try {
    const d = await api('scanReceipt', { base64Image: scanImage.base64, mimeType: scanImage.mime });
    $('e_purchases').value = d.purchases || '';
    $('e_cost').value = d.cost || '';
    $('e_vendor').value = d.vendor || '';
    $('e_reason').value = d.reason || '';
    if (d.date) $('entryDate').value = d.date;
    if (d.category) $('e_category').value = d.category;
    toast('Receipt scanned — review & save', 'ok');
  } catch (err) { toast(err.message, 'err'); }
  finally { hideOverlay(); }
}

async function saveExpense() {
  const payload = {
    date: $('entryDate').value,
    purchases: $('e_purchases').value.trim(),
    cost: $('e_cost').value,
    vendor: $('e_vendor').value.trim(),
    reason: $('e_reason').value.trim(),
    category: $('e_category').value
  };
  if (!payload.date) return toast('Pick a date', 'err');
  if (!payload.cost || isNaN(parseFloat(payload.cost))) return toast('Enter a cost', 'err');
  if (!payload.category) return toast('Choose a category', 'err');
  if (scanImage) { payload.base64Image = scanImage.base64; payload.mimeType = scanImage.mime; }

  showOverlay('💾 Saving expense…');
  try {
    const r = await api('addExpense', payload);
    toast('Expense saved' + (r.savedFile ? ' + receipt filed' : '') + ' (' + r.quarter + ')', 'ok');
    resetExpense();
    DATA.loadedAt = null; // force refresh next time totals are viewed
  } catch (err) { toast(err.message, 'err'); }
  finally { hideOverlay(); }
}

function resetExpense() {
  ['e_purchases', 'e_cost', 'e_vendor', 'e_reason'].forEach((id) => ($(id).value = ''));
  $('e_category').value = '';
  scanImage = null;
  $('preview').hidden = true; $('preview').src = '';
  $('pdfChip').hidden = true; $('pdfChip').textContent = '';
  $('scanBtn').hidden = true;
  $('fileInput').value = ''; $('cameraInput').value = '';
}

async function saveIncome() {
  const payload = { date: $('entryDate').value, source: $('i_source').value.trim(), amount: $('i_amount').value };
  if (!payload.date) return toast('Pick a date', 'err');
  if (!payload.amount || isNaN(parseFloat(payload.amount))) return toast('Enter an amount', 'err');
  showOverlay('💾 Saving income…');
  try {
    const r = await api('addIncome', payload);
    toast('Income saved (' + r.quarter + ')', 'ok');
    $('i_source').value = ''; $('i_amount').value = '';
    DATA.loadedAt = null;
  } catch (err) { toast(err.message, 'err'); }
  finally { hideOverlay(); }
}

// ============================================================
//  DASHBOARD
// ============================================================
async function renderDashboard(force) {
  if (force || !DATA.loadedAt) {
    showOverlay('Loading…');
    try { await refreshData(); } catch (err) { toast('Offline — showing last saved data. ' + err.message, 'err'); }
    finally { hideOverlay(); }
  }
  const inc = sum(DATA.income, 'amount');
  const exp = sum(DATA.expenses, 'cost');
  const profit = inc - exp;
  $('d_income').textContent = money(inc);
  $('d_expense').textContent = money(exp);
  const p = $('d_profit'); p.textContent = money(profit);
  p.className = profit >= 0 ? 'pos' : 'neg';

  const all = combined().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15);
  $('recentList').innerHTML = all.length ? all.map(entryRow).join('') : '<div class="empty">No entries yet.</div>';
  $('dataStamp').textContent = stampText();
}
$('refreshBtn').addEventListener('click', () => renderDashboard(true));

let ENTRY_MAP = {};
function combined() {
  const list = [
    ...DATA.expenses.map((e) => ({ kind: 'expense', id: 'expense:' + e.row, row: e.row, date: e.date, title: e.purchases || e.vendor || 'Expense', sub: [e.vendor, e.category].filter(Boolean).join(' · '), amount: e.cost, category: e.category, vendor: e.vendor, reason: e.reason, purchases: e.purchases, source: '' })),
    ...DATA.income.map((i) => ({ kind: 'income', id: 'income:' + i.row, row: i.row, date: i.date, title: i.source || 'Income', sub: 'Income', amount: i.amount, category: '', vendor: '', reason: '', purchases: '', source: i.source }))
  ];
  ENTRY_MAP = {};
  list.forEach((e) => { if (e.row) ENTRY_MAP[e.id] = e; });
  return list;
}
function entryRow(e) {
  const tap = e.row ? ` data-id="${esc(e.id)}"` : '';
  return `<div class="entry"${tap}><div class="e-main"><div class="e-title">${esc(e.title)}</div>
    <div class="e-sub">${esc(fmtDate(e.date))}${e.sub ? ' · ' + esc(e.sub) : ''}</div></div>
    <div class="e-amt ${e.kind}">${e.kind === 'income' ? '+' : '−'}${money(e.amount)}</div></div>`;
}
function sum(arr, key) { return arr.reduce((t, x) => t + (Number(x[key]) || 0), 0); }

// ============================================================
//  REPORTS
// ============================================================
function initReports() {
  $('r_month').value = todayISO().slice(0, 7);
  $('r_from').value = todayISO().slice(0, 4) + '-01-01';
  $('r_to').value = todayISO();
  $('r_period').addEventListener('change', syncReportPeriod);
  $('r_dim').addEventListener('change', syncReportDim);
  $('runReportBtn').addEventListener('click', runReport);
  $('rep_csv').addEventListener('click', () => exportReportCSV());
  $('rep_pdf').addEventListener('click', () => exportReportPDF());
}
function syncReportPeriod() {
  const v = $('r_period').value;
  $('r_monthWrap').hidden = v !== 'month';
  $('r_quarterWrap').hidden = v !== 'quarter';
  $('r_rangeWrap').hidden = v !== 'range';
}
function syncReportDim() {
  const dim = $('r_dim').value;
  const valSel = $('r_dimValue');
  if (!dim) { valSel.hidden = true; return; }
  let values = [];
  if (dim === 'category') values = [...new Set(DATA.expenses.map((e) => e.category).filter(Boolean))];
  if (dim === 'vendor') values = [...new Set(DATA.expenses.map((e) => e.vendor).filter(Boolean))];
  if (dim === 'source') values = [...new Set(DATA.income.map((e) => e.source).filter(Boolean))];
  values.sort();
  valSel.innerHTML = '<option value="">— Any —</option>' + values.map((v) => `<option>${esc(v)}</option>`).join('');
  valSel.hidden = false;
}

function periodPredicate(period, opts) {
  if (period === 'year') return () => true;
  if (period === 'month') { const ym = $(opts.month).value; return (iso) => iso.slice(0, 7) === ym; }
  if (period === 'quarter') { const q = $(opts.quarter).value; return (iso) => quarterOfISO(iso) === q; }
  if (period === 'range') { const f = $(opts.from).value, t = $(opts.to).value; return (iso) => (!f || iso >= f) && (!t || iso <= t); }
  return () => true;
}
function periodLabel(period, opts) {
  if (period === 'year') return 'Full year ' + todayISO().slice(0, 4);
  if (period === 'month') { const ym = $(opts.month).value; const [y, m] = ym.split('-'); return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }); }
  if (period === 'quarter') return $(opts.quarter).value + ' ' + todayISO().slice(0, 4);
  if (period === 'range') return fmtDate($(opts.from).value) + ' – ' + fmtDate($(opts.to).value);
  return '';
}

let lastReport = null;
function runReport() {
  if (!DATA.loadedAt && !DATA.expenses.length) { toast('Loading data…', ''); return renderDashboard(true).then(runReport); }
  const pred = periodPredicate($('r_period').value, { month: 'r_month', quarter: 'r_quarter', from: 'r_from', to: 'r_to' });
  const type = $('r_type').value;
  const dim = $('r_dim').value, dimVal = $('r_dimValue').value;

  let rows = combined().filter((e) => pred(e.date));
  if (type !== 'all') rows = rows.filter((e) => e.kind === type);
  if (dim && dimVal) rows = rows.filter((e) => (e[dim] || '') === dimVal);
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));

  const inc = sum(rows.filter((r) => r.kind === 'income'), 'amount');
  const exp = sum(rows.filter((r) => r.kind === 'expense'), 'amount');
  $('rep_income').textContent = money(inc);
  $('rep_expense').textContent = money(exp);
  $('rep_net').textContent = money(inc - exp);
  $('reportRows').innerHTML = rows.length ? rows.map(entryRow).join('') : '<div class="empty">No matching entries.</div>';
  $('reportResult').hidden = false;

  lastReport = { rows, inc, exp, label: periodLabel($('r_period').value, { month: 'r_month', quarter: 'r_quarter', from: 'r_from', to: 'r_to' }), type, dim, dimVal };
}

function exportReportCSV() {
  if (!lastReport) return;
  const head = ['Date', 'Type', 'Description', 'Vendor/Source', 'Category', 'Amount'];
  const lines = lastReport.rows.map((r) => [fmtDate(r.date), r.kind, r.title, r.vendor || r.source, r.category, (Number(r.amount) || 0).toFixed(2)]);
  lines.push([]);
  lines.push(['', '', '', '', 'Income', lastReport.inc.toFixed(2)]);
  lines.push(['', '', '', '', 'Expenses', lastReport.exp.toFixed(2)]);
  lines.push(['', '', '', '', 'Net', (lastReport.inc - lastReport.exp).toFixed(2)]);
  downloadCSV('PNL_Report_' + safe(lastReport.label) + '.csv', [head, ...lines]);
}
function exportReportPDF() {
  if (!lastReport) return;
  const rowsHtml = lastReport.rows.map((r) => `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(r.kind)}</td>
    <td>${esc(r.title)}</td><td>${esc(r.vendor || r.source)}</td><td>${esc(r.category)}</td>
    <td class="num ${r.kind}">${r.kind === 'income' ? '' : '-'}${money(r.amount)}</td></tr>`).join('');
  const body = `
    <h1>Expense &amp; Income Report</h1>
    <p class="meta">Horizon Turnout Gear · ${esc(lastReport.label)}</p>
    <table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Vendor / Source</th><th>Category</th><th class="num">Amount</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="6">No entries.</td></tr>'}</tbody></table>
    <table class="totals"><tbody>
      <tr><td>Total Income</td><td class="num">${money(lastReport.inc)}</td></tr>
      <tr><td>Total Expenses</td><td class="num">${money(lastReport.exp)}</td></tr>
      <tr class="grand"><td>Net</td><td class="num">${money(lastReport.inc - lastReport.exp)}</td></tr>
    </tbody></table>`;
  printHTML('PNL Report — ' + lastReport.label, body);
}

// ============================================================
//  P&L
// ============================================================
function initPnl() {
  $('pnl_from').value = todayISO().slice(0, 4) + '-01-01';
  $('pnl_to').value = todayISO();
  $('pnl_period').addEventListener('change', () => {
    const v = $('pnl_period').value;
    $('pnl_quarterWrap').hidden = v !== 'quarter';
    $('pnl_rangeWrap').hidden = v !== 'range';
  });
  $('runPnlBtn').addEventListener('click', runPnl);
  $('pnl_csv').addEventListener('click', exportPnlCSV);
  $('pnl_pdf').addEventListener('click', exportPnlPDF);
}

let lastPnl = null;
async function runPnl() {
  if (!DATA.loadedAt && !DATA.expenses.length) { await renderDashboard(true); }
  const period = $('pnl_period').value;
  const pred = periodPredicate(period === 'year' ? 'year' : period, { quarter: 'pnl_quarter', from: 'pnl_from', to: 'pnl_to' });
  const label = period === 'year' ? 'Full Year ' + todayISO().slice(0, 4)
    : period === 'quarter' ? $('pnl_quarter').value + ' ' + todayISO().slice(0, 4)
    : fmtDate($('pnl_from').value) + ' – ' + fmtDate($('pnl_to').value);

  const inc = DATA.income.filter((i) => pred(i.date));
  const exp = DATA.expenses.filter((e) => pred(e.date));
  const incomeTotal = sum(inc, 'amount');
  const byCat = CATEGORIES.map((c) => ({ cat: c, total: sum(exp.filter((e) => e.category === c), 'cost') })).filter((r) => r.total > 0);
  const uncategorised = sum(exp.filter((e) => !CATEGORIES.includes(e.category)), 'cost');
  if (uncategorised > 0) byCat.push({ cat: 'Uncategorised', total: uncategorised });
  const expenseTotal = sum(exp, 'cost');
  const net = incomeTotal - expenseTotal;
  const tax = Math.max(0, net) * TAX_RATE;

  lastPnl = { label, incomeTotal, byCat, expenseTotal, net, tax, incomeBySource: groupSum(inc, 'source', 'amount') };
  renderPnl();
  $('pnlResult').hidden = false;
}
function groupSum(arr, key, valKey) {
  const m = {};
  arr.forEach((x) => { const k = x[key] || '(no source)'; m[k] = (m[k] || 0) + (Number(x[valKey]) || 0); });
  return Object.entries(m).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
}
function renderPnl() {
  const p = lastPnl;
  const incRows = p.incomeBySource.map((s) => `<div class="pnl-line sub"><span>${esc(s.k)}</span><span>${money(s.v)}</span></div>`).join('');
  const expRows = p.byCat.map((c) => `<div class="pnl-line sub"><span>${esc(c.cat)}</span><span>${money(c.total)}</span></div>`).join('');
  $('pnlBody').innerHTML = `
    <p class="muted small center">Horizon Turnout Gear · ${esc(p.label)}</p>
    <div class="pnl-h">Income</div>${incRows || '<div class="pnl-line sub muted"><span>None</span><span>$0.00</span></div>'}
    <div class="pnl-line total"><span>Total Income</span><span>${money(p.incomeTotal)}</span></div>
    <div class="pnl-h">Expenses</div>${expRows || '<div class="pnl-line sub muted"><span>None</span><span>$0.00</span></div>'}
    <div class="pnl-line total"><span>Total Expenses</span><span>${money(p.expenseTotal)}</span></div>
    <div class="pnl-line total"><span>Net Profit / Loss</span><span class="pnl-net ${p.net >= 0 ? 'pos' : 'neg'}">${money(p.net)}</span></div>
    <div class="pnl-line sub"><span>Est. tax set-aside (30% of profit)</span><span>${money(p.tax)}</span></div>`;
}
function exportPnlCSV() {
  if (!lastPnl) return;
  const p = lastPnl;
  const rows = [['Profit & Loss — Horizon Turnout Gear'], [p.label], [],
    ['INCOME', ''], ...p.incomeBySource.map((s) => [s.k, s.v.toFixed(2)]), ['Total Income', p.incomeTotal.toFixed(2)], [],
    ['EXPENSES', ''], ...p.byCat.map((c) => [c.cat, c.total.toFixed(2)]), ['Total Expenses', p.expenseTotal.toFixed(2)], [],
    ['Net Profit / Loss', p.net.toFixed(2)], ['Est. tax set-aside (30%)', p.tax.toFixed(2)]];
  downloadCSV('PNL_Statement_' + safe(p.label) + '.csv', rows);
}
function exportPnlPDF() {
  if (!lastPnl) return;
  const p = lastPnl;
  const incRows = p.incomeBySource.map((s) => `<tr><td>${esc(s.k)}</td><td class="num">${money(s.v)}</td></tr>`).join('') || '<tr><td>None</td><td class="num">$0.00</td></tr>';
  const expRows = p.byCat.map((c) => `<tr><td>${esc(c.cat)}</td><td class="num">${money(c.total)}</td></tr>`).join('') || '<tr><td>None</td><td class="num">$0.00</td></tr>';
  const body = `
    <h1>Profit &amp; Loss Statement</h1>
    <p class="meta">Horizon Turnout Gear · ${esc(p.label)}</p>
    <h2>Income</h2><table>${incRows}<tr class="grand"><td>Total Income</td><td class="num">${money(p.incomeTotal)}</td></tr></table>
    <h2>Expenses</h2><table>${expRows}<tr class="grand"><td>Total Expenses</td><td class="num">${money(p.expenseTotal)}</td></tr></table>
    <table class="totals"><tr class="grand big"><td>Net Profit / Loss</td><td class="num">${money(p.net)}</td></tr>
    <tr><td>Estimated tax set-aside (30% of profit)</td><td class="num">${money(p.tax)}</td></tr></table>`;
  printHTML('P&L — ' + p.label, body);
}

// ============================================================
//  EXPORT HELPERS
// ============================================================
function safe(s) { return String(s).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, ''); }
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const PRINT_CSS = `
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;padding:24px;max-width:760px;margin:auto;}
  h1{font-size:22px;margin:0 0 2px;} h2{font-size:15px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;}
  .meta{color:#666;margin:0 0 14px;font-size:13px;}
  table{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:13px;}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;}
  th{border-bottom:2px solid #333;font-size:11px;text-transform:uppercase;letter-spacing:.4px;}
  .num{text-align:right;white-space:nowrap;} td.income{color:#127a52;} td.expense{color:#b3261e;}
  tr.grand td{border-top:2px solid #333;font-weight:700;border-bottom:none;}
  tr.grand.big td{font-size:16px;} table.totals{margin-top:4px;}
  @media print{@page{margin:14mm;}}`;
function printHTML(title, bodyHtml) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  const win = iframe.contentWindow;
  setTimeout(() => { win.focus(); win.print(); setTimeout(() => iframe.remove(), 1500); }, 350);
}

// ============================================================
//  EDIT / DELETE ENTRY
// ============================================================
let editing = null;
function initEdit() {
  const sel = $('ed_category');
  sel.innerHTML = '<option value="">— Select category —</option>';
  CATEGORIES.forEach((c) => { const o = document.createElement('option'); o.textContent = c; sel.appendChild(o); });
  ['recentList', 'reportRows'].forEach((id) => $(id).addEventListener('click', (ev) => {
    const el = ev.target.closest('.entry[data-id]');
    if (el) openEdit(el.getAttribute('data-id'));
  }));
  $('ed_save').addEventListener('click', saveEdit);
  $('ed_delete').addEventListener('click', deleteEdit);
  $('ed_cancel').addEventListener('click', closeEdit);
}
function openEdit(id) {
  const e = ENTRY_MAP[id];
  if (!e) return;
  editing = e;
  $('ed_status').textContent = '';
  const isIncome = e.kind === 'income';
  $('editTitle').textContent = isIncome ? 'Edit income' : 'Edit expense';
  $('editIncomeFields').hidden = !isIncome;
  $('editExpenseFields').hidden = isIncome;
  $('ed_date').value = e.date || '';
  if (isIncome) {
    $('ed_source').value = e.source || '';
    $('ed_amount').value = e.amount != null ? e.amount : '';
  } else {
    $('ed_purchases').value = e.purchases || '';
    $('ed_cost').value = e.amount != null ? e.amount : '';
    $('ed_vendor').value = e.vendor || '';
    $('ed_reason').value = e.reason || '';
    $('ed_category').value = e.category || '';
  }
  $('editModal').hidden = false;
}
function closeEdit() { $('editModal').hidden = true; editing = null; }

async function saveEdit() {
  if (!editing) return;
  const e = editing, date = $('ed_date').value;
  if (!date) return toast('Pick a date', 'err');
  let action, payload;
  if (e.kind === 'income') {
    const amt = $('ed_amount').value;
    if (!amt || isNaN(parseFloat(amt))) return toast('Enter an amount', 'err');
    action = 'updateIncome';
    payload = { row: e.row, date: date, source: $('ed_source').value.trim(), amount: amt, expect: e.amount };
  } else {
    const cost = $('ed_cost').value;
    if (!cost || isNaN(parseFloat(cost))) return toast('Enter a cost', 'err');
    if (!$('ed_category').value) return toast('Choose a category', 'err');
    action = 'updateExpense';
    payload = { row: e.row, date: date, purchases: $('ed_purchases').value.trim(), cost: cost, vendor: $('ed_vendor').value.trim(), reason: $('ed_reason').value.trim(), category: $('ed_category').value, expect: e.amount };
  }
  showOverlay('Saving changes…');
  try { await api(action, payload); toast('Entry updated', 'ok'); closeEdit(); await afterMutation(); }
  catch (err) { toast(err.message, 'err'); }
  finally { hideOverlay(); }
}

async function deleteEdit() {
  if (!editing) return;
  if (!confirm('Delete this entry? It removes the row from your Google Sheet.')) return;
  const e = editing;
  showOverlay('Deleting…');
  try { await api('deleteEntry', { kind: e.kind, row: e.row, expect: e.amount }); toast('Entry deleted', 'ok'); closeEdit(); await afterMutation(); }
  catch (err) { toast(err.message, 'err'); }
  finally { hideOverlay(); }
}

// Reload from the sheet and re-render whatever the user is looking at.
async function afterMutation() {
  try { await refreshData(); } catch (err) { toast('Saved, but reload failed. ' + err.message, 'err'); }
  renderDashboard();
  if (lastReport) runReport();
  if (lastPnl) runPnl();
}

// ============================================================
//  SETTINGS
// ============================================================
function initSettings() {
  const open = () => { $('s_url').value = getUrl(); $('s_status').textContent = ''; $('settingsModal').hidden = false; };
  $('settingsBtn').addEventListener('click', open);
  $('setupBanner').addEventListener('click', open);
  $('s_close').addEventListener('click', () => ($('settingsModal').hidden = true));
  $('s_save').addEventListener('click', async () => {
    const url = $('s_url').value.trim();
    if (!/\/exec$/.test(url)) { $('s_status').textContent = '⚠️ URL should end in /exec'; }
    localStorage.setItem('pnl_url', url);
    $('s_status').textContent = 'Testing…';
    try { await api('ping'); $('s_status').textContent = '✅ Connected!'; setConn(true); $('setupBanner').hidden = true; toast('Connected', 'ok'); }
    catch (err) { $('s_status').textContent = '❌ ' + err.message; setConn(false); }
  });
  $('s_runSetup').addEventListener('click', async () => {
    $('s_status').textContent = 'Rebuilding Income tab…';
    try { const r = await api('setup'); $('s_status').textContent = '✅ ' + r.message; toast('Sheet setup done', 'ok'); }
    catch (err) { $('s_status').textContent = '❌ ' + err.message; }
  });
}
function setConn(ok) { const d = $('connDot'); d.className = 'conn-dot ' + (ok ? 'ok' : 'bad'); }

// ============================================================
//  BOOT
// ============================================================
function init() {
  loadCache();
  initAdd();
  initReports();
  initPnl();
  initEdit();
  initSettings();
  $('setupBanner').hidden = !!getUrl();
  if (getUrl()) { api('ping').then(() => setConn(true)).catch(() => setConn(false)); }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}
init();
