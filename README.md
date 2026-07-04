# PNL Builder

A phone‑first web app (PWA) for tracking business **expenses** and **income**, scanning receipts with AI, and generating clean **reports** and a **Profit & Loss statement** for your accountant — all feeding directly into your existing `Steve_Horizon 26 PNL` Google Sheet.

Built for **Steve Smith · Horizon Turnout Gear**.

- **Live app:** https://stevehtg.github.io/PNL-Builder/
- **Source:** https://github.com/SteveHTG/PNL-Builder
- **Setup / deploy steps:** see [SETUP_GUIDE.md](SETUP_GUIDE.md)

---

## 1. What it does

| Feature | Description |
|---|---|
| **Add expense — scan** | Take a photo, choose an existing photo/screenshot, or upload a **PDF** of a receipt. Claude AI reads the vendor, amount, date, business reason, and category. You review, then save. |
| **Add expense — manual** | Type an expense in directly (no photo needed). |
| **Add income** | Record a date, source, and amount. |
| **Edit / delete** | Tap any entry in the Totals or Reports list to change its fields or delete it — the change is written straight back to your Google Sheet. Scanned expenses show a **📎 View receipt** link that opens the saved file in Drive. |
| **Duplicate warning** | Saving an expense with the same date, amount, and vendor as an existing entry asks for confirmation first (catches double-scanned receipts). |
| **Dashboard (Totals)** | Live totals: income, expenses, profit/loss, and your most recent entries. |
| **Reports** | Filter by month / quarter / year / custom date range, by type (income vs expense), and by category / vendor / source. Export to **CSV** or **PDF**. |
| **P&L** | An accountant‑ready Profit & Loss statement — income by source, expenses by category, net profit, and a 30% quarterly tax set‑aside estimate. Export to **CSV** or **PDF**. |
| **Installable** | Add to your phone's home screen; runs full‑screen like a native app and opens offline (viewing last data). |

Everything you save is written into your real Google Sheet, so your accountant and your existing formulas keep working.

---

## 2. How it's put together (architecture)

There are three pieces:

```
   ┌─────────────────────────────┐
   │  PNL Builder PWA             │   ← the app you see (HTML/CSS/JS)
   │  hosted on GitHub Pages      │      installed on your phone
   └──────────────┬──────────────┘
                  │  fetch() over HTTPS (JSON)
                  ▼
   ┌─────────────────────────────┐
   │  Google Apps Script Web App │   ← the "backend" (Code.gs)
   │  runs under YOUR Google acct │      holds the Anthropic API key
   └───────┬─────────────┬────────┘
           │             │
           ▼             ▼
   ┌───────────────┐  ┌────────────────────────┐
   │ Anthropic     │  │ Google Sheet + Drive   │
   │ Claude API    │  │ Steve_Horizon 26 PNL   │
   │ (reads recpts)│  │ + Horizon/Receipts/…   │
   └───────────────┘  └────────────────────────┘
```

**Why split it this way?**

- **The app (front‑end)** is just static files, so it's free to host on GitHub Pages and installs as a PWA — exactly like your other projects.
- **The backend (Apps Script)** runs inside *your* Google account. That's what lets it (a) keep your Anthropic API key hidden, (b) call Claude to read receipts, and (c) read/write your Google Sheet and save receipt images to Google Drive — all without exposing any secrets to the public web app.

**Your data never lives on GitHub.** GitHub only holds the app's code. Your financial data stays in your Google Sheet, in your Google account.

---

## 3. What happens when you… (data flow)

### Scan a receipt
1. You pick/take a photo or PDF in the app.
2. The file is read in your browser as base64 and sent to the Apps Script backend (`scanReceipt`).
3. The backend sends it to **Claude** (image → `image` block, PDF → `document` block) with a prompt asking for vendor / cost / date / reason / category as JSON.
4. Claude's answer comes back to the app and fills in the form for you to review.
5. On **Save**, the app calls `addExpense`: the backend appends a row to the **Expenses** tab and saves the receipt image/PDF to `Horizon/Receipts/2026/` in Drive.

### Add income
1. You enter date, source, amount → **Save**.
2. The app calls `addIncome`; the backend appends a row to the **Income** tab.

### View totals / run a report / generate a P&L
1. The app calls `getData` once, which returns all expenses and income.
2. The app builds the dashboard, reports, and P&L **in your browser** from that data (and caches the last copy so it opens offline).
3. CSV export builds a file and downloads it; PDF export opens your device's print dialog → **Save as PDF**.

---

## 4. Your Google Sheet (`Steve_Horizon 26 PNL`)

Three tabs:

**`Expenses`** — appended to when you save an expense.

| Column | Meaning |
|---|---|
| Purchases | What was bought |
| Cost | Amount (number) |
| Date | Transaction date |
| Vendor | Store / business |
| Reason | Business reason |
| Category | One of the 14 categories below |
| Quarter | Q1–Q4, auto‑computed from the date |

**`Income`** — rebuilt by this app into a clean table (the old hand‑built month layout was replaced because its hardcoded formula ranges broke as entries piled up). The old data was migrated and the old tab kept as **`Income (old)`** as a backup.

| Column | Meaning |
|---|---|
| Date | Income date |
| Source | Where it came from |
| Amount | Amount (number) |
| Quarter | Q1–Q4, auto‑computed |

**`PL`** — the summary tab. "Gross Income" sums the Income tab; the category rows sum the Expenses tab; Profit/Loss = income − expenses. These are live formulas, so the sheet updates itself as the app adds rows.

