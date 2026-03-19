/* ============================================================
   FlowState — app.js
   ============================================================ */

'use strict';

// ── State ──────────────────────────────────────────────────
const state = {
  tasks: JSON.parse(localStorage.getItem('fs_tasks') || 'null') || [
    { id: 0, name: 'Review project brief', tag: 'work',      duration: '45m', priority: 'medium', note: 'From yesterday — don\'t forget this one', status: 'todo', carryOver: true,  time: null, createdDate: getDateKey(), completedDate: null },
    { id: 1, name: 'leetcode',             tag: 'interview', duration: '30m', priority: 'high',   note: 'focus on why, how and where',            status: 'todo', carryOver: false, time: null, createdDate: getDateKey(), completedDate: null },
  ],
  goals: JSON.parse(localStorage.getItem('fs_goals') || 'null') || [
    { icon: '💼', name: 'Land First Job',   pct: 0   },
    { icon: '📚', name: 'Learn New Skill',  pct: 100 },
    { icon: '🌐', name: 'Build Portfolio',  pct: 0   },
  ],
  blocks: JSON.parse(localStorage.getItem('fs_blocks') || '[]'),
  completionLog: JSON.parse(localStorage.getItem('fs_completionLog') || '{}'),
  monthChecks: JSON.parse(localStorage.getItem('fs_monthChecks') || '{}'),
  xp:        parseInt(localStorage.getItem('fs_xp')   || '40'),
  xpMax:     200,
  level:     parseInt(localStorage.getItem('fs_level')|| '1'),
  streak:    parseInt(localStorage.getItem('fs_streak')|| '1'),
  mood:      localStorage.getItem('fs_mood') || 'Tired',
  sessions:  0,
  focusedSec:0,
  doneToday: 0,
  nextId:    parseInt(localStorage.getItem('fs_nextId')|| '2'),
  filter:    'all',
  scheduleDayOffset: 0,
  availability: JSON.parse(localStorage.getItem('fs_availability') || 'null') || {
    weekday: { start: '20:15', end: '23:00' },
    weekend: { start: '10:00', end: '14:00' },
  },

  // User schedule survey data
  userSchedule: JSON.parse(localStorage.getItem('fs_userSchedule') || 'null') || {
    profileCompleted: false,
    userType: null, // 'student', 'office-worker', 'freelancer', 'other'
    workingHours: { start: null, end: null }, // e.g., { start: '09:00', end: '17:00' }
    breakHours: { start: null, end: null }, // lunch break
    weekendAvailable: false,
    weekendHours: { start: null, end: null },
    commuteTime: 0, // minutes
    workDaysPerWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], // customizable
  },

  // timer
  timer: {
    running:   false,
    mode:      'Focus',
    totalSec:  25 * 60,
    remaining: 25 * 60,
    interval:  null,
  },
};

// ── Persist helpers ────────────────────────────────────────
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
  localStorage.setItem('fs_userSchedule', JSON.stringify(state.userSchedule));

  // Also sync to Firestore if user is logged in
  if (window.__fs_currentUid && window.fsSaveUserData) {
    window.fsSaveUserData(window.__fs_currentUid, state);
  }
}

// ── DOM refs ───────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Date display ───────────────────────────────────────────
function initDate() {
  const now = new Date();
  const opts = { weekday:'long', month:'long', day:'numeric' };
  $('todayDate').textContent = now.toLocaleDateString('en-US', opts);
}

function getDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function syncDoneToday() {
  state.doneToday = state.completionLog[getDateKey()] || 0;
}

function adjustCompletionForDate(dateKey, delta) {
  if (!dateKey) return;
  const next = Math.max(0, (state.completionLog[dateKey] || 0) + delta);
  if (next === 0) {
    delete state.completionLog[dateKey];
  } else {
    state.completionLog[dateKey] = next;
  }
  if (delta > 0) state.monthChecks[dateKey] = true;
  syncDoneToday();
}

function getDayTaskStats(dateKey) {
  const totalForDay = state.tasks.filter(t => t.createdDate === dateKey).length;
  if (totalForDay === 0) return { totalForDay: 0, doneForDay: 0, completionRatio: 0 };

  const doneForDay = state.tasks.filter(
    t => t.createdDate === dateKey && t.completedDate === dateKey
  ).length;

  return {
    totalForDay,
    doneForDay,
    completionRatio: doneForDay / totalForDay,
  };
}

function normalizeTaskDates() {
  const todayKey = getDateKey();
  state.tasks.forEach(task => {
    if (!['todo', 'active', 'done'].includes(task.status)) task.status = 'todo';
    if (!task.createdDate) task.createdDate = todayKey;
    if (task.status === 'done' && !task.completedDate) task.completedDate = todayKey;
    if (task.status !== 'done') task.completedDate = null;
  });
}

function adjustTodayCompletion(delta) {
  const key = getDateKey();
  adjustCompletionForDate(key, delta);
}

// ============================================================
//  POMODORO TIMER
// ============================================================
const RING_CIRCUMFERENCE = 2 * Math.PI * 68; // r=68
const timerRing   = $('timerRing');
const timerDisplay= $('timerDisplay');
const timerLabel  = $('timerModeLabel');

function updateRing() {
  const progress = state.timer.remaining / state.timer.totalSec;
  const offset   = RING_CIRCUMFERENCE * (1 - progress);
  timerRing.style.strokeDashoffset = offset;
}

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2,'0');
  const s = String(sec % 60).padStart(2,'0');
  return `${m}:${s}`;
}

function renderTimer() {
  timerDisplay.textContent = formatTime(state.timer.remaining);
  timerLabel.textContent   = state.timer.mode.toUpperCase();
  updateRing();
}

function startTimer() {
  if (state.timer.running) return;
  state.timer.running = true;
  $('startBtn').textContent = '⏸ Pause';
  timerRing.classList.add('running');

  state.timer.interval = setInterval(() => {
    if (state.timer.remaining <= 0) {
      clearInterval(state.timer.interval);
      state.timer.running = false;
      $('startBtn').textContent = '▶ Start';
      timerRing.classList.remove('running');
      onTimerComplete();
      return;
    }
    state.timer.remaining--;
    if (state.timer.mode === 'Focus') state.focusedSec++;
    renderTimer();
    updateSessionStats();
  }, 1000);
}

function pauseTimer() {
  clearInterval(state.timer.interval);
  state.timer.running = false;
  $('startBtn').textContent = '▶ Start';
  timerRing.classList.remove('running');
}

function resetTimer() {
  clearInterval(state.timer.interval);
  state.timer.running   = false;
  state.timer.remaining = state.timer.totalSec;
  $('startBtn').textContent = '▶ Start';
  timerRing.classList.remove('running');
  renderTimer();
}

function onTimerComplete() {
  if (state.timer.mode === 'Focus') {
    state.sessions++;
    addXP(10);
    updateSessionStats();
    flashRing('var(--mint)');
    showFloatingMsg('+10 XP — Session complete!');
  }
  renderTimer();
}

function flashRing(color) {
  timerRing.style.stroke = color;
  setTimeout(() => { timerRing.style.stroke = ''; }, 800);
}

function setPreset(minutes, mode) {
  pauseTimer();
  state.timer.mode      = mode;
  state.timer.totalSec  = minutes * 60;
  state.timer.remaining = minutes * 60;
  renderTimer();
}

$('startBtn').addEventListener('click', () => {
  state.timer.running ? pauseTimer() : startTimer();
});
$('resetBtn').addEventListener('click', resetTimer);

$$('.preset-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('.preset-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    setPreset(parseInt(chip.dataset.minutes), chip.dataset.mode);
  });
});

// ── Session stats ──────────────────────────────────────────
function updateSessionStats() {
  $('sessionCount').textContent = state.sessions;
  const minutes = Math.floor(state.focusedSec / 60);
  $('focusedMin').textContent   = minutes > 0 ? `${minutes}m` : '0m';
  $('doneToday').textContent    = state.doneToday;
}

