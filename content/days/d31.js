export default {
  day: 31,
  phase: 4,
  title: 'Writing fast queries (sargability & friends)',
  goal: 'Spot the query patterns that silently disable indexes and rewrite them so the same answer comes back fast.',
  setup: `CREATE TABLE users AS
SELECT g AS id, 'user' || g || '@example.com' AS email,
       (ARRAY['Lahore','Karachi','Islamabad','Peshawar','Quetta'])[(g * 31 % 97) % 5 + 1] AS city
FROM generate_series(1, 20000) g;
INSERT INTO users VALUES (20001, 'nadia@example.com', 'Lahore'), (20002, 'omar@example.com', 'Karachi'), (20003, 'zoya@example.com', 'Quetta');
ALTER TABLE users ADD PRIMARY KEY (id);
ALTER TABLE users ADD CONSTRAINT email_is_lowercase CHECK (email = lower(email));
CREATE UNIQUE INDEX idx_users_email ON users (email);
CREATE TABLE shop_orders AS
SELECT g AS id,
       (g * 7919) % 20000 + 1 AS user_id,
       CASE WHEN g % 50 = 0 THEN 'pending' WHEN g % 50 < 5 THEN 'cancelled'
            WHEN g % 50 < 20 THEN 'shipped' ELSE 'delivered' END AS status,
       timestamp '2025-01-01' + g * interval '150 seconds' AS created_at,
       (((g * 37) % 50000) / 100.0 + 5)::numeric(8,2) AS total
FROM generate_series(1, 200000) g;
INSERT INTO shop_orders VALUES (200001, NULL, 'delivered', '2025-12-14 12:00', 49.99);
ALTER TABLE shop_orders ADD PRIMARY KEY (id);
CREATE INDEX idx_orders_user_id ON shop_orders (user_id);
CREATE INDEX idx_orders_created_at ON shop_orders (created_at);`,
  learn: `
<p>Tables today: <code>users</code> (20,003 rows, emails stored <b>lowercase</b>, enforced by a CHECK, unique index on <code>email</code>)
and <code>shop_orders</code> (200,001 rows; one guest order has <code>user_id NULL</code>) with indexes on
<code>user_id</code> and <code>created_at</code>. The indexes exist. The question is whether your query lets Postgres use them.</p>

<h4>Sargability: leave the column alone</h4>
<p>A condition is <b>sargable</b> (Search ARGument ABLE) when the indexed column stands <b>bare</b> on one side.
The index stores <code>created_at</code> values, sorted. It doesn't store <code>date_trunc('day', created_at)</code>, so this
has to compute the function for all 200,000 rows:</p>
<table class="mini">
<tr><th>Index-killer</th><th>Index-friendly rewrite</th></tr>
<tr><td class="drop"><code>date_trunc('day', created_at) = '2025-03-10'</code></td><td class="keep"><code>created_at &gt;= '2025-03-10' AND created_at &lt; '2025-03-11'</code></td></tr>
<tr><td class="drop"><code>created_at::date = '2025-03-10'</code></td><td class="keep">same range as above</td></tr>
<tr><td class="drop"><code>EXTRACT(YEAR FROM created_at) = 2025</code></td><td class="keep"><code>created_at &gt;= '2025-01-01' AND created_at &lt; '2026-01-01'</code></td></tr>
<tr><td class="drop"><code>total * 1.17 &gt; 1000</code></td><td class="keep"><code>total &gt; 1000 / 1.17</code></td></tr>
<tr><td class="drop"><code>created_at + interval '7 days' &gt; now()</code></td><td class="keep"><code>created_at &gt; now() - interval '7 days'</code></td></tr>
<tr><td class="drop"><code>lower(email) = $1</code> (no expression index)</td><td class="keep"><code>email = lower($1)</code> when emails are stored lowercase</td></tr>
</table>
<p>Move the math to the <b>constant</b> side; constants are computed once. Use half-open ranges (<code>&gt;=</code> start,
<code>&lt;</code> next start): <code>BETWEEN '2025-03-10' AND '2025-03-11'</code> also includes orders at exactly midnight on the 11th.</p>

<h4>Casts count too</h4>
<p><code>WHERE user_id::text = '42'</code> (common in hand-built ORM filters) casts every row's column → Seq Scan.
Cast the <i>parameter</i> instead: <code>WHERE user_id = 42</code>. Comparing a column with a parameter of a different type can cause the same
problem (e.g. a <code>numeric</code> parameter against a <code>bigint</code> column), so make your driver send the column's type.</p>

<h4>LIKE</h4>
<p><code>email LIKE 'user12%'</code> is a range (<code>'user12' ≤ email &lt; 'user13'</code>), so a B-tree helps. <code>LIKE '%12@example.com'</code>
has a leading wildcard: no starting point, full scan. (For "contains" search use a trigram or full-text index, not a B-tree.)
Note: B-tree prefix search needs the "C" collation or a <code>text_pattern_ops</code> index; it works here.</p>

<h4>OR across tables → UNION</h4>
<pre><code>-- One condition per table, joined by OR: neither index can be used, Hash Join over everything
WHERE u.email = 'user42@example.com' OR o.id = 777
-- Two cheap indexed queries, glued together
SELECT … WHERE u.email = 'user42@example.com'
UNION
SELECT … WHERE o.id = 777</code></pre>
<p>(OR on two columns of the <i>same</i> table is often fine: Postgres can combine two indexes with a BitmapOr.)</p>

<h4>EXISTS vs IN vs JOIN</h4>
<p><code>EXISTS</code> and <code>IN (subquery)</code> usually get the same plan (a semi-join) in modern Postgres. <code>JOIN</code> is different: it can
<b>duplicate</b> rows (a user with 10 orders appears 10 times), and people then add <code>DISTINCT</code>, which costs a sort.
For "rows that have NO match", prefer <code>NOT EXISTS</code>: <code>NOT IN</code> returns nothing at all if the subquery contains a NULL,
and it can't become an efficient anti-join.</p>

<h4>Three more habits</h4>
<ul>
<li><b>SELECT *</b> drags every column over the network, defeats index-only scans, and breaks when columns are added. Name what you need.</li>
<li><b>COUNT(*)</b> on a huge table must visit every row (MVCC means there's no stored total). For a dashboard estimate, <code>SELECT reltuples FROM pg_class WHERE relname = 'shop_orders'</code> is instant.</li>
<li><b>ORDER BY … LIMIT</b> is only cheap if an index provides that order. <code>ORDER BY created_at DESC LIMIT 5</code> reads 5 index entries. <code>ORDER BY total DESC LIMIT 5</code> (no index on total) scans and sorts all 200k rows to return 5.</li>
</ul>

<div class="callout trap"><b>Trap:</b> "It's fast on my machine." With 100 rows in dev, every query is a Seq Scan and every query is fast.
Sargability problems only show up at production volume, so check plans against realistic data (like today's 200k rows).</div>`,
  example: {
    sql: `EXPLAIN ANALYZE
SELECT id, total
FROM shop_orders
WHERE date_trunc('day', created_at) = '2025-03-10';`,
    note: "Seq Scan, ~200k rows checked. Now replace the WHERE with: created_at >= '2025-03-10' AND created_at < '2025-03-11' and run again: Index Scan using idx_orders_created_at, same rows, a fraction of the time.",
  },
  exercises: [
    {
      id: 'd31-e1', type: 'query',
      prompt: `Rewrite this so it can use <code>idx_orders_created_at</code>. It must return exactly the same rows.
<pre>SELECT id, total FROM shop_orders
WHERE date_trunc('day', created_at) = '2025-03-10';</pre>`,
      hint: 'A half-open range: <code>&gt;=</code> the day, <code>&lt;</code> the next day.',
      solution: `SELECT id, total FROM shop_orders
WHERE created_at >= '2025-03-10' AND created_at < '2025-03-11';`,
      alts: [`SELECT id, total FROM shop_orders WHERE created_at >= date '2025-03-10' AND created_at < date '2025-03-10' + 1;`],
      wrong: [{ sql: `SELECT id, total FROM shop_orders WHERE created_at BETWEEN '2025-03-10' AND '2025-03-11';` }],
      why: 'Orders are placed every 150 seconds, so one lands at exactly 2025-03-11 00:00:00. <code>BETWEEN</code> includes it (577 rows instead of 576). <code>&lt;</code> the next day is the bulletproof pattern for date ranges.',
    },
    {
      id: 'd31-q1', type: 'quiz',
      prompt: 'Which <code>WHERE</code> clause can use a B-tree index on <code>shop_orders(created_at)</code>?',
      options: [
        "WHERE created_at::date = '2025-03-10'",
        'WHERE EXTRACT(MONTH FROM created_at) = 3',
        "WHERE created_at >= now() - interval '30 days'",
        "WHERE to_char(created_at, 'YYYY-MM') = '2025-03'",
      ],
      answer: 2,
      why: 'Only option 3 leaves <code>created_at</code> bare; <code>now() - interval \'30 days\'</code> is computed once and becomes the start of an index range. The others transform the column on every row.',
    },
    {
      id: 'd31-e2', type: 'query',
      prompt: `The "last 7 days" report runs this. Rewrite it so the arithmetic is on the constant side (same result: count and sum).
<pre>SELECT COUNT(*), SUM(total) FROM shop_orders
WHERE created_at + interval '7 days' &gt; timestamp '2025-12-14';</pre>`,
      hint: "Move <code>interval '7 days'</code> across: <code>created_at &gt; timestamp '2025-12-14' - interval '7 days'</code>. Keep it strictly greater.",
      solution: `SELECT COUNT(*), SUM(total) FROM shop_orders
WHERE created_at > timestamp '2025-12-14' - interval '7 days';`,
      alts: [`SELECT COUNT(*), SUM(total) FROM shop_orders WHERE created_at > '2025-12-07';`],
      wrong: [{ sql: `SELECT COUNT(*), SUM(total) FROM shop_orders WHERE created_at >= '2025-12-07';` }],
      why: 'Same math, but now Postgres computes <code>2025-12-07 00:00</code> once and walks the index from there. Changing <code>&gt;</code> to <code>&gt;=</code> while rewriting picks up the order at exactly midnight: rewrites must keep the exact boundaries.',
    },
    {
      id: 'd31-e3', type: 'query',
      prompt: `The admin search box runs this. Emails are guaranteed lowercase (see the CHECK constraint) and the search is really "starts with". Rewrite it to use <code>idx_users_email</code>, returning the same rows.
<pre>SELECT id, email FROM users
WHERE lower(email) LIKE '%user1234%';</pre>`,
      hint: 'Drop <code>lower()</code> (it does nothing here) and the leading <code>%</code>.',
      solution: `SELECT id, email FROM users WHERE email LIKE 'user1234%';`,
      alts: [`SELECT id, email FROM users WHERE email >= 'user1234' AND email < 'user1235';`],
      wrong: [{ sql: `SELECT id, email FROM users WHERE email = 'user1234@example.com';` }],
      why: '11 rows (user1234, user12340–user12349). Every email starts with "user…", so the anchored pattern is equivalent here and becomes an index range <code>email &gt;= \'user1234\' AND email &lt; \'user1235\'</code>. In a real app, enforce lowercase on write (as this schema does) so reads never need <code>lower()</code>.',
    },
    {
      id: 'd31-e4', type: 'query',
      prompt: `Support's lookup tool: "orders of this customer email, or this order number". The OR spans two tables, so Postgres hash-joins all 200k orders. Rewrite with <code>UNION</code> (same rows: <code>id, total</code>).
<pre>SELECT o.id, o.total
FROM shop_orders o JOIN users u ON u.id = o.user_id
WHERE u.email = 'user42@example.com' OR o.id = 777;</pre>`,
      hint: 'First half: the join filtered by email. Second half: <code>SELECT id, total FROM shop_orders WHERE id = 777</code>. <code>UNION</code> (not UNION ALL) removes overlap, just like OR would.',
      solution: `SELECT o.id, o.total
FROM shop_orders o JOIN users u ON u.id = o.user_id
WHERE u.email = 'user42@example.com'
UNION
SELECT id, total FROM shop_orders WHERE id = 777;`,
      wrong: [{ sql: `SELECT o.id, o.total FROM shop_orders o JOIN users u ON u.id = o.user_id WHERE u.email = 'user42@example.com';` }],
      why: `Each half now uses an index: email → users (1 row) → Nested Loop into idx_orders_user_id (10 rows), and the primary key for order 777. The real plan:
<pre>Unique
  -&gt;  Sort
        -&gt;  Append
              -&gt;  Nested Loop
                    -&gt;  Index Scan using idx_users_email on users u
                    -&gt;  Bitmap Heap Scan on shop_orders o   (Index Cond: user_id = u.id)
              -&gt;  Index Only Scan using shop_orders_pkey on shop_orders o_1</pre>`,
    },
    {
      id: 'd31-e5', type: 'query',
      prompt: `Marketing wants users who have <b>never</b> ordered (<code>id, email</code>). The current query returns nothing, and slowly. Fix it.
<pre>SELECT id, email FROM users
WHERE id NOT IN (SELECT user_id FROM shop_orders);</pre>`,
      hint: '<code>WHERE NOT EXISTS (SELECT 1 FROM shop_orders o WHERE o.user_id = u.id)</code>. Remember the guest order with <code>user_id NULL</code>.',
      solution: `SELECT u.id, u.email FROM users u
WHERE NOT EXISTS (SELECT 1 FROM shop_orders o WHERE o.user_id = u.id);`,
      alts: [`SELECT u.id, u.email FROM users u LEFT JOIN shop_orders o ON o.user_id = u.id WHERE o.id IS NULL;`,
        `SELECT id, email FROM users WHERE id NOT IN (SELECT user_id FROM shop_orders WHERE user_id IS NOT NULL);`],
      wrong: [{ sql: `SELECT id, email FROM users WHERE id NOT IN (SELECT user_id FROM shop_orders);` }],
      why: 'The guest order\'s <code>NULL</code> makes <code>id NOT IN (…, NULL)</code> UNKNOWN for every user, so NOT IN returns 0 rows (the Day 9 trap, now at scale). NOT EXISTS becomes a <b>Hash Anti Join</b> and finds the 3 new users (Nadia, Omar, Zoya).',
    },
    {
      id: 'd31-q2', type: 'quiz',
      prompt: `An ORM filter produced this plan. There IS an index on <code>user_id</code>. What happened?
<pre>Seq Scan on shop_orders  (cost=0.00..5164.02 rows=1000 width=31)
  Filter: ((user_id)::text = '42'::text)</pre>`,
      options: [
        'The index is corrupt',
        'The column was cast to text on every row, so the integer index on user_id can\'t be used. Compare with an integer: user_id = 42',
        'user_id = 42 is not selective enough',
        'The planner needs ANALYZE',
      ],
      answer: 1,
      why: '<code>(user_id)::text</code> in the Filter line is the giveaway: the column is wrapped. Also note rows=1000: with a wrapped column the planner can\'t use its statistics either, so it falls back to a default guess (0.5% of rows) instead of the accurate 10.',
    },
  ],
  leetcode: [],
  ownIt: 'Find (or imagine) a report query at work that filters with date_trunc, ::date, EXTRACT or lower(). Write the before/after you would put in the PR, plus one sentence your team will remember: "keep the column bare, move the work to the constant."',
};
