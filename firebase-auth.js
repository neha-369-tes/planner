/* ============================================================
   FlowState — firebase-auth.js
   Drop this file alongside index.html, app.js, style.css
   
   SETUP (one-time):
   1. Go to https://console.firebase.google.com
   2. Create a project → Add a Web App → copy the config below
   3. Enable Authentication → Sign-in method → Email/Password + Google
   4. Enable Firestore Database → Start in production mode
   5. Paste your config values into the FIREBASE_CONFIG object below
   ============================================================ */

// ── YOUR FIREBASE CONFIG — replace all values ──────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAVNxAljMNsSoVPaQYQHG_Vv3yHpRfSl1I",
  authDomain:        "flowstate-a05d5.firebaseapp.com",
  projectId:         "flowstate-a05d5",
  storageBucket:     "flowstate-a05d5.firebasestorage.app",
  messagingSenderId: "560504440983",
  appId:             "1:560504440983:web:5d09cc76107d489c0bc1d2"
};
// ───────────────────────────────────────────────────────────

import { initializeApp }                          from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged,
         createUserWithEmailAndPassword,
         signInWithEmailAndPassword,
         signInWithPopup, GoogleAuthProvider,
         signOut, updateProfile, sendEmailVerification,
         setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc,
         updateDoc, serverTimestamp }             from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Init ───────────────────────────────────────────────────
const app      = initializeApp(FIREBASE_CONFIG);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();

// Set auth persistence to SESSION only (clears on browser close)
// This prevents auto-login on page reload
setPersistence(auth, browserSessionPersistence)
  .catch(e => console.warn('[FlowState] Persistence error:', e.message));

// Expose globally so app.js can call them
window.__fs_auth = auth;
window.__fs_db   = db;


