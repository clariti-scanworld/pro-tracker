# Partner insights page: setup

A read-only page for the partners at `https://clariti-scanworld.github.io/pro-tracker/partner/`.
It shows this month vs target, the month-by-month trend, referring doctors, doctors behind potential,
and the field team's visits, all from **Clariti Marketing 2.0**.

- The page shows **totals only**. Patient names, phone numbers and IC (referral payout) amounts never leave the sheet.
- It reads the sheet and never writes to it. The PRO app and its script are not changed.
- Only Google accounts on the allow-list can see data. Anyone else who opens the link sees a sign-in button and nothing more.
- To preview it with made-up data, open `.../partner/?demo=1`.

## One-time setup (about 15 minutes, signed in as admin@claritiscanworld.com)

### 1. Create the sign-in ID (Google Cloud)
1. Open https://console.cloud.google.com/ and pick or create a project (for example "Clariti Partner Page").
2. **APIs & Services → OAuth consent screen**: User type **External**, app name "Clariti Partner Insights",
   support email admin@claritiscanworld.com. No scopes needed. Publishing status can stay **Testing** if you add
   each partner's Gmail under **Test users**, or click **Publish app** (only basic sign-in is used, so no Google review is needed).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type **Web application**.
   Under **Authorized JavaScript origins** add `https://clariti-scanworld.github.io`. Save and copy the **Client ID**
   (it ends in `.apps.googleusercontent.com`).

### 2. Create the data script (Apps Script)
1. Open https://script.google.com → **New project**. Name it "Clariti Partner Insights".
2. Replace the code with `partner/Code.gs` from this repo. Save.
3. **Project Settings (gear) → Script Properties → Add**:
   - `OAUTH_CLIENT_ID` = the Client ID from step 1
   - `ALLOWED_EMAILS` = the partners' Google accounts, comma-separated (for example Dr Jithin's Gmail, Deepak's, Roshan's, Dr Valsan's)
4. In the editor select **testRun** and click **Run** once. Approve access when asked (it reads your spreadsheets,
   and connects to an external service only to check sign-ins). The log shows a short summary of the numbers.
5. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone**. Copy the URL ending in `/exec`.
   ("Anyone" only lets the request reach the script. The script checks the sign-in and the allow-list itself.)
6. Check it: open `<that URL>?action=ping`. It should say `"status":"ok"`.

The account that deploys needs at least **view** access to Clariti Marketing 2.0.

### 3. Connect the page
In `partner/index.html`, fill in the two lines near the top of the script and commit:
```js
var SCRIPT_URL = 'https://script.google.com/macros/s/.../exec';
var GOOGLE_CLIENT_ID = 'xxxx.apps.googleusercontent.com';
```
Both are safe to have in a public repo: the Client ID is public by design, and the script refuses anyone not on the list.

### 4. Send Dr Jithin the link
`https://clariti-scanworld.github.io/pro-tracker/partner/`. On his phone: open it, tap **Sign in with Google**,
then **Add to Home Screen** so it opens like an app.

## Day to day
- **Add or remove someone:** edit `ALLOWED_EMAILS` in Script Properties. No redeploy needed.
- **Freshness:** the page is only as fresh as the last Hodo pull into Cases Data. It shows "Bills up to …" and
  warns when that is more than 2 days old. Numbers are cached for 10 minutes; the ↻ button rebuilds them.
- **If you change Code.gs:** Deploy → Manage deployments → pencil → Version: **New version** → Deploy, so the URL stays the same.

## Where the numbers come from
| Section | Source in Clariti Marketing 2.0 |
|---|---|
| This month (MRI, USG, lab, all revenue: so far, target, projected) | Top tables of **MRI Performance** and **USG Performance** |
| Month by month (cases and net revenue) | **Cases Data**, **Lab Data**, **Other Revenue Data** (same MRI case rule as MRI Performance; the current month uses the tabs' own counts) |
| Referring doctors, behind potential | Doctor tables in **MRI Performance** and **USG Performance** (aliases already merged there) |
| Field team | **Visit Data** (doctor met, per week, by executive) |
| Case lists | **Case Lists** (status counts for the latest period; IC amounts are not sent) |

The script finds the doctor tables by the header "Doctor" in column A, and Visit Data / Case Lists columns by header
name, so new columns don't break it. Renaming those tabs or headers would.
