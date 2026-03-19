'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };
const MEMORY_DB_PATH = process.env.MEMORY_DB_PATH || path.join(__dirname, 'data', 'planner-memory.json');
const MAX_MEMORY_EVENTS = Number(process.env.MAX_MEMORY_EVENTS || 2000);

function ensureMemoryDbShape(data) {
  if (!data || typeof data !== 'object') return { events: [] };
  const events = Array.isArray(data.events) ? data.events : [];
  return { events };
}

function readMemoryDb() {
  try {
    if (!fs.existsSync(MEMORY_DB_PATH)) return { events: [] };
    const text = fs.readFileSync(MEMORY_DB_PATH, 'utf8');
    if (!text.trim()) return { events: [] };
    return ensureMemoryDbShape(JSON.parse(text));
  } catch {
    return { events: [] };
  }
}

function writeMemoryDb(data) {
  const safe = ensureMemoryDbShape(data);
  fs.mkdirSync(path.dirname(MEMORY_DB_PATH), { recursive: true });
  fs.writeFileSync(MEMORY_DB_PATH, JSON.stringify(safe, null, 2), 'utf8');
}

function compactText(input, maxLen = 220) {
  const singleLine = String(input || '').replace(/\s+/g, ' ').trim();
  return singleLine.length <= maxLen ? singleLine : `${singleLine.slice(0, maxLen - 3)}...`;
}

function normalizeTokens(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function scoreEvent(queryTokens, event) {
  const hay = [event.type, event.content, event.mood, event.tag, event.priority].filter(Boolean).join(' ');
  const tokens = new Set(normalizeTokens(hay));
  let overlap = 0;
  queryTokens.forEach(t => {
    if (tokens.has(t)) overlap++;
  });

  const time = Date.parse(event.createdAt || 0);
  const hoursOld = Number.isNaN(time) ? 9999 : Math.max(0, (Date.now() - time) / 3600000);
  const recencyBoost = Math.max(0, 4 - (hoursOld / 24));
  const typeBoost = event.type === 'profile' ? 0.8 : (event.type === 'task' ? 1.2 : 0.5);
  return overlap * 3 + recencyBoost + typeBoost;
}

function addMemoryEvents(events, source = 'unknown') {
  if (!Array.isArray(events) || events.length === 0) return 0;

  const db = readMemoryDb();
  const incoming = events
    .filter(e => e && typeof e === 'object')
    .map(e => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      source,
      type: compactText(e.type || 'note', 40),
      content: compactText(e.content || '', 600),
      mood: compactText(e.mood || '', 30),
      tag: compactText(e.tag || '', 30),
      priority: compactText(e.priority || '', 20),
      createdAt: new Date().toISOString(),
    }))
    .filter(e => e.content.length > 0);

  db.events.push(...incoming);
  if (db.events.length > MAX_MEMORY_EVENTS) {
    db.events = db.events.slice(db.events.length - MAX_MEMORY_EVENTS);
  }

  writeMemoryDb(db);
  return incoming.length;
}

function retrieveMemorySnippets({ message = '', pendingTasks = [], limit = 8 }) {
  const db = readMemoryDb();
  if (!db.events.length) return [];

  const taskText = pendingTasks
    .slice(0, 20)
    .map(t => `${t.name || ''} ${t.priority || ''} ${t.tag || ''}`)
    .join(' ');
  const queryTokens = normalizeTokens(`${message} ${taskText}`);

  const scored = db.events
    .map(event => ({ event, score: scoreEvent(queryTokens, event) }))
    .filter(x => x.score > 0.8)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => `[${x.event.type}] ${x.event.content}`);

  return scored;
}

function sanitizeAssistantReply(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return '';

  // DeepSeek-style reasoning blocks are useful internally but noisy in UI.
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (withoutThink) return withoutThink;

  return raw.length > 600 ? `${raw.slice(0, 600)}...` : raw;
}

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function parseMinutesFromTime(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return fallback;
  const h = Math.max(0, Math.min(23, parseInt(match[1], 10)));
  const m = Math.max(0, Math.min(59, parseInt(match[2] || '0', 10)));
  return (h * 60) + m;
}

function inferPriority(line) {
  const lower = line.toLowerCase();
  if (/\b(high|urgent|critical|asap|p1|!{2,})\b/.test(lower)) return 'high';
  if (/\b(low|someday|later|p3)\b/.test(lower)) return 'low';
  return 'medium';
}