// ============================================================
//  AUTH OVERLAY  (injected into <body> before app loads)
// ============================================================
function buildAuthOverlay() {
  const div = document.createElement('div');
  div.id = 'authOverlay';
  div.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo"><span class="logo-icon">⚡</span><span class="auth-logo-text">FlowState</span></div>
      <p class="auth-sub">Your AI-powered daily planner</p>

      <div class="auth-tabs">
        <button class="auth-tab active" data-tab="login">Sign In</button>
        <button class="auth-tab" data-tab="signup">Sign Up</button>
      </div>

      <!-- LOGIN -->
      <div class="auth-form" id="loginForm">
        <input class="auth-input" type="email"    id="loginEmail"    placeholder="Email address" autocomplete="email" required />
        <input class="auth-input" type="password" id="loginPassword" placeholder="Password"      autocomplete="current-password" required minlength="6" />
        <button class="auth-btn-primary" id="loginBtn">Sign In</button>
        <div class="auth-divider"><span>or</span></div>
        <button class="auth-btn-google" id="googleLoginBtn">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
        <p class="auth-error" id="loginError"></p>
      </div>

      <!-- SIGNUP -->
      <div class="auth-form hidden" id="signupForm">
        <input class="auth-input" type="text"     id="signupName"     placeholder="Display name" autocomplete="name" required />
        <input class="auth-input" type="email"    id="signupEmail"    placeholder="Email address" autocomplete="email" required />
        <input class="auth-input" type="password" id="signupPassword" placeholder="Password (min 6 chars)" autocomplete="new-password" required minlength="6" />
        <button class="auth-btn-primary" id="signupBtn">Create Account</button>
        <div class="auth-divider"><span>or</span></div>
        <button class="auth-btn-google" id="googleSignupBtn">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
        <p class="auth-error" id="signupError"></p>
      </div>

      <!-- VERIFY -->
      <div class="auth-form hidden" id="verifyForm">
        <p class="auth-sub" style="margin:0; text-align:center;"></p>
        <button class="auth-btn-primary" id="resendVerificationBtn" style="margin-top: 20px;">Resend Verification Email</button>
        <button class="auth-btn-secondary" id="signOutVerifyBtn" style="margin-top: 10px; background: var(--dim-text); color: var(--text);">Back to Sign In</button>
      </div>

    </div>
  `;
  document.body.prepend(div);
  injectAuthStyles();
  bindAuthEvents();
}

function injectAuthStyles() {
  const s = document.createElement('style');
  s.textContent = `
    #authOverlay {
      position:fixed;inset:0;z-index:9999;
      background:
        radial-gradient(circle at 18% 30%, rgba(255,255,255,0.18), transparent 26%),
        radial-gradient(circle at 82% 75%, rgba(0,255,178,0.12), transparent 32%),
        linear-gradient(180deg,#101a31 0%,#0d1628 50%,#081120 100%);
      display:flex;align-items:center;justify-content:center;
      transition:opacity .35s ease;
    }
    #authOverlay.hide { opacity:0; pointer-events:none; }

    .auth-card {
      width:360px;max-width:calc(100vw - 32px);
      background:rgba(18,24,40,0.72);
      border:1px solid rgba(255,255,255,0.18);
      border-radius:24px;
      padding:32px 28px 28px;
      backdrop-filter:blur(24px) saturate(160%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.2),0 24px 60px -18px rgba(4,8,18,0.7);
    }
    .auth-logo { display:flex;align-items:center;gap:8px;margin-bottom:6px; }
    .auth-logo-text {
      font-family:'Bebas Neue',Impact,sans-serif;
      font-size:1.6rem;color:#F8F7F2;
      letter-spacing:.04em;
    }
    .auth-sub { font-size:.75rem;color:#B2B6D3;margin-bottom:22px;letter-spacing:.02em; }

    .auth-tabs { display:flex;gap:6px;margin-bottom:20px; }
    .auth-tab {
      flex:1;font-family:'Bebas Neue',sans-serif;font-size:.82rem;
      letter-spacing:.08em;padding:7px 0;border-radius:100px;
      border:1px solid rgba(240,237,230,0.1);color:#8A91B5;
      background:transparent;cursor:pointer;transition:all .18s ease;
    }
    .auth-tab.active { color:#00FFB2;border-color:rgba(0,255,178,0.35);background:rgba(0,255,178,0.08); }

    .auth-form { display:flex;flex-direction:column;gap:10px; }
    .auth-form.hidden { display:none; }

    .auth-input {
      font-family:'DM Sans','Bebas Neue',sans-serif;font-size:.88rem;
      color:#F0EEF8;background:rgba(255,255,255,0.05);
      border:1px solid rgba(255,255,255,0.14);border-radius:12px;
      padding:10px 14px;width:100%;transition:border-color .18s;
    }
    .auth-input::placeholder { color:#6B7299; }
    .auth-input:focus { outline:none;border-color:rgba(0,255,178,0.45); }

    .auth-btn-primary {
      font-family:'Bebas Neue',sans-serif;font-size:.9rem;letter-spacing:.08em;
      color:#090f1d;background:#00FFB2;border:none;border-radius:100px;
      padding:11px 0;cursor:pointer;transition:opacity .18s,box-shadow .18s;
      font-weight:600;
    }
    .auth-btn-primary:hover { opacity:.88;box-shadow:0 0 14px rgba(0,255,178,0.45); }
    .auth-btn-primary:disabled { opacity:.45;cursor:not-allowed; }

    .auth-divider {
      display:flex;align-items:center;gap:10px;
      color:#5A6080;font-size:.72rem;letter-spacing:.06em;
    }
    .auth-divider::before,.auth-divider::after {
      content:'';flex:1;height:1px;background:rgba(255,255,255,0.1);
    }

    .auth-btn-google {
      display:flex;align-items:center;justify-content:center;gap:10px;
      font-family:'DM Sans',sans-serif;font-size:.82rem;color:#E0E4F8;
      background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.16);
      border-radius:100px;padding:9px 0;cursor:pointer;transition:all .18s ease;
    }
    .auth-btn-google:hover { background:rgba(255,255,255,0.11);border-color:rgba(255,255,255,0.28); }

    .auth-btn-secondary {
      font-family:'Bebas Neue',sans-serif;font-size:.9rem;letter-spacing:.08em;
      color:#E0E4F8;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);
      border-radius:100px;padding:11px 0;cursor:pointer;transition:all .18s;
      font-weight:600;width:100%;
    }
    .auth-btn-secondary:hover { background:rgba(255,255,255,0.12);border-color:rgba(255,255,255,0.28); }
    .auth-btn-secondary:disabled { opacity:.45;cursor:not-allowed; }

    .auth-error {
      font-size:.72rem;color:#FF6B6B;min-height:18px;
      text-align:center;letter-spacing:.02em;
    }

    /* User badge injected into topbar */
    #userBadge {
      display:flex;align-items:center;gap:8px;
    }
    #userAvatar {
      width:28px;height:28px;border-radius:50%;
      background:rgba(0,255,178,0.2);border:1px solid rgba(0,255,178,0.4);
      display:flex;align-items:center;justify-content:center;
      font-size:.72rem;color:#00FFB2;font-weight:600;
      overflow:hidden;flex-shrink:0;
    }
    #userAvatar img { width:100%;height:100%;object-fit:cover; }
    #userDisplayName {
      font-size:.72rem;color:#C8CDE8;
      max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    }
    #signOutBtn {
      font-size:.68rem;color:#8A91B5;
      border:1px solid rgba(240,237,230,0.1);border-radius:100px;
      padding:3px 10px;background:transparent;cursor:pointer;
      transition:color .18s,border-color .18s;
    }
    #signOutBtn:hover { color:#FF6B6B;border-color:rgba(255,107,107,0.3); }
  `;
  document.head.appendChild(s);
}

function setAuthError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait…' : btn.dataset.label;
}

function bindAuthEvents() {
  // Tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('loginForm').classList.toggle('hidden', target !== 'login');
      document.getElementById('signupForm').classList.toggle('hidden', target !== 'signup');
      document.getElementById('verifyForm').classList.add('hidden');
    });
  });

  // Store button labels for restore after loading
  ['loginBtn','signupBtn','googleLoginBtn','googleSignupBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dataset.label = el.textContent;
  });

  // LOGIN
  document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPassword').value; // don't trim password
    setAuthError('loginError', '');
    
    // Strict validation - password cannot be empty or whitespace-only
    if (!email) { setAuthError('loginError', 'Enter your email address.'); return; }
    if (!email.includes('@')) { setAuthError('loginError', 'Please enter a valid email address.'); return; }
    if (!pass || pass.length === 0) { setAuthError('loginError', 'Enter your password.'); return; }
    if (pass.length < 6) { setAuthError('loginError', 'Password must be at least 6 characters.'); return; }
    
    setLoading('loginBtn', true);
    try {
      const result = await signInWithEmailAndPassword(auth, email, pass);
      console.log('[FlowState] Login successful:', result.user.email);
      // onAuthStateChanged will handle routing verified/unverified users
    } catch (e) {
      console.error('[FlowState] Login error:', e.code, e.message);
      setAuthError('loginError', friendlyFirebaseError(e.code));
      setLoading('loginBtn', false);
    }
  });

  // SIGNUP
  document.getElementById('signupBtn').addEventListener('click', async () => {
    const name  = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const pass  = document.getElementById('signupPassword').value;
    setAuthError('signupError', '');
    if (!name)  { setAuthError('signupError', 'Enter your display name.'); return; }
    if (!email) { setAuthError('signupError', 'Enter your email.'); return; }
    if (pass.length < 6) { setAuthError('signupError', 'Password must be at least 6 characters.'); return; }
    setLoading('signupBtn', true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      await sendEmailVerification(cred.user);

      // Show verification message
      document.getElementById('loginForm').classList.add('hidden');
      document.getElementById('signupForm').classList.add('hidden');
      const verifyForm = document.getElementById('verifyForm');
      verifyForm.classList.remove('hidden');
      verifyForm.querySelector('p').innerHTML = `
        Verification email sent to <b>${email}</b>.
        <br><br>
        Please check your inbox and click the link to finish signing up.
      `;
      document.querySelector('.auth-tabs').style.display = 'none';

    } catch (e) {
      setAuthError('signupError', friendlyFirebaseError(e.code));
      setLoading('signupBtn', false);
    }
  });

  // GOOGLE (both tabs)
  ['googleLoginBtn', 'googleSignupBtn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        const errId = id === 'googleLoginBtn' ? 'loginError' : 'signupError';
        setAuthError(errId, friendlyFirebaseError(e.code));
      }
    });
  });

  // Enter key on inputs
  ['loginEmail','loginPassword'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('loginBtn').click();
    });
  });
  ['signupName','signupEmail','signupPassword'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('signupBtn').click();
    });
  });

  // RESEND VERIFICATION EMAIL
  document.getElementById('resendVerificationBtn')?.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (user && !user.emailVerified) {
      setLoading('resendVerificationBtn', true);
      try {
        await sendEmailVerification(user);
        alert('✓ Verification email resent to ' + user.email + '\n\nCheck your inbox and spam folder.');
      } catch (e) {
        alert('Error resending email: ' + (e.message || 'Network error'));
      }
      setLoading('resendVerificationBtn', false);
    }
  });

  // SIGN OUT FROM VERIFY SCREEN
  document.getElementById('signOutVerifyBtn')?.addEventListener('click', async () => {
    await signOut(auth);
  });
}

function friendlyFirebaseError(code) {
  const map = {
    'auth/user-not-found':       'No account found with this email. Please sign up first.',
    'auth/wrong-password':       'Incorrect password. Please check and try again.',
    'auth/invalid-credential':   'Incorrect email or password.',
    'auth/invalid-login-credentials': 'Incorrect email or password.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/invalid-email':        'Please enter a valid email address.',
    'auth/too-many-requests':    'Too many login attempts. Try again in a few minutes.',
    'auth/popup-closed-by-user': 'Sign-in popup was closed.',
    'auth/network-request-failed':'Network error — check your connection.',
    'auth/operation-not-allowed': 'Email sign-in is not enabled. Use Google sign-in instead.',
  };
  return map[code] || 'Login failed: ' + (code || 'Unknown error');
}


// ============================================================
//  FIRESTORE SYNC  (called from app.js)
// ============================================================

window.fsLoadUserData = async function(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    return snap.data();
  } catch (e) {
    console.warn('[FlowState] Firestore load error:', e.message);
    return null;
  }
};

let _saveTimer = null;
window.fsSaveUserData = function(uid, stateSnapshot) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      const payload = {
        tasks:          stateSnapshot.tasks,
        goals:          stateSnapshot.goals,
        blocks:         stateSnapshot.blocks,
        completionLog:  stateSnapshot.completionLog,
        monthChecks:    stateSnapshot.monthChecks,
        xp:             stateSnapshot.xp,
        xpMax:          stateSnapshot.xpMax,
        level:          stateSnapshot.level,
        streak:         stateSnapshot.streak,
        lastStreakDate: stateSnapshot.lastStreakDate || null,
        mood:           stateSnapshot.mood,
        nextId:         stateSnapshot.nextId,
        availability:   stateSnapshot.availability,
        scheduleDayOffset: stateSnapshot.scheduleDayOffset || 0,
        userSchedule:   stateSnapshot.userSchedule || {},
        updatedAt:      serverTimestamp(),
      };
      await setDoc(doc(db, 'users', uid), payload, { merge: true });
    } catch (e) {
      console.warn('[FlowState] Firestore save error:', e.message);
    }
  }, 800); // debounce 800ms
};

window.fsCreateUserProfile = async function(user) {
  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return; // already exists
    await setDoc(ref, {
      displayName: user.displayName || '',
      email:       user.email || '',
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp(),
    });
  } catch (e) {
    console.warn('[FlowState] Profile create error:', e.message);
  }
};


// ============================================================
//  AUTH STATE LISTENER  (boot gate)
// ============================================================
buildAuthOverlay();

// Flag to track if we should sign out on page load
let shouldEnforceLogout = false;

// Hide main app until auth resolves
document.addEventListener('DOMContentLoaded', async () => {
  const dashboard = document.querySelector('.dashboard-grid');
  const topbar    = document.querySelector('.topbar');
  const agentWrap = document.querySelector('.agent-bottom-wrap');
  [dashboard, topbar, agentWrap].forEach(el => {
    if (el) el.style.visibility = 'hidden';
  });
  
  // Set flag and clear browser cache
  shouldEnforceLogout = true;
  
  // Clear Firebase persistence completely
  try {
    // Sign out and wait for completion
    await signOut(auth);
    console.log('[FlowState] Signed out on page load');
  } catch (e) {
    console.warn('[FlowState] Sign out error:', e.message);
  }
  
  // Also clear IndexedDB cache used by Firebase
  try {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name.includes('firebase')) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  } catch (e) {
    console.warn('[FlowState] IndexedDB clear error:', e.message);
  }
});

let authListenerInitialized = false;

onAuthStateChanged(auth, async (user) => {
  const overlay   = document.getElementById('authOverlay');
  const dashboard = document.querySelector('.dashboard-grid');
  const topbar    = document.querySelector('.topbar');
  const agentWrap = document.querySelector('.agent-bottom-wrap');

  // If we're enforcing logout and user exists, ignore this state change
  if (shouldEnforceLogout && user && !authListenerInitialized) {
    console.log('[FlowState] Ignoring auto-login due to logout enforcement');
    return;
  }
  
  authListenerInitialized = true;

  if (user) {
    // --- USER IS SIGNED IN ---
    if (user.emailVerified) {
      // ── 1. VERIFIED: Access granted ──────────────────────
      window.__fs_currentUid = user.uid;
      await window.fsCreateUserProfile(user); // Create profile if brand new
      const cloudData = await window.fsLoadUserData(user.uid);
      if (cloudData && window.__fs_onDataLoaded) {
        window.__fs_onDataLoaded(cloudData);
      }

      // Inject user badge
      const topbarRight = document.querySelector('.topbar-right');
      if (topbarRight && !document.getElementById('userBadge')) {
        const initials = (user.displayName || user.email || 'U')
          .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const badge = document.createElement('div');
        badge.id = 'userBadge';
        badge.innerHTML = `
          <div id="userAvatar">
            ${user.photoURL
              ? `<img src="${user.photoURL}" alt="avatar" referrerpolicy="no-referrer" />`
              : initials}
          </div>
          <span id="userDisplayName">${user.displayName || user.email}</span>
          <button id="signOutBtn">Sign out</button>
        `;
        topbarRight.prepend(badge);
        document.getElementById('signOutBtn').addEventListener('click', () => signOut(auth));
      }

      // Show app, hide overlay
      [dashboard, topbar, agentWrap].forEach(el => { if (el) el.style.visibility = 'visible'; });
      overlay.classList.add('hide');
      setTimeout(() => { overlay.style.display = 'none'; }, 380);

    } else {
      // ── 2. NOT VERIFIED: Show message ────────────────────
      setAuthError('loginError', 'Please check your inbox and verify your email to continue.');
      setLoading('loginBtn', false);
      // Ensure auth overlay stays visible
      [dashboard, topbar, agentWrap].forEach(el => { if (el) el.style.visibility = 'hidden'; });
      overlay.style.display = 'flex';
      overlay.classList.remove('hide');
    }

  } else {
    // ── Logged OUT ─────────────────────────────────────────
    window.__fs_currentUid = null;
    document.getElementById('userBadge')?.remove();
    [dashboard, topbar, agentWrap].forEach(el => { if (el) el.style.visibility = 'hidden'; });
    // Reset auth forms to default state
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('signupForm').classList.add('hidden');
    document.getElementById('verifyForm').classList.add('hidden');
    document.querySelector('.auth-tabs').style.display = 'flex';
    setAuthError('loginError', '');
    setAuthError('signupError', '');
    // Show overlay
    overlay.style.display = 'flex';
    overlay.classList.remove('hide');
  }
});
