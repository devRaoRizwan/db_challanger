export default {
  day: 34,
  phase: 4,
  title: 'Locking, SELECT FOR UPDATE, SKIP LOCKED, deadlocks',
  goal: 'Lock exactly the rows you need, build a job queue that many workers can share, and avoid deadlocks and lost updates.',
  setup: `
CREATE TABLE jobs (
  id         int PRIMARY KEY,
  kind       text NOT NULL,
  status     text NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts   int NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL
);
INSERT INTO jobs (id, kind, status, created_at) VALUES
  (1,  'email',  'done',    '2025-06-01 09:00'),
  (2,  'email',  'running', '2025-06-01 09:01'),
  (3,  'report', 'pending', '2025-06-01 09:02:30'),
  (4,  'email',  'pending', '2025-06-01 09:02'),
  (5,  'email',  'pending', '2025-06-01 09:02'),
  (6,  'report', 'failed',  '2025-06-01 09:00'),
  (7,  'sms',    'pending', '2025-06-01 09:10'),
  (8,  'email',  'pending', '2025-06-01 09:03'),
  (9,  'email',  'pending', '2025-06-01 09:20'),
  (10, 'sms',    'done',    '2025-06-01 08:00');

CREATE TABLE accounts (
  id      int PRIMARY KEY,
  owner   text NOT NULL,
  balance numeric(10,2) NOT NULL,
  version int NOT NULL
);
INSERT INTO accounts VALUES (1, 'Ali', 100, 3), (2, 'Sana', 250, 2), (3, 'Omar', 40, 1);`,
  learn: `
<p>Yesterday's isolation levels decide what you <b>see</b>. Locks decide who has to <b>wait</b>. The good news: in Postgres,
<b>readers never block writers and writers never block readers</b> (thanks to row versions, Day 36). Locks only matter when two
transactions want to <i>change</i> (or promise to change) the same thing.</p>

<h4>Row locks you already take without knowing</h4>
<p>Every <code>UPDATE</code> and <code>DELETE</code> locks the rows it touches until COMMIT/ROLLBACK. A second UPDATE of the same row waits:</p>
<div class="timeline"><table class="mini">
<tr><th>t</th><th>Session A</th><th>Session B</th></tr>
<tr><td>1</td><td>UPDATE accounts SET balance = balance - 10 WHERE id = 1;</td><td></td></tr>
<tr><td>2</td><td></td><td>UPDATE accounts SET balance = balance + 5 WHERE id = 1; <b>⏳ waits</b></td></tr>
<tr><td>3</td><td>COMMIT;</td><td>…re-reads row 1, applies +5, continues</td></tr>
</table></div>

<h4>SELECT … FOR UPDATE: "I read it, and I'm going to change it"</h4>
<p>When you must read first and decide in app code, lock the rows while reading:</p>
<pre><code>BEGIN;
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;   -- others now wait for this row
-- app logic: check limits, fraud rules…
UPDATE accounts SET balance = 90 WHERE id = 1;
COMMIT;                                          -- lock released</code></pre>
<ul>
<li><code>FOR UPDATE</code>: exclusive. Other FOR UPDATE / UPDATE / DELETE on that row wait. Plain SELECTs don't.</li>
<li><code>FOR SHARE</code>: "nobody change this while I look". Many can share, writers wait.</li>
<li><code>NOWAIT</code>: don't wait, raise an error immediately if the row is locked.</li>
<li><code>SKIP LOCKED</code>: don't wait, silently <b>skip</b> locked rows. Perfect for queues.</li>
</ul>

<h4>A job queue in one statement</h4>
<pre><code>UPDATE jobs SET status = 'running', attempts = attempts + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending'
  ORDER BY created_at, id          -- oldest first, id breaks ties
  FOR UPDATE SKIP LOCKED           -- skip jobs other workers are claiming
  LIMIT 1
)
RETURNING *;</code></pre>
<p>Ten workers can run this at once: each one locks a different row and nobody waits. Without <code>SKIP LOCKED</code>
all ten would queue up on the same oldest job, and nine of them would then find it already running.</p>

<h4>Deadlocks</h4>
<div class="timeline"><table class="mini">
<tr><th>t</th><th>Session A (1 → 2)</th><th>Session B (2 → 1)</th></tr>
<tr><td>1</td><td>UPDATE … WHERE id = 1; 🔒1</td><td></td></tr>
<tr><td>2</td><td></td><td>UPDATE … WHERE id = 2; 🔒2</td></tr>
<tr><td>3</td><td>UPDATE … WHERE id = 2; ⏳ waits for B</td><td></td></tr>
<tr><td>4</td><td></td><td>UPDATE … WHERE id = 1; ⏳ waits for A → <b>deadlock</b></td></tr>
</table></div>
<p>Postgres detects the cycle after about a second (<code>deadlock_timeout</code>) and kills one transaction with
<code>ERROR: deadlock detected</code>. The fix is boring and reliable: <b>always lock rows in the same order</b>, e.g. by id.
<code>SELECT … WHERE id IN (1, 2) ORDER BY id FOR UPDATE</code> before transferring between them.</p>

<h4>Optimistic vs pessimistic locking</h4>
<table class="mini">
<tr><th></th><th>Pessimistic</th><th>Optimistic</th></tr>
<tr><td>How</td><td>SELECT … FOR UPDATE, hold the lock</td><td>a <code>version</code> column, <code>UPDATE … WHERE version = n</code></td></tr>
<tr><td>Conflict</td><td>the other request waits</td><td>0 rows updated → tell user / retry</td></tr>
<tr><td>Good for</td><td>short transactions, hot rows</td><td>"edit form" flows where a user thinks for minutes</td></tr>
</table>
<pre><code>-- app read the row at version 3
UPDATE accounts SET balance = 80, version = version + 1
WHERE id = 1 AND version = 3
RETURNING version;           -- no row back = someone else saved first</code></pre>

<div class="callout"><b>Advisory locks</b> lock an <i>idea</i> rather than a row: <code>SELECT pg_advisory_xact_lock(42)</code>
makes every other caller with key 42 wait until your transaction ends. Handy for "only one cron run at a time".</div>

<div class="callout trap"><b>Trap:</b> locks are held until the transaction ends. Never call a slow HTTP API, send an email or wait for
user input while holding a <code>FOR UPDATE</code> lock. And watch out for DDL: <code>ALTER TABLE</code> takes an
<b>ACCESS EXCLUSIVE</b> lock that blocks even plain SELECTs on the whole table (more on Day 36).</div>`,
  example: {
    sql: `-- Claim the oldest pending job (your run is a transaction, so the lock is real until the rollback).
UPDATE jobs SET status = 'running', attempts = attempts + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending'
  ORDER BY created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING id, kind, status, attempts, created_at;`,
    note: 'Jobs 4 and 5 were both created at 09:02, so the id tie-breaker picks 4. Run SELECT * FROM jobs ORDER BY created_at, id to see the whole queue.',
  },
  exercises: [
    {
      id: 'd34-e1', type: 'query',
      prompt: `Write the worker's <b>claim</b> query: set the oldest <b>pending</b> job (by <code>created_at</code>, ties broken by <code>id</code>) to <code>status = 'running'</code>,
add 1 to <code>attempts</code>, and make it safe for many workers using <code>FOR UPDATE SKIP LOCKED</code>. Return <code>id, kind, status, attempts</code>.`,
      hint: 'A subquery picks the id: <code>SELECT id FROM jobs WHERE status = \'pending\' ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1</code>. The outer UPDATE uses <code>WHERE id = ( … )</code>.',
      solution: `UPDATE jobs SET status = 'running', attempts = attempts + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending'
  ORDER BY created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING id, kind, status, attempts;`,
      alts: [
        `WITH next_job AS (
  SELECT id FROM jobs WHERE status = 'pending'
  ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
)
UPDATE jobs j SET status = 'running', attempts = j.attempts + 1
FROM next_job WHERE j.id = next_job.id
RETURNING j.id, j.kind, j.status, j.attempts;`,
      ],
      wrong: [
        { sql: `UPDATE jobs SET status = 'running', attempts = attempts + 1
WHERE id = (SELECT id FROM jobs WHERE status = 'pending' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id, kind, status, attempts;` },
        { sql: `UPDATE jobs SET status = 'running', attempts = attempts + 1
WHERE id = (SELECT id FROM jobs ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id, kind, status, attempts;` },
      ],
      why: 'Job 4 wins: it is the oldest pending job (09:02) and beats job 5 on id. Ordering by id alone would pick job 3, which was queued later. Forgetting <code>status = \'pending\'</code> re-runs job 10, which is already done. The lock and the update happen in one statement, so two workers can never claim the same job.',
    },
    {
      id: 'd34-e2', type: 'query',
      prompt: `An email worker processes jobs in batches. Claim the <b>3 oldest pending <code>email</code> jobs</b> in one statement (same ordering and SKIP LOCKED as before),
setting them to <code>'running'</code>. Return <code>id</code> and <code>status</code>.`,
      hint: 'Use <code>WHERE id IN (SELECT id … LIMIT 3)</code> instead of <code>= ( … LIMIT 1)</code>, and add <code>kind = \'email\'</code>.',
      solution: `UPDATE jobs SET status = 'running', attempts = attempts + 1
WHERE id IN (
  SELECT id FROM jobs
  WHERE status = 'pending' AND kind = 'email'
  ORDER BY created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 3
)
RETURNING id, status;`,
      alts: [
        `UPDATE jobs SET status = 'running'
WHERE id = ANY (ARRAY(
  SELECT id FROM jobs WHERE status = 'pending' AND kind = 'email'
  ORDER BY created_at, id LIMIT 3 FOR UPDATE SKIP LOCKED))
RETURNING id, status;`,
      ],
      wrong: [
        { sql: `UPDATE jobs SET status = 'running'
WHERE id IN (SELECT id FROM jobs WHERE status = 'pending' ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 3)
RETURNING id, status;` },
      ],
      why: 'Jobs 4, 5 and 8. Batching cuts round-trips when jobs are small. Without the <code>kind</code> filter you would grab job 3, a report, which this worker doesn\'t know how to run.',
    },
    {
      id: 'd34-e3', type: 'query',
      prompt: `Optimistic locking with the <code>version</code> column. Two edit forms are being saved:
<ul><li>Request A read <b>account 1</b> at <b>version 3</b> and wants <code>balance = 80</code>.</li>
<li>Request B read <b>account 2</b> at <b>version 1</b> and wants <code>balance = 200</code>.</li></ul>
Write both UPDATEs so each only applies if the row is still at the version that request read, and bumps the version by 1. Graded on the final table.`,
      hint: '<code>UPDATE accounts SET balance = 80, version = version + 1 WHERE id = 1 AND version = 3;</code> and the same pattern for B.',
      solution: `UPDATE accounts SET balance = 80, version = version + 1 WHERE id = 1 AND version = 3;
UPDATE accounts SET balance = 200, version = version + 1 WHERE id = 2 AND version = 1;`,
      check: `SELECT id, balance, version FROM accounts ORDER BY id;`,
      ordered: true,
      alts: [
        `UPDATE accounts SET balance = 80, version = 4 WHERE id = 1 AND version = 3 RETURNING id, version;
UPDATE accounts SET balance = 200, version = 2 WHERE id = 2 AND version = 1 RETURNING id, version;`,
      ],
      wrong: [
        { sql: `UPDATE accounts SET balance = 80, version = version + 1 WHERE id = 1;
UPDATE accounts SET balance = 200, version = version + 1 WHERE id = 2;` },
        { sql: `UPDATE accounts SET balance = 80 WHERE id = 1 AND version = 3;
UPDATE accounts SET balance = 200 WHERE id = 2 AND version = 1;` },
      ],
      why: 'A is saved (account 1 → 80, version 4). B updates 0 rows because account 2 is already at version 2: someone saved in between. The app sees "0 rows affected" and shows "this record was changed, please reload" instead of silently overwriting. Forgetting <code>version = version + 1</code> breaks the scheme: the next stale writer would still match.',
    },
    {
      id: 'd34-e4', type: 'query',
      prompt: `You are about to move money between accounts <b>3 and 1</b>. To avoid deadlocks, lock <b>both</b> rows up front, in <b>ascending id order</b>, with one
<code>SELECT … FOR UPDATE</code>. Return <code>id, balance</code>. (The checker looks inside the rows to see whether your transaction holds the lock.)`,
      hint: '<code>SELECT id, balance FROM accounts WHERE id IN (1, 3) ORDER BY id FOR UPDATE;</code>',
      solution: `SELECT id, balance FROM accounts WHERE id IN (1, 3) ORDER BY id FOR UPDATE;`,
      check: `SELECT id, balance, xmax = pg_current_xact_id()::xid AS locked_by_me FROM accounts ORDER BY id;`,
      ordered: true,
      alts: [
        `SELECT id, balance FROM accounts WHERE id = 1 FOR UPDATE;
SELECT id, balance FROM accounts WHERE id = 3 FOR UPDATE;`,
        `SELECT id, balance FROM accounts WHERE id IN (1, 3) ORDER BY id FOR NO KEY UPDATE;`,
      ],
      wrong: [
        { sql: `SELECT id, balance FROM accounts WHERE id IN (1, 3) ORDER BY id;` },
        { sql: `SELECT id, balance FROM accounts ORDER BY id FOR UPDATE;` },
      ],
      why: 'Row locks are stored in the row itself: the locker\'s transaction id goes into the hidden <code>xmax</code> column, which is how the checker could tell. Without FOR UPDATE nothing is locked; without the WHERE you lock account 2 too, blocking unrelated requests. If every transfer locks in id order, two transfers can still wait for each other, but they can never deadlock.',
    },
    {
      id: 'd34-q1', type: 'quiz',
      prompt: `Two transfers run at the same time. What happens at t4?
<div class="timeline"><table class="mini">
<tr><th>t</th><th>Session A</th><th>Session B</th></tr>
<tr><td>1</td><td>UPDATE accounts SET … WHERE id = 1;</td><td></td></tr>
<tr><td>2</td><td></td><td>UPDATE accounts SET … WHERE id = 2;</td></tr>
<tr><td>3</td><td>UPDATE accounts SET … WHERE id = 2;</td><td></td></tr>
<tr><td>4</td><td></td><td>UPDATE accounts SET … WHERE id = 1;</td></tr>
</table></div>`,
      options: [
        'B waits forever and A waits forever',
        'After about a second Postgres aborts one of them with "deadlock detected"; the other continues',
        'Both updates succeed because they are in different transactions',
        'Postgres rolls back both transactions',
      ],
      answer: 1,
      why: 'A holds row 1 and waits for row 2, B holds row 2 and waits for row 1. The deadlock detector (after <code>deadlock_timeout</code>, 1s by default) picks one victim and aborts it, so the other gets its lock. The app should retry the victim, and better: lock rows in a consistent order so it never happens.',
    },
    {
      id: 'd34-q2', type: 'quiz',
      prompt: 'A "Book this seat" endpoint should immediately tell the user "someone else is booking this seat" instead of making them wait. Which clause fits best?',
      options: ['FOR SHARE', 'FOR UPDATE NOWAIT', 'FOR UPDATE SKIP LOCKED', 'LOCK TABLE seats'],
      answer: 1,
      why: 'NOWAIT raises an error (SQLSTATE 55P03, lock_not_available) right away if the row is locked, which you turn into a friendly message. SKIP LOCKED would silently return no row, fine for "give me <i>any</i> free job" but confusing for "give me <i>this</i> seat". LOCK TABLE blocks every seat.',
    },
    {
      id: 'd34-q3', type: 'quiz',
      prompt: 'Your queue worker uses <code>… ORDER BY created_at LIMIT 1 FOR UPDATE</code> (no SKIP LOCKED) and you scale from 1 to 10 workers. What happens?',
      options: [
        'Throughput goes up 10x',
        'Workers pile up waiting on the same oldest row, so throughput barely improves',
        'Two workers will run the same job at the same time',
        'Postgres raises a deadlock error on every claim',
      ],
      answer: 1,
      why: 'All ten pick the same oldest row and nine of them wait for its lock. When it is released they re-check it, find it no longer pending, and claim nothing (or one more after waiting again). SKIP LOCKED lets each worker move on to the next free row instead.',
    },
  ],
  leetcode: [],
  ownIt: 'Think of a background job, cron task or "edit and save" form in your current project. Would you protect it with SKIP LOCKED, FOR UPDATE, NOWAIT, a version column or an advisory lock? Write the exact SQL and explain in two sentences what goes wrong without it.',
};