// ============================================================
//  XP + LEVEL
// ============================================================
function addXP(amount) {
  state.xp += amount;
  while (state.xp >= state.xpMax) {
    state.xp -= state.xpMax;
    state.level++;
    showFloatingMsg(`Level up! You're now Lv.${state.level} 🎉`);
  }
  renderXP();
  save();
}

function renderXP() {
  const pct = (state.xp / state.xpMax) * 100;
  document.querySelector('.xp-bar-fill').style.width = pct + '%';
  document.querySelector('.xp-label').textContent    = `XP ${state.xp}`;
  document.querySelector('.xp-level').textContent    = `Lv.${state.level}`;
}

// ============================================================
//  MOOD
// ============================================================
const MOOD_MESSAGES = {
  Focused: '😤 You\'re locked in. Crush the queue!',
  Happy:   '😊 Great energy! Ride this wave today.',
  Meh:     '😐 That\'s okay — start small, build momentum.',
  Tired:   '😴 Tired? Start with ONE small task, then rest. You can do it!',
  Anxious: '😰 Breathe. Pick the smallest task and begin.',
  Hyper:   '⚡ Channel that energy — tackle the hardest task first!',
};

function setMood(mood) {
  state.mood = mood;
  $$('.mood-chip').forEach(c => c.classList.toggle('active', c.dataset.mood === mood));
  $('moodMessage').textContent = MOOD_MESSAGES[mood] || '';
  save();
  if (!bootingPlanner) scheduleMemorySync('mood-change');
}

$$('.mood-chip').forEach(chip => {
  chip.addEventListener('click', () => setMood(chip.dataset.mood));
});

// ============================================================
//  MOTIVATIONAL QUOTES
// ============================================================
const QUOTES = [
  'Done > Perfect. Ship it, then polish.',
  'One task at a time. That\'s all it takes.',
  'Focus is the rarest and most valuable resource.',
  'The best time was yesterday. The second best is now.',
  'Small steps compound into giant leaps.',
  'Clarity of purpose beats intensity of effort.',
  'Momentum is built one session at a time.',
  'Start before you\'re ready.',
];

function rotateQuote() {
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  const el = $('motiQuote');
  el.style.opacity = '0';
  setTimeout(() => { el.textContent = q; el.style.opacity = '1'; }, 300);
}

$('motiQuote').style.transition = 'opacity 0.3s ease';
setInterval(rotateQuote, 18000);

// ============================================================
//  TASKS
// ============================================================
const TAG_CLASS = { interview:'tag-interview', work:'tag-work', learning:'tag-learning', personal:'tag-personal', health:'tag-health' };
const TAG_LABEL = { interview:'Interview', work:'Work', learning:'Learning', personal:'Personal', health:'Health' };

function buildTaskCard(task) {
  const div = document.createElement('div');
  div.className = `task-card${task.status === 'done' ? ' done' : ''}${task.carryOver ? ' carry-over' : ''}`;
  div.dataset.status = task.status;
  div.dataset.id     = task.id;

  div.innerHTML = `
    <div class="task-check-col">
      <button class="task-checkbox${task.status === 'done' ? ' checked' : ''}" data-id="${task.id}"></button>
    </div>
    <div class="task-body">
      <div class="task-top-row">
        <span class="task-name">${escHtml(task.name)}</span>
        <div class="task-actions">
          ${task.status === 'done'
            ? `<button class="task-revive-btn" title="Revive task" data-id="${task.id}">↺</button>`
            : `<button class="task-focus-btn" title="Focus on this" data-id="${task.id}">🎯</button>`}
          <button class="task-delete-btn" title="Delete" data-id="${task.id}">✕</button>
        </div>
      </div>
      <div class="task-meta">
        <span class="tag-pill ${TAG_CLASS[task.tag] || ''}">${TAG_LABEL[task.tag] || task.tag}</span>
        <span class="duration-dot">⏱ ${escHtml(task.duration)}</span>
        <span class="priority-badge priority-${task.priority}">${cap(task.priority)}</span>
        ${task.carryOver ? '<span class="carryover-label">carry-over</span>' : ''}
      </div>
      ${task.note ? `<p class="task-note"><em>${escHtml(task.note)}</em></p>` : ''}
    </div>
  `;
  return div;
}

// ── Schedule Survey System ─────────────────────────────────
function buildSurveyForm() {
  return `
    <div class="survey-section">
      <div class="survey-question">What's your current situation?</div>
      <div class="survey-options">
        <button class="survey-option-btn" data-value="student">👨‍🎓 Student</button>
        <button class="survey-option-btn" data-value="office-worker">💼 Office Worker</button>
        <button class="survey-option-btn" data-value="freelancer">🏠 Freelancer</button>
        <button class="survey-option-btn" data-value="other">⭐ Other</button>
      </div>
    </div>

    <div class="survey-section">
      <div class="survey-question">When are you busy with work/school?</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">From (e.g., 09:00)</label>
          <input type="time" class="survey-time-input" id="workStartTime" />
        </div>
        <div class="form-group">
          <label class="form-label">To (e.g., 17:00)</label>
          <input type="time" class="survey-time-input" id="workEndTime" />
        </div>
      </div>
    </div>

    <div class="survey-section">
      <div class="survey-question">When is your lunch/break time?</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">From (e.g., 12:00)</label>
          <input type="time" class="survey-time-input" id="breakStartTime" />
        </div>
        <div class="form-group">
          <label class="form-label">To (e.g., 13:00)</label>
          <input type="time" class="survey-time-input" id="breakEndTime" />
        </div>
      </div>
    </div>

    <div class="survey-section">
      <div class="survey-question">Are you available on weekends?</div>
      <div class="survey-options">
        <button class="survey-option-btn" data-value="yes">✅ Yes</button>
        <button class="survey-option-btn" data-value="no">❌ No</button>
      </div>
    </div>

    <div class="survey-section" id="weekendHoursSection" style="display: none;">
      <div class="survey-question">Your weekend availability time</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">From (e.g., 10:00)</label>
          <input type="time" class="survey-time-input" id="weekendStartTime" />
        </div>
        <div class="form-group">
          <label class="form-label">To (e.g., 14:00)</label>
          <input type="time" class="survey-time-input" id="weekendEndTime" />
        </div>
      </div>
    </div>
  `;
}

function showScheduleSurvey() {
  const overlay = $('surveyModalOverlay');
  const body = $('surveyModalBody');
  
  if (!overlay || !body) return;

  body.innerHTML = buildSurveyForm();
  overlay.classList.add('open');

  // Attach event listeners
  $$('.survey-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const container = btn.parentElement;
      $$('.survey-option-btn', container).forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');

      // Show/hide weekend hours based on availability
      if (btn.dataset.value === 'yes') {
        $('weekendHoursSection').style.display = 'block';
      } else if (btn.dataset.value === 'no') {
        $('weekendHoursSection').style.display = 'none';
      }
    });
  });

  $('saveSurveyBtn').onclick = () => saveSurveyData();
}

function saveSurveyData() {
  const userType = document.querySelector('.survey-option-btn[data-value].selected')?.dataset.value;
  const workStartTime = $('workStartTime')?.value;
  const workEndTime = $('workEndTime')?.value;
  const breakStartTime = $('breakStartTime')?.value;
  const breakEndTime = $('breakEndTime')?.value;
  const weekendAvailable = document.querySelector('[data-value="yes"].selected') || document.querySelector('[data-value="no"].selected');
  const isWeekendAvailable = weekendAvailable?.dataset.value === 'yes';
  const weekendStartTime = $('weekendStartTime')?.value;
  const weekendEndTime = $('weekendEndTime')?.value;

  if (!userType || !workStartTime || !workEndTime) {
    alert('Please fill in all required fields');
    return;
  }

  state.userSchedule = {
    profileCompleted: true,
    userType,
    workingHours: { start: workStartTime, end: workEndTime },
    breakHours: { start: breakStartTime || null, end: breakEndTime || null },
    weekendAvailable: isWeekendAvailable,
    weekendHours: isWeekendAvailable ? { start: weekendStartTime, end: weekendEndTime } : { start: null, end: null },
    commuteTime: 0,
    workDaysPerWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  };

  save();
  $('surveyModalOverlay').classList.remove('open');
  renderTasks();
  showFloatingMsg('✅ Schedule saved! Tasks will be organized automatically.');
}

