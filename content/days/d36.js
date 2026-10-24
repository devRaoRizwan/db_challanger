export default {
  day: 36,
  phase: 4,
  title: 'Postgres in production: MVCC, VACUUM, safe migrations',
  goal: 'Explain row versions and VACUUM, and write schema migrations that don\'t lock a busy production table.',
  learn: `
<p>You've seen that readers don't block writers and that each transaction sees its own snapshot. The machinery behind both is
<b>MVCC</b> (multi-version concurrency control). Knowing it explains bloat, slow migrations and "why is the disk full?" incidents.</p>

<h4>MVCC in one picture</h4>
<p>Postgres never overwrites a row in place. Every row version (a <i>tuple</i>) carries hidden columns:
<code>xmin</code> = the transaction that created it, <code>xmax</code> = the transaction that deleted or replaced it.
<code>UPDATE products SET price = 255 WHERE id = 3</code> run by transaction 900:</p>
<table class="mini">
<tr><th>ctid (location)</th><th>id</th><th>price</th><th>xmin</th><th>xmax</th><th></th></tr>
<tr><td>(0,3)</td><td>3</td><td>249.00</td><td>753</td><td class="drop">900</td><td class="drop">old version, dead once 900 commits</td></tr>
<tr><td>(0,16)</td><td>3</td><td>255.00</td><td class="keep">900</td><td>0</td><td class="keep">new version</td></tr>
</table>
<p>So an <b>UPDATE = INSERT of a new version + marking the old one dead</b>. A snapshot taken before 900 committed still sees
the old version; everyone after sees the new one. That's how readers never wait. <code>DELETE</code> only sets <code>xmax</code>.</p>

<h4>VACUUM, autovacuum and bloat</h4>
<p>Dead versions stay on disk until <b>VACUUM</b> marks their space reusable. <b>Autovacuum</b> runs this in the background
when roughly 20% of a table has changed. If a table is updated faster than vacuum keeps up, it fills with dead rows: <b>bloat</b>.
The table and its indexes grow, and scans read more pages for the same data. <code>VACUUM</code> doesn't give space back to the OS
(<code>VACUUM FULL</code> does, but it locks the whole table while it rewrites it). Check <code>n_dead_tup</code> and
<code>last_autovacuum</code> in <code>pg_stat_user_tables</code>.</p>

<div class="callout trap"><b>Trap: long-running transactions.</b> VACUUM may only remove a dead version when <b>no</b> open transaction could still need it.
One forgotten <code>BEGIN</code> in a psql window, an "idle in transaction" connection from a crashed worker, or a 3-hour analytics query
holds back cleanup for <b>every table in the database</b>. Watch <code>pg_stat_activity</code> for old <code>xact_start</code> values and set
<code>idle_in_transaction_session_timeout</code>.</div>

<h4>Safe migrations: it's all about the lock</h4>
<p>Most <code>ALTER TABLE</code>s take an <b>ACCESS EXCLUSIVE</b> lock: no reads or writes until they finish. Fine for 1 ms, an outage for 10 minutes.
Worse, while the ALTER <i>waits</i> for that lock behind a slow query, every new query queues behind the ALTER.</p>
<table class="mini">
<tr><th>Change</th><th>Cost on a big table</th></tr>
<tr><td>ADD COLUMN nullable, no default</td><td class="keep">instant (catalog only)</td></tr>
<tr><td>ADD COLUMN … DEFAULT 0 (constant), PG 11+</td><td class="keep">instant: the default is stored once in the catalog</td></tr>
<tr><td>ADD COLUMN … DEFAULT random() / clock_timestamp()</td><td class="drop">rewrites every row</td></tr>
<tr><td>ALTER COLUMN TYPE (most changes)</td><td class="drop">rewrite</td></tr>
<tr><td>SET NOT NULL</td><td class="drop">full scan under lock (unless a valid CHECK proves it)</td></tr>
<tr><td>CREATE INDEX</td><td class="drop">blocks writes for the whole build</td></tr>
<tr><td>CREATE INDEX CONCURRENTLY</td><td class="keep">writes continue, slower build</td></tr>
</table>

<p><b>Recipes:</b></p>
<ul>
<li><b>Always</b> start with <code>SET lock_timeout = '2s'</code>: if the lock isn't free quickly, fail and retry later instead of freezing the app.</li>
<li><b>NOT NULL on a big table:</b> <code>ADD CONSTRAINT … CHECK (col IS NOT NULL) NOT VALID</code> (instant, only checks new rows) → backfill in batches →
<code>VALIDATE CONSTRAINT</code> (scans, but lets reads and writes continue) → <code>SET NOT NULL</code>, which now skips the scan because the valid CHECK proves it.</li>
<li><b>Indexes:</b> <code>CREATE INDEX CONCURRENTLY</code>. It can't run inside a transaction block (it commits several times internally), so many migration tools need a "no transaction" flag for that file.
If it fails it leaves an INVALID index you must drop. (You can't run it here: every run in this app is wrapped in a transaction.)</li>
<li><b>Renaming a column (expand/contract):</b> add the new column → write to both → backfill → switch reads → stop writing the old one → drop it.
A plain <code>RENAME</code> is instant, but the old app version still running during a deploy will crash on the missing name.</li>
</ul>

<h4>Connections and backups, briefly</h4>
<p>Every Postgres connection is a separate OS <b>process</b> using several MB of RAM, so 2,000 connections hurt. Put a pooler such as
<b>PgBouncer</b> (transaction mode) in front, and size app pools so <i>instances × pool size</i> stays under <code>max_connections</code>.
For backups, <code>pg_dump</code> is a logical snapshot; production uses a base backup plus continuous WAL archiving, which allows
<b>point-in-time recovery</b> ("restore to 14:02, just before the bad DELETE"). Managed services (RDS, Cloud SQL) do this for you. Test a restore at least once.</p>`,
  example: {
    sql: `-- Watch an UPDATE create a new row version: new xmin (our transaction) and a new location (ctid).
WITH before AS (
  SELECT id, xmin::text AS x, ctid::text AS c FROM products WHERE id IN (3, 4)
), upd AS (
  UPDATE products SET price = price + 1 WHERE id = 3
  RETURNING id, xmin::text AS x, ctid::text AS c
)
SELECT b.id, b.x AS old_xmin, b.c AS old_ctid,
       COALESCE(u.x, b.x) AS new_xmin, COALESCE(u.c, b.c) AS new_ctid,
       pg_current_xact_id()::text AS my_txid
FROM before b LEFT JOIN upd u USING (id)
ORDER BY b.id;`,
    note: 'Product 3 got a new xmin (= my_txid) and moved to a new ctid. Product 4 was untouched. The old version of product 3 is still on disk, dead, waiting for VACUUM.',
  },
  exercises: [
    {
      id: 'd36-e1', type: 'query',
      prompt: `Prove that even a "do nothing" UPDATE writes a new row version. Run <code>UPDATE products SET price = price WHERE id = 3</code>, then return
<code>id</code>, <code>price</code> and <code>xmin = pg_current_xact_id()::xid AS new_version</code> for products <b>3 and 4</b>, ordered by id.`,
      hint: 'Two statements: the UPDATE, then <code>SELECT id, price, xmin = pg_current_xact_id()::xid AS new_version FROM products WHERE id IN (3, 4) ORDER BY id;</code>',
      solution: `UPDATE products SET price = price WHERE id = 3;
SELECT id, price, xmin = pg_current_xact_id()::xid AS new_version
FROM products WHERE id IN (3, 4)
ORDER BY id;`,
      ordered: true,
      alts: [
        `UPDATE products SET price = price WHERE id = 3;
SELECT id, price, xmin::text = pg_current_xact_id()::text FROM products WHERE id IN (3, 4) ORDER BY id;`,
      ],
      wrong: [
        { sql: `SELECT id, price, xmin = pg_current_xact_id()::xid AS new_version FROM products WHERE id IN (3, 4) ORDER BY id;` },
      ],
      why: 'Product 3 shows <code>true</code>: its visible version was created by your transaction, even though the price is unchanged. Product 4 is still the version from the seed. This is why ORMs that save every column on every request, and "touch" jobs that update rows needlessly, create bloat. Add <code>WHERE price IS DISTINCT FROM new_price</code> to skip no-op writes.',
    },
    {
      id: 'd36-e2', type: 'query',
      prompt: `Make <code>employees.email</code> NOT NULL the production-safe way (Danish, id 12, has no email):
<ol><li>add <code>CHECK (email IS NOT NULL)</code> as <b>NOT VALID</b>, named <code>employees_email_present</code></li>
<li>backfill: set Danish's email to <code>'danish@acme.io'</code></li>
<li><code>VALIDATE</code> the constraint</li>
<li><code>SET NOT NULL</code> on the column</li></ol>`,
      hint: '<code>ALTER TABLE employees ADD CONSTRAINT employees_email_present CHECK (email IS NOT NULL) NOT VALID;</code> … <code>ALTER TABLE employees VALIDATE CONSTRAINT employees_email_present;</code> … <code>ALTER TABLE employees ALTER COLUMN email SET NOT NULL;</code>',
      solution: `ALTER TABLE employees ADD CONSTRAINT employees_email_present CHECK (email IS NOT NULL) NOT VALID;
UPDATE employees SET email = 'danish@acme.io' WHERE id = 12;
ALTER TABLE employees VALIDATE CONSTRAINT employees_email_present;
ALTER TABLE employees ALTER COLUMN email SET NOT NULL;`,
      check: `SELECT
  (SELECT convalidated FROM pg_constraint WHERE conname = 'employees_email_present' AND contype = 'c') AS check_validated,
  (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'employees'::regclass AND attname = 'email') AS column_not_null,
  (SELECT email FROM employees WHERE id = 12) AS danish_email;`,
      alts: [
        `ALTER TABLE employees ADD CONSTRAINT employees_email_present CHECK (email IS NOT NULL) NOT VALID;
UPDATE employees SET email = 'danish@acme.io' WHERE email IS NULL;
ALTER TABLE employees VALIDATE CONSTRAINT employees_email_present;
ALTER TABLE employees ALTER COLUMN email SET NOT NULL;`,
      ],
      wrong: [
        { sql: `ALTER TABLE employees ADD CONSTRAINT employees_email_present CHECK (email IS NOT NULL) NOT VALID;
UPDATE employees SET email = 'danish@acme.io' WHERE id = 12;` },
        { sql: `UPDATE employees SET email = 'danish@acme.io' WHERE id = 12;
ALTER TABLE employees ALTER COLUMN email SET NOT NULL;` },
      ],
      why: 'Step 1 is instant and protects new writes immediately. Step 3 scans the table but only takes a SHARE UPDATE EXCLUSIVE lock, so the app keeps reading and writing. Step 4 sees a validated CHECK that already proves "no NULLs" and skips its own scan under the heavy lock. The direct SET NOT NULL gives the same end state on 30 rows, but on 50 million rows it holds ACCESS EXCLUSIVE for the whole scan (and here it forgets the constraint the checker looks for). Try running step 3 before step 2 to see VALIDATE refuse.',
    },
    {
      id: 'd36-e3', type: 'query',
      prompt: `Add a column <code>priority int NOT NULL DEFAULT 0</code> to <code>orders</code> in <b>one</b> statement. (The checker reads <code>pg_attribute.atthasmissing</code>,
which is true when Postgres stored the default once in the catalog instead of rewriting every row.)`,
      hint: '<code>ALTER TABLE orders ADD COLUMN priority int NOT NULL DEFAULT 0;</code>',
      solution: `ALTER TABLE orders ADD COLUMN priority int NOT NULL DEFAULT 0;`,
      check: `SELECT a.atthasmissing AS fast_default,
       (SELECT COUNT(*) FROM orders WHERE priority = 0) AS rows_with_zero
FROM pg_attribute a
WHERE a.attrelid = 'orders'::regclass AND a.attname = 'priority';`,
      alts: [`ALTER TABLE orders ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0 NOT NULL;`],
      wrong: [
        { sql: `ALTER TABLE orders ADD COLUMN priority int;
UPDATE orders SET priority = 0;
ALTER TABLE orders ALTER COLUMN priority SET NOT NULL;
ALTER TABLE orders ALTER COLUMN priority SET DEFAULT 0;` },
      ],
      why: 'Since PG 11 a constant default is stored once; existing rows "virtually" have 0 and nothing is rewritten, so it is instant on any table size. The old habit (add nullable, UPDATE every row, then SET NOT NULL) writes a new version of every row: a huge transaction, a big lock, and 2x bloat. A volatile default like <code>clock_timestamp()</code> still forces a full rewrite.',
    },
    {
      id: 'd36-e4', type: 'query',
      prompt: `Write a migration that won't freeze the app if <code>orders</code> is busy: first set a <b>lock timeout of 2 seconds</b> for this transaction only
(<code>SET LOCAL</code>), then add a nullable column <code>note text</code> to <code>orders</code>.`,
      hint: '<code>SET LOCAL lock_timeout = \'2s\';</code> then <code>ALTER TABLE orders ADD COLUMN note text;</code>',
      solution: `SET LOCAL lock_timeout = '2s';
ALTER TABLE orders ADD COLUMN note text;`,
      check: `SELECT current_setting('lock_timeout') AS lock_timeout,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'orders' AND column_name = 'note') AS has_note;`,
      alts: [
        `SET LOCAL lock_timeout = 2000;
ALTER TABLE orders ADD COLUMN note text;`,
        `SET lock_timeout = '2s';
ALTER TABLE orders ADD COLUMN note text;`,
      ],
      wrong: [
        { sql: `ALTER TABLE orders ADD COLUMN note text;` },
        { sql: `SET LOCAL statement_timeout = '2s';
ALTER TABLE orders ADD COLUMN note text;` },
      ],
      why: 'Adding a nullable column takes milliseconds once it has the lock, but it needs ACCESS EXCLUSIVE, and it waits behind any long query on the table. While it waits, every new SELECT queues behind it. With lock_timeout the ALTER gives up after 2 s ("canceling statement due to lock timeout") and your migration tool retries later. <code>SET LOCAL</code> ends with the transaction, so the timeout doesn\'t leak into a pooled connection. statement_timeout is a different setting: it limits total run time, not the wait for a lock.',
    },
    {
      id: 'd36-q1', type: 'quiz',
      prompt: 'Your <code>events</code> table keeps growing on disk even though autovacuum runs and the row count is stable. <code>pg_stat_activity</code> shows one connection <b>"idle in transaction"</b> since yesterday. What is the most likely cause?',
      options: [
        'Autovacuum is disabled for that table',
        'That open transaction\'s snapshot stops VACUUM from removing any dead row versions created since it started',
        'The idle connection is holding an ACCESS EXCLUSIVE lock on events',
        'Indexes never shrink, so this is normal',
      ],
      answer: 1,
      why: 'VACUUM can only remove a dead version when no running transaction might still need to see it. An old open transaction pins the "oldest visible" horizon for the whole database, so dead rows pile up everywhere. Kill it (<code>pg_terminate_backend</code>), fix the code path that forgot to COMMIT, and set <code>idle_in_transaction_session_timeout</code>.',
    },
    {
      id: 'd36-q2', type: 'quiz',
      prompt: 'Your migration tool wraps each file in BEGIN … COMMIT, and the file contains <code>CREATE INDEX CONCURRENTLY idx_orders_customer ON orders (customer_id);</code>. What happens?',
      options: [
        'It works, just slower than a normal CREATE INDEX',
        'It fails: CREATE INDEX CONCURRENTLY cannot run inside a transaction block',
        'It silently falls back to a normal, write-blocking CREATE INDEX',
        'It creates the index only after the transaction commits',
      ],
      answer: 1,
      why: 'CONCURRENTLY builds the index in several steps, committing in between and waiting for older transactions, so it must control its own transactions. Mark that migration as "no transaction" (most tools have a flag), keep it alone in its file, and check for a leftover INVALID index if it fails.',
    },
    {
      id: 'd36-q3', type: 'quiz',
      prompt: 'You must rename <code>users.fullname</code> to <code>users.display_name</code> with zero downtime, while old and new app versions run side by side during a rolling deploy. Which plan is safe?',
      options: [
        'ALTER TABLE users RENAME COLUMN fullname TO display_name; then deploy',
        'Deploy first, then rename',
        'Add display_name → write to both → backfill → read from display_name → stop using fullname → drop it later',
        'Create a new users table and copy all rows with INSERT … SELECT',
      ],
      answer: 2,
      why: 'Expand/contract: each step is compatible with both the app version before and after it. A rename is instant in Postgres, but whichever app version is running on the other side of the deploy is querying a column that no longer (or doesn\'t yet) exist, so its requests fail.',
    },
  ],
  leetcode: [],
  ownIt: 'Open the last 3 migrations in your project at work. For each statement, write which lock it takes and whether it rewrites or scans the table. Then rewrite any risky one using today\'s recipes (lock_timeout, NOT VALID + VALIDATE, CONCURRENTLY, expand/contract).',
};
