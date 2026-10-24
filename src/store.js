// Progress lives in this browser only (localStorage). Every access is guarded so the
// app still works in private windows or when storage is blocked.
const KEY = 'dbjourney:v1';

const empty = () => ({ read: {}, ran: {}, ex: {}, quiz: {}, lc: {}, notes: {}, drafts: {}, activity: {}, playground: '', history: [] });
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }, 150);
}

export const get = () => state;

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function touch() {
  const k = todayKey();
  state.activity[k] = (state.activity[k] || 0) + 1;
}

export function solveExercise(id, { help = false } = {}) {
  const prev = state.ex[id];
  // Keep an earlier solve unless this one upgrades "solved with help" to "solved alone".
  if (prev?.solved && (!prev.help || help)) return;
  state.ex[id] = { ...prev, solved: true, help, at: todayKey() };
  touch();
  save();
}

export function markPeeked(id) {
  state.ex[id] = { ...(state.ex[id] || {}), peeked: true };
  save();
}

export function answerQuiz(id, choice, correct) {
  state.quiz[id] = { choice, correct };
  if (correct) touch();
  save();
}

export function clearQuiz(id) {
  delete state.quiz[id];
  save();
}

export function setLeetcode(key, done) {
  if (done) { state.lc[key] = todayKey(); touch(); } else delete state.lc[key];
  save();
}

export function setNote(day, text) {
  const had = (state.notes[day] || '').trim().length >= 15;
  state.notes[day] = text;
  if (!had && text.trim().length >= 15) touch();
  save();
}

export function setRead(day, read) {
  if (read) { state.read[day] = todayKey(); touch(); } else delete state.read[day];
  save();
}

export function markRan(day) {
  if (state.ran[day]) return;
  state.ran[day] = todayKey();
  save();
}

export function setDraft(id, sql) {
  state.drafts[id] = sql;
  save();
}

export function setPlayground(sql) {
  state.playground = sql;
  save();
}

export function pushHistory(sql) {
  const s = sql.trim();
  if (!s) return;
  state.history = [s, ...state.history.filter((h) => h !== s)].slice(0, 20);
  save();
}

export function resetDay(day) {
  const prefix = `d${day.day}-`;
  for (const bucket of [state.ex, state.quiz, state.drafts])
    for (const k of Object.keys(bucket)) if (k.startsWith(prefix)) delete bucket[k];
  for (const lc of day.leetcode || []) delete state.lc[`${day.day}:${lc.id}`];
  delete state.notes[day.day];
  delete state.read[day.day];
  delete state.ran[day.day];
  save();
}

export function streak() {
  let n = 0;
  const d = new Date();
  if (!state.activity[todayKey(d)]) d.setDate(d.getDate() - 1);
  while (state.activity[todayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