function categorizeTask(task) {
  const dayOfWeek = new Date().toLocaleString('en-US', { weekday: 'long' });
  const isWeekend = dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday';

  if (!state.userSchedule.profileCompleted) {
    return 'todo';
  }

  // Task categorization logic
  if (isWeekend) {
    if (state.userSchedule.weekendAvailable && task.tag === 'work') {
      return 'weekendTasks';
    } else if (task.tag === 'personal' || task.tag === 'health') {
      return 'personalWorks';
    }
  }

  if (task.tag === 'work' || task.tag === 'interview') {
    return 'weeklyTasks';
  }

  if (task.tag === 'personal' || task.tag === 'health') {
    return 'personalWorks';
  }

  if (task.priority === 'high' && task.status === 'todo') {
    return 'weeklyTasks';
  }

  return 'todoTasks';
}

function renderTasksByCategory() {
  const weeklyList = $('weeklyTasksList');
  const weekendList = $('weekendTasksList');
  const personalList = $('personalWorksList');
  const todoList = $('todoTasksList');

  if (!weeklyList || !weekendList || !personalList || !todoList) return;

  // Clear all lists
  weeklyList.innerHTML = '';
  weekendList.innerHTML = '';
  personalList.innerHTML = '';
  todoList.innerHTML = '';

  // Categorize and add tasks
  state.tasks.forEach(task => {
    if (task.status === 'done') return;

    const category = categorizeTask(task);
    let list;

    switch (category) {
      case 'weeklyTasks':
        list = weeklyList;
        break;
      case 'weekendTasks':
        list = weekendList;
        break;
      case 'personalWorks':
        list = personalList;
        break;
      case 'todoTasks':
      default:
        list = todoList;
        break;
    }

    const card = buildTaskCard(task);
    list.appendChild(card);
  });
}

function renderTasks() {
  const filter = state.filter;
  
  // Filter check
  const visible = state.tasks.filter(t => {
    if (filter === 'todo')   return t.status === 'todo';
    if (filter === 'active') return t.status === 'active';
    if (filter === 'done')   return t.status === 'done';
    return true;
  });

  $('emptyState').style.display = visible.length === 0 ? 'block' : 'none';

  // Show survey if not completed
  if (!state.userSchedule.profileCompleted) {
    showScheduleSurvey();
  }

  // Render tasks by category
  renderTasksByCategory();

  // Progress label
  const total = state.tasks.length;
  const done  = state.tasks.filter(t => t.status === 'done').length;
  $('taskProgressLabel').textContent = `${done} of ${total} task${total !== 1 ? 's' : ''} complete`;

  bindTaskEvents();
}

function getHeatLevel(taskCount) {
  if (taskCount <= 0) return 0;
  if (taskCount === 1) return 1;
  if (taskCount === 2) return 2;
  if (taskCount <= 4) return 3;
  return 4;
}

function renderMonthSheet() {
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rangeEnd = new Date(now.getFullYear() + 1, now.getMonth() + 1, 0);
  const totalDays = Math.floor((rangeEnd - rangeStart) / 86400000) + 1;

  const labelStart = rangeStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const labelEnd = rangeEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  $('monthSheetLabel').textContent = `${labelStart} - ${labelEnd}`;

  const grid = $('monthHeatmapGrid');
  const monthAxis = $('monthAxis');
  grid.innerHTML = '';
  monthAxis.innerHTML = '';

  let checkedCount = 0;
  let runningCheckedStreak = 0;

  const startOffset = (rangeStart.getDay() + 6) % 7; // Monday=0..Sunday=6
  const totalCells = startOffset + totalDays;
  const weekColumns = Math.ceil(totalCells / 7);

  const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthStartCols = new Set();
  for (let m = 0; m < 13; m++) {
    const first = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + m, 1);
    const dayIndex = Math.floor((first - rangeStart) / 86400000);
    const col = Math.floor((startOffset + dayIndex) / 7);
    if (m > 0) monthStartCols.add(col);
    const label = document.createElement('span');
    label.className = 'month-axis-label';
    label.textContent = monthShort[first.getMonth()];
    label.style.gridColumn = String(col + 1);
    monthAxis.appendChild(label);
  }

  for (let col = 0; col < weekColumns; col++) {
    for (let row = 0; row < 7; row++) {
      const day = (col * 7 + row) - startOffset + 1;

      if (day < 1 || day > totalDays) {
        const empty = document.createElement('span');
        empty.className = `heat-day heat-day-empty${monthStartCols.has(col) ? ' month-sep' : ''}`;
        grid.appendChild(empty);
        continue;
      }

      const date = new Date(rangeStart);
      date.setDate(rangeStart.getDate() + day - 1);
      const key = getDateKey(date);
      const dayStats = getDayTaskStats(key);
      const autoCheckedByRatio = dayStats.totalForDay > 0 && dayStats.completionRatio >= 0.5;
      const taskCount = state.completionLog[key] || 0;
      const checked = Boolean(state.monthChecks[key] || autoCheckedByRatio);
      if (checked) {
        checkedCount++;
        runningCheckedStreak++;
      } else {
        runningCheckedStreak = 0;
      }

      let streakTier = 0;
      if (runningCheckedStreak >= 1) streakTier = 1;
      if (runningCheckedStreak >= 3) streakTier = 2;
      if (runningCheckedStreak >= 6) streakTier = 3;
      if (runningCheckedStreak >= 10) streakTier = 4;

      const heatLevel = getHeatLevel(taskCount);
      const combinedLevel = checked ? Math.max(heatLevel, Math.min(4, streakTier)) : heatLevel;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `heat-day heat-${combinedLevel}${checked ? ` checked streak-${streakTier}` : ''}${monthStartCols.has(col) ? ' month-sep' : ''}`;
      cell.dataset.date = key;
      cell.title = `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${dayStats.doneForDay}/${dayStats.totalForDay} done, streak ${runningCheckedStreak}`;
      cell.setAttribute('aria-label', cell.title);

      cell.addEventListener('click', () => {
        state.monthChecks[key] = !state.monthChecks[key];
        save();
        renderMonthSheet();
      });

      grid.appendChild(cell);
    }
  }

  $('monthSheetProgress').textContent = `${checkedCount} / ${totalDays} days checked`;
}

function bindTaskEvents() {
  $$('.task-checkbox').forEach(btn => {
    btn.addEventListener('click', () => toggleTask(parseInt(btn.dataset.id)));
  });
  $$('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteTask(parseInt(btn.dataset.id)));
  });
  $$('.task-focus-btn').forEach(btn => {
    btn.addEventListener('click', () => focusTask(parseInt(btn.dataset.id)));
  });
  $$('.task-revive-btn').forEach(btn => {
    btn.addEventListener('click', () => reviveTask(parseInt(btn.dataset.id)));
  });
}

function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (task.status !== 'done') {
    task.status = 'done';
    task.completedDate = getDateKey();
    adjustCompletionForDate(task.completedDate, 1);
    addXP(15);
    showFloatingMsg('+15 XP — Task complete!');
  } else {
    const previousDoneDate = task.completedDate || getDateKey();
    task.status = 'todo';
    task.completedDate = null;
    adjustCompletionForDate(previousDoneDate, -1);
  }
  updateSessionStats();
  renderTasks();
  renderMonthSheet();
  save();
  scheduleMemorySync('task-toggle');
}

function reviveTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task || task.status !== 'done') return;
  const previousDoneDate = task.completedDate || getDateKey();
  task.status = 'todo';
  task.completedDate = null;
  adjustCompletionForDate(previousDoneDate, -1);
  updateSessionStats();
  renderTasks();
  renderMonthSheet();
  save();
  scheduleMemorySync('task-revive');
  showFloatingMsg('Task revived.');
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  renderTasks();
  save();
  scheduleMemorySync('task-delete');
}

function focusTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  $('focusLabel').textContent = task.name;
  $('focusLabel').classList.add('has-task');

  // parse duration to minutes
  const raw = task.duration;
  let minutes = 25;
  if (raw.endsWith('h')) minutes = parseInt(raw) * 60;
  else if (raw.endsWith('m')) minutes = parseInt(raw);

  // find closest preset or use custom
  const chipMatch = Array.from($$('.preset-chip')).find(c => parseInt(c.dataset.minutes) === minutes);
  $$('.preset-chip').forEach(c => c.classList.remove('active'));
  if (chipMatch) chipMatch.classList.add('active');

  setPreset(minutes, 'Focus');
  showFloatingMsg(`Focusing on: ${task.name}`);
}

// Filter tabs
$$('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.filter = tab.dataset.filter;
    renderTasks();
  });
});

