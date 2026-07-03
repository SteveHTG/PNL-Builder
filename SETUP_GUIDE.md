# PNL Builder — Setup & Deploy Guide

A phone-first PWA that logs expenses (scan a receipt or type it in) and income into your
**Steve_Horizon 26 PNL** Google Sheet, and generates reports + a clean P&L for your accountant.

- **Front-end (this folder):** the app you install on your phone — hosted free on **GitHub Pages**.
- **Back-end:** your existing **Google Apps Script** project, upgraded to a JSON API (`apps-script/Code.gs`).
  Your Anthropic API key and Google Sheet stay on Google's side — never in the app or on GitHub.

Do the steps **in order**. Takes ~15 minutes.

---

## ⚠️ STEP 0 — Kill the leaked API key (do this first)

Your old key was pasted in chat, so treat it as public.

1. Go to **console.anthropic.com → Settings → API Keys**.
2. **Delete** the old `sk-ant-…` key.
3. **Create a new key** and copy it somewhere safe for a minute (you'll paste it in Step 2). **Don't** put it in any file.

---

## STEP 1 — Update the Apps Script backend

1. Go to **script.google.com** and open your existing Receipt Tracker project.
2. Open `Code.gs`, select all, delete it.
3. Open `apps-script/Code.gs` from this folder, copy **everything**, and paste it in. **Save** (💾).

> This replaces the old `google.script.run` code with a JSON API. Your receipt-scanning logic and
> categories are preserved. The API key is no longer in the code.

---

## STEP 2 — Store the API key securely (Script Property)

1. In the Apps Script editor, click **Project Settings** (⚙️ on the left).
2. Scroll to **Script Properties → Add script property**.
3. Property = `ANTHROPIC_API_KEY`  ·  Value = your **new** key from Step 0.
4. **Save script properties.**

---

## STEP 3 — Deploy as a Web App

1. Top-right **Deploy → New deployment**.
2. Gear icon → **Web app**.
3. Set:
   - **Description:** `PNL Builder API`
   - **Execute as:** **Me** (steve@horizonturnout.com)
   - **Who has access:** **Anyone**  ← required so the PWA can reach it
4. **Deploy**, approve the Google permissions prompt.
5. **Copy the Web app URL** — it ends in **`/exec`**. Keep it for Step 5.

> Later, when you change `Code.gs`, use **Deploy → Manage deployments → ✏️ Edit → Version: New version**
> so the same URL keeps working.

---

## STEP 4 — Rebuild the Income tab (one time)

Your old `Income` tab used fragile hardcoded month ranges. This converts it to a clean
`Date | Source | Amount | Quarter` table and re-points the P&L's Gross Income at it. Your existing
income entries are migrated automatically; the old tab is kept as **“Income (old)”** as a backup.

You can run it two ways:

- **Easiest — from the app:** finish Step 5, open the app → ⚙️ → **Run one-time sheet setup**.
- **Or from Apps Script:** paste your URL into a browser with `?` … actually just use the app button above.

> Your two migrated entries (May 7 = $2,476.80, June 4 = $1,500.00) will have a **blank Source** —
> open the Income tab and fill those in when convenient.

---

## STEP 5 — Connect the app to the backend

You have two options:

**A) Quick (per-device):** open the app (Step 6), tap **⚙️**, paste the `/exec` URL, tap
**Save & test connection**. Green dot = connected. *(Stored on that device only.)*

**B) Baked-in (recommended):** edit `js/config.js` and paste your URL:
```js
window.PNL_CONFIG = { WEB_APP_URL: "https://script.google.com/macros/s/AKfyc…/exec" };
```
Then everyone who opens the GitHub Pages link is connected automatically.

---

## STEP 6 — Publish on GitHub Pages

From this folder (`PNL Builder`):

```bash
git init
git add .
git commit -m "PNL Builder PWA"
git branch -M main
git remote add origin https://github.com/<your-username>/pnl-builder.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / root → Save**.
After a minute your app is live at `https://<your-username>.github.io/pnl-builder/`.

> ⚠️ The repo is public, which is why the API key must **never** be in it (it lives only in Apps Script).
> `js/config.js` holding just the `/exec` URL is fine — that URL isn't a secret.

---

## STEP 7 — Install on your phone

1. Open the GitHub Pages link in **Chrome or Firefox on Android**.
2. Menu (⋮) → **Add to Home screen / Install app**.
3. Launch it from the home screen — it opens full-screen like a native app and works offline for
   viewing (adding entries needs a connection).

---

## ✅ Test checklist

- [ ] ⚙️ shows **✅ Connected** (green dot).
- [ ] **Add → Expense → scan a receipt** → fields fill in → **Save** → row appears in the `Expenses` tab + image in `Horizon/Receipts/2026`.
- [ ] **Add → Expense → manual** (no photo) → Save → row appears.
- [ ] **Add → Income** → source + amount → Save → row appears in the new `Income` tab.
- [ ] **Totals** shows income, expenses, profit.
- [ ] **Reports** → run for the year → CSV and PDF export.
- [ ] **P&L** → Generate → CSV and PDF export.

---

## Notes & maintenance

- **PDF export** opens your device's print dialog — choose **“Save as PDF.”**
- **CSV** files download straight to your device.
- **Offline:** the app opens and shows the last-loaded totals offline; adding/scanning needs internet.
- **After editing app files:** bump `CACHE_VERSION` in `service-worker.js` (e.g. `v1` → `v2`) so phones
  pick up the new version, then push.
- **New year (2027):** in `apps-script/Code.gs` change `var YEAR = 2026;` to `2027`, make sure the
  `Steve_Horizon 27 PNL` sheet and `Horizon/Receipts/2027` folder exist, redeploy a **new version**,
  then run **⚙️ → Run one-time sheet setup** once for the new sheet.
- **If scanning/saving fails:** confirm the deployment's **“Who has access” = Anyone**, the
  `ANTHROPIC_API_KEY` Script Property is set, and the sheet is named exactly `Steve_Horizon 26 PNL`.