function inferDurationMinutes(line) {
  const h = line.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?/i);
  if (h) return Math.max(15, Math.round(parseFloat(h[1]) * 60));

  const m = line.match(/(\d+)\s*m(?:in|ins|inutes?)?/i);
  if (m) return Math.max(15, parseInt(m[1], 10));

  return 45;
}

function parseDurationValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(15, Math.round(value));
  }

  const text = String(value || '').trim().toLowerCase();
  if (!text) return 45;

  const h = text.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/i);
  if (h) return Math.max(15, Math.round(parseFloat(h[1]) * 60));

  const m = text.match(/^(\d+)\s*m(?:in|ins|inutes?)?$/i);
  if (m) return Math.max(15, parseInt(m[1], 10));

  const n = parseInt(text, 10);
  if (Number.isFinite(n)) return Math.max(15, n);
  return 45;
}

function extractDeadlineFromNote(note) {
  const match = String(note || '').match(/deadline\s*:\s*([^|]+)/i);
  return match ? String(match[1]).trim() : '';
}

function normalizeRoutine(raw) {
  const val = String(raw || '').toLowerCase();
  if (val.includes('daily')) return 'daily';
  if (val.includes('weekend')) return 'weekends';
  if (val.includes('weekly')) return 'weekly';
  return 'single';
}

function parseDeadline(deadlineRaw, now = new Date()) {
  const text = String(deadlineRaw || '').toLowerCase().trim();
  if (!text) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return { dueDate: startOfDay(d), category: 'unspecified', urgencyBonus: 0 };
  }

  if (text.includes('today')) {
    return { dueDate: startOfDay(now), category: 'today', urgencyBonus: 3 };
  }

  if (text.includes('tomorrow')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { dueDate: startOfDay(d), category: 'tomorrow', urgencyBonus: 2 };
  }

  if (text.includes('this week')) {
    const d = new Date(now);
    const day = d.getDay();
    const add = day === 0 ? 0 : 7 - day;
    d.setDate(d.getDate() + add);
    return { dueDate: startOfDay(d), category: 'this-week', urgencyBonus: 2 };
  }

  if (text.includes('weekend')) {
    const d = new Date(now);
    const day = d.getDay();
    const add = day <= 6 ? (6 - day) : 0;
    d.setDate(d.getDate() + add);
    return { dueDate: startOfDay(d), category: 'weekend', urgencyBonus: 1 };
  }

  if (text.includes('daily')) {
    return { dueDate: startOfDay(now), category: 'daily', urgencyBonus: 2 };
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return { dueDate: startOfDay(parsed), category: 'date', urgencyBonus: 2 };
  }

  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 7);
  return { dueDate: startOfDay(fallback), category: 'unspecified', urgencyBonus: 0 };
}

function stripTaskLine(line) {
  return line
    .replace(/^[-*\d.)\s]+/, '')
    .replace(/\[(high|medium|low)\]/ig, '')
    .replace(/\b(high|medium|low|urgent|critical|asap)\b/ig, '')
    .replace(/\((\d+\s*(?:m|min|mins|minutes?|h|hours?))\)/ig, '')
    .trim();
}

function extractTasksFromText(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line.length > 2)
    .filter(line => !/^#/.test(line));

  const seen = new Set();
  const tasks = [];

  for (const line of lines) {
    const name = stripTaskLine(line);
    if (!name || name.length < 3) continue;

    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const priority = inferPriority(line);
    const durationMin = inferDurationMinutes(line);
    const routineRaw = /\b(daily|weekly|weekend|weekends)\b/i.exec(line)?.[1] || 'single';
    const deadlineRaw = /\b(today|tomorrow|this week|daily|weekends?)\b/i.exec(line)?.[1] || '';
    tasks.push({
      name,
      priority,
      durationMin,
      note: 'Imported by Agent',
      tag: 'work',
      routineRaw,
      deadlineRaw,
    });
  }

  return tasks.slice(0, 100);
}

function extractTasksFromWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const tasks = [];

  workbook.SheetNames.forEach(sheetName => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    if (!rows.length) return;

    const headerRow = rows[0].map(normalizeHeader);
    const taskCol = headerRow.findIndex(h => h === 'task' || h.includes('task'));
    const detailsCol = headerRow.findIndex(h => h === 'details' || h.includes('detail'));
    const deadlineCol = headerRow.findIndex(h => h.includes('deadline') || h.includes('due'));
    const routineCol = headerRow.findIndex(h => h.includes('routine') || h.includes('repeat'));

    rows.slice(1).forEach(r => {
      const taskName = String(taskCol >= 0 ? r[taskCol] : r[1] || r[0] || '').trim();
      if (!taskName) return;

      const details = String(detailsCol >= 0 ? r[detailsCol] : '').trim();
      const deadlineRaw = String(deadlineCol >= 0 ? r[deadlineCol] : '').trim();
      const routineRaw = String(routineCol >= 0 ? r[routineCol] : '').trim() || 'single';
      const sourceText = `${taskName} ${details} ${deadlineRaw} ${routineRaw}`;

      tasks.push({
        name: taskName,
        note: details || 'Imported from workbook',
        durationMin: inferDurationMinutes(details || sourceText),
        priority: inferPriority(sourceText),
        deadlineRaw,
        routineRaw,
        tag: /gym|run|yoga|health/i.test(sourceText)
          ? 'health'
          : (/project|code|interview|aptitude|rec/i.test(sourceText) ? 'learning' : 'work'),
      });
    });
  });

  return tasks;
}

async function parseFilePayload(file) {
  const original = (file.originalname || '').toLowerCase();

  if (original.endsWith('.txt') || original.endsWith('.md') || original.endsWith('.csv')) {
    const text = file.buffer.toString('utf8');
    return { text, tasks: extractTasksFromText(text) };
  }

  if (original.endsWith('.docx')) {
    const out = await mammoth.extractRawText({ buffer: file.buffer });
    const text = out.value || '';
    return { text, tasks: extractTasksFromText(text) };
  }

  if (original.endsWith('.pdf')) {
    const out = await pdfParse(file.buffer);
    const text = out.text || '';
    return { text, tasks: extractTasksFromText(text) };
  }

  if (original.endsWith('.xlsx') || original.endsWith('.xls')) {
    const tasks = extractTasksFromWorkbook(file.buffer);
    const text = tasks.map(t => `${t.name} ${t.note} ${t.deadlineRaw} ${t.routineRaw}`).join('\n');
    return { text, tasks };
  }

  throw new Error('Unsupported file type. Use TXT, MD, CSV, DOCX, PDF, or XLSX.');
}

