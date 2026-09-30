/**
 * Stars and Scrubs Pick'em — autopilot (Google Apps Script)
 *
 * Runs every hour on Google's servers. No one has to do anything week to week:
 *   • Posts winners as NFL games go final (from ESPN's public scoreboard).
 *   • When the week's last game is final, emails the weekly review (standings, every
 *     team's picks, full audit trail) to RECIPIENTS.
 *   • Then loads next week's games with lock times and emails the new slate, with a
 *     message ready to paste into the league WhatsApp.
 * It also backs the "Email the review" button on the site (doPost).
 *
 * SETUP (about 5 minutes; easiest on a computer, signed in as rgupta42@gmail.com —
 * the Google account that owns the Firebase project):
 * 1. script.google.com → New project → name it "Pick'em autopilot".
 * 2. Replace the sample code in Code.gs with this whole file. Save.
 * 3. Project Settings (gear, left side) → tick "Show appsscript.json manifest file in editor".
 *    Back in Editor, open appsscript.json and replace it with the manifest from the repo
 *    (appsscript.json). Save.
 * 4. In the toolbar function menu choose "setup" → Run. Approve the permissions
 *    (if Google says the app isn't verified: Advanced → Go to Pick'em autopilot).
 *    This creates the hourly schedule and runs it once.
 * 5. Optional, for the site's "Email the review" button: Deploy → New deployment →
 *    Web app (Execute as: Me, Who has access: Anyone) → Deploy → copy the /exec URL.
 */

const PROJECT = 'stars-and-scrubs-pick-em';
const RECIPIENTS = 'rgupta42@gmail.com,vkudur@gmail.com';
const SITE = 'https://rgupta42-del.github.io/starsandscrubs/';
const TZ = 'America/New_York';
const LAST_WEEK = 18;
const ESPN_TO_SITE = { WSH: 'WAS' };
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';

// ---------- entry points ----------
function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('tick').timeBased().everyHours(1).create();
  tick();
}

function tick() {
  const weeks = listDocs('weeks').sort((a, b) => (a.data.order || 0) - (b.data.order || 0));
  if (!weeks.length) return;
  const cur = weeks[weeks.length - 1];
  updateResults(cur);
  finishWeek(cur, weeks);
}

// Manual send from the site's Review tab.
function doPost(e) {
  const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  const subject = String(data.subject || "Stars and Scrubs Pick'em review").slice(0, 200);
  const html = String(data.html || '').slice(0, 400000);
  if (!html) return ContentService.createTextOutput('empty');
  MailApp.sendEmail({ to: RECIPIENTS, subject: subject, htmlBody: html, name: "Stars and Scrubs Pick'em" });
  return ContentService.createTextOutput('sent');
}

// ---------- results ----------
function updateResults(wk) {
  const w = wk.data, winners = w.winners || {}, now = Date.now();
  const open = (w.games || []).filter(g => !winners[g.id] && Date.parse(g.kickoff) < now);
  if (!open.length) return;
  const events = espnWeek(w.order, w.season);
  const updates = {};
  for (const e of events) {
    const comp = e.competitions[0], status = (comp.status || e.status || {}).type || {};
    if (!status.completed) continue;
    const home = comp.competitors.find(c => c.homeAway === 'home'), away = comp.competitors.find(c => c.homeAway === 'away');
    const h = abbr(home.team.abbreviation), a = abbr(away.team.abbreviation);
    const g = open.find(x => x.home === h && x.away === a);
    if (!g) continue;
    updates[g.id] = home.winner ? h : away.winner ? a : 'TIE';
  }
  const ids = Object.keys(updates);
  if (!ids.length) return;
  patchDoc('weeks/' + wk.id, { winners: updates }, ids.map(id => 'winners.' + id));
  ids.forEach(id => (w.winners = w.winners || {})[id] = updates[id]);
}

