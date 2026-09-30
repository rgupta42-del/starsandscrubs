// Paste the firebaseConfig object from Firebase console → Project settings → Your apps.
// These values identify the project; they are not secrets. Access is controlled by firestore.rules.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyA5jqs6SOv22LwYYtGYRbBFozLPCoQ7lFs",
  authDomain: "stars-and-scrubs-pick-em.firebaseapp.com",
  projectId: "stars-and-scrubs-pick-em",
  storageBucket: "stars-and-scrubs-pick-em.firebasestorage.app",
  messagingSenderId: "624101470919",
  appId: "1:624101470919:web:95d10aff1b1368382204e2"
};

// The Google account that can post results and enter picks from chat.
// Must match the email in firestore.rules.
window.ADMIN_EMAIL = "rgupta42@gmail.com";
