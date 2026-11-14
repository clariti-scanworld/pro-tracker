/**
 * Clariti Partner Insights - read-only Apps Script backend
 *
 * Serves the partner page (partner/index.html on GitHub Pages) with TOTALS ONLY from
 * "Clariti Marketing 2.0". It never sends patient names, phone numbers or IC (referral payout) amounts.
 * It never writes to the sheet.
 *
 * This is a SEPARATE script from the PRO tracker's. Create it as a new standalone project
 * (script.google.com > New project), paste this file, then set Script Properties
 * (Project Settings > Script Properties):
 *   ALLOWED_EMAILS   comma-separated Google accounts that may see the page, e.g. a@gmail.com,b@gmail.com
 *   OAUTH_CLIENT_ID  the Web OAuth client ID used by the page's "Sign in with Google" button
 *   ACCESS_KEY       (optional) a long random key; lets the page work by secret link instead of sign-in
 * Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone".
 * ("Anyone" only lets the request reach the script; the script itself checks who is asking.)
 *
 * POST body (text/plain JSON): { "id_token": "<Google ID token>" }  or  { "key": "<ACCESS_KEY>" }
 * GET  ?action=ping  -> { status: "ok" } (no data, for checking the deployment)
 */

var SPREADSHEET_ID = '1RbZvifukgd-MaX-bUsu4nuyXQP6VrciZ0Y2vuN2A7p0'; // Clariti Marketing 2.0
var TZ = 'Asia/Kolkata';
var CACHE_SECONDS = 600;          // totals are rebuilt at most every 10 minutes
var FIRST_MONTH = '2026-06';      // Hodo data starts 04/06/2026
var VISIT_WEEKS = 8;
var TOP_N = 10;

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'ping') return json_({ status: 'ok', time: new Date().toISOString() });
  return json_({ status: 'error', error: 'Use POST with a sign-in token' });
}

function doPost(e) {
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { body = {}; }
    var who = authorise_(body);
    if (!who.ok) return json_({ status: 'denied', error: who.error });
    var cache = CacheService.getScriptCache();
    var cached = body.refresh ? null : cache.get('insights_v1');
    var payload = cached ? JSON.parse(cached) : buildInsights_(SpreadsheetApp.openById(SPREADSHEET_ID));
    if (!cached) { try { cache.put('insights_v1', JSON.stringify(payload), CACHE_SECONDS); } catch (x) {} }
    payload.viewer = who.email || 'link';
    return json_({ status: 'success', data: payload });
  } catch (err) {
    return json_({ status: 'error', error: String(err && err.message || err) });
  }
}

// ---------- access ----------
function authorise_(body) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('ACCESS_KEY');
  if (body.key) {
    if (key && key.length >= 16 && body.key === key) return { ok: true };
    return { ok: false, error: 'This link is not valid any more. Ask Deepak for a new one.' };
  }
  if (!body.id_token) return { ok: false, error: 'Please sign in.' };
  var clientId = props.getProperty('OAUTH_CLIENT_ID');
  var allowed = String(props.getProperty('ALLOWED_EMAILS') || '').toLowerCase().split(/[\s,;]+/).filter(String);
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(body.id_token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'Sign-in expired. Please sign in again.' };
  var t = JSON.parse(res.getContentText());
  var email = String(t.email || '').toLowerCase();
  if (!clientId || t.aud !== clientId) return { ok: false, error: 'Sign-in is not set up for this page.' };
  if (String(t.email_verified) !== 'true') return { ok: false, error: 'Google account email is not verified.' };
  if (allowed.indexOf(email) < 0) return { ok: false, error: email + ' does not have access. Ask Deepak to add it.' };
  return { ok: true, email: email };
}

