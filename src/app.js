import { PGlite } from 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/index.js';
import { DAYS, PHASES, WEEKS, START_DATE } from '../content/index.js';
import { resetDb, runSql, gradeExercise } from './engine.js';
import * as store from './store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad2 = (n) => String(n).padStart(2, '0');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const ICON = {
  left: '<svg class="icon" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg class="icon" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  cal: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  ext: '<svg class="icon" viewBox="0 0 24 24"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  eye: '<svg class="icon" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  circle: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
  done: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  play: '<svg class="icon" viewBox="0 0 24 24"><path d="m7 4 13 8-13 8V4Z"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  bulb: '<svg class="icon" viewBox="0 0 24 24"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2Z"/></svg>',
  reset: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
};

/* ---------------------------------------------------------------- dates */

const [sy, sm, sd] = START_DATE.split('-').map(Number);
const START = new Date(sy, sm - 1, sd);
const dayDate = (n) => new Date(sy, sm - 1, sd + n - 1);
const fmt = (d, opts) => d.toLocaleDateString('en-GB', opts);
const weekOf = (n) => Math.ceil(n / 7);
function calendarDay() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - START) / 86400000) + 1; // <1 before the start, >40 after the end
}
const clampDay = (n) => Math.min(Math.max(n, 1), DAYS.length);

/* ---------------------------------------------------------------- database */

let db = null;
let loaded = { setup: null, dirty: true };
let queue = Promise.resolve();
const status = $('#dbStatus');

// Serialize all DB work so double clicks never interleave BEGIN/ROLLBACK.
function withDb(fn) {
  const p = queue.then(async () => {
    await dbReady;
    return fn(db);
  });
  queue = p.catch(() => {});
  return p;
}

const dbReady = (async () => {
  try {
    db = new PGlite();
    await db.waitReady;
    await resetDb(db);
    loaded = { setup: '', dirty: false };
    status.className = 'dbstatus glass ready';
  } catch (e) {
    status.className = 'dbstatus glass error';
    $('.txt', status).textContent = `Could not start Postgres: ${e.message}`;
    throw e;
  }
})();

async function ensureDb(setup = '') {
  if (!loaded.dirty && loaded.setup === setup) return;
  status.className = 'dbstatus glass';
  $('.txt', status).textContent = setup ? 'Preparing today’s tables…' : 'Resetting the practice database…';
  try {
    await resetDb(db, setup);
    loaded = { setup, dirty: false };
  } finally {
    status.className = 'dbstatus glass ready';
  }
}

function toast(title, sub) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span style="font-size:23px">🎉</span><span><strong>${esc(title)}</strong><small>${esc(sub)}</small></span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ---------------------------------------------------------------- progress */

// Every day has the same four steps; "tasks" are the individual items inside them.
function dayProgress(day) {
  if (day.placeholder) return { done: 0, total: 0, pct: 0, steps: [false, false, false, false] };
  const s = store.get();
  const exDone = day.exercises.filter((ex) => (ex.type === 'quiz' ? s.quiz[ex.id]?.correct : s.ex[ex.id]?.solved)).length;
  const lcDone = day.leetcode.filter((lc) => s.lc[`${day.day}:${lc.id}`]).length;
  const noted = (s.notes[day.day] || '').trim().length >= 15;
  const read = !!s.read[day.day];
  const done = exDone + lcDone + (noted ? 1 : 0) + (read ? 1 : 0);
  const total = day.exercises.length + day.leetcode.length + 2;
  return {
    done, total, exDone,
    pct: Math.round((done / total) * 100),
    steps: [read, !!s.ran[day.day], exDone === day.exercises.length, noted && lcDone === day.leetcode.length],
  };
}

