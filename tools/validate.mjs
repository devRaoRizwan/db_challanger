// Checks every day's content against a real Postgres (PGlite):
//   node tools/validate.mjs          -> all days
//   node tools/validate.mjs 11-20    -> a range
import { PGlite } from '@electric-sql/pglite';
import { DAYS } from '../content/index.js';
import { resetDb, runSql, gradeExercise } from '../src/engine.js';

const [lo, hi] = (process.argv[2] || '1-40').split('-').map(Number);
const days = DAYS.filter((d) => !d.placeholder && d.day >= lo && d.day <= (hi || lo));
const db = new PGlite();
let errors = 0, warnings = 0;
const err = (d, m) => { errors++; console.log(`  ✗ Day ${d.day}: ${m}`); };
const warn = (d, m) => { warnings++; console.log(`  ! Day ${d.day}: ${m}`); };
const ids = new Set();

for (const d of days) {
  console.log(`Day ${d.day} — ${d.title}`);
  for (const f of ['day', 'phase', 'title', 'goal', 'learn', 'example', 'exercises', 'leetcode', 'ownIt'])
    if (d[f] === undefined) err(d, `missing field "${f}"`);
  await resetDb(db, d.setup);
  const ex = await runSql(db, d.example?.sql || '');
  if (ex.error) err(d, `example failed: ${ex.error}`);
  if (ex.dirty) await resetDb(db, d.setup);

  for (const e of d.exercises || []) {
    if (ids.has(e.id)) err(d, `duplicate exercise id ${e.id}`);
    ids.add(e.id);
    if (!e.prompt) err(d, `${e.id}: missing prompt`);
    if (e.type === 'quiz') {
      if (!Array.isArray(e.options) || e.options.length < 2) err(d, `${e.id}: quiz needs options`);
      if (!(e.answer >= 0 && e.answer < (e.options || []).length)) err(d, `${e.id}: bad answer index`);
      if (!e.why) warn(d, `${e.id}: quiz has no "why"`);
      continue;
    }
    if (e.type !== 'query') { err(d, `${e.id}: unknown type ${e.type}`); continue; }
    if (!e.solution) { err(d, `${e.id}: missing solution`); continue; }
    if (!e.hint) warn(d, `${e.id}: no hint`);
    if (e.ordered && !/order\s+by/i.test(e.solution + (e.check || ''))) err(d, `${e.id}: ordered but solution has no ORDER BY`);
    const r = await runSql(db, e.solution, { check: e.check });
    if (r.dirty) await resetDb(db, d.setup);
    if (r.error) { err(d, `${e.id}: solution failed: ${r.error}`); continue; }
    if (!r.result?.fields?.length) err(d, `${e.id}: solution returns no columns (add a "check" query for DDL/DML)`);
    else if (!r.result.rows.length && !e.allowEmpty) warn(d, `${e.id}: solution returns 0 rows`);
    for (const [i, alt] of (e.alts || []).entries()) {
      const g = await gradeExercise(db, e, alt);
      if (g.dirty) await resetDb(db, d.setup);
      if (!g.ok) err(d, `${e.id}: alt #${i + 1} does not pass: ${g.error || g.reason}`);
    }
    for (const [i, bad] of (e.wrong || []).entries()) {
      const g = await gradeExercise(db, e, bad.sql);
      if (g.dirty) await resetDb(db, d.setup);
      if (g.ok) err(d, `${e.id}: wrong answer #${i + 1} unexpectedly passes`);
    }
  }
}
console.log(`\n${days.length} days checked — ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
