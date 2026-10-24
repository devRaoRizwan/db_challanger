// Runs SQL against a PGlite instance and grades answers.
// Shared by the browser app and tools/validate.mjs, so keep it free of DOM code.
import { SEED_SQL } from '../content/seed.js';

// Show dates/times exactly as Postgres prints them. JS Date objects would shift
// timestamps into the viewer's timezone. 1082 date, 1114 timestamp, 1184 timestamptz.
const RAW = (v) => v;
const PARSERS = { 1082: RAW, 1114: RAW, 1184: RAW };

const TXN_CONTROL = /\b(commit|rollback|end|abort)\b\s*(;|$)/im;

export async function resetDb(db, setup = '') {
  // The playground may have left a transaction open (or aborted); close it first.
  await db.exec('ROLLBACK').catch(() => {});
  await db.exec('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await db.exec(SEED_SQL);
  if (setup) await db.exec(setup);
  await db.exec('ANALYZE;');
}

// Runs `sql`. With rollback=true every change is undone afterwards, so exercises never
// corrupt the dataset. Returns { result, results, error, dirty } where result is the last
// statement that produced columns (or the last statement at all).
export async function runSql(db, sql, { rollback = true, check = '' } = {}) {
  const out = { result: null, results: [], error: null, dirty: false };
  const started = performance.now();
  if (rollback) await db.exec('BEGIN');
  try {
    out.results = await db.exec(sql, { rowMode: 'array', parsers: PARSERS });
    if (check) out.results = out.results.concat(await db.exec(check, { rowMode: 'array', parsers: PARSERS }));
  } catch (e) {
    out.error = formatError(e);
  }
  if (rollback) {
    try { await db.exec('ROLLBACK'); } catch { /* already closed by user's COMMIT */ }
    // The user ended our transaction themselves, so their changes may have persisted.
    out.dirty = TXN_CONTROL.test(stripComments(sql));
  }
  out.ms = Math.round(performance.now() - started);
  const withCols = out.results.filter((r) => r.fields && r.fields.length);
  out.result = check ? out.results[out.results.length - 1] : withCols[withCols.length - 1] || out.results[out.results.length - 1] || null;
  return out;
}

function stripComments(sql) {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^']|'')*'/g, "''");
}

function formatError(e) {
  let msg = e.message || String(e);
  if (e.hint) msg += `\nHint: ${e.hint}`;
  if (e.detail) msg += `\nDetail: ${e.detail}`;
  return msg;
}

export function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const s = v.toISOString();
    return s.endsWith('T00:00:00.000Z') ? s.slice(0, 10) : s;
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return fmtNum(Number(v));
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function fmtNum(n) {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

const rowsOf = (res) => (res && res.rows ? res.rows.map((r) => r.map(normalizeValue)) : []);

// Compares the user's result with the expected result.
// Column names are ignored; values, column count, row count (and order if `ordered`) matter.
export function compareResults(actual, expected, { ordered = false } = {}) {
  const a = rowsOf(actual), e = rowsOf(expected);
  const aCols = actual?.fields?.length ?? 0, eCols = expected?.fields?.length ?? 0;
  if (aCols !== eCols) return { ok: false, reason: `Expected ${eCols} column${eCols === 1 ? '' : 's'}, your query returned ${aCols}.` };
  if (a.length !== e.length) return { ok: false, reason: `Expected ${e.length} row${e.length === 1 ? '' : 's'}, your query returned ${a.length}.` };
  const key = (r) => JSON.stringify(r);
  const as = a.map(key), es = e.map(key);
  if (ordered) {
    const i = as.findIndex((r, idx) => r !== es[idx]);
    if (i === -1) return { ok: true };
    const unordered = [...as].sort().join('\n') === [...es].sort().join('\n');
    if (unordered) return { ok: false, reason: 'Right rows, wrong order. Check your ORDER BY.' };
    return { ok: false, reason: `Row ${i + 1} differs. Expected ${fmtRow(e[i])}, got ${fmtRow(a[i])}.` };
  }
  const sa = [...as].sort(), se = [...es].sort();
  const i = sa.findIndex((r, idx) => r !== se[idx]);
  if (i === -1) return { ok: true };
  const missing = es.find((r) => !as.includes(r));
  return { ok: false, reason: missing ? `A row is missing or wrong, e.g. expected ${fmtRow(JSON.parse(missing))}.` : 'Some values differ from the expected result.' };
}

const fmtRow = (r) => '(' + r.map((v) => (v === null ? 'NULL' : v)).join(', ') + ')';

// Grades one query exercise. Returns { ok, reason, actual, expected, error }.
export async function gradeExercise(db, ex, userSql) {
  const expected = await runSql(db, ex.solution, { check: ex.check });
  if (expected.error) return { ok: false, error: `Exercise is broken (solution failed): ${expected.error}`, dirty: expected.dirty };
  const actual = await runSql(db, userSql, { check: ex.check });
  if (actual.error) return { ok: false, error: actual.error, actual, dirty: actual.dirty };
  return { ...compareResults(actual.result, expected.result, { ordered: !!ex.ordered }), actual, expected, dirty: actual.dirty };
}
