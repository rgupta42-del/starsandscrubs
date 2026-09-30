/**
 * Stars and Scrubs Pick'em — autopilot (Google Apps Script)
 *
 * Runs every hour on Google's servers. No one has to do anything week to week:
 *   • Keeps the full schedule (Weeks FIRST_WEEK–LAST_WEEK) and the 12 teams loaded on the site,
 *     picking up NFL time changes (flexed games) for games that haven't locked yet.
 *   • Posts winners as NFL games go final (from ESPN's public scoreboard).
 *   • When the week's last game is final, emails the weekly review (standings, every
 *     team's picks, full audit trail) to RECIPIENTS, with a results CSV and an audit CSV attached.
 *   • Then emails next week's slate, with a message ready to paste into the league WhatsApp.
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
const SEASON = 2026;
const FIRST_WEEK = 4;
const LAST_WEEK = 17;
const TEAMS_URL = 'https://raw.githubusercontent.com/rgupta42-del/starsandscrubs/main/teams.json';
const ESPN_TO_SITE = { WSH: 'WAS' };
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';

// ---------- entry points ----------
function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('tick').timeBased().everyHours(1).create();
  syncNow();
}

function tick() {
  syncTeams();
  let weeks = listDocs('weeks');
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('scheduleSyncedAt') || 0);
  if (weeks.length < LAST_WEEK - FIRST_WEEK + 1 || Date.now() - last > 6 * 3600e3) {
    syncSchedule(weeks);
    props.setProperty('scheduleSyncedAt', String(Date.now()));
    weeks = listDocs('weeks');
  }
  weeks.sort((a, b) => (a.data.order || 0) - (b.data.order || 0));
  const now = Date.now();
  for (const wk of weeks) {
    const games = wk.data.games || [];
    if (wk.data.reviewSentAt || !games.some(g => Date.parse(g.kickoff) < now)) continue;
    updateResults(wk);
    finishWeek(wk, weeks);
  }
}

// Run this from the editor any time to reload teams and the full schedule right away.
function syncNow() {
  PropertiesService.getScriptProperties().deleteProperty('scheduleSyncedAt');
  tick();
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
  if (w.reviewSentAt || !(allFinal || Date.now() > lastKick + 48 * 3600e3)) return;
  sendReview(wk.id, w, weeks);
  patchDoc('weeks/' + wk.id, { reviewSentAt: new Date() }, ['reviewSentAt']);
  w.reviewSentAt = new Date();
  const next = weeks.find(x => x.data.order === w.order + 1);
  if (next && !next.data.slateSentAt) {
    sendSlate(next.data);
    patchDoc('weeks/' + next.id, { slateSentAt: new Date() }, ['slateSentAt']);
  }
}

// ---------- teams ----------
function syncTeams() {
  const res = UrlFetchApp.fetch(TEAMS_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return;
  const teams = JSON.parse(res.getContentText());
  const have = {}; listDocs('managers').forEach(d => have[d.id] = d.data);
  teams.forEach(t => {
    if (!have[t.id]) patchDoc('managers/' + t.id, { name: t.name, uid: null }, null);
    else if (have[t.id].name !== t.name) patchDoc('managers/' + t.id, { name: t.name }, ['name']);
  });
}

// ---------- schedule ----------
// Loads or refreshes every week from FIRST_WEEK to LAST_WEEK. Game ids stay fixed per matchup so saved
// picks never move, and a game's lock time never changes once it has locked.
function syncSchedule(existing) {
  const byId = {}; existing.forEach(d => byId[d.id] = d.data);
  const now = Date.now();
  for (let order = FIRST_WEEK; order <= LAST_WEEK; order++) {
    const id = 'w' + order, old = byId[id];
    if (old && (old.games || []).length && (old.games || []).every(g => Date.parse(g.lockAt) <= now)) continue;
    const built = buildWeek(order, SEASON, old);
    if (!built) continue;
    if (old) patchDoc('weeks/' + id, built, Object.keys(built));
    else { built.winners = {}; patchDoc('weeks/' + id, built, null); }
  }
}

function buildWeek(order, season, old) {
  const events = espnWeek(order, season);
  if (!events.length) return null;
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

  const oldGames = (old && old.games) || [], now = Date.now();
  let nextNum = oldGames.reduce((m, g) => Math.max(m, Number(g.id.slice(1)) || 0), 0);
  const games = [], locks = {}, teams = {};
  rows.forEach(r => {
    const prev = oldGames.find(g => g.away === r.away && g.home === r.home);
    const id = prev ? prev.id : 'g' + String(++nextNum).padStart(2, '0');
    let lock = r.kickoff < cap ? r.kickoff : cap;
    if (prev && Date.parse(prev.lockAt) <= now) lock = new Date(prev.lockAt);
    games.push({ id: id, kickoff: r.kickoff.toISOString(), lockAt: lock.toISOString(), away: r.away, awayName: r.awayName,
      home: r.home, homeName: r.homeName, tv: r.tv, note: r.note });
    locks[id] = lock; teams[id] = [r.away, r.home];
  });
  const last = rows[rows.length - 1].kickoff;
  return { label: 'Week ' + order, order: order, season: season,
    dates: Utilities.formatDate(first, TZ, 'EEE MMM d') + ' – ' + Utilities.formatDate(last, TZ, 'EEE MMM d, yyyy'),
    games: games, locks: locks, teams: teams };
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
  // Results files for double-checking: one row per team with every pick, point and total; plus the audit trail.
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['Rank', 'Team'].concat(w.games.map(g => g.away + ' @ ' + g.home), ['Week points', 'Season points', 'Picks made']);
  const winRow = ['', 'WINNER'].concat(w.games.map(g => (w.winners || {})[g.id] || 'not final'), ['', '', '']);
  const lines = [head, winRow].concat(rows.map((r, i) => [i + 1, r.name].concat(w.games.map(g => {
    const p = pickOf(r.id, wid, g.id), win = (w.winners || {})[g.id];
    return p ? p + (win ? (p === win ? ' (1)' : ' (0)') : '') : '— (0)'; }), [r.wk, r.season, r.made])));
  const resultsCsv = lines.map(l => l.map(q).join(',')).join('\n');
  const auditCsv = [['Time (ET)', 'Team', 'Game', 'Action', 'Pick', 'Latitude', 'Longitude', 'Accuracy (m)', 'Location status', 'Entered by', 'After lock']]
    .concat(audit.map(a => { const l = a.loc || {}; return [stamp(a.at), nameOf(a.mgr), gameLabel(a.game), a.action, a.pick || '', l.lat, l.lng, l.acc, l.status, a.by === 'commish' ? 'Commissioner' : 'Player', late(a) ? 'yes' : '']; }))
    .map(l => l.map(q).join(',')).join('\n');
  const slug = 'stars-and-scrubs-' + w.label.toLowerCase().replace(/\s+/g, '-');
  MailApp.sendEmail({ to: RECIPIENTS, subject: "Stars and Scrubs Pick'em · " + w.label + ' review', htmlBody: h, name: "Stars and Scrubs Pick'em",
    attachments: [Utilities.newBlob(resultsCsv, 'text/csv', slug + '-results.csv'), Utilities.newBlob(auditCsv, 'text/csv', slug + '-audit.csv')] });
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