// ── Add Task Modal ─────────────────────────────────────────
function openModal(id) {
  const el = $(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = $(id);
  if (el) el.classList.remove('open');
}

$('addTaskBtn').addEventListener('click',  () => openModal('modalOverlay'));
$('modalClose').addEventListener('click',  () => closeModal('modalOverlay'));
$('cancelBtn').addEventListener('click',   () => closeModal('modalOverlay'));
$('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) closeModal('modalOverlay'); });

$('createTaskBtn').addEventListener('click', () => {
  const name = $('taskNameInput').value.trim();
  if (!name) { $('taskNameInput').focus(); $('taskNameInput').style.borderColor = 'var(--red)'; return; }
  $('taskNameInput').style.borderColor = '';

  const task = {
    id:        state.nextId++,
    name,
    tag:       $('taskTag').value,
    duration:  $('taskDuration').value,
    priority:  $('taskPriority').value,
    note:      $('taskNote').value.trim(),
    status:    'todo',
    carryOver: false,
    time:      null,
    createdDate: getDateKey(),
    completedDate: null,
  };

  state.tasks.push(task);

  $('taskNameInput').value = '';
  $('taskNote').value      = '';

  closeModal('modalOverlay');
  renderTasks();
  save();
  scheduleMemorySync('task-create');
  showFloatingMsg('Task added!');
});

// Enter key submits
$('taskNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('createTaskBtn').click(); });

// ============================================================
//  CAREER GOALS
// ============================================================
function renderGoals() {
  const container = $('goalBars');
  container.innerHTML = '';
  state.goals.forEach((g, i) => {
    const isFull = g.pct >= 100;
    container.innerHTML += `
      <div class="goal-item">
        <div class="goal-top">
          <span class="goal-icon">${g.icon}</span>
          <span class="goal-name">${escHtml(g.name)}</span>
          <span class="goal-pct${isFull ? ' mint' : ''}">${g.pct}%</span>
        </div>
        <div class="goal-bar-track">
          <div class="goal-bar-fill${isFull ? ' goal-bar-full' : ''}" style="width:${g.pct}%"></div>
        </div>
      </div>`;
  });
}

// Edit Goals Modal
$('editGoalsBtn').addEventListener('click', () => {
  const body = $('goalsModalBody');
  body.innerHTML = '';
  state.goals.forEach((g, i) => {
    body.innerHTML += `
      <div class="goal-edit-row">
        <span class="goal-edit-icon">${g.icon}</span>
        <span class="goal-edit-name">${escHtml(g.name)}</span>
        <input type="number" class="goal-edit-pct-input" data-index="${i}"
               min="0" max="100" value="${g.pct}" />
        <span style="font-size:.72rem;color:var(--text-muted)">%</span>
      </div>`;
  });
  openModal('goalsModalOverlay');
});
$('goalsModalClose').addEventListener('click', () => closeModal('goalsModalOverlay'));
$('goalsCancelBtn').addEventListener('click',  () => closeModal('goalsModalOverlay'));
$('goalsModalOverlay').addEventListener('click', e => { if (e.target === $('goalsModalOverlay')) closeModal('goalsModalOverlay'); });

$('saveGoalsBtn').addEventListener('click', () => {
  $$('.goal-edit-pct-input').forEach(inp => {
    const i   = parseInt(inp.dataset.index);
    const val = Math.min(100, Math.max(0, parseInt(inp.value) || 0));
    state.goals[i].pct = val;
  });
  renderGoals();
  closeModal('goalsModalOverlay');
  save();
  scheduleMemorySync('goals-update');
  showFloatingMsg('Goals updated!');
});

// ============================================================
//  SCHEDULE BLOCKS
// ============================================================
function renderBlocks() {
  const container = $('scheduleSlots');
  if (!container) return;
  const noMsg = container.querySelector('.no-slots-msg');
  const selectedDate = getDateKeyOffset(state.scheduleDayOffset || 0);
  const selectedDateLabel = formatDateShort(selectedDate);
  const labelEl = $('scheduleDayLabel');
  if (labelEl) {
    labelEl.textContent = (state.scheduleDayOffset === 0)
      ? 'Today'
      : `${state.scheduleDayOffset > 0 ? '+' : ''}${state.scheduleDayOffset}d`;
    labelEl.title = selectedDateLabel;
  }

  const hintEl = $('scheduleHint');
  if (hintEl) hintEl.textContent = `Viewing ${selectedDateLabel}. Chat updates will appear here.`;

  const todayBtn = $('scheduleTodayBtn');
  if (todayBtn) todayBtn.classList.toggle('active', state.scheduleDayOffset === 0);

  // remove old blocks
  container.querySelectorAll('.time-block').forEach(el => el.remove());

  const visibleBlocks = state.blocks.filter(b => {
    const blockDate = b.date || getDateKey();
    return blockDate === selectedDate;
  });

  if (visibleBlocks.length === 0) {
    const msg = `No time-blocked tasks for ${selectedDateLabel}`;
    if (!noMsg) container.innerHTML = `<p class="no-slots-msg">${msg}</p>`;
    else noMsg.textContent = msg;
    return;
  }
  if (noMsg) noMsg.remove();

  // sort by date (if any) then by start time
  const sorted = [...visibleBlocks].sort((a, b) => {
    return String(a.start || '').localeCompare(String(b.start || ''));
  });

  sorted.forEach(b => {
    const div = document.createElement('div');
    div.className = 'time-block';
    const timeStr = b.end ? `${fmtTime12(b.start)} – ${fmtTime12(b.end)}` : fmtTime12(b.start);
    const dayLabel = b.date ? formatDateShort(b.date) : '';
    div.innerHTML = `
      <span class="time-block-time">${dayLabel ? `${dayLabel} · ${timeStr}` : timeStr}</span>
      <span class="time-block-label">${escHtml(b.label)}</span>`;
    container.appendChild(div);
  });
}

function fmtTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour  = h % 12 || 12;
  return `${hour}:${String(m).padStart(2,'0')} ${ampm}`;
}

function formatDateShort(dateKey) {
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeToMin(t, fallback = 0) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return (hh * 60) + mm;
}

function pruneDaytimeBlocks(minStart = 20 * 60 + 15) {
  state.blocks = state.blocks.filter(b => {
    if (!b || !b.start) return true;
    return timeToMin(b.start, minStart) >= minStart;
  });
}

function getDateKeyOffset(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return getDateKey(d);
}

function toHHMM(hour24, minute) {
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseFreeStartTime(text) {
  const lower = String(text || '').toLowerCase();
  const hasAvailabilityCue = /\b(from|free|available|after|start)\b/.test(lower);
  if (!hasAvailabilityCue) return null;

  const match = lower.match(/(?:from|after|start(?:ing)?(?:\s+at)?)\s*(\d{1,2})(?:[:.](\d{1,2}))?\s*(am|pm)?/i)
    || lower.match(/\b(\d{1,2})(?:[:.](\d{1,2}))\s*(am|pm)\b/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = Math.max(0, Math.min(59, parseInt(match[2] || '0', 10)));
  const meridiem = (match[3] || '').toLowerCase();

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && hour <= 8) hour += 12;
  if (hour > 23) return null;

  return toHHMM(hour, minute);
}

function parseTimeToken(token) {
  const m = String(token || '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{1,2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10)));
  const meridiem = (m[3] || '').toLowerCase();

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && hour <= 8) hour += 12;
  if (hour > 23) return null;
  return toHHMM(hour, minute);
}

function parseTimeRange(text) {
  const m = String(text || '').toLowerCase()
    .match(/(\d{1,2}(?:[:.]\d{1,2})?\s*(?:am|pm)?)\s*(?:to|-|till|until)\s*(\d{1,2}(?:[:.]\d{1,2})?\s*(?:am|pm)?)/i);
  if (!m) return null;
  const start = parseTimeToken(m[1]);
  const end = parseTimeToken(m[2]);
  if (!start || !end) return null;
  return { start, end };
}

function extractDeadlineFromNoteText(note) {
  const m = String(note || '').match(/deadline\s*:\s*([^|]+)/i);
  return m ? m[1].trim() : '';
}

async function rebuildScheduleFromCurrentTasks() {
  const pendingTasks = state.tasks
    .filter(t => t.status !== 'done')
    .map(t => ({
      name: t.name,
      priority: t.priority,
      duration: t.duration,
      note: t.note || '',
      tag: t.tag || 'work',
      deadlineRaw: extractDeadlineFromNoteText(t.note || ''),
      routineRaw: /routine:\s*([^|]+)/i.exec(t.note || '')?.[1]?.trim() || 'single',
    }));

  const response = await fetch(`${AGENT_API_BASE}/api/rebuild-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: pendingTasks,
      weekdayStart: state.availability.weekday.start,
      weekdayEnd: state.availability.weekday.end,
      weekendStart: state.availability.weekend.start,
      weekendEnd: state.availability.weekend.end,
      horizonDays: 7,
      weekendTaskOnly: false,
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Could not rebuild schedule.');

  state.blocks = state.blocks.filter(b => b.source !== 'agent');
  (payload.slots || []).forEach(slot => {
    state.blocks.push({
      label: slot.label,
      start: slot.start,
      end: slot.end,
      source: 'agent',
      date: slot.date || null,
    });
  });

  renderBlocks();
  save();
  return payload;
}

function addChatTask(taskName, opts = {}) {
  const task = {
    id: state.nextId++,
    name: taskName,
    tag: opts.tag || 'learning',
    duration: opts.duration || '1h',
    priority: opts.priority || 'high',
    note: opts.note || 'Added from chat instruction',
    status: 'todo',
    carryOver: false,
    time: null,
    createdDate: opts.createdDate || getDateKey(),
    completedDate: null,
  };
  state.tasks.push(task);
  return task;
}

function normalizeSearchText(input) {
  return String(input || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferChatDuration(text) {
  const raw = String(text || '').toLowerCase();
  const h = raw.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  if (h) {
    const minutes = Math.max(15, Math.round(parseFloat(h[1]) * 60));
    return mapDuration(minutes);
  }
  const m = raw.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  if (m) {
    const minutes = Math.max(15, parseInt(m[1], 10));
    return mapDuration(minutes);
  }
  return '1h';
}

function inferChatPriority(text) {
  const raw = String(text || '').toLowerCase();
  if (/\b(high|urgent|critical|asap|p1)\b/.test(raw)) return 'high';
  if (/\b(low|later|p3|optional)\b/.test(raw)) return 'low';
  return 'medium';
}

function inferChatTag(text) {
  const raw = String(text || '').toLowerCase();
  if (/\b(interview|leetcode|dsa|coding|exam|study|revise)\b/.test(raw)) return 'learning';
  if (/\b(work|office|project|client)\b/.test(raw)) return 'work';
  if (/\b(health|workout|gym|walk|sleep|run)\b/.test(raw)) return 'health';
  if (/\b(personal|family|home|errand)\b/.test(raw)) return 'personal';
  return 'learning';
}

function cleanTaskNameFromCommand(text) {
  return String(text || '')
    .replace(/\b(today|tomorrow|high|medium|low|urgent|critical|asap)\b/ig, '')
    .replace(/\bfor\s+\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/ig, '')
    .replace(/^['"\s]+|['"\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findTaskByQuery(query, includeDone = false) {
  const target = normalizeSearchText(query);
  if (!target) return null;

  const pool = state.tasks.filter(t => includeDone || t.status !== 'done');
  const exact = pool.find(t => normalizeSearchText(t.name) === target);
  if (exact) return exact;

  const partial = pool.find(t => normalizeSearchText(t.name).includes(target));
  if (partial) return partial;

  const reverse = pool.find(t => target.includes(normalizeSearchText(t.name)));
  return reverse || null;
}

async function applyConversationPlannerAction(text) {
  const lower = String(text || '').toLowerCase();
  const tomorrow = getDateKeyOffset(1);

  const studyMatch = /(?:study|stludy|prep|prepare|revise)\s+(.+?)(?:\s+(?:today|tonight|tomorrow|for)|$)/i.exec(text);
  const examMatch = /(?:exam|test)/i.test(lower);
  const isTomorrow = /\btomorrow\b|\btomorrows\b|tomorrow's/i.test(lower);

  const freeStart = parseFreeStartTime(text);
  const range = parseTimeRange(text);
  const weekendMentioned = /weekend|saturday|sunday|holiday/.test(lower);
  const weekdayMentioned = /weekday|monday|tuesday|wednesday|thursday|friday/.test(lower);

  if (range && (weekendMentioned || weekdayMentioned)) {
    const bucket = weekendMentioned ? 'weekend' : 'weekday';
    state.availability[bucket] = { start: range.start, end: range.end };
    const rebuilt = await rebuildScheduleFromCurrentTasks();
    return {
      handled: true,
      message: `Updated ${bucket} window to ${fmtTime12(range.start)} - ${fmtTime12(range.end)}. ${rebuilt.summary}`,
    };
  }

  if (freeStart) {
    state.availability.weekday.start = freeStart;
    const rebuilt = await rebuildScheduleFromCurrentTasks();
    return {
      handled: true,
      message: `Updated weekday start to ${fmtTime12(freeStart)} and rebuilt timeline. ${rebuilt.summary}`,
    };
  }

  if (studyMatch && !isTomorrow && !examMatch) {
    const topic = studyMatch[1].replace(/\s+/g, ' ').trim();
    if (topic.length >= 2) {
      addChatTask(`Study ${topic}`, {
        tag: 'learning',
        duration: '1h',
        priority: 'high',
        note: 'deadline: today | Planned for evening session from chat.',
      });
      const rebuilt = await rebuildScheduleFromCurrentTasks();
      return {
        handled: true,
        message: `Added: Study ${topic}. ${rebuilt.summary}`,
      };
    }
  }

  if (isTomorrow && examMatch) {
    const topicMatch = /(?:math|maths|physics|chemistry|biology|coding|ml|ai|english|statistics|dsa)/i.exec(text);
    const topic = topicMatch ? topicMatch[0].toUpperCase() : 'EXAM';

    addChatTask(`Prepare for tomorrow ${topic} exam`, {
      tag: 'learning',
      duration: '2h',
      priority: 'high',
      note: 'deadline: tomorrow | Exam prep day set from chat. Focus on revision and practice.',
      createdDate: tomorrow,
    });

    const before = state.blocks.length;
    state.blocks = state.blocks.filter(b => !(b.source === 'agent' && b.date === tomorrow));
    const removed = before - state.blocks.length;
    const rebuilt = await rebuildScheduleFromCurrentTasks();

    return {
      handled: true,
      message: `Done. Tomorrow was rebalanced${removed ? ` (removed ${removed} timed slot(s))` : ''} with exam prep prioritized. ${rebuilt.summary}`,
    };
  }

  if (/\b(rebuild|refresh|replan|reschedule)\b/.test(lower) && /\b(schedule|timeline|plan)\b/.test(lower)) {
    const rebuilt = await rebuildScheduleFromCurrentTasks();
    return { handled: true, message: `Rebuilt schedule. ${rebuilt.summary}` };
  }

  const addMatch = /^(?:please\s+)?(?:add|create|schedule|plan|include)\s+(?:task\s+)?(.+)$/i.exec(text.trim());
  if (addMatch) {
    const rawName = cleanTaskNameFromCommand(addMatch[1]);
    if (rawName.length >= 2) {
      const dayOffset = /\btomorrow\b/i.test(text) ? 1 : 0;
      const createdDate = getDateKeyOffset(dayOffset);
      const task = addChatTask(rawName, {
        tag: inferChatTag(text),
        duration: inferChatDuration(text),
        priority: inferChatPriority(text),
        note: `Added from chat | deadline: ${dayOffset === 1 ? 'tomorrow' : 'today'}`,
        createdDate,
      });
      state.scheduleDayOffset = dayOffset;
      const rebuilt = await rebuildScheduleFromCurrentTasks();
      return {
        handled: true,
        message: `Added "${task.name}" for ${dayOffset === 1 ? 'tomorrow' : 'today'} and updated schedule. ${rebuilt.summary}`,
      };
    }
  }

  const completeMatch = /^(?:please\s+)?(?:mark|complete|finish|done)\s+(?:task\s+)?(.+)$/i.exec(text.trim());
  if (completeMatch) {
    const task = findTaskByQuery(completeMatch[1], true);
    if (!task) return { handled: true, message: `I could not find a task matching "${completeMatch[1].trim()}".` };
    if (task.status !== 'done') {
      task.status = 'done';
      task.completedDate = getDateKey();
      adjustCompletionForDate(task.completedDate, 1);
    }
    const rebuilt = await rebuildScheduleFromCurrentTasks();
    return { handled: true, message: `Marked "${task.name}" as done. ${rebuilt.summary}` };
  }

  const removeMatch = /^(?:please\s+)?(?:delete|remove|cancel|clear)\s+(?:task\s+)?(.+)$/i.exec(text.trim());
  if (removeMatch) {
    const task = findTaskByQuery(removeMatch[1], true);
    if (!task) return { handled: true, message: `I could not find a task matching "${removeMatch[1].trim()}".` };
    state.tasks = state.tasks.filter(t => t.id !== task.id);
    const rebuilt = await rebuildScheduleFromCurrentTasks();
    return { handled: true, message: `Removed "${task.name}" and rebuilt schedule. ${rebuilt.summary}` };
  }

  const moveMatch = /^(?:please\s+)?(?:move|reschedule|shift)\s+(.+?)\s+(?:to|for)\s+(today|tomorrow)$/i.exec(text.trim());
  if (moveMatch) {
    const task = findTaskByQuery(moveMatch[1], true);
    if (!task) return { handled: true, message: `I could not find a task matching "${moveMatch[1].trim()}".` };
    const targetOffset = moveMatch[2].toLowerCase() === 'tomorrow' ? 1 : 0;
    task.createdDate = getDateKeyOffset(targetOffset);
    if (task.status === 'done') {
      const previousDoneDate = task.completedDate || getDateKey();
      task.status = 'todo';
      task.completedDate = null;
      adjustCompletionForDate(previousDoneDate, -1);
    }
    state.scheduleDayOffset = targetOffset;
    const rebuilt = await rebuildScheduleFromCurrentTasks();
    return { handled: true, message: `Moved "${task.name}" to ${moveMatch[2].toLowerCase()} and refreshed schedule. ${rebuilt.summary}` };
  }

  const priorityMatch = /^(?:please\s+)?(?:make|set)\s+(.+?)\s+(?:to\s+)?(?:priority\s+)?(high|medium|low)\s*(?:priority)?$/i.exec(text.trim());
  if (priorityMatch) {
    const task = findTaskByQuery(priorityMatch[1], true);
    if (!task) return { handled: true, message: `I could not find a task matching "${priorityMatch[1].trim()}".` };
    task.priority = priorityMatch[2].toLowerCase();
    const rebuilt = await rebuildScheduleFromCurrentTasks();
    return { handled: true, message: `Updated "${task.name}" to ${task.priority} priority. ${rebuilt.summary}` };
  }

  return { handled: false, message: '' };
}

// Time-allotting feature removed: planner runs in task-only mode.

// ============================================================
//  AI "WHAT'S NEXT?" CHIP
// ============================================================
const AI_SUGGESTIONS = [
  task => `You have ${state.tasks.filter(t=>t.status==='todo').length} tasks left. Tackle "${task?.name || 'your top priority'}" next — it's marked ${task?.priority || 'high'}.`,
  ()   => `You've been in ${state.sessions} session${state.sessions!==1?'s':''} today. ${state.sessions < 2 ? 'One more focused block can make a big difference.' : 'Great discipline — keep the momentum.'}`,
  ()   => state.mood === 'Tired' ? 'You selected Tired. Try a 5-minute break before your next task.' : `Mood is ${state.mood}. Stay consistent — progress beats perfection.`,
  ()   => `${state.tasks.filter(t=>t.status==='done').length} of ${state.tasks.length} tasks done. ${state.tasks.filter(t=>t.status==='done').length === 0 ? 'Complete one task to build momentum.' : 'Nice work — keep chipping away.'}`,
];

const AGENT_API_BASE = 'http://localhost:8787';
const N8N_PROXY_URL = `${AGENT_API_BASE}/api/n8n-webhook`;
let memorySyncTimer = null;
let bootingPlanner = false;

async function sendCommandToN8n(message) {
  try {
    const response = await fetch(N8N_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        timestamp: new Date().toISOString(),
        pendingTasks: state.tasks.filter(t => t.status !== 'done').length,
        totalTasks: state.tasks.length,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ n8n response:', result);
    return result;
  } catch (err) {
    console.error('❌ n8n proxy error:', err.message);
    return { status: 'offline', message: 'n8n agent offline', action: null };
  }
}

function friendlyApiError(err) {
  const raw = String(err?.message || 'Unknown error');
  if (/failed to fetch|networkerror|unable to connect|load resource/i.test(raw)) {
    return 'Planner API is offline. Start it with: npm.cmd run api';
  }
  if (/abort|aborted|timeout/i.test(raw)) {
    return 'DeepSeek is taking too long. Please retry, or make sure Ollama is running.';
  }
  return raw;
}

async function updatePlannerApiStatus() {
  const status = $('plannerImportStatus');
  if (!status) return;

  try {
    const response = await fetch(`${AGENT_API_BASE}/api/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    status.textContent = 'Agent online. Upload a plan document or ask directly in chat.';
  } catch (_err) {
    status.textContent = 'Agent offline. Start backend with: npm.cmd run api';
  }
}

function parseTaskDurationMin(rawDuration) {
  const raw = String(rawDuration || '').trim().toLowerCase();
  if (!raw) return 45;
  if (raw.endsWith('h')) return (parseInt(raw, 10) || 1) * 60;
  if (raw.endsWith('m')) return parseInt(raw, 10) || 45;
  return parseInt(raw, 10) || 45;
}

async function syncPlannerMemory(reason = 'state-update') {
  const pending = state.tasks.filter(t => t.status !== 'done');
  const topPending = pending
    .slice()
    .sort((a, b) => {
      const p = { high: 3, medium: 2, low: 1 };
      return (p[b.priority] || 2) - (p[a.priority] || 2);
    })
    .slice(0, 8);

  const events = [
    {
      type: 'profile',
      mood: state.mood,
      content: `User mood=${state.mood}; streak=${state.streak}; level=${state.level}; sessions=${state.sessions}; reason=${reason}`,
    },
    {
      type: 'goals',
      content: `Goals: ${state.goals.map(g => `${g.name}=${g.pct}%`).join('; ')}`,
    },
    ...topPending.map(t => ({
      type: 'task',
      priority: t.priority,
      tag: t.tag,
      content: `Task: ${t.name}; priority=${t.priority}; duration=${parseTaskDurationMin(t.duration)}m; note=${t.note || 'none'}`,
    })),
  ];

  try {
    await fetch(`${AGENT_API_BASE}/api/memory/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events, source: 'planner-ui' }),
    });
  } catch (_err) {
    // Planner should still function even if memory sync endpoint is offline.
  }
}

function scheduleMemorySync(reason) {
  clearTimeout(memorySyncTimer);
  memorySyncTimer = setTimeout(() => {
    syncPlannerMemory(reason);
  }, 450);
}

function mapDuration(minutes) {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function mapTaskFromImport(importedTask) {
  return {
    id: state.nextId++,
    name: importedTask.name,
    tag: importedTask.tag || 'work',
    duration: mapDuration(importedTask.durationMin || 45),
    priority: importedTask.priority || 'medium',
    note: [importedTask.note || 'Imported by planning agent', importedTask.deadlineRaw ? `deadline: ${importedTask.deadlineRaw}` : '', importedTask.routineRaw ? `routine: ${importedTask.routineRaw}` : '']
      .filter(Boolean)
      .join(' | '),
    status: 'todo',
    carryOver: false,
    time: null,
    createdDate: getDateKey(),
    completedDate: null,
  };
}

function isImportedTask(task) {
  const note = String(task?.note || '');
  return /imported by agent|imported by planning agent|imported from workbook/i.test(note);
}

function purgeLegacyImportedTasks() {
  state.tasks = state.tasks.filter(t => !isImportedTask(t));
}

function appendPlannerChatLine(role, text, meta = '') {
  const log = $('plannerChatLog');
  if (!log) return;

  const row = document.createElement('div');
  row.className = `planner-chat-line ${role === 'user' ? 'user' : 'agent'}`;

  const bubble = document.createElement('div');
  bubble.className = 'planner-chat-bubble';
  bubble.textContent = text;
  row.appendChild(bubble);

  if (meta) {
    const tag = document.createElement('span');
    tag.className = 'planner-chat-meta';
    tag.textContent = meta;
    row.appendChild(tag);
  }

  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  return row;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json();
    return { response, payload };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runDocumentAgentPlan() {
  const fileInput = $('taskDocInput');
  const status = $('plannerImportStatus');
  const file = fileInput?.files?.[0];

  if (!file) {
    status.textContent = 'Pick a file first (PDF, DOCX, XLSX, TXT).';
    return;
  }

  status.textContent = 'Reading document and building schedule...';

  try {
    const formData = new FormData();
    formData.append('taskDocument', file);
    formData.append('weekdayStart', state.availability.weekday.start);
    formData.append('weekdayEnd', state.availability.weekday.end);
    formData.append('weekendStart', state.availability.weekend.start);
    formData.append('weekendEnd', state.availability.weekend.end);
    formData.append('horizonDays', '14');

    const response = await fetch(`${AGENT_API_BASE}/api/plan-from-file`, {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Planner API failed.');

    state.tasks = state.tasks.filter(t => !isImportedTask(t));
    const newTasks = (payload.tasks || []).map(mapTaskFromImport);
    state.tasks.push(...newTasks);

    state.blocks = state.blocks.filter(b => b.source !== 'agent');
    (payload.slots || []).forEach(slot => {
      state.blocks.push({ label: slot.label, start: slot.start, end: slot.end, source: 'agent', date: slot.date || null });
    });

    renderTasks();
    renderBlocks();
    save();
    scheduleMemorySync('document-import');

    const summary = payload.summary || 'Agent plan ready.';
    const firstQuestion = payload.checkinQuestions?.[0] || 'Can you follow this schedule?';
    $('aiResponse').textContent = `${summary} ${firstQuestion}`;
    $('aiResponse').classList.add('visible');

    const canFollow = window.confirm('Agent schedule is ready. Can you follow this plan today?');
    const checkinResponse = await fetch(`${AGENT_API_BASE}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adhered: canFollow,
        blocker: canFollow ? '' : 'Need lighter task order',
        pendingHigh: state.tasks.filter(t => t.priority === 'high' && t.status !== 'done').length,
      }),
    });

    if (checkinResponse.ok) {
      const checkin = await checkinResponse.json();
      $('aiResponse').textContent = `${summary} ${checkin.message} ${checkin.nextQuestion}`;
    }

    status.textContent = `Imported ${newTasks.length} tasks and built ${payload.slots?.length || 0} timeline blocks.${payload.mcpUsed ? ' MCP connected.' : ' Using local planner logic.'}`;
    appendPlannerChatLine('agent', summary, 'schedule');
    showFloatingMsg('Agent schedule ready.');
  } catch (err) {
    const message = friendlyApiError(err);
    status.textContent = `Import failed: ${message}`;
    appendPlannerChatLine('agent', `Import failed: ${message}`, 'error');
  }
}

$('autoScheduleBtn')?.addEventListener('click', runDocumentAgentPlan);
$('uploadDocBtn')?.addEventListener('click', () => {
  $('taskDocInput')?.click();
});
$('taskDocInput')?.addEventListener('change', () => {
  const file = $('taskDocInput')?.files?.[0];
  if (!file) return;
  $('plannerImportStatus').textContent = `Uploading ${file.name}...`;
  appendPlannerChatLine('user', `Please build my schedule from ${file.name}`);
  runDocumentAgentPlan();
});

function executeN8nAction(action, target, taskName) {
  try {
    if (action === 'clear_all_tasks') {
      const before = state.tasks.length;
      state.tasks = [];
      save();
      console.log('✅ Cleared tasks. state.tasks length now:', state.tasks.length);
      showFloatingMsg(`✅ Cleared ${before} task${before !== 1 ? 's' : ''}!`);
      return true;
    }

    if (action === 'reschedule_all') {
      const dayOffset = target === 'tomorrow' ? 1 : 0;
      const newDate = getDateKeyOffset(dayOffset);
      let count = 0;
      state.tasks.forEach(task => {
        if (task.status !== 'done') {
          task.createdDate = newDate;
          count++;
        }
      });
      save();
      const dayLabel = dayOffset === 0 ? 'today' : 'tomorrow';
      console.log('✅ Rescheduled tasks. count:', count);
      showFloatingMsg(`✅ Rescheduled ${count} task${count !== 1 ? 's' : ''} to ${dayLabel}!`);
      return true;
    }

    if (action === 'add_task' && taskName && taskName.length >= 2) {
      addChatTask(taskName, {
        tag: 'learning',
        duration: '1h',
        priority: 'medium',
        note: 'Added via n8n chat',
      });
      save();
      console.log('✅ Added task:', taskName);
      showFloatingMsg(`✅ Added: "${taskName}"`);
      return true;
    }

    return false;
  } catch (err) {
    console.error('Error executing n8n action:', err);
    return false;
  }
}

async function askPlannerAssistant() {
  const input = $('plannerChatInput');
  const sendBtn = $('plannerChatSendBtn');
  const text = input?.value?.trim();
  if (!text) return;

  appendPlannerChatLine('user', text);
  input.value = '';
  input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  try {
    // Try n8n agent first
    const n8nResult = await sendCommandToN8n(text);
    if (n8nResult && n8nResult.status === 'success' && n8nResult.action && n8nResult.action !== 'unknown') {
      // Execute the action on client side
      const executed = executeN8nAction(n8nResult.action, n8nResult.target, n8nResult.taskName);
      appendPlannerChatLine('agent', n8nResult.message || '✅ Done!', 'action');
      if (executed) {
        // Force re-render of all UI
        setTimeout(() => {
          renderTasks();
          renderBlocks();
          renderMonthSheet();
          save();
          scheduleMemorySync('chat-action-n8n');
        }, 100);
      }
      input.disabled = false;
      input.focus();
      if (sendBtn) sendBtn.disabled = false;
      return;
    }
  } catch (err) {
    console.error('n8n action error:', err);
  }

  try {
    const action = await applyConversationPlannerAction(text);
    if (action.handled) {
      renderTasks();
      renderBlocks();
      save();
      scheduleMemorySync('chat-action');
      appendPlannerChatLine('agent', action.message, 'action');
      input.disabled = false;
      input.focus();
      if (sendBtn) sendBtn.disabled = false;
      return;
    }
  } catch (err) {
    appendPlannerChatLine('agent', `Action error: ${friendlyApiError(err)}`, 'error');
  }

  const thinkingLine = appendPlannerChatLine('agent', 'Thinking...', 'deepseek');

  try {
    const { response, payload } = await fetchJsonWithTimeout(`${AGENT_API_BASE}/api/chat-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        dayStart: state.availability.weekday.start,
        dayEnd: state.availability.weekday.end,
        pendingTasks: state.tasks
          .filter(t => t.status !== 'done')
          .map(t => ({ name: t.name, priority: t.priority, tag: t.tag, durationMin: parseTaskDurationMin(t.duration) })),
      }),
    }, 120000);

    if (!response.ok) throw new Error(payload.error || 'Assistant unavailable.');

    thinkingLine?.remove();
    const source = payload.mode === 'ai' ? 'deepseek' : 'fallback';

    // Handle LLM action commands
    if (payload.action === 'delete_task' && payload.taskName) {
      const task = findTaskByQuery(payload.taskName, true);
      if (task) {
        state.tasks = state.tasks.filter(t => t.id !== task.id);
        await rebuildScheduleFromCurrentTasks();
        renderTasks();
        renderBlocks();
        save();
      }
    } else if (payload.action === 'add_task' && payload.taskName) {
      addChatTask(payload.taskName, {
        tag: inferChatTag(text),
        duration: inferChatDuration(text),
        priority: inferChatPriority(text),
        note: 'Added from chat',
      });
      await rebuildScheduleFromCurrentTasks();
      renderTasks();
      renderBlocks();
      save();
    } else if (payload.action === 'move_task' && payload.taskName && payload.target) {
      const task = findTaskByQuery(payload.taskName, true);
      if (task) {
        const targetOffset = /tomorrow/i.test(payload.target) ? 1 : 0;
        task.createdDate = getDateKeyOffset(targetOffset);
        if (task.status === 'done') {
          const previousDoneDate = task.completedDate || getDateKey();
          task.status = 'todo';
          task.completedDate = null;
          adjustCompletionForDate(previousDoneDate, -1);
        }
        state.scheduleDayOffset = targetOffset;
        await rebuildScheduleFromCurrentTasks();
        renderTasks();
        renderBlocks();
        save();
      }
    }

    appendPlannerChatLine('agent', payload.response, source);
    if (payload.followUp) appendPlannerChatLine('agent', payload.followUp);
  } catch (err) {
    thinkingLine?.remove();
    appendPlannerChatLine('agent', friendlyApiError(err), 'error');
  } finally {
    input.disabled = false;
    input.focus();
    if (sendBtn) sendBtn.disabled = false;
  }
}

$('plannerChatSendBtn')?.addEventListener('click', askPlannerAssistant);
$('plannerChatInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') askPlannerAssistant();
});

$('schedulePrevDayBtn')?.addEventListener('click', () => {
  state.scheduleDayOffset = Math.max(-3, (state.scheduleDayOffset || 0) - 1);
  renderBlocks();
  save();
});

$('scheduleTodayBtn')?.addEventListener('click', () => {
  state.scheduleDayOffset = 0;
  renderBlocks();
  save();
});

$('scheduleNextDayBtn')?.addEventListener('click', () => {
  state.scheduleDayOffset = Math.min(14, (state.scheduleDayOffset || 0) + 1);
  renderBlocks();
  save();
});

$('aiChip').addEventListener('click', () => {
  const pending = state.tasks.filter(t => t.status === 'todo');
  const top     = pending.find(t => t.priority === 'high') || pending[0];
  const fn      = AI_SUGGESTIONS[Math.floor(Math.random() * AI_SUGGESTIONS.length)];
  const msg     = fn(top);
  const resp    = $('aiResponse');
  resp.textContent = msg;
  resp.classList.add('visible');
  resp.style.animation = 'none';
  void resp.offsetWidth;
  resp.style.animation = '';
});

// ============================================================
//  FLOATING MESSAGE TOAST
// ============================================================
function showFloatingMsg(text) {
  const el = document.createElement('div');
  el.className = 'floating-toast';
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, 2200);
}