function formatTimeMinutes(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nextHalfHour(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  const bump = m <= 30 ? 30 - m : 60 - m;
  d.setMinutes(m + bump);
  return d;
}

function scheduleTasks(tasks, options = {}) {
  const now = startOfDay(new Date());
  const horizonDays = Number(options.horizonDays || 14);
  const weekdayStartMin = parseMinutesFromTime(options.weekdayStart || options.dayStart, 20 * 60 + 15);
  const weekdayEndRaw = parseMinutesFromTime(options.weekdayEnd || options.dayEnd, 23 * 60);
  const weekdayEndMin = weekdayEndRaw > weekdayStartMin ? weekdayEndRaw : (weekdayStartMin + 180);
  const weekendStartMin = parseMinutesFromTime(options.weekendStart, 10 * 60);
  const weekendEndRaw = parseMinutesFromTime(options.weekendEnd, 14 * 60);
  const weekendEndMin = weekendEndRaw > weekendStartMin ? weekendEndRaw : (weekendStartMin + 180);
  const weekendTaskOnly = options.weekendTaskOnly === true;

  const days = [];
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push({
      date: d,
      key: dateKey(d),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      cursorMin: (d.getDay() === 0 || d.getDay() === 6) ? weekendStartMin : weekdayStartMin,
      endMin: (d.getDay() === 0 || d.getDay() === 6) ? weekendEndMin : weekdayEndMin,
    });
  }

  const workItems = [];
  tasks.forEach(task => {
    const deadlineInfo = parseDeadline(task.deadlineRaw, now);
    const routine = normalizeRoutine(task.routineRaw);

    if (routine === 'daily') {
      days.forEach(day => {
        workItems.push({
          task,
          dueDate: new Date(day.date),
          earliestDate: new Date(day.date),
          weekendOnly: false,
          urgencyBonus: 2,
        });
      });
      return;
    }

    if (routine === 'weekly' || routine === 'weekends') {
      const weeklyDays = days.filter(d => d.isWeekend);
      weeklyDays.forEach(day => {
        workItems.push({
          task,
          dueDate: new Date(day.date),
          earliestDate: new Date(day.date),
          weekendOnly: true,
          urgencyBonus: 1,
        });
      });
      return;
    }

    workItems.push({
      task,
      dueDate: deadlineInfo.dueDate,
      earliestDate: new Date(now),
      weekendOnly: deadlineInfo.category === 'weekend',
      urgencyBonus: deadlineInfo.urgencyBonus,
    });
  });

  const sortedItems = workItems.sort((a, b) => {
    const dueDelta = a.dueDate - b.dueDate;
    if (dueDelta !== 0) return dueDelta;

    const aScore = PRIORITY_WEIGHT[a.task.priority] + a.urgencyBonus;
    const bScore = PRIORITY_WEIGHT[b.task.priority] + b.urgencyBonus;
    if (aScore !== bScore) return bScore - aScore;

    return b.task.durationMin - a.task.durationMin;
  });

  const slots = [];
  const unscheduled = [];
  const taskOnly = [];

  for (const item of sortedItems) {
    const duration = Math.max(15, item.task.durationMin || 45);
    const candidates = days.filter(day => {
      if (day.date < startOfDay(item.earliestDate)) return false;
      if (day.date > startOfDay(item.dueDate)) return false;
      if (item.weekendOnly && !day.isWeekend) return false;
      return true;
    });

    let placed = false;
    const timedCandidates = weekendTaskOnly ? candidates.filter(day => !day.isWeekend) : candidates;

    if (weekendTaskOnly && timedCandidates.length === 0 && candidates.length > 0) {
      const date = candidates[0].key;
      taskOnly.push({
        label: item.task.name,
        date,
        priority: item.task.priority,
        note: 'Weekend/holiday: complete as checklist, not fixed time block.',
      });
      placed = true;
      continue;
    }

    for (const day of timedCandidates) {
      if ((day.cursorMin + duration) > day.endMin) continue;

      const startMin = day.cursorMin;
      const endMin = day.cursorMin + duration;
      day.cursorMin = endMin;

      slots.push({
        label: item.task.name,
        start: formatTimeMinutes(startMin),
        end: formatTimeMinutes(endMin),
        priority: item.task.priority,
        durationMin: duration,
        date: day.key,
        deadlineRaw: item.task.deadlineRaw || '',
        routineRaw: item.task.routineRaw || 'single',
      });
      placed = true;
      break;
    }

    if (!placed) {
      unscheduled.push(item.task.name);
    }
  }

  const uniqueSortedTasks = [...tasks].sort((a, b) => {
    const da = parseDeadline(a.deadlineRaw, now).dueDate;
    const db = parseDeadline(b.deadlineRaw, now).dueDate;
    const dueDelta = da - db;
    if (dueDelta !== 0) return dueDelta;
    return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  });

  return { sortedTasks: uniqueSortedTasks, slots, unscheduled, taskOnly };
}

async function enrichWithMCP(basePlan) {
  const mcpPlannerUrl = process.env.MCP_PLANNER_URL;
  if (!mcpPlannerUrl) {
    return { ...basePlan, mcpUsed: false };
  }

  try {
    const response = await fetch(mcpPlannerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePlan),
    });

    if (!response.ok) return { ...basePlan, mcpUsed: false };

    const external = await response.json();
    return {
      ...basePlan,
      tasks: external.tasks || basePlan.tasks,
      slots: external.slots || basePlan.slots,
      checkinQuestions: external.checkinQuestions || basePlan.checkinQuestions,
      mcpUsed: true,
    };
  } catch {
    return { ...basePlan, mcpUsed: false };
  }
}