**The 14 categories:** Advertising · Office Expenses · Insurance · Legal and Professional Services · Travel · Utilities · Supplies · Mortgage · Subscriptions · Dues and Fees · Mail · Internet · Cell Phone · Business Meeting.

---

## 5. Files in this project

```
PNL Builder/
├── index.html            # the app's screens (Add / Totals / Reports / P&L)
├── css/styles.css        # dark, phone-first styling
├── js/
│   ├── config.js         # (leave blank — connect per-device instead; see Security)
│   └── app.js            # all app logic: entry, scan, reports, P&L, CSV/PDF export
├── manifest.json         # PWA metadata (name, icons, install behavior)
├── service-worker.js     # offline app shell + update control (CACHE_VERSION)
├── icons/                # app icons (generated)
├── apps-script/
│   └── Code.gs           # the backend — paste this into your Apps Script project
├── SETUP_GUIDE.md        # step-by-step deploy instructions
├── README.md             # this file
└── Steve_Horizon_26_PNL.xlsx   # LOCAL backup of the sheet (gitignored, never published)
```

### The backend endpoints (`apps-script/Code.gs`)
All are called via a single `doPost` that routes on an `action` field:

| Action | What it does |
|---|---|
| `ping` | Health check (used by the ⚙️ "test connection" button) |
| `scanReceipt` | Sends a photo/PDF to Claude and returns extracted fields |
| `addExpense` | Appends an expense row; saves the receipt file to Drive |
| `addIncome` | Appends an income row |
| `updateExpense` / `updateIncome` | Edits an existing row (matched by row number, guarded against stale edits) |
| `deleteEntry` | Removes an entry — shifts the data columns up so the sheet's summary formulas stay intact |
| `getData` | Returns all expenses + income (with row numbers) for the dashboard/reports/P&L |
| `setup` | One‑time: rebuilds the Income tab into the clean table |
| `fixFormulas` | One‑time: repoints the sheet's summary formulas to full‑column ranges (the originals stopped counting near row 176 and missed the last category) and adds the Receipt column header |

---

## 6. Security & privacy

- **Your Anthropic API key** lives only in the Apps Script project as a **Script Property** (`ANTHROPIC_API_KEY`). It is never in the app code and never sent to the browser.
- **The GitHub repo is public**, so it must contain **no secrets and no financial data**. The spreadsheet backup (`.xlsx`) is git‑ignored; `js/config.js` is intentionally left blank.
- **Connect per device.** Because the repo is public, you paste your Apps Script `/exec` URL into the app once per device (⚙️ button) rather than baking it into the code — a URL committed to a public repo could be found and used by others, running up API charges. The URL is stored only on that device.

---

## 7. Costs

- **GitHub Pages hosting:** free.
- **Google Sheets / Drive / Apps Script:** free within normal quotas.
- **Claude receipt scanning:** roughly **$0.01 per receipt** in Anthropic API usage. Manual entry and all reports/exports are free.

---

## 8. Updating the app

When you change any app file (`index.html`, `app.js`, `styles.css`, etc.):
1. **Bump `CACHE_VERSION`** in `service-worker.js` (e.g. `pnl-builder-v2` → `v3`) so installed phones pick up the change.
2. Commit and push to GitHub (GitHub Desktop → **Push origin**). Pages redeploys in ~1 minute.
3. On the phone, fully close and reopen the app (twice if needed) to load the new version. **No reinstall needed.**

When you change the backend (`apps-script/Code.gs`):
1. Paste the new code into the Apps Script project and **Save**.
2. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** The `/exec` URL stays the same.

---

## 9. New year rollover (e.g. 2027)

1. In `apps-script/Code.gs`, change `var YEAR = 2026;` to the new year.
2. Make sure the matching sheet (`Steve_Horizon 27 PNL`) and Drive folder (`Horizon/Receipts/2027`) exist.
3. Redeploy the Apps Script as a **new version**.
4. In the app, ⚙️ → **Run one-time sheet setup** once to build the clean Income tab on the new sheet.

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| ⚙️ shows red / "not connected" | The `/exec` URL is missing or wrong on this device. Re‑paste it (must end in `/exec`). Each device connects once. |
| First connection test fails | The Apps Script deployment's **"Who has access"** isn't set to **Anyone**. Fix in Deploy settings. |
| Photos scan but **PDFs fail** | The backend wasn't redeployed as a **new version** after the PDF update. Redeploy `Code.gs`. |
| "Income tab has not been rebuilt" | Run ⚙️ → **Run one-time sheet setup** once. |
| App looks old after an update | Fully close and reopen it (twice). The service worker swaps in the new version on relaunch. |
| Receipt saved but no image in Drive | The `Horizon/Receipts/<year>` folder must exist; manual entries (no photo) save no image by design. |
| Old entries have no 📎 receipt link | Links are recorded from the date this feature was added; earlier receipts are still in `Horizon/Receipts/2026`, just not linked to their rows. |

---

## 11. Quick reference

- **Migrated income entries** (May 7 = $2,476.80, June 4 = $1,500.00) have a **blank Source** — fill those in on the Income tab when convenient.
- **PDF limit** ~30 MB, **image limit** ~5 MB (the app warns you before sending an oversized file).
- **P&L tax estimate** = 30% of profit (income − expenses), shown as a set‑aside guide only.

---

*Built with Claude Code. Backend uses the Anthropic Claude API for receipt reading; front‑end is a static PWA on GitHub Pages.*