// ---------- build ----------
function buildInsights_(ss) {
  var now = new Date();
  var out = { generated: now.toISOString() };
  out.mri = headlineMri_(values_(ss, 'MRI Performance'));
  out.usg = headlineUsg_(values_(ss, 'USG Performance'));
  out.dataUpTo = out.mri.dataUpTo || out.usg.dataUpTo || '';
  out.monthly = monthly_(values_(ss, 'Cases Data'), values_(ss, 'Lab Data'), values_(ss, 'Other Revenue Data'));
  // Use the sheet's own counts for the current month so the trend and the headline agree.
  var cur = out.monthly.filter(function (m) { return m.month === String(out.dataUpTo).slice(0, 7); })[0];
  if (cur) {
    if (out.mri.soFar) cur.mriCases = out.mri.soFar;
    var usgLine = (out.usg.lines || []).filter(function (l) { return /^USG cases/i.test(l.label); })[0];
    if (usgLine) cur.usgCases = usgLine.soFar;
    cur.partial = true;
  }
  out.mriDoctors = doctorTable_(values_(ss, 'MRI Performance'));
  out.usgDoctors = doctorTable_(values_(ss, 'USG Performance'));
  out.referrers = { mri: referrerInsights_(out.mriDoctors.rows), usg: referrerInsights_(out.usgDoctors.rows) };
  out.mriDoctors.rows = out.mriDoctors.rows.slice(0, 15);   // furthest behind first (sheet order)
  out.usgDoctors.rows = out.usgDoctors.rows.slice(0, 15);
  out.visits = visits_(values_(ss, 'Visit Data'), now);
  out.caseLists = caseLists_(values_(ss, 'Case Lists'));
  return out;
}

function values_(ss, name) {
  var sh = ss.getSheetByName(name);
  return sh ? sh.getDataRange().getValues() : [];
}