async function askPlannerLLM({ message, dayStart, dayEnd, pendingTasks, memorySnippets = [] }) {
  const provider = (process.env.AI_PROVIDER || (process.env.AI_API_KEY ? 'openai' : 'ollama')).toLowerCase();
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const openAiModel = process.env.AI_MODEL || 'gpt-4o-mini';
  const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const ollamaModel = process.env.OLLAMA_MODEL || 'deepseek-r1:8b';
  const maxTokens = Number(process.env.OLLAMA_MAX_TOKENS || 220);
  const ollamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 8000);

  if (provider === 'openai' && !apiKey) return null;

  const taskSummary = pendingTasks
    .slice(0, 12)
    .map((t, i) => `${i + 1}. ${t.name || 'Task'} | priority=${t.priority || 'medium'} | duration=${t.durationMin || 45}m`)
    .join('\n');

  const systemPrompt = [
    'You are FlowState planner assistant.',
    'Be practical, concise, and logical.',
    'Optimize by deadline urgency, then priority, then routine consistency.',
    'Respect available timeline and suggest realistic adjustments.',
    'Do not create full-day plans by default.',
    'Treat weekends/holidays as task-only checklist unless user asks for strict time blocks.',
    'Use memory context only if relevant, and never invent remembered facts.',
    'IMPORTANT: Detect and respond to ACTION COMMANDS:',
    '- If user wants to DELETE/REMOVE/CLEAR/WIPE/CANCEL a task, respond with: [ACTION:DELETE:TASKNAME] where TASKNAME is extracted from user message',
    '- If user wants to ADD/CREATE/SCHEDULE a new task, respond with: [ACTION:ADD:TASKNAME]',
    '- If user wants to MOVE a task, respond with: [ACTION:MOVE:TASKNAME:TARGET]',
    'For regular questions, respond in plain text with 2 sections: "Answer:" and "Next Step:".'
  ].join(' ');

  const memoryContext = memorySnippets.length
    ? `Memory context (retrieved):\n${memorySnippets.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
    : 'Memory context (retrieved): none';

  const userPrompt = [
    `Available window: ${dayStart} to ${dayEnd}`,
    `Pending tasks:\n${taskSummary || 'None'}`,
    memoryContext,
    `User question: ${message}`
  ].join('\n\n');

  if (provider === 'ollama') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ollamaTimeoutMs);

    const response = await fetch(`${ollamaBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: maxTokens,
          top_k: 30,
          top_p: 0.9,
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const payload = await response.json();
    const text = sanitizeAssistantReply(payload?.message?.content);
    return text || null;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: openAiModel,
      temperature: 0.35,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`);
  }

  const payload = await response.json();
  const text = sanitizeAssistantReply(payload?.choices?.[0]?.message?.content);
  return text || null;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'flowstate-agent-api' });
});

// Friendly root route so opening API URL in browser does not show "Cannot GET /".
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'flowstate-agent-api',
    hint: 'Use /api/health, /api/chat-assistant, /api/plan-from-file, /api/rebuild-schedule'
  });
});

// Silence common browser probe requests that otherwise show noisy 404 errors.
app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => res.status(204).end());

app.get('/api/memory/stats', (_req, res) => {
  const db = readMemoryDb();
  res.json({ ok: true, totalEvents: db.events.length });
});

app.post('/api/memory/events', (req, res) => {
  const { events = [], source = 'web' } = req.body || {};
  const added = addMemoryEvents(events, source);
  res.json({ ok: true, added });
});

app.post('/api/plan-from-file', upload.single('taskDocument'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const parsed = await parseFilePayload(req.file);
    const extracted = parsed.tasks;

    if (!extracted.length) {
      return res.status(422).json({ error: 'Could not detect tasks in this file. Try one task per line.' });
    }

    const { sortedTasks, slots, unscheduled, taskOnly } = scheduleTasks(extracted, {
      weekdayStart: req.body.weekdayStart || req.body.dayStart || '20:15',
      weekdayEnd: req.body.weekdayEnd || req.body.dayEnd || '23:00',
      weekendStart: req.body.weekendStart || '10:00',
      weekendEnd: req.body.weekendEnd || '14:00',
      horizonDays: Number(req.body.horizonDays || 14),
      weekendTaskOnly: false,
    });

    const plan = {
      tasks: sortedTasks,
      slots,
      unscheduled,
      taskOnly,
      checkinQuestions: [
        'Can you follow this schedule as planned?',
        'Do your available hours look realistic for this load?',
        'Should I rebalance if a deadline moved or you missed a block?'
      ],
      summary: `Scheduled ${slots.length} blocks from ${extracted.length} imported tasks using weekday/weekend windows.${taskOnly.length ? ` ${taskOnly.length} weekend/holiday tasks are checklist-only.` : ''}${unscheduled.length ? ` ${unscheduled.length} tasks need more available time.` : ''}`,
    };

    const finalPlan = await enrichWithMCP(plan);
    res.json(finalPlan);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Planning failed.' });
  }
});

app.post('/api/rebuild-schedule', (req, res) => {
  try {
    const {
      tasks = [],
      weekdayStart = '20:15',
      weekdayEnd = '23:00',
      weekendStart = '10:00',
      weekendEnd = '14:00',
      horizonDays = 7,
      weekendTaskOnly = false,
    } = req.body || {};

    const normalized = (Array.isArray(tasks) ? tasks : [])
      .filter(t => t && typeof t === 'object')
      .map(t => ({
        name: compactText(t.name || 'Task', 120),
        priority: ['high', 'medium', 'low'].includes(String(t.priority || '').toLowerCase())
          ? String(t.priority).toLowerCase()
          : 'medium',
        durationMin: parseDurationValue(t.durationMin ?? t.duration),
        note: compactText(t.note || '', 220),
        tag: compactText(t.tag || 'work', 24),
        deadlineRaw: compactText(t.deadlineRaw || extractDeadlineFromNote(t.note), 40),
        routineRaw: compactText(t.routineRaw || 'single', 20),
      }))
      .filter(t => t.name.length > 0);

    const { sortedTasks, slots, unscheduled, taskOnly } = scheduleTasks(normalized, {
      weekdayStart,
      weekdayEnd,
      weekendStart,
      weekendEnd,
      horizonDays: Number(horizonDays || 7),
      weekendTaskOnly: weekendTaskOnly === true,
    });

    return res.json({
      ok: true,
      tasks: sortedTasks,
      slots,
      unscheduled,
      taskOnly,
      summary: `Rebuilt ${slots.length} timed slots and ${taskOnly.length} task-only weekend items.`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Rebuild failed.' });
  }
});

app.post('/api/checkin', (req, res) => {
  const { adhered = true, blocker = '', pendingHigh = 0 } = req.body || {};

  if (adhered) {
    return res.json({
      message: 'Great consistency. Keep momentum with one more high-impact block.',
      nextQuestion: 'Do you want me to advance tomorrow\'s top priority into today?',
    });
  }

  const hint = blocker
    ? `Noted blocker: ${blocker}.`
    : 'No blocker provided.';

  res.json({
    message: `${hint} I recommend reducing slot length by 20% and starting with one quick win task.`,
    nextQuestion: pendingHigh > 0
      ? 'Should I auto-reorder unfinished high-priority tasks to your next open slot?'
      : 'Should I rebuild the schedule with lighter tasks first?'
  });
});

app.post('/api/chat-assistant', async (req, res) => {
  const { message = '', dayStart = '20:15', dayEnd = '23:00', pendingTasks = [] } = req.body || {};
  const lower = String(message).toLowerCase();
  const startMin = parseMinutesFromTime(dayStart, 20 * 60 + 15);
  const endMin = parseMinutesFromTime(dayEnd, 23 * 60);
  const availableHours = Math.max(0, (endMin - startMin) / 60);

  const pendingHigh = pendingTasks.filter(t => t.priority === 'high').length;
  const pendingCount = pendingTasks.length;
  const memorySnippets = retrieveMemorySnippets({ message, pendingTasks, limit: 8 });

  addMemoryEvents([
    {
      type: 'chat-question',
      content: `Q: ${compactText(message, 280)}`,
    }
  ], 'chat');

  const llmTimeoutMs = Number(process.env.LLM_TIMEOUT_MS || 10000);
  try {
    const llmReply = await Promise.race([
      askPlannerLLM({ message, dayStart, dayEnd, pendingTasks, memorySnippets }),
      new Promise(resolve => setTimeout(() => resolve(null), llmTimeoutMs))
    ]);
    if (llmReply) {
      // Check for action commands in LLM response
      const deleteMatch = /\[ACTION:DELETE:(.+?)\]/i.exec(llmReply);
      if (deleteMatch) {
        const taskName = deleteMatch[1].trim();
        return res.json({
          response: `Removing "${taskName}" from your schedule...`,
          action: 'delete_task',
          taskName: taskName,
          mode: 'ai',
        });
      }

      const addMatch = /\[ACTION:ADD:(.+?)\]/i.exec(llmReply);
      if (addMatch) {
        const taskName = addMatch[1].trim();
        return res.json({
          response: `Adding "${taskName}" to your schedule...`,
          action: 'add_task',
          taskName: taskName,
          mode: 'ai',
        });
      }

      const moveMatch = /\[ACTION:MOVE:(.+?):(.+?)\]/i.exec(llmReply);
      if (moveMatch) {
        const taskName = moveMatch[1].trim();
        const target = moveMatch[2].trim();
        return res.json({
          response: `Moving "${taskName}" to ${target}...`,
          action: 'move_task',
          taskName: taskName,
          target: target,
          mode: 'ai',
        });
      }

      addMemoryEvents([
        {
          type: 'chat-answer',
          content: `A: ${compactText(llmReply, 460)}`,
        }
      ], 'chat');

      return res.json({
        response: llmReply,
        followUp: 'If needed, tell me your exact available hours and I will re-balance automatically.',
        mode: 'ai',
      });
    }
  } catch (_err) {
    // Continue to deterministic fallback if model is unavailable.
  }

  if (/can't|cannot|missed|overwhelm|not follow|reschedule/.test(lower)) {
    return res.json({
      response: `Understood. I will compress tomorrow to ${Math.max(4, availableHours - 1)} focused hours and move low-priority tasks after urgent deadlines.`,
      followUp: 'Do you want strict deadline mode or balanced mode?',
      mode: 'fallback',
    });
  }

  if (/enough time|can i finish|possible|feasible/.test(lower)) {
    const roughCapacity = availableHours * 60;
    const demand = pendingTasks.reduce((acc, t) => acc + (t.durationMin || 45), 0);
    return res.json({
      response: demand <= roughCapacity
        ? `Yes, feasible today. Estimated demand ${demand} min within ${roughCapacity} min capacity.`
        : `Tight timeline. Demand ${demand} min exceeds ${roughCapacity} min. I recommend splitting tasks and deferring non-urgent work.`,
      followUp: 'Should I auto-split tasks longer than 60 minutes?',
      mode: 'fallback',
    });
  }

  res.json({
    response: `You have ${pendingCount} pending tasks (${pendingHigh} high priority). Based on your ${availableHours}h window, I can keep deadlines first and rebalance routine tasks.`,
    followUp: 'Share your available hours for tomorrow and I will rebuild the schedule.',
    mode: 'fallback',
  });
});

app.post('/api/n8n-action', (req, res) => {
  const { action, target, message } = req.body || {};

  try {
    // Server just validates and acknowledges the action
    // Client (app.js) will actually execute the changes
    
    if (action === 'clear_all_tasks') {
      return res.json({
        status: 'success',
        message: '✅ Clearing all tasks...',
        action: 'clear_all_tasks',
      });
    }

    if (action === 'reschedule_all') {
      const dayLabel = target === 'tomorrow' ? 'tomorrow' : 'today';
      return res.json({
        status: 'success',
        message: `✅ Rescheduling all tasks to ${dayLabel}...`,
        action: 'reschedule_all',
        target: target,
      });
    }

    if (action === 'add_task') {
      const taskName = String(message || '')
        .replace(/^(?:add|create|schedule)\s+/i, '')
        .replace(/(?:for|in)\s+\d+(?:[:.][0-9]+)?\s*(?:h|m|hours?|mins?)/gi, '')
        .trim();

      if (taskName.length >= 2) {
        return res.json({
          status: 'success',
          message: `✅ Adding task: "${taskName}"`,
          action: 'add_task',
          taskName: taskName,
        });
      }
    }

    return res.json({
      status: 'unknown',
      message: '❓ Could not parse command.',
      action: 'unknown',
    });

  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: `❌ Error: ${err.message}`,
    });
  }
});

// Proxy endpoint to forward messages to n8n production webhook (always listening)
app.post('/api/n8n-webhook', async (req, res) => {
  try {
    const { message, timestamp, pendingTasks, totalTasks } = req.body || {};
    
    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }

    console.log(`[n8n-proxy] Forwarding to n8n: "${message}"`);

    // Forward to n8n PRODUCTION webhook (always listening, no manual activation needed)
    const n8nProductionWebhookUrl = 'http://localhost:5678/webhook/d51b7f50-e420-4c83-b9c1-a5317489788a';
    
    const response = await fetch(n8nProductionWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        timestamp,
        pendingTasks,
        totalTasks,
      }),
      timeout: 15000,
    });

    if (!response.ok) {
      throw new Error(`n8n webhook responded with ${response.status}`);
    }

    const result = await response.json();
    console.log(`[n8n-proxy] n8n response:`, result);
    return res.json(result);
  } catch (err) {
    console.error('❌ n8n proxy error:', err.message);
    return res.status(500).json({
      status: 'offline',
      message: 'n8n agent error: ' + err.message,
      action: null,
      error: err.message,
    });
  }
});

const port = Number(process.env.API_PORT || 8787);
app.listen(port, () => {
  console.log(`FlowState Agent API listening on http://localhost:${port}`);
});