function totals(days) {
  let done = 0, total = 0;
  for (const d of days) { const p = dayProgress(d); done += p.done; total += p.total; }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

const weekDays = (w) => DAYS.slice((w - 1) * 7, w * 7);
const isComplete = (d) => !d.placeholder && dayProgress(d).pct === 100;

/* ---------------------------------------------------------------- sidebar */

function renderSidebar(activeWeek) {
  const completed = DAYS.filter(isComplete).length;
  $('#journeyCard').innerHTML = `
    <p class="eyebrow">Your roadmap</p>
    <strong>${fmt(START, { day: 'numeric', month: 'short' })} — ${fmt(dayDate(DAYS.length), { day: 'numeric', month: 'short' })}</strong>
    <div class="overall-progress"><i style="width:${(completed / DAYS.length) * 100}%"></i></div>
    <small>${completed} of ${DAYS.length} sessions completed</small>`;
  $('#weekList').innerHTML = WEEKS.map((w) => {
    const days = weekDays(w.n);
    const done = days.filter(isComplete).length;
    const first = days[0].day, last = days[days.length - 1].day;
    return `<a class="week-button glass ${w.n === activeWeek ? 'active' : ''} ${done === days.length ? 'done' : ''}" href="#/day/${first}">
      <span class="week-index">W${pad2(w.n)}</span>
      <span class="week-copy"><strong>${esc(w.title)}</strong>
        <small>${fmt(dayDate(first), { day: 'numeric', month: 'short' })}–${fmt(dayDate(last), { day: 'numeric', month: 'short' })} · ${done}/${days.length} days</small></span>
      <span class="week-chevron">${ICON.right}</span>
    </a>`;
  }).join('');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', location.hash.startsWith('#/' + a.dataset.nav)));
}

/* ---------------------------------------------------------------- editors & results */

function makeEditor(el, value, { onRun, onChange } = {}) {
  const cm = CodeMirror(el, {
    value,
    mode: 'text/x-pgsql',
    lineNumbers: true,
    matchBrackets: true,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true,
    viewportMargin: Infinity,
    extraKeys: {
      'Ctrl-Enter': () => onRun?.(),
      'Cmd-Enter': () => onRun?.(),
      Tab: (c) => c.replaceSelection('  '),
    },
  });
  if (onChange) cm.on('change', () => onChange(cm.getValue()));
  return cm;
}

function displayValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const s = v.toISOString();
    return s.endsWith('T00:00:00.000Z') ? s.slice(0, 10) : s.replace('T', ' ').replace('.000Z', 'Z');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function renderResult(el, out, { maxRows = 500 } = {}) {
  if (out.error) {
    el.innerHTML = `<div class="msg error">${esc(out.error)}</div>`;
    return;
  }
  const r = out.result;
  if (!r || !r.fields?.length) {
    const affected = out.results.reduce((a, x) => a + (x.affectedRows || 0), 0);
    el.innerHTML = `<div class="msg info">Query ran OK${affected ? ` · ${plural(affected, 'row')} affected` : ''} · ${out.ms} ms</div>`;
    return;
  }
  const meta = `<div class="meta">${plural(r.rows.length, 'row')} · ${out.ms} ms${r.rows.length > maxRows ? ` · showing first ${maxRows}` : ''}</div>`;
  if (r.fields.length === 1 && r.fields[0].name === 'QUERY PLAN') {
    el.innerHTML = meta + `<div class="scroll"><pre class="plan">${esc(r.rows.map((x) => x[0]).join('\n'))}</pre></div>`;
    return;
  }
  const head = r.fields.map((f) => `<th>${esc(f.name)}</th>`).join('');
  const body = r.rows.slice(0, maxRows).map((row) => '<tr>' + row.map((v) => {
    const d = displayValue(v);
    if (d === null) return '<td class="null">NULL</td>';
    return `<td${typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(d) ? ' class="num"' : ''}>${esc(d)}</td>`;
  }).join('') + '</tr>').join('');
  el.innerHTML = meta + `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td class="null" colspan="${r.fields.length}">(no rows)</td></tr>`}</tbody></table></div>`;
}

/* ---------------------------------------------------------------- router */

function route() {
  const [page, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (page === 'playground') renderPlayground();
  else renderDay(page === 'day' ? clampDay(Number(arg) || 1) : clampDay(calendarDay()));
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ---------------------------------------------------------------- day page */

function topbar(n) {
  const cal = calendarDay();
  const phase = PHASES.find((p) => p.id === DAYS[n - 1].phase);
  return `<header class="topbar">
    <div>
      <p class="topbar-text">A focused ~35 minute SQL session</p>
      <h1>Day ${n} of ${DAYS.length}</h1>
      <small>${fmt(dayDate(n), { weekday: 'long', day: 'numeric', month: 'long' })} · Week ${weekOf(n)} of ${WEEKS.length}${phase ? ` · ${esc(phase.title)}` : ''}${cal < 1 && n === 1 ? ` · starts in ${plural(1 - cal, 'day')}` : ''}</small>
    </div>
    <div class="day-controls">
      <a class="icon-button" href="#/day/${Math.max(n - 1, 1)}" aria-label="Previous day">${ICON.left}</a>
      <a class="today-button" href="#/day/${clampDay(cal)}">${ICON.cal}Today</a>
      <a class="icon-button" href="#/day/${Math.min(n + 1, DAYS.length)}" aria-label="Next day">${ICON.right}</a>
    </div>
  </header>`;
}

function dayPicker(n) {
  const cal = calendarDay();
  const w = weekOf(n);
  const chips = [];
  for (let i = 0; i < 7; i++) {
    const d = DAYS[(w - 1) * 7 + i];
    if (!d) { chips.push('<span class="date-chip glass empty"></span>'); continue; }
    const date = dayDate(d.day);
    const cls = ['date-chip', 'glass', d.day === n ? 'active' : '', isComplete(d) ? 'complete' : '', d.day === cal ? 'today' : ''].join(' ');
    chips.push(`<a class="${cls}" href="#/day/${d.day}">
      <span>${fmt(date, { weekday: 'short' })}</span><b>${fmt(date, { day: 'numeric', month: 'short' })}</b>
      <small>${isComplete(d) ? 'Done ✓' : d.day === cal ? 'Today' : `Day ${d.day}`}</small></a>`);
  }
  return `<nav class="day-picker" aria-label="Days this week">${chips.join('')}</nav>`;
}

function dashboard(n) {
  const all = totals(DAYS.filter((d) => !d.placeholder));
  const wk = totals(weekDays(weekOf(n)).filter((d) => !d.placeholder));
  const s = store.get();
  const streak = store.streak();
  const lcTotal = DAYS.reduce((a, d) => a + (d.leetcode?.length || 0), 0);
  return `<section class="dashboard">
    <div class="stat-card glass"><p class="stat-label">Total progress</p><p class="stat-value">${all.pct}%</p>
      <div class="progress-bar"><i style="width:${all.pct}%"></i></div><span class="stat-detail">${all.done} of ${all.total} tasks</span></div>
    <div class="stat-card glass"><p class="stat-label">This week</p><p class="stat-value">${wk.pct}%</p>
      <div class="progress-bar"><i style="width:${wk.pct}%"></i></div><span class="stat-detail">${wk.done} of ${wk.total} tasks</span></div>
    <div class="stat-card glass"><p class="stat-label">Streak days</p><p class="stat-value">${streak}</p>
      <span class="stat-detail">${streak ? 'Keep going! 🔥' : 'Solve one exercise to start 🔥'}</span></div>
    <div class="stat-card glass"><p class="stat-label">Interview prep</p><p class="stat-value">${Object.keys(s.lc).length}</p>
      <span class="stat-detail">of ${lcTotal} LeetCode SQL problems solved</span></div>
  </section>`;
}

const STEPS = [
  { id: 'learn', name: 'Learn it', min: '5 min' },
  { id: 'see', name: 'See it', min: '5 min' },
  { id: 'do', name: 'Do it', min: '20 min' },
  { id: 'own', name: 'Own it', min: '5 min' },
];

function sessionCard(day, n) {
  const p = dayProgress(day);
  const isToday = n === calendarDay();
  return `<section class="session-card glass" id="sessionCard">
    <div class="session-top">
      <div>
        <p class="eyebrow">${isToday ? 'Today’s session' : 'Session'} · Phase ${day.phase}</p>
        <h2>${esc(day.title)}</h2>
        <p>Read the idea, run an example, solve queries against real Postgres, then explain it in your own words. No race.</p>
      </div>
      <div class="session-progress"><strong>${p.steps.filter(Boolean).length}/4</strong><small>steps done</small></div>
    </div>
    <div class="session-timeline">
      ${STEPS.map((s, i) => `<button class="phase ${p.steps[i] ? 'done' : ''}" data-jump="${s.id}">
        <span class="phase-number">${p.steps[i] ? '✓' : pad2(i + 1)}</span><strong>${s.name}</strong><span class="phase-duration">${s.min}</span></button>`).join('')}
    </div>
  </section>`;
}

function renderDay(n) {
  const day = DAYS[n - 1];
  renderSidebar(weekOf(n));
  if (day.placeholder) {
    app.innerHTML = topbar(n) + dayPicker(n) + `
      <section class="session-card glass"><p class="eyebrow">Coming soon</p><h2 style="font:800 19px var(--head);margin:5px 0">This day is still being written</h2>
      <p class="muted" style="margin:0">Check back shortly, or keep practicing in the <a href="#/playground">playground</a>.</p></section>`;
    return;
  }
  const phase = PHASES.find((p) => p.id === day.phase);
  const setup = day.setup || '';
  const s = store.get();

  app.innerHTML = topbar(n) + dayPicker(n) + dashboard(n) + sessionCard(day, n) + `
    <section class="lesson-card glass">
      <div class="lesson-icon">✦</div>
      <div class="lesson-copy">
        <p class="eyebrow">Before you query · Phase ${phase.id} · ${esc(phase.title)}</p>
        <h2>${esc(day.goal)}</h2>
        <p class="muted" style="margin:0;font-size:12px">${esc(phase.blurb)} Every run happens inside a transaction that is rolled back, so you can’t break anything.</p>
      </div>
    </section>

    <div class="section-heading" id="learn">
      <div><p class="eyebrow">01 · Learn it · 5 min</p><h2>The idea, one picture at a time</h2></div>
      <span class="task-count">Read it slowly. Then try it.</span>
    </div>
    <article class="block glass">
      <div class="prose">${day.learn}</div>
      <div class="task-actions"><button class="complete-button ${s.read[n] ? 'marked' : ''}" id="readBtn">${s.read[n] ? ICON.done + 'Read' : ICON.circle + 'Mark as read'}</button></div>
    </article>

    <div class="section-heading" id="see">
      <div><p class="eyebrow">02 · See it · 5 min</p><h2>Run a worked example</h2></div>
      <span class="task-count">Ctrl/⌘ + Enter runs it</span>
    </div>
    <article class="block glass">
      <p class="question-prompt" style="margin-bottom:10px">${day.example.note || ''}</p>
      <div class="editor" id="exampleEd"></div>
      <div class="task-actions">
        <button class="primary-btn sm" id="exampleRun">${ICON.play}Run</button>
        <button class="ghost-btn" id="exampleReset">${ICON.reset}Restore example</button>
      </div>
      <div class="result" id="exampleOut"></div>
    </article>

    <div class="section-heading" id="do">
      <div><p class="eyebrow">03 · Do it · 20 min</p><h2>Small steps, one query at a time</h2></div>
      <span class="task-count" id="doCount"></span>
    </div>
    <div class="task-list" id="exercises"></div>

    <section class="interview-question glass" id="own">
      <span class="interview-step">04 · Final step</span>
      <div><p class="eyebrow">Own it · 5 min</p><h2>Explain it, then prove it on LeetCode</h2></div>
      ${day.leetcode.map((lc) => {
        const key = `${n}:${lc.id}`;
        return `<div class="lc-row">
          <span class="t">${lc.id}. ${esc(lc.title)}<small class="diff-${esc(lc.difficulty)}">${esc(lc.difficulty)} · LeetCode · choose PostgreSQL</small></span>
          <a class="primary-btn sm" href="https://leetcode.com/problems/${esc(lc.slug)}/" target="_blank" rel="noopener">${ICON.ext}Open the problem</a>
          <button class="complete-button ${s.lc[key] ? 'marked' : ''}" data-lc="${key}">${s.lc[key] ? ICON.done + 'Done' : ICON.circle + 'Mark done'}</button>
        </div>`;
      }).join('')}
      <p class="question-prompt"><b>Explain it in your own words:</b> ${day.ownIt}</p>
      <textarea class="note" id="note" placeholder="Write it as if you were explaining it to a teammate.">${esc(s.notes[n] || '')}</textarea>
      <p class="answer-promise">Counts as done once you’ve written a sentence or two. Notes are saved automatically.</p>
    </section>

    <footer class="page-footer">
      <span>Progress is stored in this browser only.</span>
      <span class="nav">
        ${n > 1 ? `<a class="ghost-btn" href="#/day/${n - 1}">${ICON.left}Day ${n - 1}</a>` : ''}
        ${n < DAYS.length ? `<a class="ghost-btn" href="#/day/${n + 1}">Day ${n + 1}${ICON.right}</a>` : ''}
        <button class="text-button" id="resetDay">${ICON.reset}Reset this day</button>
      </span>
    </footer>`;

  // Start heavy setup early so the first Run isn't slow.
  withDb(() => ensureDb(setup)).catch(() => {});

  const wasComplete = isComplete(day);
  const refresh = () => {
    const p = dayProgress(day);
    $('#doCount').textContent = `${p.exDone}/${day.exercises.length} solved · checked against real Postgres`;
    $('#sessionCard').outerHTML = sessionCard(day, n);
    bindJumps();
    renderSidebar(weekOf(n));
    if (!refresh.celebrated && !wasComplete && p.pct === 100) {
      refresh.celebrated = true;
      toast(`Day ${n} complete`, 'Every step done. See you tomorrow!');
    }
  };
  const bindJumps = () => app.querySelectorAll('[data-jump]').forEach((b) => b.onclick = () => $('#' + b.dataset.jump).scrollIntoView({ behavior: 'smooth' }));

  // Learn
  $('#readBtn').onclick = () => {
    const now = !store.get().read[n];
    store.setRead(n, now);
    $('#readBtn').className = `complete-button ${now ? 'marked' : ''}`;
    $('#readBtn').innerHTML = now ? ICON.done + 'Read' : ICON.circle + 'Mark as read';
    refresh();
  };

  // See
  const exOut = $('#exampleOut');
  const runExample = () => withDb(async () => {
    await ensureDb(setup);
    const out = await runSql(db, exEd.getValue());
    if (out.dirty) loaded.dirty = true;
    renderResult(exOut, out);
    if (!out.error && !store.get().ran[n]) { store.markRan(n); refresh(); }
  });
  const exEd = makeEditor($('#exampleEd'), day.example.sql, { onRun: runExample });
  $('#exampleRun').onclick = runExample;
  $('#exampleReset').onclick = () => exEd.setValue(day.example.sql);

  // Do
  const list = $('#exercises');
  day.exercises.forEach((ex, i) => list.appendChild(ex.type === 'quiz' ? quizCard(ex, i, refresh) : queryCard(ex, i, setup, refresh)));

  // Own
  app.querySelectorAll('[data-lc]').forEach((b) => b.onclick = () => {
    const now = !store.get().lc[b.dataset.lc];
    store.setLeetcode(b.dataset.lc, now);
    b.className = `complete-button ${now ? 'marked' : ''}`;
    b.innerHTML = now ? ICON.done + 'Done' : ICON.circle + 'Mark done';
    refresh();
  });
  $('#note').addEventListener('input', (e) => { store.setNote(n, e.target.value); refresh(); });
  $('#resetDay').onclick = () => {
    if (confirm(`Clear all progress, drafts and notes for Day ${n}?`)) { store.resetDay(day); route(); }
  };
  refresh();
}

function queryCard(ex, i, setup, onProgress) {
  const card = document.createElement('article');
  card.className = 'course-task glass';
  card.innerHTML = `
    <div class="task-marker">${pad2(i + 1)}</div>
    <div style="min-width:0">
      <div class="task-heading">
        <div><p class="task-kicker">Practice · query${ex.ordered ? ' · order matters' : ''}</p><div class="prompt">${ex.prompt}</div></div>
        <span class="status-pill"></span>
      </div>
      <div class="editor"></div>
      <div class="task-actions">
        <button class="primary-btn sm" data-a="check">${ICON.check}Check answer</button>
        <button class="attempt-button" data-a="run">${ICON.play}Run</button>
        <span class="spacer"></span>
        <button class="resource-link" data-a="hint">${ICON.bulb}Hint</button>
        <button class="resource-link" data-a="solution">${ICON.eye}Reveal solution</button>
      </div>
      <div class="feedback"></div>
      <div class="result"></div>
      <div class="extra"></div>
    </div>`;
  const out = $('.result', card), fb = $('.feedback', card), extra = $('.extra', card), pill = $('.status-pill', card);

  const paint = () => {
    const st = store.get().ex[ex.id];
    card.classList.toggle('completed', !!st?.solved);
    $('.task-marker', card).textContent = st?.solved ? '✓' : pad2(i + 1);
    pill.hidden = !st?.solved;
    pill.className = 'status-pill' + (st?.help ? ' help' : '');
    pill.textContent = st?.help ? 'Solved with help' : 'Solved';
  };

  const run = () => withDb(async () => {
    await ensureDb(setup);
    const r = await runSql(db, ed.getValue(), { check: ex.check });
    if (r.dirty) loaded.dirty = true;
    fb.innerHTML = '';
    renderResult(out, r);
  });

  const check = () => {
    if (!ed.getValue().replace(/--.*$/gm, '').trim()) { fb.innerHTML = '<div class="msg info">Write a query first.</div>'; return; }
    return withDb(async () => {
      await ensureDb(setup);
      const g = await gradeExercise(db, ex, ed.getValue());
      if (g.dirty) loaded.dirty = true;
      if (g.error) {
        fb.innerHTML = `<div class="msg error">${esc(g.error)}</div>`;
        out.innerHTML = '';
        return;
      }
      renderResult(out, g.actual);
      if (g.ok) {
        store.solveExercise(ex.id, { help: !!store.get().ex[ex.id]?.peeked });
        fb.innerHTML = '<div class="msg ok"><b>Correct!</b> Your result matches exactly.</div>';
        extra.innerHTML = `<div class="answer-panel"><p class="answer-label">Why it works</p>${ex.why || ''}</div>`;
        paint();
        onProgress();
      } else {
        fb.innerHTML = `<div class="msg bad"><b>Not yet.</b> ${esc(g.reason)}</div>`;
      }
    });
  };

  const ed = makeEditor($('.editor', card), store.get().drafts[ex.id] ?? '-- Write your query here\n', {
    onRun: run,
    onChange: (v) => store.setDraft(ex.id, v),
  });

  card.querySelector('[data-a="run"]').onclick = run;
  card.querySelector('[data-a="check"]').onclick = check;
  card.querySelector('[data-a="hint"]').onclick = () => {
    extra.innerHTML = `<div class="answer-panel"><p class="answer-label">Hint</p>${ex.hint || 'No hint for this one. Re-read the Learn section.'}</div>`;
  };
  card.querySelector('[data-a="solution"]').onclick = () => {
    const st = store.get().ex[ex.id];
    if (!st?.solved && !st?.peeked && !confirm('Looking at the solution early means you learn less. Have you tried the hint?\n\nShow it anyway?')) return;
    if (!st?.solved) store.markPeeked(ex.id);
    extra.innerHTML = `<div class="answer-panel"><p class="answer-label">Solution</p><pre>${esc(ex.solution)}</pre>
      ${ex.alts?.length ? `<p class="answer-label" style="margin-top:12px">Also correct</p>${ex.alts.map((a) => `<pre>${esc(a)}</pre>`).join('')}` : ''}
      <p class="answer-label" style="margin-top:12px">Why it works</p>${ex.why || ''}
      <div class="task-actions"><button class="ghost-btn" data-a="use">Copy into editor</button></div></div>`;
    extra.querySelector('[data-a="use"]').onclick = () => ed.setValue(ex.solution);
  };
  paint();
  return card;
}

function quizCard(ex, i, onProgress) {
  const card = document.createElement('article');
  card.className = 'course-task glass';
  const paint = () => {
    const st = store.get().quiz[ex.id];
    card.classList.toggle('completed', !!st?.correct);
    card.innerHTML = `
      <div class="task-marker">${st?.correct ? '✓' : pad2(i + 1)}</div>
      <div style="min-width:0">
        <div class="task-heading"><div><p class="task-kicker">Quick check</p><div class="prompt">${ex.prompt}</div></div>
          ${st?.correct ? '<span class="status-pill">Correct</span>' : ''}</div>
        <div class="options">${ex.options.map((o, k) => {
          let cls = 'option';
          if (st && k === ex.answer && st.correct) cls += ' right';
          if (st && k === st.choice && !st.correct) cls += ' wrongpick';
          return `<button class="${cls}" data-k="${k}" ${st ? 'disabled' : ''}><b>${String.fromCharCode(65 + k)}.</b> ${o}</button>`;
        }).join('')}</div>
        ${!st ? '' : st.correct
          ? `<div class="answer-panel"><p class="answer-label">Why</p>${ex.why || ''}</div>`
          : `<div class="msg bad"><b>Not quite.</b> Think about it once more.</div>
             <div class="task-actions"><button class="ghost-btn" data-a="retry">${ICON.reset}Try again</button><button class="resource-link" data-a="reveal">${ICON.eye}Reveal answer</button></div>`}
      </div>`;
    card.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
      const k = Number(b.dataset.k);
      store.answerQuiz(ex.id, k, k === ex.answer);
      paint();
      onProgress();
    });
    const retry = card.querySelector('[data-a="retry"]');
    if (retry) retry.onclick = () => { store.clearQuiz(ex.id); paint(); };
    const reveal = card.querySelector('[data-a="reveal"]');
    if (reveal) reveal.onclick = () => {
      reveal.parentElement.insertAdjacentHTML('afterend', `<div class="answer-panel"><p class="answer-label">Answer: ${String.fromCharCode(65 + ex.answer)}</p>${ex.why || ''}</div>`);
      reveal.remove();
    };
  };
  paint();
  return card;
}

/* ---------------------------------------------------------------- playground */

const MUTATING = /\b(begin|start|insert|update|delete|create|alter|drop|truncate|comment|grant|revoke|vacuum|reindex|cluster|set)\b/i;
let pendingPlayground = null, queuedSql = null;

function renderPlayground() {
  pendingPlayground = null;
  renderSidebar(0);
  app.innerHTML = `
    <header class="topbar">
      <div><p class="topbar-text">Free practice</p><h1>SQL Playground</h1><small id="pgState"></small></div>
      <div class="day-controls">
        <button class="icon-button" id="pgTables" title="Show tables" aria-label="Show tables"><svg class="icon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg></button>
        <a class="today-button" href="#/day/${clampDay(calendarDay())}">${ICON.cal}Today</a>
      </div>
    </header>
    <div class="pg-wrap">
      <section class="lesson-card glass" style="margin:0">
        <div class="lesson-icon">✦</div>
        <div class="lesson-copy"><p class="eyebrow">Anything goes</p>
          <h2>Real Postgres, same data as the lessons</h2>
          <p class="muted" style="margin:0;font-size:12px">Changes here <b>stay</b> until you reset, so you can create an index and then <code>EXPLAIN</code> a query in the next run. Opening a day resets the database automatically.</p></div>
      </section>
      <article class="block glass" style="margin:0">
        <div class="editor" id="pgEd"></div>
        <div class="task-actions">
          <button class="primary-btn sm" id="pgRun">${ICON.play}Run</button>
          <span class="kbd">Ctrl/⌘ + Enter</span>
          <span class="spacer"></span>
          <label class="check"><input type="checkbox" id="pgRollback" /> Undo changes after each run</label>
          <button class="text-button" id="pgReset">${ICON.reset}Reset database</button>
        </div>
        <div class="result" id="pgOut"></div>
      </article>
      <article class="block glass history" style="margin:0">
        <p class="eyebrow" style="margin-bottom:6px">Recent queries</p><div id="pgHist"></div>
      </article>
    </div>
    <footer class="page-footer"><span>Progress is stored in this browser only.</span></footer>`;
  const out = $('#pgOut');
  const paintState = () => {
    $('#pgState').textContent = loaded.dirty ? 'Database: modified by you' : loaded.setup ? 'Database: practice data + a day’s extra tables' : 'Database: original practice data';
  };
  const paintHist = () => {
    const h = store.get().history;
    $('#pgHist').innerHTML = h.length ? h.map((q, i) => `<button data-h="${i}" title="${esc(q)}">${esc(q.replace(/\s+/g, ' '))}</button>`).join('') : '<p class="muted" style="font-size:12px;margin:0">Nothing yet.</p>';
    app.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => ed.setValue(store.get().history[b.dataset.h]));
  };
  const run = () => withDb(async () => {
    const sql = ed.getValue();
    const rollback = $('#pgRollback').checked;
    const r = await runSql(db, sql, { rollback });
    if (r.dirty || (!rollback && MUTATING.test(sql))) loaded.dirty = true;
    store.pushHistory(sql);
    renderResult(out, r, { maxRows: 1000 });
    paintState();
    paintHist();
  });
  const ed = makeEditor($('#pgEd'), store.get().playground || `-- Try anything. For example:
SELECT d.name, COUNT(e.id) AS headcount, ROUND(AVG(e.salary)) AS avg_salary
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.name
ORDER BY headcount DESC;
`, { onRun: run, onChange: (v) => store.setPlayground(v) });
  $('#pgRun').onclick = run;
  $('#pgTables').onclick = openTables;
  $('#pgReset').onclick = () => withDb(async () => {
    loaded.dirty = true;
    await ensureDb('');
    paintState();
    out.innerHTML = '<div class="msg ok">Database reset to the original practice data.</div>';
  });
  paintState();
  paintHist();
  pendingPlayground = (sql) => { ed.setValue(sql); run(); };
  if (queuedSql) { const q = queuedSql; queuedSql = null; pendingPlayground(q); }
}

/* ---------------------------------------------------------------- tables drawer */

const drawer = $('#tablesDrawer'), scrim = $('#scrim');

function openTables() {
  drawer.classList.add('open');
  scrim.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  withDb(async () => {
    const cols = await db.query(`
      SELECT c.table_name, c.column_name, c.data_type, c.is_nullable,
             EXISTS (SELECT 1 FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage k USING (constraint_schema, constraint_name, table_name)
                     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = c.table_name AND k.column_name = c.column_name) AS pk,
             (SELECT ccu.table_name FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage k USING (constraint_schema, constraint_name, table_name)
                     JOIN information_schema.constraint_column_usage ccu USING (constraint_schema, constraint_name)
                     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = c.table_name AND k.column_name = c.column_name LIMIT 1) AS fk
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
      ORDER BY t.table_type, c.table_name, c.ordinal_position`);
    const counts = await db.query(`SELECT relname, GREATEST(reltuples, 0)::bigint AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p')`);
    const n = Object.fromEntries(counts.rows.map((r) => [r.relname, r.n]));
    const tables = {};
    for (const r of cols.rows) (tables[r.table_name] ||= []).push(r);
    $('#tablesBody').innerHTML = `<p class="muted" style="font-size:12px">🔑 primary key · → foreign key. Click <b>Preview</b> to look at the rows.</p>` +
      Object.entries(tables).map(([t, cs], i) => `
        <details class="tbl" ${i < 2 ? 'open' : ''}>
          <summary>${esc(t)} <span>${n[t] !== undefined ? `~${n[t]} rows` : 'view'}</span></summary>
          <ul>${cs.map((c) => `<li><span>${c.pk ? '<span class="pk">🔑</span> ' : ''}${esc(c.column_name)}${c.fk ? ` <span class="ty">→ ${esc(c.fk)}</span>` : ''}</span><span class="ty">${esc(c.data_type.replace('character varying', 'varchar').replace('timestamp with time zone', 'timestamptz'))}${c.is_nullable === 'NO' ? '' : ' · null'}</span></li>`).join('')}</ul>
          <button class="ghost-btn" data-preview="${esc(t)}" style="margin:6px 0 0 12px">${ICON.eye}Preview</button>
        </details>`).join('');
    drawer.querySelectorAll('[data-preview]').forEach((b) => b.onclick = () => {
      const sql = `SELECT * FROM ${b.dataset.preview} LIMIT 20;`;
      closeTables();
      if (pendingPlayground && location.hash.startsWith('#/playground')) pendingPlayground(sql);
      else { queuedSql = sql; location.hash = '#/playground'; }
    });
  });
}
function closeTables() {
  drawer.classList.remove('open');
  scrim.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}
$('#tablesBtn').onclick = openTables;
$('#tablesClose').onclick = closeTables;
scrim.onclick = closeTables;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTables(); });

route();