function finishWeek(wk, weeks) {
  const w = wk.data, games = w.games || [], winners = w.winners || {};
  if (!games.length) return;
  const lastKick = Math.max.apply(null, games.map(g => Date.parse(g.kickoff)));
  const allFinal = games.every(g => winners[g.id]);
  if (!w.reviewSentAt && (allFinal || Date.now() > lastKick + 48 * 3600e3)) {
    sendReview(wk.id, w, weeks);
    patchDoc('weeks/' + wk.id, { reviewSentAt: new Date() }, ['reviewSentAt']);
    w.reviewSentAt = new Date();
  }
  if (w.reviewSentAt && (w.order || 0) < LAST_WEEK) {
    const nextId = 'w' + (w.order + 1);
    if (!weeks.some(x => x.id === nextId)) createWeek(w.order + 1, w.season || new Date().getFullYear());
  }
}

// ---------- next week ----------
function createWeek(order, season) {
  const events = espnWeek(order, season);
  if (!events.length) return;
  const rows = events.map(e => {
    const comp = e.competitions[0];
    const home = comp.competitors.find(c => c.homeAway === 'home'), away = comp.competitors.find(c => c.homeAway === 'away');
    const tv = (comp.broadcasts || []).reduce((acc, b) => acc.concat(b.names || []), []).join(' / ');
    const city = comp.venue && comp.venue.address && comp.venue.address.city;
    return { kickoff: new Date(e.date), away: abbr(away.team.abbreviation), awayName: away.team.shortDisplayName || away.team.name,
      home: abbr(home.team.abbreviation), homeName: home.team.shortDisplayName || home.team.name, tv: tv,
      note: comp.neutralSite ? (city || 'Neutral site') : '' };
  }).sort((a, b) => a.kickoff - b.kickoff);

  // Lock = kickoff, but never later than 1:00 PM ET on the week's Sunday.
  const first = rows[0].kickoff;
  const dow = Number(Utilities.formatDate(first, TZ, 'u')); // 1 = Mon … 7 = Sun
  const sunday = new Date(first.getTime() + ((7 - dow) % 7) * 864e5);
  const sunYmd = Utilities.formatDate(sunday, TZ, 'yyyy-MM-dd');
  const offset = Utilities.formatDate(new Date(sunYmd + 'T17:00:00Z'), TZ, 'XXX');
  const cap = new Date(sunYmd + 'T13:00:00' + offset);

  const games = [], locks = {}, teams = {};
  rows.forEach((r, i) => {
    const id = 'g' + String(i + 1).padStart(2, '0');
    const lock = r.kickoff < cap ? r.kickoff : cap;
    games.push({ id: id, kickoff: r.kickoff.toISOString(), lockAt: lock.toISOString(), away: r.away, awayName: r.awayName,
      home: r.home, homeName: r.homeName, tv: r.tv, note: r.note });
    locks[id] = lock; teams[id] = [r.away, r.home];
  });
  const last = rows[rows.length - 1].kickoff;
  const doc = { label: 'Week ' + order, order: order, season: season,
    dates: Utilities.formatDate(first, TZ, 'EEE MMM d') + ' – ' + Utilities.formatDate(last, TZ, 'EEE MMM d, yyyy'),
    games: games, locks: locks, teams: teams, winners: {} };
  patchDoc('weeks/w' + order, doc, null);
  sendSlate(doc);
}

// ---------- emails ----------
function sendSlate(w) {
  const fmt = iso => Utilities.formatDate(new Date(iso), TZ, 'EEE MMM d, h:mm a');
  let text = "🏈 Stars and Scrubs Pick'em · " + w.label + '\nPick the winner of every game. 1 pt per correct pick.\nLocks at kickoff, never later than 1:00 PM ET Sunday.\n';
  w.games.forEach(g => text += '\n' + fmt(g.kickoff) + ' · ' + g.awayName + ' @ ' + g.homeName);
  text += '\n\nMake your picks: ' + SITE;
  const html = '<div style="font:14px Arial,sans-serif;color:#152019"><h2 style="margin:0 0 6px">' + esc(w.label) + ' is open for picks</h2>' +
    '<p>The games are loaded and locks are set. Copy the message below into the league WhatsApp:</p>' +
    '<pre style="background:#f2f2f2;padding:12px;border-radius:8px;white-space:pre-wrap;font:13px Menlo,monospace">' + esc(text) + '</pre></div>';
  MailApp.sendEmail({ to: RECIPIENTS, subject: "Stars and Scrubs Pick'em · " + w.label + ' is open', htmlBody: html, body: text, name: "Stars and Scrubs Pick'em" });
}

