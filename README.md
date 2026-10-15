# Stars and Scrubs Pick'em

Weekly NFL winner picks for the Stars and Scrubs fantasy league. Static site on GitHub Pages, picks stored in Firebase Firestore.

## How it works
- Managers open the link, choose their team from the dropdown (it's then tied to that phone), and tap a winner for each game. No account needed.
- Every pick, change and clear is written to an append-only audit trail with server time and approximate location (~1 km, with the browser's permission).
- Each game locks at kickoff, and no later than 1:00 PM ET Sunday. The database rules reject picks after lock.
- 1 point per correct pick; 0 for a miss or no pick. A tie scores nobody.
- The commissioner signs in with Google (footer link) to get the **Commish** tab: post or correct results, release team phones, and enter picks sent by chat. The **Review** tab shows the audit trail and emails the weekly review (see `autopilot.gs`).

## Files
- `index.html` — the app
- `config.js` — Firebase web config + commissioner email
- `teams.json` — the 12 league teams shown in the dropdown
- `autopilot.gs` + `appsscript.json` — Google Apps Script that runs hourly: posts winners from ESPN, emails the weekly review, and loads next week
- `firestore.rules` — paste into Firebase console → Firestore → Rules

## Each week (automatic)
- **Tuesday 9:00 AM ET:** every manager gets the week's games and their personal team link.
- **Thursday 3:30 PM ET:** managers who haven't finished their picks get a reminder (and a nudge to set their Yahoo lineup).
- **Each lock:** that game's picks become visible to the league (they're private until then).
- **After Monday Night Football is final:** every manager gets their week and season results and standings; the commissioners get the full review with results and audit CSVs.

The autopilot (Apps Script, every 5 minutes) also keeps Weeks 4–17 and the teams loaded from nflverse and `teams.json`.
Manager emails live only in the private Code.gs in Apps Script (`LEAGUE_EMAILS`), never in this repo.
