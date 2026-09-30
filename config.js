// Firebase web config. These values identify the project; they are not secrets.
// Access is controlled by firestore.rules (and the key is restricted to this site in Google Cloud).
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyA5jqs6SOv22LwYYtGYRbBFozLPCoQ7lFs",
  authDomain: "stars-and-scrubs-pick-em.firebaseapp.com",
  projectId: "stars-and-scrubs-pick-em",
  storageBucket: "stars-and-scrubs-pick-em.firebasestorage.app",
  messagingSenderId: "624101470919",
  appId: "1:624101470919:web:95d10aff1b1368382204e2"
};

// Google accounts that can post results, manage teams and see the audit trail.
// Must match the emails in firestore.rules.
window.ADMIN_EMAILS = ["rgupta42@gmail.com", "vkudur@gmail.com"];

// League teams live in teams.json. The autopilot loads them into the site every hour.

// Weekly review email. Paste the Apps Script web app URL here (see autopilot.gs, step 5).
// Until it's set, "Email the review" opens your mail app with a summary instead.
window.REPORT_URL = null;
window.REPORT_TO = ["rgupta42@gmail.com", "vkudur@gmail.com"];