function sendReview(wid, w, weeks) {
  const managers = listDocs('managers').map(d => ({ id: d.id, name: d.data.name })).sort((a, b) => a.id < b.id ? -1 : 1);
  const picks = {}; listDocs('picks').forEach(d => picks[d.id] = d.data);
  const audit = runQuery('audit', 'week', wid).sort((a, b) => (b.at || 0) - (a.at || 0));
  const nameOf = id => (managers.find(m => m.id === id) || {}).name || id;
  const pickOf = (m, wk, g) => (picks[m + '__' + wk + '__' + g] || {}).pick || null;
  const score = (m, wkDoc) => (wkDoc.data.games || []).reduce((s, g) => { const r = (wkDoc.data.winners || {})[g.id], p = pickOf(m, wkDoc.id, g.id); return s + (r && p && p === r ? 1 : 0); }, 0);
  const thisWeek = { id: wid, data: w };
  const rows = managers.map(m => ({ name: m.name, id: m.id, wk: score(m.id, thisWeek),
      season: weeks.reduce((s, x) => s + score(m.id, x.id === wid ? thisWeek : x), 0),
      made: w.games.filter(g => pickOf(m.id, wid, g.id)).length }))
    .sort((a, b) => b.wk - a.wk || b.season - a.season || a.name.localeCompare(b.name));
  const td = 'style="padding:6px 8px;border:1px solid #ddd;font:13px Arial,sans-serif"';
  const th = 'style="padding:6px 8px;border:1px solid #ddd;background:#f2f2f2;font:bold 13px Arial,sans-serif;text-align:left"';
  const stamp = d => d ? Utilities.formatDate(d, TZ, 'MMM d h:mm:ss a') : '';
  const gameLabel = gid => { const g = w.games.find(x => x.id === gid); return g ? g.away + ' @ ' + g.home : gid; };
  const late = a => { const g = w.games.find(x => x.id === a.game); return g && a.at && a.at.getTime() >= Date.parse(g.lockAt); };
  const locText = l => !l ? '—' : l.status === 'ok' ? l.lat + ', ' + l.lng : l.status === 'commish' ? 'Entered by commissioner' : l.status === 'denied' ? 'Location declined' : 'Location unavailable';
  const decided = w.games.filter(g => (w.winners || {})[g.id]).length;

  let h = '<div style="font:14px Arial,sans-serif;color:#152019"><h2 style="margin:0 0 4px">Stars and Scrubs Pick\'em · ' + esc(w.label) + ' review</h2>' +
    '<p style="margin:0 0 12px">' + decided + ' of ' + w.games.length + ' games final. <a href="' + SITE + '">Open the pick\'em</a></p>';
  h += '<h3>Standings</h3><table style="border-collapse:collapse"><tr><th ' + th + '>#</th><th ' + th + '>Team</th><th ' + th + '>' + esc(w.label) + '</th><th ' + th + '>Season</th><th ' + th + '>Picks made</th></tr>';
  rows.forEach((r, i) => h += '<tr><td ' + td + '>' + (i + 1) + '</td><td ' + td + '>' + esc(r.name) + '</td><td ' + td + '><b>' + r.wk + '</b></td><td ' + td + '>' + r.season + '</td><td ' + td + '>' + r.made + '/' + w.games.length + '</td></tr>');
  h += '</table><h3>Pick sheet</h3><table style="border-collapse:collapse"><tr><th ' + th + '>Team</th>';
  w.games.forEach(g => { const r = (w.winners || {})[g.id]; h += '<th ' + th + '>' + esc(g.away) + '@' + esc(g.home) + (r ? '<br><span style="color:#2E7D4F">W: ' + esc(r) + '</span>' : '') + '</th>'; });
  h += '</tr>';
  rows.forEach(r => { h += '<tr><td ' + td + '>' + esc(r.name) + '</td>';
    w.games.forEach(g => { const p = pickOf(r.id, wid, g.id), win = (w.winners || {})[g.id];
      h += '<td ' + td + '>' + (p ? '<span style="color:' + (win ? (p === win ? '#2E7D4F' : '#B3261E') : '#152019') + '">' + esc(p) + '</span>' : '—') + '</td>'; });
    h += '</tr>'; });
  h += '</table><h3>Audit trail</h3>';
  if (!audit.length) h += '<p>No picks were recorded this week.</p>';
  else {
    h += '<table style="border-collapse:collapse"><tr><th ' + th + '>Time (ET)</th><th ' + th + '>Team</th><th ' + th + '>Game</th><th ' + th + '>Action</th><th ' + th + '>Location</th><th ' + th + '>By</th></tr>';
    audit.forEach(a => { const l = a.loc, link = l && l.status === 'ok' ? 'https://maps.google.com/?q=' + l.lat + ',' + l.lng : null;
      h += '<tr><td ' + td + '>' + esc(stamp(a.at)) + (late(a) ? ' <b style="color:#B3261E">after lock</b>' : '') + '</td><td ' + td + '>' + esc(nameOf(a.mgr)) + '</td><td ' + td + '>' + esc(gameLabel(a.game)) +
        '</td><td ' + td + '>' + esc(a.action) + (a.pick ? ' ' + esc(a.pick) : '') + '</td><td ' + td + '>' + (link ? '<a href="' + link + '">' + esc(locText(l)) + '</a>' : esc(locText(l))) +
        '</td><td ' + td + '>' + (a.by === 'commish' ? 'Commissioner' : 'Player') + '</td></tr>'; });
    h += '</table>';
  }
  h += '<p style="color:#5E6B62;font-size:12px">Locations are approximate (about 1 km) and come from each manager\'s browser with their permission.</p></div>';
  MailApp.sendEmail({ to: RECIPIENTS, subject: "Stars and Scrubs Pick'em · " + w.label + ' review', htmlBody: h, name: "Stars and Scrubs Pick'em" });
}

