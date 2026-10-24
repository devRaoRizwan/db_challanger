// Grading helper: the non-primary-key indexes on a table, as "col1, col2" (key columns in order),
// "include cols", and the partial-index predicate. Index names are ignored on purpose.
const indexShape = (table) => `SELECT
  string_agg(a.attname, ', ' ORDER BY k.ord) FILTER (WHERE k.ord <= i.indnkeyatts) AS key_columns,
  COALESCE(string_agg(a.attname, ', ' ORDER BY k.ord) FILTER (WHERE k.ord > i.indnkeyatts), '') AS include_columns,
  pg_get_expr(i.indpred, i.indrelid) AS partial_where
FROM pg_index i
CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
WHERE i.indrelid = '${table}'::regclass AND NOT i.indisprimary
GROUP BY i.indexrelid, i.indpred, i.indrelid;`;

export default {
  day: 29,
  phase: 4,
  title: 'Composite, covering, partial & expression indexes',
  goal: 'Design the right index for a real query: multi-column order, INCLUDE, partial WHERE and expressions.',
  setup: `CREATE TABLE users AS
SELECT g AS id,
       CASE WHEN g % 2 = 0 THEN 'User' || g || '@Example.com' ELSE 'user' || g || '@example.com' END AS email,
       (ARRAY['Lahore','Karachi','Islamabad','Peshawar','Quetta'])[g % 5 + 1] AS city
FROM generate_series(1, 20000) g;
INSERT INTO users VALUES
  (20001, 'USER7@EXAMPLE.COM', 'Lahore'),
  (20002, 'user10@example.com', 'Karachi'),
  (20003, 'User25@example.com', 'Quetta');
ALTER TABLE users ADD PRIMARY KEY (id);
CREATE TABLE shop_orders AS
SELECT g AS id,
       (g * 7919) % 20000 + 1 AS user_id,
       CASE WHEN g % 50 = 0 THEN 'pending' WHEN g % 50 < 5 THEN 'cancelled'
            WHEN g % 50 < 20 THEN 'shipped' ELSE 'delivered' END AS status,
       timestamp '2025-01-01' + g * interval '150 seconds' AS created_at,
       (((g * 37) % 50000) / 100.0 + 5)::numeric(8,2) AS total
FROM generate_series(1, 200000) g;
ALTER TABLE shop_orders ADD PRIMARY KEY (id);`,
  learn: `
<p>This day adds two tables: <code>users</code> (20,003 rows; emails in <i>mixed case</i>, a messy real-world detail) and
<code>shop_orders</code> (200,000 rows: <code>id, user_id, status, created_at, total</code>; only 2% are <code>'pending'</code>).
Yesterday's indexes were on one column. Real endpoints filter on several.</p>

<h4>Composite indexes and the leftmost-prefix rule</h4>
<p>An index on <code>(user_id, created_at)</code> is sorted like a phone book sorted by <b>last name, then first name</b>:</p>
<table class="mini">
<tr><th>user_id</th><th>created_at</th><th>→ row</th></tr>
<tr><td>41</td><td>2025-11-30</td><td>…</td></tr>
<tr><td class="keep">42</td><td class="keep">2025-02-07</td><td>…</td></tr>
<tr><td class="keep">42</td><td class="keep">2025-05-14</td><td>…</td></tr>
<tr><td class="keep">42</td><td class="keep">2025-09-02</td><td>…</td></tr>
<tr><td>43</td><td>2025-01-19</td><td>…</td></tr>
</table>
<p>All of user 42's orders sit together, already sorted by date. So this one index serves:</p>
<ul>
<li><code>WHERE user_id = 42</code> ✓ (leftmost column)</li>
<li><code>WHERE user_id = 42 AND created_at &gt;= '2025-06-01'</code> ✓ (jump to 42, then to June, read forward)</li>
<li><code>WHERE user_id = 42 ORDER BY created_at DESC LIMIT 10</code> ✓ (already in order, no sort)</li>
<li><code>WHERE created_at &gt;= '2025-06-01'</code> ✗: dates are scattered across every user. Like finding all "Ahmed"s in a book sorted by last name.</li>
</ul>
<p><b>Column order rule of thumb:</b> columns tested with <b>=</b> first, then the one used for a <b>range or ORDER BY</b>.
<code>(created_at, user_id)</code> would be much worse for "orders of user 42 since June": the June range comes first and
covers every user.</p>

<h4>Covering indexes (INCLUDE) → Index Only Scan</h4>
<p>A normal index lookup finds the key, then visits the table ("heap") to fetch the other columns. If the index already
holds every column the query needs, Postgres can skip the table entirely:</p>
<pre><code>CREATE INDEX idx_orders_user_total ON shop_orders (user_id) INCLUDE (total);

SELECT SUM(total) FROM shop_orders WHERE user_id = 42;
--  -&gt;  Index Only Scan using idx_orders_user_total on shop_orders
--        Index Cond: (user_id = 42)
--        Heap Fetches: 0</code></pre>
<p><code>INCLUDE</code> columns are stored in the index leaves but aren't part of the sort order, so they keep the index
small and can't be searched on. <code>Heap Fetches</code> counts rows Postgres still had to check in the table (recently
changed pages, until VACUUM marks them all-visible).</p>

<h4>Partial indexes: only the rows you query</h4>
<pre><code>CREATE INDEX idx_orders_pending ON shop_orders (created_at) WHERE status = 'pending';</code></pre>
<p>The worker that processes pending orders only ever asks about 2% of the table. A partial index stores just those
4,000 rows: tiny, fast, and cheap on writes for the other 98%. The query must include the same condition
(<code>WHERE status = 'pending'</code>) for the planner to use it.</p>

<h4>Expression indexes: index what you search by</h4>
<pre><code>SELECT * FROM users WHERE lower(email) = 'user42@example.com';   -- Seq Scan, even with an index on email
CREATE INDEX idx_users_email_lower ON users (lower(email));       -- now it's an index lookup</code></pre>
<p>An index on <code>email</code> stores <code>'User42@Example.com'</code>; it knows nothing about <code>lower(email)</code>.
Index the exact expression the query uses.</p>

<h4>UNIQUE indexes</h4>
<p><code>CREATE UNIQUE INDEX … ON users (lower(email))</code> makes it impossible to sign up as both <code>Ali@x.com</code> and
<code>ali@x.com</code>, something a plain <code>UNIQUE(email)</code> constraint can't do. Creating it fails if duplicates already exist,
so you find and clean them first.</p>

<div class="callout trap"><b>Trap:</b> making one index per column (<code>(user_id)</code>, <code>(status)</code>, <code>(created_at)</code>)
and expecting them to combine like a composite. Postgres can sometimes merge them (BitmapAnd), but it's far slower than
one composite index built for the query, and it still can't return rows pre-sorted.</div>

<div class="callout">In the <b>Playground</b> (changes persist until "Reset DB"), create an index in one run and
<code>EXPLAIN</code> your query in the next. Try <code>(user_id, created_at)</code> vs <code>(created_at, user_id)</code> on the same query.</div>`,
  example: {
    sql: `CREATE INDEX idx_orders_user_created ON shop_orders (user_id, created_at);

EXPLAIN
SELECT * FROM shop_orders
WHERE user_id = 42 AND created_at >= '2025-06-01';`,
    note: 'Look at "Index Cond": both columns are used. Now change the WHERE to only created_at >= \'2025-06-01\' AND created_at < \'2025-06-02\' and run again: Seq Scan, because created_at is not the leftmost column.',
  },
  exercises: [
    {
      id: 'd29-e1', type: 'query',
      prompt: 'The "My orders" page runs <code>SELECT * FROM shop_orders WHERE user_id = $1 AND created_at &gt;= $2 ORDER BY created_at DESC</code>. Create <b>one</b> composite index on <code>shop_orders</code> that serves it best (any name).',
      hint: 'Equality column first, range/sort column second.',
      solution: `CREATE INDEX idx_orders_user_created ON shop_orders (user_id, created_at);`,
      check: indexShape('shop_orders'),
      alts: [`CREATE INDEX ON shop_orders (user_id, created_at DESC);`],
      wrong: [{ sql: `CREATE INDEX ON shop_orders (created_at, user_id);` }, { sql: `CREATE INDEX ON shop_orders (user_id);` }],
      why: 'With <code>(user_id, created_at)</code> Postgres jumps straight to user 42 and reads their orders already in date order: no sort, and the range is part of the Index Cond. With <code>(created_at, user_id)</code>, the range on the first column spans all users, so the index would have to scan a huge slice.',
    },
    {
      id: 'd29-q1', type: 'quiz',
      prompt: 'Given only an index on <code>(user_id, created_at)</code>, which query <b>cannot</b> use it efficiently?',
      options: [
        'WHERE user_id = 42',
        "WHERE user_id = 42 AND created_at >= '2025-06-01'",
        "WHERE created_at >= '2025-06-01' AND created_at < '2025-06-02'",
        'WHERE user_id = 42 ORDER BY created_at DESC LIMIT 5',
      ],
      answer: 2,
      why: `created_at alone skips the leftmost column. The real plan with that index present:
<pre>Seq Scan on shop_orders  (cost=0.00..4664.00 rows=610 width=31)
  Filter: ((created_at &gt;= '2025-06-01 00:00:00'::timestamp) AND (created_at &lt; '2025-06-02 00:00:00'::timestamp))</pre>
That query needs its own index on <code>(created_at)</code>.`,
    },
    {
      id: 'd29-e2', type: 'query',
      prompt: "The background worker runs <code>SELECT * FROM shop_orders WHERE status = 'pending' ORDER BY created_at LIMIT 100</code> every few seconds. Create a <b>partial</b> index on <code>created_at</code> containing only pending orders (any name).",
      hint: "<code>CREATE INDEX … ON shop_orders (created_at) WHERE status = 'pending';</code>",
      solution: `CREATE INDEX idx_orders_pending ON shop_orders (created_at) WHERE status = 'pending';`,
      check: indexShape('shop_orders'),
      alts: [`create index on shop_orders(created_at) where status='pending';`],
      wrong: [{ sql: `CREATE INDEX ON shop_orders (status, created_at);` }, { sql: `CREATE INDEX ON shop_orders (created_at);` }],
      why: '4,000 rows instead of 200,000 in the index, and inserts of shipped/delivered orders never touch it. <code>(status, created_at)</code> would also work for this query, but it indexes all 200k rows to serve 2% of them.',
    },
    {
      id: 'd29-e3', type: 'query',
      prompt: 'The account page shows <code>SELECT SUM(total) FROM shop_orders WHERE user_id = $1</code>. Create a <b>covering</b> index: key column <code>user_id</code>, with <code>total</code> added via <code>INCLUDE</code> (any name).',
      hint: '<code>CREATE INDEX … ON shop_orders (user_id) INCLUDE (total);</code>',
      solution: `CREATE INDEX idx_orders_user_total ON shop_orders (user_id) INCLUDE (total);`,
      check: indexShape('shop_orders'),
      wrong: [{ sql: `CREATE INDEX ON shop_orders (user_id);` }, { sql: `CREATE INDEX ON shop_orders (total) INCLUDE (user_id);` }],
      why: 'Everything the query touches (<code>user_id</code> to search, <code>total</code> to sum) lives in the index, so Postgres can do an Index Only Scan and never read the table. <code>(user_id, total)</code> as two key columns would also cover it; INCLUDE just keeps <code>total</code> out of the sort order.',
    },
    {
      id: 'd29-q2', type: 'quiz',
      prompt: `What does this plan tell you?
<pre>Aggregate  (cost=8.62..8.63 rows=1 width=32) (actual time=0.412..0.415 rows=1.00 loops=1)
  -&gt;  Index Only Scan using idx_orders_user_total on shop_orders  (cost=0.42..8.59 rows=10 width=6) (actual time=0.160..0.170 rows=10.00 loops=1)
        Index Cond: (user_id = 42)
        Heap Fetches: 0</pre>`,
      options: [
        'The query read the 10 rows from the table after finding them in the index',
        'All needed columns came from the index; the table was not read at all (Heap Fetches: 0)',
        'The index is broken because it fetched 0 rows from the heap',
        'Postgres scanned the whole index',
      ],
      answer: 1,
      why: '"Index Only Scan" + "Heap Fetches: 0" is the best case: the answer came entirely from the index. If Heap Fetches is high, the visibility map is stale (VACUUM hasn\'t run since many changes) and the "index only" scan is checking the table anyway.',
    },
    {
      id: 'd29-e4', type: 'query',
      prompt: 'You want a UNIQUE index on <code>lower(email)</code>, but first check for case-insensitive duplicates. Return each <code>lower(email)</code> that appears more than once, with its count.',
      hint: '<code>GROUP BY lower(email) HAVING COUNT(*) &gt; 1</code>',
      solution: `SELECT lower(email), COUNT(*)
FROM users
GROUP BY lower(email)
HAVING COUNT(*) > 1;`,
      wrong: [{ sql: `SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1;`, }],
      why: 'Three duplicates (users 7, 10 and 25 signed up again with different casing). Grouping by <code>email</code> finds nothing because the strings differ, which is exactly how these duplicates slipped in.',
    },
    {
      id: 'd29-e5', type: 'query',
      prompt: 'Clean up and lock it down, in one run: <b>delete the newer duplicate</b> of each pair (the higher <code>id</code>), then create a <b>UNIQUE expression index</b> on <code>users (lower(email))</code> (any name).',
      hint: 'Delete with a self-join: <code>DELETE FROM users u USING users d WHERE lower(u.email) = lower(d.email) AND u.id &gt; d.id;</code> then <code>CREATE UNIQUE INDEX … ON users (lower(email));</code>. Without the DELETE you\'ll see "could not create unique index".',
      solution: `DELETE FROM users u
USING users d
WHERE lower(u.email) = lower(d.email) AND u.id > d.id;

CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));`,
      check: `SELECT (SELECT COUNT(*) FROM users) AS users_left, i.indisunique, pg_get_expr(i.indexprs, i.indrelid) AS expr
FROM pg_index i
WHERE i.indrelid = 'users'::regclass AND NOT i.indisprimary;`,
      alts: [`DELETE FROM users WHERE id IN (20001, 20002, 20003);
CREATE UNIQUE INDEX ON users (lower(email));`],
      wrong: [
        { sql: `DELETE FROM users u USING users d WHERE lower(u.email) = lower(d.email) AND u.id > d.id;
CREATE UNIQUE INDEX ON users (email);` },
        { sql: `DELETE FROM users u USING users d WHERE lower(u.email) = lower(d.email) AND u.id > d.id;
CREATE INDEX ON users (lower(email));` },
      ],
      why: 'Now <code>WHERE lower(email) = $1</code> (the login query) is an index lookup, and the database itself refuses a second account with the same email in any casing. A UNIQUE index on plain <code>email</code> would happily accept <code>Ali@x.com</code> next to <code>ali@x.com</code>.',
    },
  ],
  leetcode: [],
  ownIt: 'A teammate added three single-column indexes on shop_orders (user_id), (status), (created_at) "to make everything fast". Write the review comment: which index would you replace them with for the "My orders" page and the pending-orders worker, and why does column order matter?',
};
