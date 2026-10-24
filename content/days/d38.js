export default {
  day: 38,
  phase: 5,
  title: 'SQL vs NoSQL + mock round #2',
  goal: 'Answer "SQL or NoSQL?" with real trade-offs, then solve four medium interview problems in 15 minutes.',
  learn: `
<p>"Why not just use MongoDB?" comes up in every backend interview. A good answer doesn't pick a side. It names the
<b>access pattern</b> and the <b>guarantees</b> you need.</p>

<h4>The four NoSQL families</h4>
<table class="mini">
<tr><th>Type</th><th>Examples</th><th>Data looks like</th><th>Great for</th></tr>
<tr><td>Document</td><td>MongoDB, Firestore</td><td>JSON documents, nested</td><td>Flexible per-record shape, read whole object at once</td></tr>
<tr><td>Key-value</td><td>Redis, DynamoDB</td><td><code>key → blob</code></td><td>Cache, sessions, counters, rate limits</td></tr>
<tr><td>Wide-column</td><td>Cassandra, ScyllaDB</td><td>Rows partitioned by key, sorted columns</td><td>Huge write volume: events, IoT, time series</td></tr>
<tr><td>Graph</td><td>Neo4j</td><td>Nodes + edges</td><td>Deep relationship walks: "friends of friends who…"</td></tr>
</table>
<p>The price is the same everywhere: you design around <b>known queries</b>. Joins, ad-hoc reports and multi-row
transactions are weak or missing, so you denormalize and keep the copies in sync yourself.</p>

<h4>When Postgres is enough</h4>
<p>Most apps that "need NoSQL" need one flexible column. A <code>jsonb</code> column with a GIN index gives you
document storage <i>next to</i> relational data, with constraints and transactions still working. Add Redis for caching,
and Postgres covers the majority of products. Reach for a specialised store when one access pattern dominates and is
truly huge (millions of writes per second, global multi-region writes, graph traversals 6 levels deep).</p>

<h4>CAP and PACELC in plain words</h4>
<pre><code>CAP:    when the network Partitions, choose Consistency or Availability
PACELC: if Partition → C or A;  Else (normal days) → Latency or Consistency</code></pre>
<p>During a network split, a node either refuses to answer (stays <b>consistent</b>) or answers with maybe-stale
data (stays <b>available</b>). PACELC adds the everyday trade-off: even with no failure, waiting for replicas to confirm
costs latency. A Postgres primary with synchronous replicas chooses C. Cassandra with low consistency levels chooses A/L.</p>

<h4>ACID vs BASE</h4>
<table class="mini">
<tr><th>ACID (Postgres)</th><th>BASE (many NoSQL stores)</th></tr>
<tr><td>Atomic, Consistent, Isolated, Durable</td><td><b>B</b>asically <b>A</b>vailable, <b>S</b>oft state, <b>E</b>ventually consistent</td></tr>
<tr><td>A transfer debits and credits together or not at all</td><td>All replicas agree <i>eventually</i>, reads can be stale meanwhile</td></tr>
<tr><td>Money, inventory, bookings</td><td>Likes, view counts, feeds, logs</td></tr>
</table>
<div class="callout trap"><b>Trap:</b> "NoSQL scales, SQL doesn't" is a myth. Postgres scales with replicas, partitioning
and sharding (Citus). NoSQL scales <i>writes</i> more easily because it gives up joins and cross-row transactions.
That's a trade-off, not a free win.</div>

<h4>Mock round #2 rules</h4>
<p>Start a <b>15-minute timer</b> before the exercises. For each problem: say the output shape out loud (one row per
<i>what</i>?), write the query, check edge cases (zero rows, NULLs, cancelled orders, fan-out). Order value always means
<code>SUM(quantity * unit_price)</code> from <code>order_items</code>, and cancelled orders don't count unless the prompt says so.</p>`,
  example: {
    sql: `-- The pattern behind most "per X including zero" problems:
-- LEFT JOIN, filter the RIGHT table in ON, count a right-side column.
SELECT c.id, c.name, COUNT(o.id) AS december_orders
FROM customers c
LEFT JOIN orders o
  ON o.customer_id = c.id
 AND o.order_date >= '2025-12-01'
GROUP BY c.id, c.name
ORDER BY december_orders DESC, c.id
LIMIT 10;`,
    note: 'Move the date filter into WHERE and watch every zero-order customer disappear. That one change is the whole of LeetCode 1158.',
  },
  exercises: [
    {
      id: 'd38-q1', type: 'quiz',
      prompt: 'You are building a checkout: decrement stock, create the order and its items, and record the payment, all or nothing. Users also want flexible "product attributes" that differ per category. Best fit?',
      options: [
        'MongoDB: attributes vary, so a document store is required',
        'Cassandra for orders, Redis for stock',
        'Postgres with a jsonb attributes column on products',
        'Neo4j, since orders relate to products',
      ],
      answer: 2,
      why: 'The checkout needs a multi-table ACID transaction, and that is Postgres\'s home ground. The flexible part is one column, so <code>jsonb</code> (plus a GIN index if you filter on it) covers it without a second database.',
    },
    {
      id: 'd38-q2', type: 'quiz',
      prompt: 'A social app shows a "likes" counter. During a network split between data centres, the team prefers that users can still like posts, even if counts differ between regions for a few seconds. In CAP terms they chose…',
      options: ['Consistency over availability (CP)', 'Availability over consistency (AP)', 'Both C and A, because a partition never happens', 'Neither, since CAP only applies to SQL'],
      answer: 1,
      why: 'Accepting writes on both sides and merging later means staying <b>available</b> and being <b>eventually consistent</b> (BASE). That\'s fine for likes, but you would never do it for a bank balance.',
    },
    {
      id: 'd38-e1', type: 'query',
      prompt: '<b>Market analysis</b> (LeetCode 1158 style). For <b>every</b> customer show <code>customer_id</code>, <code>signup_date</code> and <code>orders_h2</code> = the number of orders (any status) they placed on or after <code>2025-07-01</code>. Customers with none must show 0.',
      hint: 'LEFT JOIN orders with the date condition <b>in the ON clause</b>, and <code>COUNT(o.id)</code>, not <code>COUNT(*)</code>.',
      solution: `SELECT c.id AS customer_id, c.signup_date, COUNT(o.id) AS orders_h2
FROM customers c
LEFT JOIN orders o
  ON o.customer_id = c.id
 AND o.order_date >= '2025-07-01'
GROUP BY c.id, c.signup_date;`,
      alts: [
        `SELECT c.id, c.signup_date,
       (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.order_date >= '2025-07-01') AS orders_h2
FROM customers c;`,
        `SELECT c.id, c.signup_date, COALESCE(h.n, 0)
FROM customers c
LEFT JOIN (SELECT customer_id, COUNT(*) AS n FROM orders WHERE order_date >= '2025-07-01' GROUP BY customer_id) h
  ON h.customer_id = c.id;`,
      ],
      wrong: [
        { sql: `SELECT c.id, c.signup_date, COUNT(o.id) FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.order_date >= '2025-07-01' GROUP BY c.id, c.signup_date;` },
        { sql: `SELECT c.id, c.signup_date, COUNT(*) FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.order_date >= '2025-07-01'
GROUP BY c.id, c.signup_date;` },
      ],
      why: '28 rows, 11 of them with 0. A filter on the right table in <code>WHERE</code> throws away the NULL rows the LEFT JOIN kept, turning it into an inner join. <code>COUNT(*)</code> counts that NULL row as 1.',
    },
    {
      id: 'd38-e2', type: 'query',
      prompt: '<b>Customer balance</b> (LeetCode 1393 "capital gain/loss" style). For every customer with at least one non-cancelled order, show <code>customer_id</code> and <code>balance</code> = total paid (all their payments) <b>minus</b> the total value of their non-cancelled orders. Negative means they still owe money.',
      hint: 'Turn both sides into one signed list: order values as negative amounts, payments as positive. <code>UNION ALL</code> them, then <code>SUM</code> per customer. Joining payments and order_items in one join multiplies rows.',
      solution: `WITH movements AS (
  SELECT o.customer_id, -SUM(oi.quantity * oi.unit_price) AS amount
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.customer_id
  UNION ALL
  SELECT o.customer_id, SUM(p.amount)
  FROM payments p JOIN orders o ON o.id = p.order_id
  GROUP BY o.customer_id
)
SELECT customer_id, SUM(amount) AS balance
FROM movements
GROUP BY customer_id
HAVING customer_id IN (SELECT customer_id FROM orders WHERE status <> 'cancelled');`,
      alts: [
        `SELECT c.customer_id,
       COALESCE((SELECT SUM(p.amount) FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.customer_id = c.customer_id), 0)
     - (SELECT SUM(oi.quantity * oi.unit_price) FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.customer_id = c.customer_id AND o.status <> 'cancelled') AS balance
FROM (SELECT DISTINCT customer_id FROM orders WHERE status <> 'cancelled') c;`,
        `WITH owed AS (
  SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS v
  FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.status <> 'cancelled' GROUP BY 1),
paid AS (
  SELECT o.customer_id, SUM(p.amount) AS v FROM payments p JOIN orders o ON o.id = p.order_id GROUP BY 1)
SELECT owed.customer_id, COALESCE(paid.v, 0) - owed.v FROM owed LEFT JOIN paid USING (customer_id);`,
      ],
      wrong: [{ sql: `SELECT o.customer_id, COALESCE(SUM(p.amount), 0) - SUM(oi.quantity * oi.unit_price) AS balance
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
LEFT JOIN payments p ON p.order_id = o.id
WHERE o.status <> 'cancelled'
GROUP BY o.customer_id;` }],
      why: 'Most customers come out at exactly 0. Customer 2 owes 1104.78 (pending orders). The single-join version repeats each payment once per order line and each line once per payment, so both sums are inflated. That\'s the fan-out trap. Aggregate each side first, then combine.',
    },
    {
      id: 'd38-e3', type: 'query',
      prompt: '<b>Repeat-purchase rate.</b> Among customers with at least one non-cancelled order, what percentage have <b>two or more</b> non-cancelled orders? Return one column <code>repeat_rate_pct</code>, rounded to 2 decimals.',
      hint: 'First count non-cancelled orders per customer in a CTE, then <code>100.0 * COUNT(*) FILTER (WHERE n &gt;= 2) / COUNT(*)</code>.',
      solution: `WITH per_customer AS (
  SELECT customer_id, COUNT(*) AS n
  FROM orders
  WHERE status <> 'cancelled'
  GROUP BY customer_id
)
SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE n >= 2) / COUNT(*), 2) AS repeat_rate_pct
FROM per_customer;`,
      alts: [`SELECT ROUND(AVG(CASE WHEN n >= 2 THEN 100.0 ELSE 0 END), 2)
FROM (SELECT customer_id, COUNT(*) AS n FROM orders WHERE status <> 'cancelled' GROUP BY customer_id) t;`],
      wrong: [
        { sql: `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE n >= 2) / COUNT(*), 2)
FROM (SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id) t;` },
        { sql: `SELECT ROUND(100 * COUNT(*) FILTER (WHERE n >= 2) / COUNT(*), 2)
FROM (SELECT customer_id, COUNT(*) AS n FROM orders WHERE status <> 'cancelled' GROUP BY customer_id) t;` },
      ],
      why: '20 of 23 customers, which is 86.96%. Forgetting the status filter gives 87.5%. Writing <code>100 *</code> instead of <code>100.0 *</code> uses integer division and returns 86.',
    },
    {
      id: 'd38-e4', type: 'query',
      prompt: '<b>Average order value per month.</b> For non-cancelled orders, show <code>month</code> as text <code>\'YYYY-MM\'</code> and <code>avg_order_value</code> (average of each <b>order\'s</b> total, rounded to 2 decimals). Order by month.',
      hint: 'Two levels: first one row per order with its total, then average those per month. Use <code>to_char(order_date, \'YYYY-MM\')</code>.',
      solution: `WITH order_totals AS (
  SELECT o.id, o.order_date, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.id, o.order_date
)
SELECT to_char(order_date, 'YYYY-MM') AS month, ROUND(AVG(total), 2) AS avg_order_value
FROM order_totals
GROUP BY 1
ORDER BY 1;`,
      ordered: true,
      alts: [`SELECT to_char(o.order_date, 'YYYY-MM'),
       ROUND(SUM(oi.quantity * oi.unit_price) / COUNT(DISTINCT o.id), 2)
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled'
GROUP BY 1 ORDER BY 1;`],
      wrong: [{ sql: `SELECT to_char(o.order_date, 'YYYY-MM'), ROUND(AVG(oi.quantity * oi.unit_price), 2)
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled'
GROUP BY 1 ORDER BY 1;` }],
      why: 'January is 461.82. Averaging straight over the join gives the average <b>line</b> value (230.91), because orders with more lines count more times. Always ask "one row per what?" before calling AVG.',
    },
  ],
  leetcode: [
    { id: 1158, title: 'Market Analysis I', slug: 'market-analysis-i', difficulty: 'Medium' },
    { id: 1393, title: 'Capital Gain/Loss', slug: 'capital-gainloss', difficulty: 'Medium' },
  ],
  ownIt: 'Your lead says "let\'s move to MongoDB, it scales better." Write a 5-sentence reply covering what our app actually needs (transactions? joins? flexible fields?), what jsonb gives you, and the one case where you would agree.',
};
