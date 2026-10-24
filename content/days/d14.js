export default {
  day: 14,
  phase: 2,
  title: 'LAG / LEAD: comparing rows',
  goal: 'Compare each row with the one before or after it: gaps between orders, month-over-month change, consecutive streaks.',
  learn: `
<p>Until now every row was evaluated on its own. But many questions compare a row with its <b>neighbour</b>:
"days since the previous order", "revenue vs last month", "did they log in the next day?".
Before window functions you needed a self-join for this. Now there are two functions:</p>
<ul>
<li><code>LAG(col)</code>: the value of <code>col</code> from the <b>previous</b> row in the window.</li>
<li><code>LEAD(col)</code>: the value from the <b>next</b> row.</li>
</ul>
<p>Both take optional extras: <code>LAG(col, 3)</code> looks 3 rows back, and <code>LAG(col, 1, 0)</code> returns 0 instead
of NULL when there is no previous row.</p>

<h4>Customer 7's orders, side by side</h4>
<pre><code>SELECT id, order_date,
       LAG(order_date)  OVER (ORDER BY order_date) AS prev_date,
       order_date - LAG(order_date) OVER (ORDER BY order_date) AS gap_days,
       LEAD(order_date) OVER (ORDER BY order_date) AS next_date
FROM orders WHERE customer_id = 7;</code></pre>
<table class="mini">
<tr><th>id</th><th>order_date</th><th>prev_date</th><th>gap_days</th><th>next_date</th></tr>
<tr><td>32</td><td>2025-03-08</td><td class="drop">NULL</td><td class="drop">NULL</td><td>2025-03-18</td></tr>
<tr><td>39</td><td>2025-03-18</td><td>2025-03-08</td><td>10</td><td>2025-04-25</td></tr>
<tr><td>80</td><td>2025-04-25</td><td>2025-03-18</td><td>38</td><td>2025-05-12</td></tr>
<tr><td colspan="5">…</td></tr>
<tr><td>78</td><td>2025-11-21</td><td>2025-09-21</td><td>61</td><td class="drop">NULL</td></tr>
</table>
<p>The first row has no previous row, so LAG gives NULL. The last row has no next row, so LEAD gives NULL.
In Postgres, <code>date - date</code> is an integer number of days (MySQL: <code>DATEDIFF(a, b)</code>).</p>

<h4>Always think: "previous <i>within what</i>?"</h4>
<p>For all customers at once you need <code>PARTITION BY customer_id</code>. Without it, the "previous order" of
customer 8's first order is somebody else's order.</p>

<div class="callout trap"><b>Trap: filtering before LAG.</b> Window functions run <b>after</b> WHERE. If you write
<code>WHERE status = 'delivered'</code>, LAG only sees delivered orders. Sometimes that's what you want, but if you need
"previous order of any status, but only show delivered rows", compute LAG in a subquery and filter outside.</div>

<h4>Consecutive streaks (LeetCode 180)</h4>
<p>"Customers who logged in on 4 consecutive days." With one row per customer per day, if the row 3 positions back
is exactly 3 days earlier, the 4 rows in between must be 4 consecutive days:</p>
<pre><code>login_date - LAG(login_date, 3) OVER (PARTITION BY customer_id ORDER BY login_date) = 3</code></pre>
<p>The older interview answer is a self-join: <code>l2.login_date = l1.login_date + 1 AND l3.login_date = l1.login_date + 2 …</code>.
It works too but grows one join per day.</p>

<h4>First and last in the group</h4>
<p><code>FIRST_VALUE(status) OVER (PARTITION BY customer_id ORDER BY order_date DESC)</code> puts each customer's
<b>latest</b> status on every one of their rows. (Its twin <code>LAST_VALUE</code> has a nasty trap that we fix on Day 15,
so for now flip the ORDER BY and use FIRST_VALUE.)</p>`,
  example: {
    sql: `SELECT customer_id, id, order_date,
       LAG(order_date) OVER w  AS prev_order,
       order_date - LAG(order_date) OVER w AS days_since_prev,
       FIRST_VALUE(order_date) OVER w AS first_order
FROM orders
WINDOW w AS (PARTITION BY customer_id ORDER BY order_date)
ORDER BY customer_id, order_date;`,
    note: 'Each customer starts over: their first row has NULL for prev_order. Remove PARTITION BY and watch the numbers go wrong.',
  },
  exercises: [
    {
      id: 'd14-e1', type: 'query',
      prompt: 'For <b>customer 7</b>, list every order with <code>id</code>, <code>order_date</code>, the <code>prev_date</code> of their previous order, and <code>days_since_prev</code> (integer). Order by <code>order_date</code>.',
      hint: '<code>LAG(order_date) OVER (ORDER BY order_date)</code>; subtract dates to get days.',
      solution: `SELECT id, order_date,
       LAG(order_date) OVER (ORDER BY order_date) AS prev_date,
       order_date - LAG(order_date) OVER (ORDER BY order_date) AS days_since_prev
FROM orders
WHERE customer_id = 7
ORDER BY order_date;`,
      ordered: true,
      alts: [
        `SELECT o.id, o.order_date, p.order_date, o.order_date - p.order_date
FROM orders o
LEFT JOIN orders p ON p.customer_id = 7 AND p.order_date = (
  SELECT MAX(order_date) FROM orders x WHERE x.customer_id = 7 AND x.order_date < o.order_date)
WHERE o.customer_id = 7
ORDER BY o.order_date;`,
      ],
      wrong: [{ sql: `SELECT id, order_date, prev_date, order_date - prev_date FROM (
  SELECT id, customer_id, order_date, LAG(order_date) OVER (ORDER BY order_date, id) AS prev_date FROM orders) t
WHERE customer_id = 7 ORDER BY order_date;` }],
      why: 'Here WHERE runs first, so LAG only sees customer 7\'s 10 orders. The wrong version computes LAG over <i>all</i> orders and filters afterwards, so "previous" means "previous order by anyone". The longest gap is 61 days (Sept 21 → Nov 21).',
    },
    {
      id: 'd14-e2', type: 'query',
      prompt: 'For every customer with <b>at least 2 orders</b>, show <code>customer_id</code> and <code>avg_gap</code>: the average number of days between consecutive orders, rounded to 1 decimal.',
      hint: 'Inner query: <code>order_date - LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date)</code>. Outer: AVG of that per customer. AVG ignores the NULL first row.',
      solution: `SELECT customer_id, ROUND(AVG(gap), 1) AS avg_gap
FROM (
  SELECT customer_id,
         order_date - LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) AS gap
  FROM orders
) t
GROUP BY customer_id
HAVING COUNT(*) >= 2;`,
      alts: [
        `SELECT customer_id, ROUND((MAX(order_date) - MIN(order_date))::numeric / (COUNT(*) - 1), 1)
FROM orders GROUP BY customer_id HAVING COUNT(*) >= 2;`,
      ],
      wrong: [{ sql: `SELECT customer_id, ROUND(AVG(gap), 1) FROM (
  SELECT customer_id, order_date - LAG(order_date) OVER (ORDER BY order_date) AS gap FROM orders) t
GROUP BY customer_id HAVING COUNT(*) >= 2;` }],
      why: 'Without PARTITION BY, the gaps are between different customers\' orders. The alt is a neat math shortcut: the gaps add up to (last − first), so the average gap is (last − first) / (n − 1). Interviewers love it when you spot this. 21 customers qualify.',
    },
    {
      id: 'd14-e3', type: 'query',
      prompt: 'Month-over-month revenue. Revenue = <code>SUM(quantity * unit_price)</code> of non-cancelled orders, grouped by <code>date_trunc(\'month\', order_date)</code>. Show <code>month</code>, <code>revenue</code>, <code>prev_revenue</code>, <code>change</code> (revenue − prev_revenue). Order by month.',
      hint: 'Aggregate per month first (subquery or CTE), then apply <code>LAG(revenue) OVER (ORDER BY month)</code>.',
      solution: `SELECT month, revenue,
       LAG(revenue) OVER (ORDER BY month) AS prev_revenue,
       revenue - LAG(revenue) OVER (ORDER BY month) AS change
FROM (
  SELECT date_trunc('month', o.order_date) AS month,
         SUM(oi.quantity * oi.unit_price) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY 1
) m
ORDER BY month;`,
      ordered: true,
      alts: [
        `SELECT date_trunc('month', o.order_date) AS month, SUM(oi.quantity * oi.unit_price),
       LAG(SUM(oi.quantity * oi.unit_price)) OVER (ORDER BY date_trunc('month', o.order_date)),
       SUM(oi.quantity * oi.unit_price) - LAG(SUM(oi.quantity * oi.unit_price)) OVER (ORDER BY date_trunc('month', o.order_date))
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled' GROUP BY 1 ORDER BY 1;`,
      ],
      why: 'January has no previous month, so its change is NULL. The biggest jump is August (+3668.88), right after the weakest month, July. The alt shows you can wrap an aggregate inside LAG in a single SELECT, but the subquery version is easier to read.',
    },
    {
      id: 'd14-e4', type: 'query',
      prompt: '<b>LeetCode 180 style:</b> find every <code>customer_id</code> that logged in on <b>at least 4 consecutive days</b> (table <code>logins</code>). Each customer once.',
      hint: 'If <code>login_date - LAG(login_date, 3) OVER (PARTITION BY customer_id ORDER BY login_date) = 3</code>, the last 4 logins are 4 days in a row.',
      solution: `SELECT DISTINCT customer_id
FROM (
  SELECT customer_id, login_date,
         LAG(login_date, 3) OVER (PARTITION BY customer_id ORDER BY login_date) AS three_back
  FROM logins
) t
WHERE login_date - three_back = 3;`,
      alts: [
        `SELECT DISTINCT l1.customer_id
FROM logins l1
JOIN logins l2 ON l2.customer_id = l1.customer_id AND l2.login_date = l1.login_date + 1
JOIN logins l3 ON l3.customer_id = l1.customer_id AND l3.login_date = l1.login_date + 2
JOIN logins l4 ON l4.customer_id = l1.customer_id AND l4.login_date = l1.login_date + 3;`,
      ],
      wrong: [{ sql: `SELECT DISTINCT customer_id FROM (
  SELECT customer_id, login_date, LAG(login_date) OVER (PARTITION BY customer_id ORDER BY login_date) AS prev FROM logins) t
WHERE login_date - prev = 1;` }],
      why: '9 customers: 1, 2, 3, 4, 6, 7, 8, 9, 11 (only 5, 10 and 12 never manage 4 in a row). The trick works because a customer can log in at most once per day (primary key), so 4 rows spanning only 3 days must be consecutive. The wrong version only checks <i>two</i> days in a row, which every customer has.',
    },
    {
      id: 'd14-e5', type: 'query',
      prompt: '<b>LeetCode 550 on our data:</b> what fraction of customers in <code>logins</code> logged in again on the <b>day right after their first login</b>? Return one column <code>fraction</code>, rounded to 2 decimals.',
      hint: 'Step 1: each customer\'s first login (<code>MIN(login_date)</code>). Step 2: check whether a row exists for <code>first + 1</code>. Step 3: count those ÷ total customers. Watch out for integer division.',
      solution: `SELECT ROUND(
         COUNT(l.customer_id)::numeric / COUNT(*), 2) AS fraction
FROM (
  SELECT customer_id, MIN(login_date) AS first_login
  FROM logins
  GROUP BY customer_id
) f
LEFT JOIN logins l
  ON l.customer_id = f.customer_id
 AND l.login_date = f.first_login + 1;`,
      alts: [
        `SELECT ROUND(AVG(CASE WHEN next_login = login_date + 1 THEN 1 ELSE 0 END), 2)
FROM (
  SELECT customer_id, login_date,
         LEAD(login_date) OVER (PARTITION BY customer_id ORDER BY login_date) AS next_login,
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date) AS rn
  FROM logins) t
WHERE rn = 1;`,
      ],
      wrong: [{ sql: `SELECT ROUND(COUNT(DISTINCT l1.customer_id)::numeric / (SELECT COUNT(DISTINCT customer_id) FROM logins), 2)
FROM logins l1 JOIN logins l2 ON l2.customer_id = l1.customer_id AND l2.login_date = l1.login_date + 1;` }],
      why: '9 of 12 customers (0.75). Customers 8, 9 and 11 skipped the day after their first login. The wrong version checks "logged in two days in a row <i>at any time</i>", which is true for everyone (1.00). Read the question: it\'s anchored on the <b>first</b> login. In MySQL you would write <code>DATE_ADD(first_login, INTERVAL 1 DAY)</code>.',
    },
    {
      id: 'd14-e6', type: 'query',
      prompt: 'For every customer who has orders, show <code>customer_id</code>, <code>first_order_date</code> and <code>latest_status</code> (the status of their most recent order). One row per customer.',
      hint: '<code>FIRST_VALUE(status) OVER (PARTITION BY customer_id ORDER BY order_date DESC)</code> plus <code>MIN(order_date) OVER (PARTITION BY customer_id)</code>, then DISTINCT.',
      solution: `SELECT DISTINCT customer_id,
       MIN(order_date) OVER (PARTITION BY customer_id) AS first_order_date,
       FIRST_VALUE(status) OVER (PARTITION BY customer_id ORDER BY order_date DESC) AS latest_status
FROM orders;`,
      alts: [
        `SELECT DISTINCT ON (customer_id) customer_id,
       MIN(order_date) OVER (PARTITION BY customer_id), status
FROM orders ORDER BY customer_id, order_date DESC;`,
        `SELECT o.customer_id, f.first_date, o.status
FROM orders o
JOIN (SELECT customer_id, MIN(order_date) AS first_date, MAX(order_date) AS last_date FROM orders GROUP BY customer_id) f
  ON f.customer_id = o.customer_id AND o.order_date = f.last_date;`,
      ],
      wrong: [{ sql: `SELECT DISTINCT customer_id,
       MIN(order_date) OVER (PARTITION BY customer_id),
       LAST_VALUE(status) OVER (PARTITION BY customer_id ORDER BY order_date)
FROM orders;` }],
      why: '24 rows. The LAST_VALUE version looks right but returns several rows per customer: with ORDER BY, the default window frame ends at the <i>current</i> row, so LAST_VALUE is just the current row\'s status. Day 15 explains frames; for now, flip the sort and use FIRST_VALUE. The third alt works here only because no customer has two orders on the same day.',
    },
    {
      id: 'd14-q1', type: 'quiz',
      prompt: 'What does <code>LEAD(order_date, 1, order_date) OVER (PARTITION BY customer_id ORDER BY order_date)</code> return on a customer\'s <b>last</b> order?',
      options: ['NULL', 'That order\'s own order_date', 'The next customer\'s first order_date', 'An error'],
      answer: 1,
      why: 'The third argument is the default used when there is no next row inside the partition. Here the default is the row\'s own date, so the gap to "next" would be 0 instead of NULL. PARTITION BY guarantees LEAD never crosses into another customer.',
    },
  ],
  leetcode: [
    { id: 180, title: 'Consecutive Numbers', slug: 'consecutive-numbers', difficulty: 'Medium' },
    { id: 550, title: 'Game Play Analysis IV', slug: 'game-play-analysis-iv', difficulty: 'Medium' },
    { id: 1164, title: 'Product Price at a Given Date', slug: 'product-price-at-a-given-date', difficulty: 'Medium' },
  ],
  ownIt: 'Explain how LAG(login_date, 3) finds 4-day streaks, and why the trick depends on there being at most one login per customer per day. What would you change if duplicates were possible?',
};
