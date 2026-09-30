# Stars and Scrubs Pick'em

Weekly NFL winner picks for the Stars and Scrubs fantasy league. Static site on GitHub Pages, picks stored in Firebase Firestore.

## How it works
- Managers open the link, type their name, and tap a winner for each game. No account needed (Firebase anonymous sign-in keeps picks tied to that phone/browser).
- Each game locks at kickoff, and no later than 1:00 PM ET Sunday. The database rules reject picks after lock.
- 1 point per correct pick; 0 for a miss or no pick. A tie scores nobody.
- The commissioner signs in with Google (footer link) to get the **Commish** tab: publish the schedule, post results, and enter picks sent by chat.

## Files
- `index.html` — the app
- `config.js` — Firebase web config + commissioner email
- `weeks.json` — schedule; each game has `kickoff` and `lockAt` (earlier of kickoff and Sun 1:00 PM ET)
- `firestore.rules` — paste into Firebase console → Firestore → Rules

## Each week
1. Add the new week to `weeks.json` (id, label, order, dates, games).
2. Open the site, sign in as commissioner, Commish → **Publish schedule**.
3. After games finish, tap winners in Commish → Final results.
