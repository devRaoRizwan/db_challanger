export default {
  day: 18,
  phase: 2,
  title: 'Dates & time',
  goal: 'Group by month, do date arithmetic, fill in missing months, and translate it all to MySQL for LeetCode.',
  learn: `
<p>Almost every reporting question is about time: "revenue per month", "orders in the last 7 days", "days to pay".
Postgres has a small toolbox that covers 95% of it.</p>

<h4>Bucketing: date_trunc, EXTRACT, to_char</h4>
<table class="mini">
<tr><th>expression (order_date = 2025-08-23)</th><th>result</th><th>use it for</th></tr>
<tr><td><code>date_trunc('month', order_date)</code></td><td>2025-08-01 00:00</td><td>GROUP BY month (sorts correctly!)</td></tr>
<tr><td><code>EXTRACT(MONTH FROM order_date)</code></td><td>8</td><td>a number: month, year, dow, isodow…</td></tr>
<tr><td><code>to_char(order_date, 'YYYY-MM')</code></td><td>'2025-08'</td><td>display text</td></tr>
<tr><td><code>to_char(order_date, 'Dy')</code></td><td>'Sat'</td><td>weekday names</td></tr>
</table>
<p><code>date_trunc</code> returns a timestamp; add <code>::date</code> if you want a plain date. Group by
<code>EXTRACT(MONTH …)</code> alone and you merge August 2024 with August 2025, so include the year.</p>

<h4>Arithmetic</h4>
<pre><code>order_date + 7                        -- date + integer  → date (7 days later)
order_date + INTERVAL '1 month'       -- date + interval → timestamp
paid_at - order_date                  -- date - date     → integer days
age(DATE '2025-12-31', signup_date)   -- a "1 year 2 mons 3 days" interval</code></pre>
<p>Use fixed dates in reports you want to reproduce. <code>now()</code> and <code>CURRENT_DATE</code> change every day,
so the same query gives different answers tomorrow.</p>

<h4>Missing months</h4>
<p>GROUP BY can only produce months that <i>have</i> rows. To show zeros, generate the months and LEFT JOIN:</p>
<pre><code>SELECT m::date AS month, COUNT(o.id)
FROM generate_series(DATE '2025-01-01', DATE '2025-12-01', INTERVAL '1 month') AS m
LEFT JOIN orders o
  ON o.order_date &gt;= m AND o.order_date &lt; m + INTERVAL '1 month'
GROUP BY m;</code></pre>
<p>The condition <code>&gt;= start AND &lt; next start</code> is the <b>half-open range</b>. It works for dates and timestamps alike,
and an index on order_date can use it (wrapping the column in a function often prevents that).</p>

<div class="callout trap"><b>Trap: BETWEEN with timestamps.</b> <code>created_at BETWEEN '2025-02-01' AND '2025-02-28'</code> means
"up to Feb 28 <b>00:00:00</b>", which loses almost the whole last day. Our columns are plain <code>DATE</code>s, so it happens to work here,
but in real apps they're timestamps. Use the half-open range.</div>

<div class="callout"><b>timestamp vs timestamptz.</b> <code>timestamp</code> stores wall-clock time with no zone, so "09:00" means nothing
once servers and users span time zones. <code>timestamptz</code> stores an absolute instant (in UTC internally) and converts to the
session's time zone on display. Default to <code>timestamptz</code> for "when did this happen" columns.</div>

<h4>MySQL translations (for LeetCode 1193, 1484, 1327)</h4>
<table class="mini">
<tr><th>Postgres</th><th>MySQL</th></tr>
<tr><td><code>to_char(d, 'YYYY-MM')</code></td><td><code>DATE_FORMAT(d, '%Y-%m')</code></td></tr>
<tr><td><code>b - a</code> (days)</td><td><code>DATEDIFF(b, a)</code></td></tr>
<tr><td><code>d + INTERVAL '7 days'</code></td><td><code>DATE_ADD(d, INTERVAL 7 DAY)</code></td></tr>
<tr><td><code>date_trunc('month', d)</code></td><td><code>DATE_FORMAT(d, '%Y-%m-01')</code></td></tr>
<tr><td><code>string_agg(x, ',' ORDER BY x)</code></td><td><code>GROUP_CONCAT(x ORDER BY x SEPARATOR ',')</code></td></tr>
</table>`,
  example: {
    sql: `SELECT to_char(order_date, 'YYYY-MM') AS month,
       COUNT(*)                                       AS orders,
       COUNT(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
       MIN(order_date)                                AS first_order,
       MAX(order_date) - MIN(order_date)              AS days_spanned
FROM orders
GROUP BY 1
ORDER BY 1;`,
    note: "'YYYY-MM' text sorts correctly because the year comes first. Try to_char(order_date, 'Mon') instead and see how the ORDER BY breaks.",
  },
  exercises: [
    {
      id: 'd18-e1', type: 'query',
      prompt: '<b>LeetCode 1193 style:</b> for each month of 2025, show <code>month</code> as text <code>\'YYYY-MM\'</code>, <code>orders</code> (number of non-cancelled orders) and <code>revenue</code> (their item total). Order by month.',
      hint: 'Count orders with <code>COUNT(DISTINCT o.id)</code>. After joining order_items, a plain COUNT(*) counts items.',
      solution: `SELECT to_char(o.order_date, 'YYYY-MM') AS month,
       COUNT(DISTINCT o.id) AS orders,
       SUM(oi.quantity * oi.unit_price) AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled'
GROUP BY 1
ORDER BY 1;`,
      ordered: true,
      alts: [
        `WITH t AS (SELECT o.id, o.order_date, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.status <> 'cancelled' GROUP BY o.id, o.order_date)
SELECT to_char(date_trunc('month', order_date), 'YYYY-MM'), COUNT(*), SUM(total) FROM t GROUP BY 1 ORDER BY 1;`,
      ],
      wrong: [{ sql: `SELECT to_char(o.order_date, 'YYYY-MM'), COUNT(*), SUM(oi.quantity * oi.unit_price)
FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.status <> 'cancelled' GROUP BY 1 ORDER BY 1;` }],
      why: 'August is the busiest month (13 non-cancelled orders, 5169.38). <code>COUNT(*)</code> after the join counts order <i>lines</i>, roughly 2–3 per order. In MySQL the month column is <code>DATE_FORMAT(trans_date, \'%Y-%m\')</code>.',
    },
    {
      id: 'd18-e2', type: 'query',
      prompt: 'Which weekday gets the most orders? Show <code>weekday</code> (<code>to_char(order_date, \'Dy\')</code>, e.g. <code>Mon</code>) and <code>orders</code> (all statuses), ordered Monday → Sunday.',
      hint: '<code>EXTRACT(ISODOW FROM order_date)</code> gives Monday = 1 … Sunday = 7. Group by both it and the name, and order by the number.',
      solution: `SELECT to_char(order_date, 'Dy') AS weekday, COUNT(*) AS orders
FROM orders
GROUP BY EXTRACT(ISODOW FROM order_date), to_char(order_date, 'Dy')
ORDER BY EXTRACT(ISODOW FROM order_date);`,
      ordered: true,
      alts: [
        `SELECT to_char(order_date, 'Dy'), COUNT(*) FROM orders GROUP BY 1, to_char(order_date, 'ID') ORDER BY to_char(order_date, 'ID');`,
      ],
      wrong: [{ sql: `SELECT to_char(order_date, 'Dy') AS weekday, COUNT(*) FROM orders GROUP BY 1 ORDER BY 1;` }],
      why: 'Friday wins with 16 orders; Wednesday is quiet with 6. Sorting by the name gives alphabetical order (Fri, Mon, Sat…). Keep a sortable number next to every display label. Also note <code>EXTRACT(DOW …)</code> uses Sunday = 0, while ISODOW uses Monday = 1.',
    },
    {
      id: 'd18-e3', type: 'query',
      prompt: 'Which orders took <b>more than 14 days</b> to be fully paid? Use the date of the <b>last</b> payment. Show <code>order_id</code>, <code>order_date</code>, <code>last_paid</code>, <code>days_to_pay</code>.',
      hint: 'GROUP BY order, <code>MAX(paid_at)</code>, then <code>HAVING MAX(paid_at) &gt; order_date + INTERVAL \'14 days\'</code> (or compare the integer difference).',
      solution: `SELECT o.id AS order_id, o.order_date,
       MAX(p.paid_at) AS last_paid,
       MAX(p.paid_at) - o.order_date AS days_to_pay
FROM orders o
JOIN payments p ON p.order_id = o.id
GROUP BY o.id, o.order_date
HAVING MAX(p.paid_at) > o.order_date + INTERVAL '14 days';`,
      alts: [
        `SELECT o.id, o.order_date, MAX(p.paid_at), MAX(p.paid_at) - o.order_date
FROM orders o JOIN payments p ON p.order_id = o.id
GROUP BY o.id, o.order_date HAVING MAX(p.paid_at) - o.order_date > 14;`,
      ],
      wrong: [
        { sql: `SELECT o.id, o.order_date, MIN(p.paid_at), MIN(p.paid_at) - o.order_date
FROM orders o JOIN payments p ON p.order_id = o.id
GROUP BY o.id, o.order_date HAVING MIN(p.paid_at) - o.order_date > 14;` },
        { sql: `SELECT o.id, o.order_date, MAX(p.paid_at), MAX(p.paid_at) - o.order_date
FROM orders o JOIN payments p ON p.order_id = o.id
GROUP BY o.id, o.order_date HAVING MAX(p.paid_at) - o.order_date >= 14;` },
      ],
      why: '8 orders, the slowest being order 34 (20 days). All of them are orders paid in 2 parts: the first part arrived quickly and the second one was late. That\'s why the question says "fully paid" and you need <code>MAX(paid_at)</code>; using MIN finds nothing. "More than 14" means <code>&gt; 14</code>: order 69 took exactly 14 days and must not appear. Comparing a date with <code>date + interval</code> works because Postgres converts both to timestamps.',
    },
    {
      id: 'd18-e4', type: 'query',
      prompt: 'Show <b>every month of 2025</b> and its number of <b>cancelled</b> orders, including months with none (0). Columns: <code>month</code> (a date: the first day of the month) and <code>cancelled</code>.',
      hint: '<code>generate_series(DATE \'2025-01-01\', DATE \'2025-12-01\', INTERVAL \'1 month\')</code>, LEFT JOIN orders on the half-open range <b>and</b> <code>status = \'cancelled\'</code> in the ON clause, then <code>COUNT(o.id)</code>.',
      solution: `SELECT m::date AS month, COUNT(o.id) AS cancelled
FROM generate_series(DATE '2025-01-01', DATE '2025-12-01', INTERVAL '1 month') AS m
LEFT JOIN orders o
  ON o.order_date >= m
 AND o.order_date < m + INTERVAL '1 month'
 AND o.status = 'cancelled'
GROUP BY m;`,
      alts: [
        `SELECT m::date, (SELECT COUNT(*) FROM orders o WHERE date_trunc('month', o.order_date) = m AND o.status = 'cancelled')
FROM generate_series(DATE '2025-01-01', DATE '2025-12-01', INTERVAL '1 month') AS m;`,
        `SELECT date_trunc('month', order_date)::date, COUNT(*) FILTER (WHERE status = 'cancelled') FROM orders GROUP BY 1;`,
      ],
      wrong: [
        { sql: `SELECT m::date, COUNT(o.id)
FROM generate_series(DATE '2025-01-01', DATE '2025-12-01', INTERVAL '1 month') AS m
LEFT JOIN orders o ON o.order_date >= m AND o.order_date < m + INTERVAL '1 month'
WHERE o.status = 'cancelled' GROUP BY m;` },
        { sql: `SELECT date_trunc('month', order_date)::date, COUNT(*) FROM orders WHERE status = 'cancelled' GROUP BY 1;` },
      ],
      why: '12 rows; January, March, May and November had no cancellations. Putting <code>status = \'cancelled\'</code> in WHERE throws away the NULL rows the LEFT JOIN made for empty months (the Day 7 trap again), leaving 8 rows. The FILTER alt passes only because every month of 2025 has <i>some</i> order. It would silently drop an empty month, so generate_series is the robust answer.',
    },
    {
      id: 'd18-e5', type: 'query',
      prompt: 'Signup cohorts: group customers by signup month (<code>\'YYYY-MM\'</code>). Show <code>cohort</code>, <code>signups</code> and <code>ordered</code> (how many of them have placed at least one order, any status). Include cohorts where nobody ordered.',
      hint: 'LEFT JOIN customers to a per-customer subquery (or use EXISTS inside <code>COUNT(*) FILTER (WHERE …)</code>). Avoid joining raw orders and counting rows: customers have several orders.',
      solution: `SELECT to_char(c.signup_date, 'YYYY-MM') AS cohort,
       COUNT(*) AS signups,
       COUNT(f.customer_id) AS ordered
FROM customers c
LEFT JOIN (SELECT DISTINCT customer_id FROM orders) f ON f.customer_id = c.id
GROUP BY 1;`,
      alts: [
        `SELECT to_char(c.signup_date, 'YYYY-MM'), COUNT(DISTINCT c.id), COUNT(DISTINCT o.customer_id)
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY 1;`,
        `SELECT to_char(signup_date, 'YYYY-MM'), COUNT(*),
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id))
FROM customers c GROUP BY 1;`,
      ],
      wrong: [{ sql: `SELECT to_char(c.signup_date, 'YYYY-MM'), COUNT(*), COUNT(o.id)
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY 1;` }],
      why: '14 cohorts. July 2024 (Emma, who never ordered) shows 1 signup and 0 ordered. Joining raw orders multiplies each customer by their order count, so "signups" and "ordered" both explode. Bonus data check: customer 9 (Irfan) signed up on 2025-03-01 but placed an order on 2025-02-10. Real data is messy, and spotting this in an interview earns points.',
    },
    {
      id: 'd18-e6', type: 'query',
      prompt: '<b>LeetCode 1327 style:</b> list products with <b>at least 5 units</b> ordered in <b>February 2025</b> (any status). Show product <code>name</code> and <code>units</code>. Use a half-open date range.',
      hint: '<code>WHERE o.order_date &gt;= DATE \'2025-02-01\' AND o.order_date &lt; DATE \'2025-03-01\'</code>, group by product, <code>HAVING SUM(quantity) &gt;= 5</code>.',
      solution: `SELECT p.name, SUM(oi.quantity) AS units
FROM order_items oi
JOIN orders o   ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
WHERE o.order_date >= DATE '2025-02-01'
  AND o.order_date <  DATE '2025-03-01'
GROUP BY p.name
HAVING SUM(oi.quantity) >= 5;`,
      alts: [
        `SELECT p.name, SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
WHERE date_trunc('month', o.order_date) = DATE '2025-02-01' GROUP BY p.name HAVING SUM(oi.quantity) >= 5;`,
      ],
      wrong: [{ sql: `SELECT p.name, SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
WHERE o.order_date >= DATE '2025-02-01' AND o.order_date < DATE '2025-03-01'
GROUP BY p.name HAVING COUNT(*) >= 5;` }],
      why: '4 products: Noise Cancelling Headphones, Coffee Mug and Clean Code (6 units each) and Wireless Mouse (5). "Units" means SUM(quantity); COUNT(*) counts order lines and finds nothing. The date_trunc alt is correct too, but wrapping the column in a function can stop Postgres from using an index on order_date (Day 31).',
    },
    {
      id: 'd18-q1', type: 'quiz',
      prompt: 'An app stores <code>created_at timestamptz</code>. Which filter correctly returns <b>all</b> rows from 28 Feb 2025?',
      options: [
        "created_at = '2025-02-28'",
        "created_at BETWEEN '2025-02-28' AND '2025-02-28'",
        "created_at >= '2025-02-28' AND created_at < '2025-03-01'",
        "EXTRACT(DAY FROM created_at) = 28",
      ],
      answer: 2,
      why: "A timestamp compared with '2025-02-28' means midnight exactly, so the first two only match rows at 00:00:00. The half-open range covers the whole day, and EXTRACT(DAY) matches the 28th of every month. (Which day a timestamptz falls on also depends on the session time zone.)",
    },
  ],
  leetcode: [
    { id: 1193, title: 'Monthly Transactions I', slug: 'monthly-transactions-i', difficulty: 'Medium' },
    { id: 1484, title: 'Group Sold Products By The Date', slug: 'group-sold-products-by-the-date', difficulty: 'Easy' },
    { id: 1327, title: 'List the Products Ordered in a Period', slug: 'list-the-products-ordered-in-a-period', difficulty: 'Easy' },
  ],
  ownIt: 'Explain why "show monthly cancellations including zero months" needs a generated list of months, and why the status filter must go in the ON clause and not in WHERE.',
};