// Inject toast styles dynamically (keeps CSS file clean)
const toastStyle = document.createElement('style');
toastStyle.textContent = `
  .floating-toast {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%) translateY(12px);
    background: var(--bg-panel);
    border: 1px solid var(--border-mint);
    color: var(--mint);
    font-family: var(--font-body);
    font-size: .75rem;
    font-weight: 500;
    padding: 8px 20px;
    border-radius: var(--radius-pill);
    opacity: 0;
    transition: opacity .3s ease, transform .3s ease;
    z-index: 999;
    pointer-events: none;
    white-space: nowrap;
  }
  .floating-toast.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
`;
document.head.appendChild(toastStyle);

// ============================================================
//  STREAK
// ============================================================
function checkStreak() {
  const lastVisit = localStorage.getItem('fs_lastVisit');
  const today     = new Date().toDateString();
  if (lastVisit !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (lastVisit === yesterday) {
      state.streak++;
    } else if (lastVisit && lastVisit !== today) {
      state.streak = 1; // broke streak
    }
    localStorage.setItem('fs_lastVisit', today);
    save();
  }
  document.querySelector('.streak-count').textContent = state.streak;
}

// ============================================================
//  UTILS
// ============================================================
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ============================================================
//  INIT
// ============================================================
function init() {
  bootingPlanner = true;
  normalizeTaskDates();
  if (localStorage.getItem('fs_import_cleanup_v1') !== '1') {
    purgeLegacyImportedTasks();
    localStorage.setItem('fs_import_cleanup_v1', '1');
  }
  const cleanupDone = localStorage.getItem('fs_evening_cleanup_v1') === '1';
  if (!cleanupDone) {
    pruneDaytimeBlocks(timeToMin('20:15', 20 * 60 + 15));
    localStorage.setItem('fs_evening_cleanup_v1', '1');
  }
  syncDoneToday();
  initDate();
  renderTimer();
  renderTasks();
  renderMonthSheet();
  renderGoals();
  renderBlocks();
  renderXP();
  setMood(state.mood);
  checkStreak();
  updateSessionStats();
  appendPlannerChatLine('agent', 'Planner is ready. Weekdays are optimized for evening self-work, and weekends stay task-only unless you ask for fixed slots.', 'ready');
  bootingPlanner = false;
  updatePlannerApiStatus();
  scheduleMemorySync('init');
}

// ── Firestore Data Callback ────────────────────────────────
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

document.addEventListener('DOMContentLoaded', init);

// ── Keyboard shortcuts ────────────────────────────────────
document.addEventListener('keydown', e => {
  // Escape closes any open modal
  if (e.key === 'Escape') {
    ['modalOverlay','goalsModalOverlay'].forEach(id => closeModal(id));
  }
  // Space bar = start/pause timer (when not typing in an input)
  if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'SELECT') {
    e.preventDefault();
    state.timer.running ? pauseTimer() : startTimer();
  }
  // N = new task
  if (e.key === 'n' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    openModal('modalOverlay');
    setTimeout(() => $('taskNameInput').focus(), 80);
  }
});