function num_(v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v == null ? '' : v).replace(/[₹,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function toDate_(v) {
  if (v instanceof Date) return v;
  var s = String(v || '').trim(), m;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return new Date(+m[3], +m[2] - 1, +m[1]);
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

function ymd_(d) { return d ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : ''; }
function ym_(d) { return d ? Utilities.formatDate(d, TZ, 'yyyy-MM') : ''; }

// MRI Performance: row 1 labels, row 2 values (A data-up-to, B target, C so far, D projected, E gap), row 3 revenue.
function headlineMri_(v) {
  if (v.length < 3) return {};
  return {
    dataUpTo: ymd_(toDate_(v[1][0])), target: num_(v[1][1]), soFar: num_(v[1][2]),
    projected: num_(v[1][3]), gap: num_(v[1][4]),
    revenueSoFar: num_(v[2][2]), revenueProjected: num_(v[2][3]),
    lastMonth: v.length > 3 ? num_(v[3][1]) : null
  };
}

// USG Performance: rows 2-8 = label, last month, target, so far, projected EOM, gap.
function headlineUsg_(v) {
  if (!v.length) return {};
  var m = String(v[0][0] || '').match(/(\d{1,2} \w{3} \d{4})/);
  var lines = [];
  for (var i = 1; i < Math.min(v.length, 10); i++) {
    var label = String(v[i][0] || '').trim();
    if (!label || label === 'Doctor') break;
    lines.push({ label: label, lastMonth: num_(v[i][1]), target: v[i][2] === '' ? null : num_(v[i][2]),
      soFar: num_(v[i][3]), projected: num_(v[i][4]), gap: v[i][5] === '' ? null : num_(v[i][5]) });
  }
  var d = m ? new Date(m[1]) : null;
  return { dataUpTo: d && !isNaN(d) ? ymd_(d) : '', lines: lines };
}

// Doctor table under the header row whose column A is "Doctor". Keeps the sheet's order (furthest behind first).
// Only the first 6 columns plus "Days since visit" / "Last visit" are sent.
function doctorTable_(v) {
  var h = -1;
  for (var i = 0; i < Math.min(v.length, 30); i++) if (String(v[i][0]).trim() === 'Doctor') { h = i; break; }
  if (h < 0) return { lastMonthLabel: '', rows: [] };
  var head = v[h].map(function (x) { return String(x).trim(); });
  var iLastVisit = head.indexOf('Last visit');
  var rows = [];
  for (var r = h + 1; r < v.length; r++) {
    var name = String(v[r][0] || '').trim();
    if (!name) continue;
    var lv = iLastVisit >= 0 ? toDate_(v[r][iLastVisit]) : null;
    rows.push({ doctor: name, lastMonth: num_(v[r][1]), potential: num_(v[r][2]), expected: num_(v[r][3]),
      soFar: num_(v[r][4]), gap: num_(v[r][5]), lastVisit: ymd_(lv) });
  }
  return { lastMonthLabel: head[1] || 'Last month', rows: rows };
}

function referrerInsights_(rows) {
  var docs = rows.filter(function (r) { return r.doctor.toUpperCase() !== 'SELF'; });
  var totalLast = docs.reduce(function (s, r) { return s + r.lastMonth; }, 0);
  var byLast = docs.slice().sort(function (a, b) { return b.lastMonth - a.lastMonth; });
  var top = byLast.slice(0, TOP_N);
  var topLast = top.reduce(function (s, r) { return s + r.lastMonth; }, 0);
  var bySoFar = docs.filter(function (r) { return r.soFar > 0; }).sort(function (a, b) { return b.soFar - a.soFar; });
  var pick = function (r) { return { doctor: r.doctor, lastMonth: r.lastMonth, soFar: r.soFar, lastVisit: r.lastVisit }; };
  var self = rows.filter(function (r) { return r.doctor.toUpperCase() === 'SELF'; })[0];
  return {
    activeLastMonth: docs.filter(function (r) { return r.lastMonth > 0; }).length,
    activeThisMonth: bySoFar.length,
    top10ShareLastMonth: totalLast ? Math.round(topLast / totalLast * 100) : 0,
    topThisMonth: bySoFar.slice(0, TOP_N).map(pick),
    topLastMonth: top.map(pick),
    newThisMonth: bySoFar.filter(function (r) { return r.lastMonth === 0; }).slice(0, TOP_N).map(pick),
    quiet: byLast.filter(function (r) { return r.lastMonth >= 3 && r.soFar === 0; }).slice(0, TOP_N).map(pick),
    self: self ? { lastMonth: self.lastMonth, soFar: self.soFar } : null
  };
}

// Monthly cases and net revenue (price - discount - refund) from the raw Hodo tabs.
// MRI case rule (same as MRI Performance): one case per visit with an MRI scan; a further MRI in the same
// visit counts if its net bill is over ₹3,000; fully refunded lines and *CHARGE* lines are not cases.
function monthly_(cases, lab, other) {
  var M = {};
  var bucket = function (ym) {
    return M[ym] || (M[ym] = { month: ym, mriCases: 0, usgCases: 0, mri: 0, usg: 0, lab: 0, other: 0 });
  };
  var mriSeen = {}, usgSeen = {};
  for (var i = 1; i < cases.length; i++) {
    var r = cases[i];
    var d = toDate_(r[6]); if (!d) continue;
    var ym = ym_(d); if (ym < FIRST_MONTH) continue;
    var b = bucket(ym), cat = String(r[2]).trim(), test = String(r[1]).toUpperCase(), visit = String(r[5]);
    var price = num_(r[8]), net = price - num_(r[9]) - num_(r[10]);
    if (test.indexOf('CHARGE') >= 0) { b.other += net; continue; }
    if (cat === 'MRI') {
      b.mri += net;
      if (net <= 0 && price > 0) continue;
      if (!mriSeen[visit]) { mriSeen[visit] = 1; b.mriCases++; }
      else if (net > 3000) b.mriCases++;
    } else if (cat === 'USG') {
      b.usg += net;
      if (net <= 0 && price > 0) continue;
      if (!usgSeen[visit]) { usgSeen[visit] = 1; b.usgCases++; }
    }
  }
  var addRev = function (rows, key) {
    for (var j = 1; j < rows.length; j++) {
      var d2 = toDate_(rows[j][6]); if (!d2) continue;
      var ym2 = ym_(d2); if (ym2 < FIRST_MONTH) continue;
      bucket(ym2)[key] += num_(rows[j][8]) - num_(rows[j][9]) - num_(rows[j][10]);
    }
  };
  addRev(lab, 'lab');
  addRev(other, 'other');
  return Object.keys(M).sort().map(function (k) {
    var b = M[k];
    ['mri', 'usg', 'lab', 'other'].forEach(function (x) { b[x] = Math.round(b[x]); });
    b.total = b.mri + b.usg + b.lab + b.other;
    return b;
  });
}

// PRO visits per week (Monday start) for the last VISIT_WEEKS weeks, by executive first name.
function visits_(v, now) {
  if (v.length < 2) return { weeks: [], people: [] };
  var head = v[0].map(function (x) { return String(x).trim(); });
  var iDate = head.indexOf('Date'), iMet = head.indexOf('Met Status'), iExec = head.indexOf('Executive');
  var today = new Date(Utilities.formatDate(now, TZ, 'yyyy/MM/dd'));
  var monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  var weeks = [];
  for (var w = VISIT_WEEKS - 1; w >= 0; w--) {
    var s = new Date(monday); s.setDate(monday.getDate() - 7 * w);
    weeks.push({ start: ymd_(s), met: {}, notMet: {} });
  }
  var first = new Date(weeks[0].start.replace(/-/g, '/'));
  var people = {}, monthMet = {}, thisYm = ym_(today);
  for (var i = 1; i < v.length; i++) {
    var d = toDate_(v[i][iDate]); if (!d) continue;
    var who = String(v[i][iExec] || '').trim().split(/\s+/)[0];
    if (!who) continue;
    who = who.charAt(0).toUpperCase() + who.slice(1).toLowerCase();
    var met = /^met/i.test(String(v[i][iMet] || '').trim());
    if (ym_(d) === thisYm && met) monthMet[who] = (monthMet[who] || 0) + 1;
    if (d < first) continue;
    var idx = Math.floor((d - first) / (7 * 864e5));
    if (idx < 0 || idx >= weeks.length) continue;
    people[who] = 1;
    var bag = met ? weeks[idx].met : weeks[idx].notMet;
    bag[who] = (bag[who] || 0) + 1;
  }
  return { weeks: weeks, people: Object.keys(people).sort(), metThisMonth: monthMet };
}

// Case Lists: count of the latest status per doctor (no IC amounts).
function caseLists_(v) {
  if (v.length < 2) return { counts: {}, latestPeriod: '' };
  var head = v[0].map(function (x) { return String(x).trim(); });
  var iPeriod = head.indexOf('Period'), iEnd = head.indexOf('Period end'), iStatus = head.indexOf('Status');
  var latest = null, label = '';
  for (var i = 1; i < v.length; i++) {
    var d = toDate_(v[i][iEnd]);
    if (d && (!latest || d > latest)) { latest = d; label = String(v[i][iPeriod]); }
  }
  var counts = {};
  for (var j = 1; j < v.length; j++) {
    var dj = toDate_(v[j][iEnd]);
    if (!dj || !latest || dj.getTime() !== latest.getTime()) continue;
    var st = String(v[j][iStatus] || 'Unknown').trim() || 'Unknown';
    counts[st] = (counts[st] || 0) + 1;
  }
  return { counts: counts, latestPeriod: label };
}

// Run this once from the editor to approve access and check the numbers.
function testRun() {
  var d = buildInsights_(SpreadsheetApp.openById(SPREADSHEET_ID));
  // Touch UrlFetchApp so its permission is asked for now, not on the first sign-in.
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=x', { muteHttpExceptions: true });
  Logger.log('Data up to %s. MRI %s of %s. Months: %s. Doctors in MRI table: %s. Payload %s bytes.',
    d.dataUpTo, d.mri.soFar, d.mri.target, d.monthly.map(function (m) { return m.month + ' ' + m.mriCases; }).join(', '),
    d.mriDoctors.rows.length, JSON.stringify(d).length);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
