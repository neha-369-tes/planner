/* ============================================================
   FlowState — app.js FIREBASE PATCH
   
   Apply these 3 targeted changes to your existing app.js.
   Everything else in app.js stays exactly the same.
   ============================================================ */


// ════════════════════════════════════════════════════════════
//  CHANGE 1 — Replace the save() function (around line 32)
//  Find this exact function and replace it entirely:
// ════════════════════════════════════════════════════════════

/*  REMOVE this block:

function save() {
  localStorage.setItem('fs_tasks',  JSON.stringify(state.tasks));
  localStorage.setItem('fs_goals',  JSON.stringify(state.goals));
  localStorage.setItem('fs_blocks', JSON.stringify(state.blocks));
  localStorage.setItem('fs_completionLog', JSON.stringify(state.completionLog));
  localStorage.setItem('fs_monthChecks', JSON.stringify(state.monthChecks));
  localStorage.setItem('fs_xp',     state.xp);
  localStorage.setItem('fs_level',  state.level);
  localStorage.setItem('fs_streak', state.streak);
  localStorage.setItem('fs_mood',   state.mood);
  localStorage.setItem('fs_nextId', state.nextId);
  localStorage.setItem('fs_availability', JSON.stringify(state.availability));
}

*/

//  REPLACE WITH:

function save() {
  // Keep localStorage as offline/fast cache
  localStorage.setItem('fs_tasks',  JSON.stringify(state.tasks));
  localStorage.setItem('fs_goals',  JSON.stringify(state.goals));
  localStorage.setItem('fs_blocks', JSON.stringify(state.blocks));
  localStorage.setItem('fs_completionLog', JSON.stringify(state.completionLog));
  localStorage.setItem('fs_monthChecks', JSON.stringify(state.monthChecks));
  localStorage.setItem('fs_xp',     state.xp);
  localStorage.setItem('fs_level',  state.level);
  localStorage.setItem('fs_streak', state.streak);
  localStorage.setItem('fs_mood',   state.mood);
  localStorage.setItem('fs_nextId', state.nextId);
  localStorage.setItem('fs_availability', JSON.stringify(state.availability));

  // Also sync to Firestore if user is logged in
  if (window.__fs_currentUid && window.fsSaveUserData) {
    window.fsSaveUserData(window.__fs_currentUid, state);
  }
}


// ════════════════════════════════════════════════════════════
//  CHANGE 2 — Add this callback registration BEFORE init()
//  Add it just above: document.addEventListener('DOMContentLoaded', init);
// ════════════════════════════════════════════════════════════

// Called by firebase-auth.js once Firestore data is loaded for the user.
// Merges cloud data into state so the dashboard reflects the user's real data.
window.__fs_onDataLoaded = function(cloudData) {
  if (!cloudData) return;

  // Merge cloud fields into state (cloud wins over stale localStorage)
  if (Array.isArray(cloudData.tasks))        state.tasks         = cloudData.tasks;
  if (Array.isArray(cloudData.goals))        state.goals         = cloudData.goals;
  if (Array.isArray(cloudData.blocks))       state.blocks        = cloudData.blocks;
  if (cloudData.completionLog)               state.completionLog = cloudData.completionLog;
  if (cloudData.monthChecks)                 state.monthChecks   = cloudData.monthChecks;
  if (typeof cloudData.xp     === 'number')  state.xp            = cloudData.xp;
  if (typeof cloudData.level  === 'number')  state.level         = cloudData.level;
  if (typeof cloudData.streak === 'number')  state.streak        = cloudData.streak;
  if (typeof cloudData.nextId === 'number')  state.nextId        = cloudData.nextId;
  if (cloudData.mood)                        state.mood          = cloudData.mood;
  if (cloudData.availability)                state.availability  = cloudData.availability;

  // Also update localStorage cache so offline mode has fresh data
  localStorage.setItem('fs_tasks',  JSON.stringify(state.tasks));
  localStorage.setItem('fs_goals',  JSON.stringify(state.goals));
  localStorage.setItem('fs_blocks', JSON.stringify(state.blocks));
  localStorage.setItem('fs_completionLog', JSON.stringify(state.completionLog));
  localStorage.setItem('fs_monthChecks', JSON.stringify(state.monthChecks));
  localStorage.setItem('fs_xp',    state.xp);
  localStorage.setItem('fs_level', state.level);
  localStorage.setItem('fs_streak',state.streak);
  localStorage.setItem('fs_mood',  state.mood);
  localStorage.setItem('fs_nextId',state.nextId);
  localStorage.setItem('fs_availability', JSON.stringify(state.availability));

  // Re-render everything with the fresh data
  syncDoneToday();
  normalizeTaskDates();
  renderTasks();
  renderGoals();
  renderMonthSheet();
  renderBlocks();
  renderXP();
  setMood(state.mood);
  checkStreak();
  updateSessionStats();
};


// ════════════════════════════════════════════════════════════
//  CHANGE 3 — Update index.html to load firebase-auth.js
//  
//  In index.html, find the LAST line:
//    <script src="app.js"></script>
//  
//  Replace it with:
//    <script type="module" src="firebase-auth.js"></script>
//    <script src="app.js"></script>
//
//  firebase-auth.js MUST load as type="module" (it uses ES imports).
//  app.js stays as a regular script — no changes needed there.
// ════════════════════════════════════════════════════════════


/* ============================================================
   FIRESTORE SECURITY RULES
   
   Go to Firebase Console → Firestore → Rules tab
   Paste this (replaces the default rules):
   ============================================================

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Each user can only read/write their own document
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}

   ============================================================ */


/* ============================================================
   SUMMARY OF ALL CHANGES:
   
   1. app.js  → save() now also calls fsSaveUserData() when logged in
   2. app.js  → add window.__fs_onDataLoaded() before DOMContentLoaded
   3. index.html → add <script type="module" src="firebase-auth.js">
                   before the existing <script src="app.js"> line
   4. firebase-auth.js → new file (already output separately)
   
   HOW IT WORKS:
   • firebase-auth.js shows a login screen before the app loads
   • After login, it loads the user's Firestore data and calls
     __fs_onDataLoaded() which hydrates state and re-renders the UI
   • Every save() call writes to localStorage (fast, offline cache)
     AND to Firestore (cloud, debounced 800ms)
   • Logging out hides the dashboard; logging in from another
     device loads that user's exact data from Firestore
   
   DATA ISOLATION:
   • Firestore path: users/{uid}  — one doc per user
   • Security rules enforce that users can only access their own doc
   • localStorage is keyed per-browser, Firestore is keyed per user
   ============================================================ */
