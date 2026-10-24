export default {
  day: 30,
  phase: 4,
  title: 'EXPLAIN ANALYZE & join algorithms',
  goal: 'Read a real EXPLAIN ANALYZE plan: spot bad estimates, find where the time goes, and know why Postgres picked that join.',
  setup: `CREATE TABLE users AS
SELECT g AS id, 'user' || g || '@example.com' AS email,
       (ARRAY['Lahore','Karachi','Islamabad','Peshawar','Quetta'])[(g * 31 % 97) % 5 + 1] AS city
FROM generate_series(1, 20000) g;
ALTER TABLE users ADD PRIMARY KEY (id);
CREATE TABLE shop_orders AS
SELECT g AS id,
       (g * 7919) % 20000 + 1 AS user_id,
       CASE WHEN g % 50 = 0 THEN 'pending' WHEN g % 50 < 5 THEN 'cancelled'
            WHEN g % 50 < 20 THEN 'shipped' ELSE 'delivered' END AS status,
       timestamp '2025-01-01' + g * interval '150 seconds' AS created_at,
       (((g * 37) % 50000) / 100.0 + 5)::numeric(8,2) AS total
FROM generate_series(1, 200000) g;
ALTER TABLE shop_orders ADD PRIMARY KEY (id);
CREATE INDEX idx_orders_user_id ON shop_orders (user_id);`,
  learn: `
<p>Tables today: <code>users</code> (20,000 rows: <code>id, email, city</code>) and <code>shop_orders</code>
(200,000 rows: <code>id, user_id, status, created_at, total</code>) with an index on <code>shop_orders(user_id)</code>.</p>

<p><code>EXPLAIN</code> shows the plan Postgres <i>intends</i> to use. <code>EXPLAIN ANALYZE</code> <b>runs the query</b> and puts
the reality next to each guess. Most slow-query investigations are just reading that comparison.</p>

<h4>Anatomy of one node</h4>
<pre><code>-&gt;  Seq Scan on shop_orders o  (cost=0.00..4164.00 rows=4133 width=4)
                               (actual time=0.058..23.415 rows=4000.00 loops=1)
      Filter: (status = 'pending'::text)
      Rows Removed by Filter: 196000
      Buffers: shared hit=1664</code></pre>
<ul>
<li><b>rows=4133</b> (estimate) vs <b>rows=4000</b> (actual): close, so the planner's picture of the data is right. A gap of 10× or more is a red flag: the plan was chosen for a different table than the one you have.</li>
<li><b>actual time=0.058..23.415</b>: ms until the first row .. until the last row. It <b>includes the children</b>, so a parent's time is never less than its slowest child.</li>
<li><b>loops</b>: how many times this node ran. Times and rows are <b>per loop</b>: multiply by loops for the total.</li>
<li><b>Buffers</b> (shown with <code>EXPLAIN (ANALYZE, BUFFERS)</code>, on by default in Postgres 18): 8 kB pages touched. <i>hit</i> = from memory, <i>read</i> = from disk. Fewer pages is the real goal; time is just the symptom.</li>
</ul>

<h4>The three join algorithms</h4>
<table class="mini">
<tr><th>Join</th><th>How it works</th><th>Chosen when</th></tr>
<tr><td>Nested Loop</td><td>For each outer row, look up matches in the inner side (ideally via an index)</td><td>The outer side is <b>small</b> (a few rows) and the inner side has an index on the join key</td></tr>
<tr><td>Hash Join</td><td>Build a hash table from the smaller side, then stream the bigger side through it</td><td>Both sides are large-ish, equality join, no useful order. The workhorse for reports.</td></tr>
<tr><td>Merge Join</td><td>Walk two inputs <b>sorted on the join key</b> side by side, like a zipper</td><td>Both sides are already sorted (e.g. both read via an index on the key), or are big and need sorting anyway</td></tr>
</table>
<pre><code>Nested Loop  (actual time=0.090..0.109 rows=10.00 loops=1)
  -&gt;  Index Only Scan using users_pkey on users u   (rows=1.00 loops=1)     ← 1 outer row
  -&gt;  Bitmap Heap Scan on shop_orders o              (rows=10.00 loops=1)    ← 1 lookup
        -&gt;  Bitmap Index Scan on idx_orders_user_id</code></pre>
<p>Nested Loop is perfect for "one user and their orders". The same algorithm with 20,000 outer rows means 20,000 index lookups.
That's the classic slow plan caused by a <b>bad row estimate</b>: the planner expected 5 rows, got 20,000, and
picked Nested Loop.</p>

<h4>Sorts that spill to disk</h4>
<pre><code>Sort  (actual time=735.382..839.022 rows=200000.00 loops=1)
  Sort Key: total DESC
  Sort Method: external merge  Disk: 9168kB</code></pre>
<p>"external merge" means the sort didn't fit in <code>work_mem</code> and used temp files. Fixes: return fewer rows
(add a <code>LIMIT</code> or a tighter <code>WHERE</code>), provide the order from an index, or raise <code>work_mem</code> for that query.
"quicksort Memory: 25kB" is the happy version.</p>

<h4>Where estimates come from: statistics</h4>
<p>The planner doesn't count rows before planning. It reads <b>statistics</b> collected by <code>ANALYZE</code> (from a random sample): row count,
distinct values, most common values and their frequencies. You can look at them yourself in <code>pg_stats</code>.
After a big data change (bulk import, backfill, a new status value), stats are <b>stale</b> until ANALYZE runs again.
Autovacuum does it eventually, but after a big load in a migration or script you should run <code>ANALYZE table_name;</code> yourself.</p>

<div class="callout trap"><b>Trap:</b> <code>EXPLAIN ANALYZE DELETE FROM …</code> really deletes. When you need to analyze a write, wrap it:
<code>BEGIN; EXPLAIN ANALYZE UPDATE …; ROLLBACK;</code></div>

<div class="callout">Paste plans into a visualizer like <i>explain.dalibo.com</i> at work. Here, use the <b>Playground</b>: run the example query with and without
<code>WHERE u.id = 42</code> and watch the join type flip.</div>`,
  example: {
    sql: `EXPLAIN ANALYZE
SELECT u.city, COUNT(*)
FROM users u
JOIN shop_orders o ON o.user_id = u.id
WHERE o.status = 'pending'
GROUP BY u.city;`,
    note: 'Hash Join: users is hashed (the "Hash" node), and the 4,000 pending orders stream through it. Now replace the WHERE with WHERE u.id = 42 and run again: Nested Loop, one index lookup. Same tables, different plan, because the row counts changed.',
  },
  exercises: [
    {
      id: 'd30-e1', type: 'query',
      prompt: 'For the ops dashboard: number of <b>pending</b> orders per user <code>city</code>. Return <code>city</code> and the count. Then run it with <code>EXPLAIN ANALYZE</code> in front (in the Playground) and find the Hash Join.',
      hint: "<code>JOIN shop_orders o ON o.user_id = u.id WHERE o.status = 'pending' GROUP BY u.city</code>",
      solution: `SELECT u.city, COUNT(*)
FROM users u
JOIN shop_orders o ON o.user_id = u.id
WHERE o.status = 'pending'
GROUP BY u.city;`,
      alts: [`SELECT u.city, COUNT(o.id) FROM shop_orders o JOIN users u ON u.id = o.user_id AND o.status = 'pending' GROUP BY 1;`],
      wrong: [{ sql: `SELECT u.city, COUNT(*) FROM users u JOIN shop_orders o ON o.user_id = u.id GROUP BY u.city;` }],
      why: 'About 800 per city. 4,000 pending orders against 20,000 users is "many to many-ish", so Postgres hashes one side once instead of doing 4,000 separate index lookups.',
    },
    {
      id: 'd30-q1', type: 'quiz',
      prompt: `The query from the example takes 51 ms. Where does most of the time go?
<pre>HashAggregate  (actual time=50.919..50.923 rows=5.00 loops=1)
  -&gt;  Hash Join  (actual time=21.578..48.788 rows=4000.00 loops=1)
        Hash Cond: (o.user_id = u.id)
        -&gt;  Seq Scan on shop_orders o  (actual time=0.058..23.415 rows=4000.00 loops=1)
              Filter: (status = 'pending'::text)
              Rows Removed by Filter: 196000
        -&gt;  Hash  (actual time=21.444..21.446 rows=20000.00 loops=1)
              -&gt;  Seq Scan on users u  (actual time=0.045..9.945 rows=20000.00 loops=1)</pre>`,
      options: [
        'In HashAggregate: 50.9 ms of its own work',
        'Roughly half scanning 200k orders to find 4,000 pending ones, half building the hash of all 20,000 users',
        'In the Hash Join itself, because 48.8 ms is the biggest child number',
        'Nowhere in particular; actual times are estimates',
      ],
      answer: 1,
      why: 'Times include children. HashAggregate (50.9) contains Hash Join (48.8), which contains the orders scan (23.4) and the Hash build (21.4). Subtracting children leaves the scans as the real cost. A partial index on pending orders would shrink the first half; reading 20k users is the price of hashing them.',
    },
    {
      id: 'd30-q2', type: 'quiz',
      prompt: `How many rows did the Bitmap Heap Scan produce <b>in total</b>?
<pre>Nested Loop  (actual time=0.563..1.101 rows=50.00 loops=1)
  -&gt;  Index Only Scan using users_pkey on users u  (actual time=0.251..0.268 rows=5.00 loops=1)
        Index Cond: ((id &gt;= 100) AND (id &lt;= 104))
  -&gt;  Bitmap Heap Scan on shop_orders o  (actual time=0.065..0.101 rows=10.00 loops=5)
        Recheck Cond: (u.id = user_id)</pre>`,
      options: ['10', '5', '50', '15'],
      answer: 2,
      why: 'rows=10 is <b>per loop</b>, and it ran loops=5 times (once per outer user): 10 × 5 = 50, which matches the Nested Loop\'s output. The same goes for time: 0.101 ms × 5. Forgetting to multiply by loops is how people miss the real cost of a Nested Loop.',
    },
    {
      id: 'd30-e2', type: 'query',
      prompt: "See what the planner knows. From <code>pg_stats</code>, return <code>n_distinct</code> and <code>most_common_vals</code> for <code>tablename = 'shop_orders'</code> and <code>attname = 'status'</code>.",
      hint: "<code>SELECT n_distinct, most_common_vals FROM pg_stats WHERE tablename = … AND attname = …;</code>",
      solution: `SELECT n_distinct, most_common_vals
FROM pg_stats
WHERE tablename = 'shop_orders' AND attname = 'status';`,
      alts: [`SELECT n_distinct, most_common_vals::text FROM pg_stats WHERE tablename = 'shop_orders' AND attname = 'status';`],
      why: '4 distinct values, most common first. Postgres also stores <code>most_common_freqs</code> (try adding it): that\'s how it estimated rows=4133 for <code>status = \'pending\'</code> without counting: 2% × 200,000 ≈ 4,000. These numbers come from a random sample, so they can differ slightly every ANALYZE.',
    },
    {
      id: 'd30-q3', type: 'quiz',
      prompt: `A migration just bulk-inserted 50,000 orders with a new status <code>'refunded'</code>. Then:
<pre>EXPLAIN ANALYZE SELECT * FROM shop_orders WHERE status = 'refunded';

Seq Scan on shop_orders  (cost=0.00..5205.00 rows=1 width=31) (actual time=30.318..63.592 rows=50000.00 loops=1)
  Filter: (status = 'refunded'::text)
  Rows Removed by Filter: 200000</pre>
What's the problem and the fix?`,
      options: [
        'The table needs an index on status',
        'Statistics are stale: the planner has never seen \'refunded\' so it guesses 1 row. Run ANALYZE shop_orders',
        'The query should use LIMIT',
        'Nothing; rows=1 means one page was read',
      ],
      answer: 1,
      why: 'Estimate 1, actual 50,000: a 50,000× miss. This query happens to be fine as a Seq Scan, but if it joined another table, a "1 row" estimate would make the planner choose a Nested Loop that runs 50,000 times. After ANALYZE the estimate becomes rows=50725. Always ANALYZE after bulk loads.',
    },
    {
      id: 'd30-e3', type: 'query',
      prompt: `Reproduce it and fix it in one run: insert the refunded orders, then refresh the table's statistics.
<pre>INSERT INTO shop_orders (id, user_id, status, created_at, total)
SELECT 200000 + g, 777, 'refunded', timestamp '2025-12-20' + g * interval '1 second', 10
FROM generate_series(1, 50000) g;</pre>
The checker then reads <code>pg_class.reltuples</code> (the planner's row count) and <code>n_distinct</code> for status.`,
      hint: 'After the INSERT, run <code>ANALYZE shop_orders;</code>. (ANALYZE is allowed inside a transaction; VACUUM is not.)',
      solution: `INSERT INTO shop_orders (id, user_id, status, created_at, total)
SELECT 200000 + g, 777, 'refunded', timestamp '2025-12-20' + g * interval '1 second', 10
FROM generate_series(1, 50000) g;
ANALYZE shop_orders;`,
      check: `SELECT c.reltuples >= 240000 AS planner_sees_new_rows, s.n_distinct
FROM pg_class c
JOIN pg_stats s ON s.tablename = c.relname AND s.attname = 'status'
WHERE c.relname = 'shop_orders';`,
      alts: [`INSERT INTO shop_orders (id, user_id, status, created_at, total)
SELECT 200000 + g, 777, 'refunded', timestamp '2025-12-20' + g * interval '1 second', 10
FROM generate_series(1, 50000) g;
ANALYZE;`],
      wrong: [{ sql: `INSERT INTO shop_orders (id, user_id, status, created_at, total)
SELECT 200000 + g, 777, 'refunded', timestamp '2025-12-20' + g * interval '1 second', 10
FROM generate_series(1, 50000) g;` }],
      why: 'Without ANALYZE the planner still believes there are 200,000 rows and 4 statuses. Add <code>EXPLAIN SELECT * FROM shop_orders WHERE status = \'refunded\';</code> at the end of your run, with and without the ANALYZE line, and watch rows=1 become rows≈50000.',
    },
    {
      id: 'd30-q4', type: 'quiz',
      prompt: `An export endpoint is slow. Its plan contains:
<pre>Sort  (actual time=735.382..839.022 rows=200000.00 loops=1)
  Sort Key: total DESC
  Sort Method: external merge  Disk: 9168kB
  -&gt;  Seq Scan on shop_orders  (actual time=0.011..68.791 rows=200000.00 loops=1)</pre>
Which fix addresses what this node is telling you?`,
      options: [
        'Add an index on status',
        'Switch to a Hash Join',
        'The sort spilled to disk: sort fewer rows (paginate / LIMIT), let an index on total provide the order, or raise work_mem for this query',
        'Run ANALYZE; the estimate is wrong',
      ],
      answer: 2,
      why: 'The scan took 69 ms; the sort took the other ~770 ms and wrote 9 MB of temp files. With <code>ORDER BY total DESC LIMIT 50</code> and an index on <code>total</code>, Postgres reads 50 index entries and never sorts at all.',
    },
  ],
  leetcode: [],
  ownIt: 'Pick a slow endpoint at work (or the example above). Write the "plan review" you\'d post in the PR: which node costs the most, whether the estimates match reality, which join algorithm was chosen and why, and the one change you\'d make.',
};
