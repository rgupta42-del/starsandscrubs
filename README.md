# Stars and Scrubs Pick'em

Weekly NFL winner picks for the Stars and Scrubs fantasy league. Static site on GitHub Pages, picks stored in Firebase Firestore.

## How it works
- Managers open the link, choose their team from the dropdown (it's then tied to that phone), and tap a winner for each game. No account needed.
- Every pick, change and clear is written to an append-only audit trail with server time and approximate location (~1 km, with the browser's permission).
- Each game locks at kickoff, and no later than 1:00 PM ET Sunday. The database rules reject picks after lock.
- 1 point per correct pick; 0 for a miss or no pick. A tie scores nobody.
- The commissioner signs in with Google (footer link) to get the **Commish** tab: publish the schedule, post results, release team phones, and enter picks sent by chat. The **Review** tab shows the audit trail and emails the weekly review (see `emailer.gs`).

## Files
- `index.html` — the app
- `config.js` — Firebase web config + commissioner email
- `weeks.json` — schedule; each game has `kickoff` and `lockAt` (earlier of kickoff and Sun 1:00 PM ET)
- `emailer.gs` — Google Apps Script that sends the weekly review email
- `firestore.rules` — paste into Firebase console → Firestore → Rules

## Each week
1. Add the new week to `weeks.json` (id, label, order, dates, games).
2. Open the site, sign in as commissioner, Commish → **Publish schedule**.
3. After games finish, tap winners in Commish → Final results.