// ---------- ESPN ----------
function espnWeek(week, season) {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=' + week + '&dates=' + season;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('ESPN ' + res.getResponseCode());
  return JSON.parse(res.getContentText()).events || [];
}
function abbr(a) { return ESPN_TO_SITE[a] || a; }

// ---------- Firestore REST (runs as the project owner, so it can post results and read the audit trail) ----------
function fsFetch(method, path, body) {
  const opt = { method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'x-goog-user-project': PROJECT } };
  if (body) opt.payload = JSON.stringify(body);
  const res = UrlFetchApp.fetch(BASE + path, opt), code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error(method + ' ' + path + ' → ' + code + ': ' + res.getContentText().slice(0, 400));
  return JSON.parse(res.getContentText() || '{}');
}
function listDocs(coll) {
  const out = []; let token = '';
  do {
    const r = fsFetch('get', '/' + coll + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : '')) || {};
    (r.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), data: fromFields(d.fields || {}) }));
    token = r.nextPageToken || '';
  } while (token);
  return out;
}
function runQuery(coll, field, value) {
  const r = fsFetch('post', ':runQuery', { structuredQuery: { from: [{ collectionId: coll }],
    where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toFs(value) } } } }) || [];
  return r.filter(x => x.document).map(x => fromFields(x.document.fields || {}));
}
function patchDoc(path, obj, mask) {
  const q = mask ? '?' + mask.map(p => 'updateMask.fieldPaths=' + encodeURIComponent(p)).join('&') : '';
  return fsFetch('patch', '/' + path + q, { fields: toFields(obj) });
}
function toFields(o) { const f = {}; Object.keys(o).forEach(k => f[k] = toFs(o[k])); return f; }
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  switch (typeof v) {
    case 'string': return { stringValue: v };
    case 'boolean': return { booleanValue: v };
    case 'number': return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    default: return { mapValue: { fields: toFields(v) } };
  }
}
function fromFs(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  return null;
}
function fromFields(f) { const o = {}; Object.keys(f).forEach(k => o[k] = fromFs(f[k])); return o; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
