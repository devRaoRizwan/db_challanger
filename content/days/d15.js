export default {
  day: 15,
  phase: 2,
  title: 'Running totals & window frames',
  goal: 'Write running totals, moving averages and cumulative percentages, and control exactly which rows a window sees.',
  learn: `
<p>Add <code>ORDER BY</code> inside <code>OVER()</code> to an aggregate and it stops being "the total" and becomes a
<b>running</b> total:</p>
<pre><code>SUM(total) OVER (ORDER BY order_date, id)   -- everything up to this row</code></pre>
<p>Why? Every window function has a <b>frame</b>: the slice of the partition it looks at for the current row.
You can write it out yourself:</p>
<pre><code>SUM(x) OVER (ORDER BY d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)  -- running total
AVG(x) OVER (ORDER BY d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)          -- last 7 rows
SUM(x) OVER (ORDER BY d RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW) -- last 7 calendar days
SUM(x) OVER ()                                                              -- whole partition</code></pre>
<ul>
<li><b>ROWS</b> counts physical rows: "the 6 rows before me".</li>
<li><b>RANGE</b> works on the ORDER BY <i>value</i>: "every row whose date is within 6 days of mine". If some days have
no orders, ROWS reaches further back in time than RANGE does.</li>
</ul>

<h4>The default frame trap</h4>
<p>If you write <code>ORDER BY</code> and no frame, Postgres uses
<code>RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW</code>. With RANGE, rows that share the same ORDER BY value
(called <b>peers</b>) are all "current", so they all get the same total. Three orders were placed on 2025-02-04:</p>
<table class="mini">
<tr><th>id</th><th>order_date</th><th>total</th><th>ORDER BY order_date, id</th><th>ORDER BY order_date</th></tr>
<tr><td>3</td><td>2025-01-25</td><td>754.97</td><td>2770.90</td><td>2770.90</td></tr>
<tr><td>4</td><td>2025-02-04</td><td>330.48</td><td class="keep">3101.38</td><td class="drop">3270.38</td></tr>
<tr><td>12</td><td>2025-02-04</td><td>69.00</td><td class="keep">3170.38</td><td class="drop">3270.38</td></tr>
<tr><td>27</td><td>2025-02-04</td><td>100.00</td><td class="keep">3270.38</td><td>3270.38</td></tr>
</table>
<p>Neither is "wrong", but they answer different questions. For a per-row running total, make the ORDER BY unique
(add <code>id</code>) or say <code>ROWS</code> explicitly.</p>

<div class="callout trap"><b>Trap: LAST_VALUE.</b> <code>LAST_VALUE(status) OVER (PARTITION BY customer_id ORDER BY order_date)</code>
returns the <i>current</i> row's status, because the default frame stops at the current row. Fix it with
<code>ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING</code>, or just use FIRST_VALUE with the order flipped.</div>

<h4>Cumulative % of total</h4>
<p>Combine two windows: a running sum divided by the grand total.</p>
<pre><code>100 * SUM(rev) OVER (ORDER BY rev DESC) / SUM(rev) OVER ()</code></pre>
<p>On category revenue this gives Electronics 61.9%, + Furniture 87.7%, + Books 96.9%, + Accessories 100%.
That's a Pareto ("80/20") report, a favourite in analytics interviews.</p>

<h4>"Last one that fits" (LeetCode 1204)</h4>
<p>Running totals also solve "people board a bus in order until the weight limit": compute the running sum in boarding order,
keep rows where it is ≤ the limit, and take the last one.</p>`,
  example: {
    sql: `WITH daily AS (
  SELECT login_date, COUNT(*) AS logins
  FROM logins
  GROUP BY login_date
)
SELECT login_date, logins,
       SUM(logins) OVER (ORDER BY login_date) AS running_total,
       ROUND(AVG(logins) OVER (ORDER BY login_date
             ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS avg_7d
FROM daily
ORDER BY login_date;`,
    note: 'Every day of March has logins, so here ROWS 6 PRECEDING and a 6-day RANGE give the same answer. The first 6 days average fewer than 7 rows: a "partial window".',
  },
  exercises: [
    {
      id: 'd15-e1', type: 'query',
      prompt: 'For every <b>non-cancelled</b> order, show <code>id</code>, <code>order_date</code>, <code>total</code> (SUM of quantity × unit_price) and <code>running_total</code> across all orders in date order. Same-day orders count one at a time in <code>id</code> order. Order by <code>order_date, id</code>.',
      hint: 'Group order_items per order first, then <code>SUM(total) OVER (ORDER BY order_date, id)</code>.',
      solution: `SELECT id, order_date, total,
       SUM(total) OVER (ORDER BY order_date, id) AS running_total
FROM (
  SELECT o.id, o.order_date, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.id, o.order_date
) t
ORDER BY order_date, id;`,
      ordered: true,
      alts: [
        `SELECT o.id, o.order_date, SUM(oi.quantity * oi.unit_price),
       SUM(SUM(oi.quantity * oi.unit_price)) OVER (ORDER BY o.order_date, o.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled' GROUP BY o.id, o.order_date ORDER BY o.order_date, o.id;`,
      ],
      wrong: [{ sql: `SELECT id, order_date, total, SUM(total) OVER (ORDER BY order_date) FROM (
  SELECT o.id, o.order_date, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled' GROUP BY o.id, o.order_date) t
ORDER BY order_date, id;` }],
      why: 'With only <code>ORDER BY order_date</code>, the default RANGE frame treats same-day orders as peers, so orders 10 and 22 (both 2025-01-07) share one running total. Adding <code>id</code> makes every row unique. <code>SUM(SUM(…)) OVER</code> in the alt is a window over an aggregate: legal, if a little hard to read.',
    },
    {
      id: 'd15-e2', type: 'query',
      prompt: 'Per <b>customer</b>, a running total of their spend. For each non-cancelled order show <code>customer_id</code>, <code>order_id</code>, <code>order_date</code>, <code>total</code>, <code>customer_running_total</code>. Order by <code>customer_id, order_date</code>.',
      hint: 'Same as before, plus <code>PARTITION BY customer_id</code>. No customer has two orders on the same day, but adding <code>id</code> to the ORDER BY is a good habit.',
      solution: `SELECT customer_id, id AS order_id, order_date, total,
       SUM(total) OVER (PARTITION BY customer_id ORDER BY order_date, id) AS customer_running_total
FROM (
  SELECT o.id, o.customer_id, o.order_date, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.id, o.customer_id, o.order_date
) t
ORDER BY customer_id, order_date;`,
      ordered: true,
      alts: [
        `SELECT t.customer_id, t.id, t.order_date, t.total,
       (SELECT SUM(oi2.quantity * oi2.unit_price) FROM orders o2 JOIN order_items oi2 ON oi2.order_id = o2.id
        WHERE o2.customer_id = t.customer_id AND o2.status <> 'cancelled' AND o2.order_date <= t.order_date)
FROM (SELECT o.id, o.customer_id, o.order_date, SUM(oi.quantity * oi.unit_price) AS total
      FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status <> 'cancelled' GROUP BY o.id, o.customer_id, o.order_date) t
ORDER BY t.customer_id, t.order_date;`,
      ],
      wrong: [{ sql: `SELECT customer_id, id, order_date, total, SUM(total) OVER (ORDER BY order_date, id) FROM (
  SELECT o.id, o.customer_id, o.order_date, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled' GROUP BY o.id, o.customer_id, o.order_date) t
ORDER BY customer_id, order_date;` }],
      why: 'PARTITION BY restarts the running sum for every customer. The alt is the pre-window-function way: a correlated subquery summing "everything of mine up to this date". Same answer, but it re-scans orders once per row.',
    },
    {
      id: 'd15-e3', type: 'query',
      prompt: 'For each day that had non-cancelled orders, show <code>order_date</code>, <code>daily_revenue</code> and <code>revenue_7d</code>: the revenue of the <b>7 calendar days</b> ending on that date (that day and the 6 before it). Order by <code>order_date</code>.',
      hint: 'Days are missing, so you need <code>RANGE BETWEEN INTERVAL \'6 days\' PRECEDING AND CURRENT ROW</code>, not ROWS.',
      solution: `SELECT order_date, daily_revenue,
       SUM(daily_revenue) OVER (ORDER BY order_date
         RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW) AS revenue_7d
FROM (
  SELECT o.order_date, SUM(oi.quantity * oi.unit_price) AS daily_revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.order_date
) d
ORDER BY order_date;`,
      ordered: true,
      alts: [
        `WITH d AS (
  SELECT o.order_date, SUM(oi.quantity * oi.unit_price) AS daily_revenue
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled' GROUP BY o.order_date)
SELECT a.order_date, a.daily_revenue, SUM(b.daily_revenue)
FROM d a JOIN d b ON b.order_date BETWEEN a.order_date - 6 AND a.order_date
GROUP BY a.order_date, a.daily_revenue
ORDER BY a.order_date;`,
      ],
      wrong: [{ sql: `SELECT order_date, daily_revenue,
       SUM(daily_revenue) OVER (ORDER BY order_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
FROM (SELECT o.order_date, SUM(oi.quantity * oi.unit_price) AS daily_revenue
      FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status <> 'cancelled' GROUP BY o.order_date) d
ORDER BY order_date;` }],
      why: 'On 2025-01-24 the right answer is 35.00: nothing else happened between Jan 18 and Jan 24. ROWS 6 PRECEDING grabs the previous 6 <i>order days</i>, reaching back to Jan 2, and gives 2015.93. The self-join alt (match every day within 6 days) is what you would write in MySQL 5 or on LeetCode 1321 if you forget the frame syntax.',
    },
    {
      id: 'd15-e4', type: 'query',
      prompt: '<b>LeetCode 1321 on our data:</b> from <code>logins</code>, count logins per day, then show <code>login_date</code>, <code>total_7d</code> (sum of logins over that day and the 6 before) and <code>avg_7d</code> (that sum ÷ 7, rounded to 2 decimals). Only show days that have a full 7-day history (from <b>2025-03-07</b>). Order by date.',
      hint: 'Compute the window on <i>all</i> days in a subquery, and filter to <code>login_date &gt;= \'2025-03-07\'</code> <b>outside</b>. Filtering first would cut off the history.',
      solution: `SELECT login_date, total_7d, ROUND(total_7d / 7.0, 2) AS avg_7d
FROM (
  SELECT login_date,
         SUM(COUNT(*)) OVER (ORDER BY login_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS total_7d
  FROM logins
  GROUP BY login_date
) t
WHERE login_date >= DATE '2025-03-07'
ORDER BY login_date;`,
      ordered: true,
      alts: [
        `WITH d AS (SELECT login_date, COUNT(*) AS n FROM logins GROUP BY login_date)
SELECT a.login_date, SUM(b.n), ROUND(SUM(b.n) / 7.0, 2)
FROM d a JOIN d b ON b.login_date BETWEEN a.login_date - 6 AND a.login_date
WHERE a.login_date >= '2025-03-07'
GROUP BY a.login_date ORDER BY a.login_date;`,
      ],
      wrong: [{ sql: `SELECT login_date, SUM(COUNT(*)) OVER (ORDER BY login_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),
       ROUND(SUM(COUNT(*)) OVER (ORDER BY login_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) / 7.0, 2)
FROM logins WHERE login_date >= '2025-03-07' GROUP BY login_date ORDER BY login_date;` }],
      why: '25 rows, March 7 to 31. The window runs <i>after</i> WHERE, so filtering inside throws away March 1–6 and the first rows only average their own few days. "Window first, filter outside" is the same lesson as LAG on Day 14.',
    },
    {
      id: 'd15-e5', type: 'query',
      prompt: 'Pareto report: revenue per product <code>category</code> (non-cancelled orders), and the <b>cumulative % of total revenue</b> when categories are sorted from highest to lowest revenue. Columns: <code>category</code>, <code>revenue</code>, <code>cum_pct</code> (rounded to 1 decimal). Order by revenue DESC.',
      hint: '<code>100 * SUM(revenue) OVER (ORDER BY revenue DESC) / SUM(revenue) OVER ()</code>.',
      solution: `SELECT category, revenue,
       ROUND(100 * SUM(revenue) OVER (ORDER BY revenue DESC) / SUM(revenue) OVER (), 1) AS cum_pct
FROM (
  SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN orders o   ON o.id = oi.order_id
  JOIN products p ON p.id = oi.product_id
  WHERE o.status <> 'cancelled'
  GROUP BY p.category
) c
ORDER BY revenue DESC;`,
      ordered: true,
      alts: [
        `WITH c AS (SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
  WHERE o.status <> 'cancelled' GROUP BY p.category)
SELECT a.category, a.revenue,
       ROUND(100 * (SELECT SUM(b.revenue) FROM c b WHERE b.revenue >= a.revenue) / (SELECT SUM(revenue) FROM c), 1)
FROM c a ORDER BY a.revenue DESC;`,
      ],
      wrong: [{ sql: `SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue,
       ROUND(100 * SUM(oi.quantity * oi.unit_price) / SUM(SUM(oi.quantity * oi.unit_price)) OVER (), 1)
FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
WHERE o.status <> 'cancelled' GROUP BY p.category ORDER BY revenue DESC;` }],
      why: 'Electronics alone is 61.9% of revenue; with Furniture it reaches 87.7%. The wrong version gives each category\'s <i>own</i> share (61.9, 25.7, 9.2, 3.1): a plain percentage, not a cumulative one. <code>OVER ()</code> with nothing inside means "the whole result".',
    },
    {
      id: 'd15-e6', type: 'query',
      prompt: '<b>LeetCode 1204 on our data:</b> the company "boards" employees in <code>hire_date</code> order and has a payroll limit of <b>1,000,000</b>. Return the <code>first_name</code> of the <b>last employee who fits</b> (running salary total ≤ 1,000,000).',
      hint: 'Running <code>SUM(salary) OVER (ORDER BY hire_date)</code>, keep rows ≤ 1000000, then <code>ORDER BY</code> the running total (or hire_date) <code>DESC LIMIT 1</code>.',
      solution: `SELECT first_name
FROM (
  SELECT first_name, hire_date,
         SUM(salary) OVER (ORDER BY hire_date, id) AS running
  FROM employees
) t
WHERE running <= 1000000
ORDER BY hire_date DESC, running DESC
LIMIT 1;`,
      alts: [
        `SELECT e1.first_name FROM employees e1
JOIN employees e2 ON e2.hire_date <= e1.hire_date
GROUP BY e1.id, e1.first_name, e1.hire_date
HAVING SUM(e2.salary) <= 1000000
ORDER BY e1.hire_date DESC LIMIT 1;`,
      ],
      wrong: [{ sql: `SELECT first_name FROM (
  SELECT first_name, hire_date, SUM(salary) OVER (ORDER BY hire_date) AS running FROM employees) t
WHERE running <= 1000000 ORDER BY hire_date LIMIT 1;` }],
      why: 'Running totals: Ayesha 250k, Bilal 430k, Sara 610k, Hina 780k, <b>Usman 940k</b>, then Omar pushes it to 1.08M. Usman is the answer. Sorting ascending returns the <i>first</i> person to fit (Ayesha) instead of the last. The self-join alt is the classic pre-window answer to 1204.',
    },
    {
      id: 'd15-q1', type: 'quiz',
      prompt: 'You write <code>AVG(x) OVER (ORDER BY d)</code> with no frame clause. What frame does Postgres use?',
      options: [
        'The whole partition',
        'RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW (current row plus its peers)',
        'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW (exactly up to this row)',
        'ROWS BETWEEN 1 PRECEDING AND CURRENT ROW',
      ],
      answer: 1,
      why: 'With ORDER BY, the default is RANGE … CURRENT ROW, which includes every peer that has the same d. Without ORDER BY, the frame is the whole partition. That\'s why SUM(x) OVER () is a grand total.',
    },
  ],
  leetcode: [
    { id: 1204, title: 'Last Person to Fit in the Bus', slug: 'last-person-to-fit-in-the-bus', difficulty: 'Medium' },
    { id: 1321, title: 'Restaurant Growth', slug: 'restaurant-growth', difficulty: 'Medium' },
  ],
  ownIt: 'Explain the difference between ROWS and RANGE frames using our order dates (some days have several orders, some days have none). When would each one give a different running total or moving sum?',
};
