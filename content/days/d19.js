export default {
  day: 19,
  phase: 2,
  title: 'Pivoting, string_agg, gaps & islands',
  goal: 'Turn rows into columns, squash many rows into one list, and find unbroken streaks with the gaps-and-islands trick.',
  learn: `
<h4>1. Pivoting: rows → columns</h4>
<p>"Show order counts per month, one column per status." GROUP BY gives you one row per (month, status). To spread the
statuses across columns, count conditionally:</p>
<pre><code>SELECT to_char(order_date, 'YYYY-MM') AS month,
       COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
       COUNT(*) FILTER (WHERE status = 'shipped')   AS shipped,
       COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
FROM orders GROUP BY 1 ORDER BY 1;</code></pre>
<table class="mini">
<tr><th>month</th><th>pending</th><th>shipped</th><th>delivered</th><th>cancelled</th></tr>
<tr><td>2025-01</td><td>1</td><td>0</td><td>5</td><td>0</td></tr>
<tr><td>2025-02</td><td>1</td><td>1</td><td>5</td><td>3</td></tr>
<tr><td>2025-03</td><td>0</td><td>2</td><td>5</td><td>0</td></tr>
</table>
<p><code>FILTER</code> is Postgres. The portable (MySQL, LeetCode 1179) form is <code>SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)</code>.
You must know the column values in advance: SQL can't create columns from data.</p>

<h4>2. Many rows → one string or array</h4>
<pre><code>string_agg(p.name, ', ' ORDER BY p.name)     -- 'Coffee Mug, Noise Cancelling Headphones'
string_agg(DISTINCT p.name, ',' ORDER BY p.name)
array_agg(DISTINCT p.category ORDER BY p.category)   -- {Books,Electronics}</code></pre>
<p>Always put an <code>ORDER BY</code> <i>inside</i> the aggregate, otherwise the order of the list is not guaranteed.
MySQL: <code>GROUP_CONCAT(DISTINCT name ORDER BY name SEPARATOR ',')</code>.</p>

<h4>3. Gaps & islands: finding streaks</h4>
<p>An "island" is a run of consecutive values; the "gaps" are the holes between runs. The trick: number each customer's logins
with ROW_NUMBER and <b>subtract</b> that number (as days) from the date. Inside a run, both go up by 1 each step, so the difference
stays <b>constant</b>. When a day is skipped, the date jumps but the row number doesn't, so the difference changes. Customer 6:</p>
<table class="mini">
<tr><th>login_date</th><th>row_number</th><th>login_date − rn</th></tr>
<tr><td>03-04</td><td>1</td><td class="keep">03-03</td></tr>
<tr><td>03-05</td><td>2</td><td class="keep">03-03</td></tr>
<tr><td>03-10</td><td>3</td><td class="drop">03-07</td></tr>
<tr><td>03-11</td><td>4</td><td class="drop">03-07</td></tr>
<tr><td>03-12</td><td>5</td><td class="drop">03-07</td></tr>
<tr><td>03-13</td><td>6</td><td class="drop">03-07</td></tr>
<tr><td>03-15</td><td>7</td><td>03-08</td></tr>
<tr><td>03-17</td><td>8</td><td class="keep">03-09</td></tr>
<tr><td colspan="3">… 03-18, 03-19, 03-20 also give 03-09</td></tr>
</table>
<p>The difference is a <b>group key</b> for each island. Then it's a normal GROUP BY:</p>
<pre><code>WITH s AS (
  SELECT customer_id, login_date,
         login_date - ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date)::int AS grp
  FROM logins
)
SELECT customer_id, MIN(login_date) AS start_date, MAX(login_date) AS end_date, COUNT(*) AS days
FROM s GROUP BY customer_id, grp;</code></pre>
<p>(<code>date - integer</code> gives a date in Postgres; with timestamps write <code>- rn * INTERVAL '1 day'</code>.)
The same trick works on ids: LeetCode 601 uses <code>id - ROW_NUMBER()</code> over the rows that pass a filter.</p>

<div class="callout trap"><b>Trap: duplicates break the trick.</b> If a customer could log in twice on the same day, ROW_NUMBER keeps counting
while the date stays the same, and the island splits. De-duplicate first (<code>SELECT DISTINCT</code>) or use <code>DENSE_RANK</code>.
Our <code>logins</code> table has a primary key on (customer_id, login_date), so we're safe.</div>`,
  example: {
    sql: `SELECT customer_id, login_date,
       ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date) AS rn,
       login_date - ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date)::int AS grp
FROM logins
WHERE customer_id IN (1, 6)
ORDER BY customer_id, login_date;`,
    note: 'Watch the grp column: it stays the same through each streak and changes after every gap. Customer 1 has a 7-day streak (10th to 16th).',
  },
  exercises: [
    {
      id: 'd19-e1', type: 'query',
      prompt: '<b>Pivot (LeetCode 1179 style):</b> for each month <code>\'YYYY-MM\'</code>, show the number of orders in each status as columns: <code>month</code>, <code>pending</code>, <code>shipped</code>, <code>delivered</code>, <code>cancelled</code>. Order by month.',
      hint: 'One <code>COUNT(*) FILTER (WHERE status = …)</code> per column, or <code>SUM(CASE WHEN … THEN 1 ELSE 0 END)</code>.',
      solution: `SELECT to_char(order_date, 'YYYY-MM') AS month,
       COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
       COUNT(*) FILTER (WHERE status = 'shipped')   AS shipped,
       COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
FROM orders
GROUP BY 1
ORDER BY 1;`,
      ordered: true,
      alts: [
        `SELECT to_char(order_date, 'YYYY-MM'),
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),
       SUM(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END),
       SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END),
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)
FROM orders GROUP BY 1 ORDER BY 1;`,
      ],
      wrong: [{ sql: `SELECT to_char(order_date, 'YYYY-MM'),
       COUNT(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),
       COUNT(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END),
       COUNT(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END),
       COUNT(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)
FROM orders GROUP BY 1 ORDER BY 1;` }],
      why: '12 rows; every row\'s four numbers add up to that month\'s total. The classic bug is <code>COUNT(CASE … ELSE 0 END)</code>: COUNT counts every non-NULL value, and 0 is not NULL, so every column shows the month total. Use SUM with ELSE 0, or COUNT with no ELSE (NULL).',
    },
    {
      id: 'd19-e2', type: 'query',
      prompt: 'For each of <b>customer 7\'s</b> orders, show <code>order_id</code> and <code>products</code>: the product names in that order, alphabetical, joined by <code>\', \'</code> (comma + space).',
      hint: '<code>string_agg(p.name, \', \' ORDER BY p.name)</code>, grouped by order id.',
      solution: `SELECT o.id AS order_id,
       string_agg(p.name, ', ' ORDER BY p.name) AS products
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
WHERE o.customer_id = 7
GROUP BY o.id;`,
      alts: [
        `SELECT o.id, (SELECT string_agg(p.name, ', ' ORDER BY p.name) FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id)
FROM orders o WHERE o.customer_id = 7;`,
        `SELECT o.id, array_to_string(array_agg(p.name ORDER BY p.name), ', ')
FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
WHERE o.customer_id = 7 GROUP BY o.id;`,
      ],
      wrong: [{ sql: `SELECT o.id, string_agg(p.name, ',' ORDER BY p.name) FROM orders o JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id WHERE o.customer_id = 7 GROUP BY o.id;` }],
      why: '10 rows; order 78 is the biggest with 4 products. The separator is part of the answer, so <code>\',\'</code> vs <code>\', \'</code> gives different strings. LeetCode is just as strict. In MySQL: <code>GROUP_CONCAT(name ORDER BY name SEPARATOR \', \')</code>.',
    },
    {
      id: 'd19-e3', type: 'query',
      prompt: '<b>LeetCode 1484 style:</b> for each <code>order_date</code> in <b>February 2025</b>, show <code>num_products</code> (number of <i>different</i> products sold that day) and <code>products</code> (their distinct names, alphabetical, joined by <code>\',\'</code>).',
      hint: '<code>COUNT(DISTINCT …)</code> and <code>string_agg(DISTINCT p.name, \',\' ORDER BY p.name)</code>. With DISTINCT, the ORDER BY must use the same expression.',
      solution: `SELECT o.order_date,
       COUNT(DISTINCT p.name) AS num_products,
       string_agg(DISTINCT p.name, ',' ORDER BY p.name) AS products
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
WHERE o.order_date >= DATE '2025-02-01' AND o.order_date < DATE '2025-03-01'
GROUP BY o.order_date;`,
      alts: [
        `SELECT order_date, COUNT(*), string_agg(name, ',' ORDER BY name) FROM (
  SELECT DISTINCT o.order_date, p.name FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
  WHERE o.order_date >= '2025-02-01' AND o.order_date < '2025-03-01') t
GROUP BY order_date;`,
      ],
      wrong: [{ sql: `SELECT o.order_date, COUNT(*), string_agg(p.name, ',' ORDER BY p.name)
FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
WHERE o.order_date >= '2025-02-01' AND o.order_date < '2025-03-01' GROUP BY o.order_date;` }],
      why: '7 days. On 2025-02-04 three orders sold 7 lines but only 5 different products (Clean Code and Coffee Mug appear twice). Without DISTINCT, both the count and the list contain duplicates. The alt de-duplicates first in a subquery, which is handy in MySQL versions where GROUP_CONCAT DISTINCT is awkward.',
    },
    {
      id: 'd19-e4', type: 'query',
      prompt: 'Using <code>array_agg</code>, list customers who have <b>not</b> bought from all 4 product categories (any order status). Show <code>customer_id</code> and <code>categories</code>: an array of the distinct categories they did buy, sorted alphabetically.',
      hint: '<code>array_agg(DISTINCT p.category ORDER BY p.category)</code> and <code>HAVING COUNT(DISTINCT p.category) &lt; 4</code>.',
      solution: `SELECT o.customer_id,
       array_agg(DISTINCT p.category ORDER BY p.category) AS categories
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
GROUP BY o.customer_id
HAVING COUNT(DISTINCT p.category) < 4;`,
      alts: [
        `SELECT o.customer_id, array_agg(DISTINCT p.category ORDER BY p.category)
FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
GROUP BY o.customer_id
HAVING cardinality(array_agg(DISTINCT p.category)) < (SELECT COUNT(DISTINCT category) FROM products);`,
      ],
      wrong: [{ sql: `SELECT o.customer_id, array_agg(p.category ORDER BY p.category)
FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
GROUP BY o.customer_id HAVING COUNT(DISTINCT p.category) < 4;` }],
      why: '9 customers. Customer 10 only ever bought Electronics. Without DISTINCT the array repeats a category once per item bought. The alt compares to the number of categories in <code>products</code> instead of hard-coding 4, so it survives a new category: that\'s the "relational division" pattern from LeetCode 1045.',
    },
    {
      id: 'd19-e5', type: 'query',
      prompt: 'Gaps & islands: for every customer in <code>logins</code>, find their <b>longest login streak</b> (most consecutive days). Show <code>customer_id</code> and <code>longest_streak</code>.',
      hint: 'Step 1: <code>login_date - ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date)::int AS grp</code>. Step 2: COUNT(*) per (customer_id, grp). Step 3: MAX of that per customer.',
      solution: `WITH s AS (
  SELECT customer_id, login_date,
         login_date - ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date)::int AS grp
  FROM logins
),
islands AS (
  SELECT customer_id, grp, COUNT(*) AS days
  FROM s
  GROUP BY customer_id, grp
)
SELECT customer_id, MAX(days) AS longest_streak
FROM islands
GROUP BY customer_id;`,
      alts: [
        `WITH s AS (
  SELECT customer_id, login_date,
         CASE WHEN login_date - LAG(login_date) OVER (PARTITION BY customer_id ORDER BY login_date) = 1 THEN 0 ELSE 1 END AS new_island
  FROM logins),
g AS (SELECT customer_id, SUM(new_island) OVER (PARTITION BY customer_id ORDER BY login_date) AS island FROM s)
SELECT customer_id, MAX(n) FROM (SELECT customer_id, island, COUNT(*) AS n FROM g GROUP BY customer_id, island) t GROUP BY customer_id;`,
      ],
      wrong: [{ sql: `WITH s AS (
  SELECT customer_id, login_date,
         login_date - ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date)::int AS grp
  FROM logins)
SELECT customer_id, COUNT(*) FROM s GROUP BY customer_id, grp;` }],
      why: 'Customers 1 and 2 lead with 7 days, then customer 3 with 5. Stopping after step 2 returns <i>every</i> island (dozens of rows); the question wants one row per customer, so you need one more GROUP BY with MAX. That\'s why building it as named CTE steps helps. The alt is the other famous technique: flag "a new island starts here" with LAG, then a running SUM of the flags numbers the islands.',
    },
    {
      id: 'd19-e6', type: 'query',
      prompt: '<b>LeetCode 601 on our data:</b> count logins per day in March. A "busy day" has <b>at least 7</b> logins. Return every busy day that belongs to a run of <b>3 or more consecutive busy days</b>: <code>login_date</code>, <code>logins</code>. Order by date.',
      hint: 'Step 1: daily counts. Step 2: keep busy days and compute <code>login_date - ROW_NUMBER() OVER (ORDER BY login_date)::int</code>. Step 3: keep rows whose group has COUNT ≥ 3 (use <code>COUNT(*) OVER (PARTITION BY grp)</code>).',
      solution: `WITH daily AS (
  SELECT login_date, COUNT(*) AS logins
  FROM logins
  GROUP BY login_date
),
busy AS (
  SELECT login_date, logins,
         login_date - ROW_NUMBER() OVER (ORDER BY login_date)::int AS grp
  FROM daily
  WHERE logins >= 7
)
SELECT login_date, logins
FROM (SELECT *, COUNT(*) OVER (PARTITION BY grp) AS run_len FROM busy) t
WHERE run_len >= 3
ORDER BY login_date;`,
      ordered: true,
      alts: [
        `WITH d AS (SELECT login_date, COUNT(*) AS n FROM logins GROUP BY login_date HAVING COUNT(*) >= 7)
SELECT DISTINCT a.login_date, a.n
FROM d a, d b, d c
WHERE (b.login_date = a.login_date + 1 AND c.login_date = a.login_date + 2)
   OR (b.login_date = a.login_date - 1 AND c.login_date = a.login_date + 1)
   OR (b.login_date = a.login_date - 2 AND c.login_date = a.login_date - 1)
ORDER BY a.login_date;`,
      ],
      wrong: [{ sql: `WITH daily AS (SELECT login_date, COUNT(*) AS logins FROM logins GROUP BY login_date),
busy AS (SELECT login_date, logins, login_date - ROW_NUMBER() OVER (ORDER BY login_date)::int AS grp FROM daily)
SELECT login_date, logins FROM (SELECT *, COUNT(*) OVER (PARTITION BY grp) AS run_len FROM busy) t
WHERE logins >= 7 AND run_len >= 3 ORDER BY login_date;` }],
      why: '7 days: March 10–13 and March 29–31. The order of steps matters: filter to busy days <b>before</b> numbering them, so a quiet day creates a gap. In the wrong version every day of March is numbered, the difference never changes, and all busy days look like one long run. The triple self-join alt is the classic pre-window answer to 601: a day qualifies if it is the first, middle or last of 3 consecutive busy days.',
    },
    {
      id: 'd19-q1', type: 'quiz',
      prompt: 'In the gaps-and-islands trick, why does <code>login_date - ROW_NUMBER()</code> stay constant inside a streak?',
      options: [
        'Because ROW_NUMBER restarts at every gap',
        'Because inside a streak the date and the row number both increase by exactly 1 per row, so their difference doesn\'t change',
        'Because Postgres rounds dates to the start of the streak',
        'Because the PARTITION BY groups consecutive dates automatically',
      ],
      answer: 1,
      why: 'Consecutive days step by 1, and so does ROW_NUMBER. A gap makes the date jump by more than 1 while the row number still steps by 1, so the difference shifts to a new value: a new island.',
    },
  ],
  leetcode: [
    { id: 1179, title: 'Reformat Department Table', slug: 'reformat-department-table', difficulty: 'Easy' },
    { id: 601, title: 'Human Traffic of Stadium', slug: 'human-traffic-of-stadium', difficulty: 'Hard' },
  ],
  ownIt: 'Draw the gaps-and-islands table for customer 1 (logins on March 4, 5, 7, 10–16) and explain to a friend how the "date minus row number" column turns streaks into groups.',
};
