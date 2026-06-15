// ============================================================================
// FIREBASE CONFIG — fill this in with YOUR Firebase project's credentials.
//
// How to get these values (free tier, ~5 minutes):
// 1. Go to https://console.firebase.google.com/ and create a project
//    (or use an existing one).
// 2. In the project, click "Build" -> "Realtime Database" -> "Create Database".
//    - Choose any region.
//    - Start in "test mode" (open read/write rules) — see rules below.
// 3. Click the gear icon (Project settings) -> scroll to "Your apps" ->
//    click the </> (web) icon -> register an app (no hosting needed).
// 4. Firebase will show you a config object that looks like the one below.
//    Copy those values into the object here.
//
// Realtime Database RULES (Realtime Database -> Rules tab) — paste this:
// {
//   "rules": {
//     "trapgrid": {
//       ".read": true,
//       ".write": true
//     }
//   }
// }
// This keeps the rest of your database private while allowing this game
// to read/write only under the "trapgrid" path. You can tighten this later.
// ============================================================================

export const firebaseConfig = {
    apiKey: "AIzaSyAvRFqFutfPJi2TTW3dXRYar8SxzWShCpk",
    authDomain: "trapgrid-7e448.firebaseapp.com",
    databaseURL: "https://trapgrid-7e448-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "trapgrid-7e448",
    storageBucket: "trapgrid-7e448.firebasestorage.app",
    messagingSenderId: "1032747603566",
    appId: "1:1032747603566:web:b75817a54aa62b8782b87f",
    measurementId: "G-D1BE36SY9B",
};