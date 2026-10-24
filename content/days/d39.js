export default {
  day: 39,
  phase: 5,
  title: 'Mock round #3: hard set',
  goal: 'Recognise the hard interview patterns from a single phrase in the prompt and solve six of them on your own.',
  learn: `
<p>Hard SQL interview questions are usually two or three patterns you already know, stacked together. The skill is
<b>spotting the trigger phrase</b> in the prompt. Here is the whole course squeezed into one lookup table.</p>

<table class="mini">
<tr><th>When the prompt says…</th><th>Reach for</th><th>Day</th></tr>
<tr><td>"Nth highest", "top 3 per group"</td><td><code>DENSE_RANK() OVER (PARTITION BY … ORDER BY … DESC)</code>, filter in an outer query</td><td>12–13</td></tr>
<tr><td>"latest / first per X"</td><td><code>ROW_NUMBER() … = 1</code> or <code>DISTINCT ON</code></td><td>11</td></tr>
<tr><td>"consecutive", "streak", "3 days in a row"</td><td>Gaps &amp; islands: <code>date - ROW_NUMBER()</code> = group key</td><td>19</td></tr>
<tr><td>"compared to previous", "growth"</td><td><code>LAG</code> / <code>LEAD</code></td><td>14</td></tr>
<tr><td>"running total", "moving average"</td><td><code>SUM() OVER (ORDER BY … ROWS …)</code></td><td>15</td></tr>
<tr><td>"never", "without any", "didn't"</td><td>Anti-join: <code>NOT EXISTS</code> or <code>LEFT JOIN … IS NULL</code> (not <code>NOT IN</code> with NULLs)</td><td>7, 9</td></tr>
<tr><td>"bought <b>every</b> / <b>all</b> …"</td><td>Relational division: <code>HAVING COUNT(DISTINCT x) = (SELECT COUNT(*) …)</code></td><td>9</td></tr>
<tr><td>"rate", "percentage", "ratio"</td><td><code>AVG((cond)::int)</code> or <code>COUNT(*) FILTER (…) * 1.0 / COUNT(*)</code></td><td>10</td></tr>
<tr><td>"including zero", "for every X"</td><td>Start from X, <code>LEFT JOIN</code>, filter in <code>ON</code>, <code>COUNT(col)</code></td><td>7</td></tr>
<tr><td>"median", "percentile"</td><td><code>PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY …)</code></td><td>today</td></tr>
<tr><td>"above the average"</td><td>Scalar subquery or <code>AVG() OVER ()</code></td><td>9, 11</td></tr>
<tr><td>"hierarchy", "all reports under"</td><td><code>WITH RECURSIVE</code></td><td>17</td></tr>
</table>

<h4>New tool: the median</h4>
<pre><code>SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total) FROM order_totals;</code></pre>
<p>It sorts the values and picks the middle one, or interpolates between the two middle values when the count is even.
In databases without it, use windows: number the rows, count them, and average the middle one or two:</p>
<pre><code>rn:    1    2    3    4    5        n = 5 → middle rows (n+1)/2 = 3 and (n+2)/2 = 3
total: 10   20  [30]  40   90       median = 30   (AVG would be 38: one big order pulls it up)</code></pre>
<p>That's why dashboards often prefer the median: a single 3000-rupee order can't move it.</p>

<h4>How to work through a hard problem (out loud)</h4>
<ol>
<li><b>Shape:</b> "one row per <i>what</i>, with which columns?"</li>
<li><b>Steps:</b> break it into CTEs: base rows → per-entity numbers → filter/rank → final.</li>
<li><b>Edge cases:</b> ties, NULLs, zero rows, cancelled orders, fan-out from joins.</li>
<li><b>Check:</b> run each CTE on its own and look at a few rows.</li>
</ol>

<div class="callout trap"><b>Trap:</b> in streak problems, <code>ROW_NUMBER()</code> must be <code>PARTITION BY</code> the person.
Without it, the numbering runs across all customers and the islands mix people together.</div>

<div class="callout">No quiz today. Give yourself <b>30 minutes for all six</b>. If one takes more than 8 minutes, skip it and come back.
Today's definition: an order's value = <code>SUM(quantity * unit_price)</code> of its items.</div>`,
  example: {
    sql: `-- Median vs average of non-cancelled order values
WITH order_totals AS (
  SELECT o.id, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.id
)
SELECT COUNT(*)                                            AS orders,
       ROUND(AVG(total), 2)                                AS average,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total)  AS median,
       PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY total)  AS p90
FROM order_totals;`,
    note: 'The average (410.87) is well above the median (324.48): a few large orders pull the average up. p90 is how SLO dashboards talk about latency.',
  },
  exercises: [
    {
      id: 'd39-e1', type: 'query',
      prompt: '<b>Median order value.</b> Over all non-cancelled orders, return the median order value as one column <code>median_order_value</code>.',
      hint: 'CTE with one row per order and its total, then <code>PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total)</code>. For extra practice, also solve it with ROW_NUMBER and COUNT(*) OVER ().',
      solution: `WITH order_totals AS (
  SELECT o.id, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.id
)
SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total) AS median_order_value
FROM order_totals;`,
      alts: [`WITH order_totals AS (
  SELECT o.id, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.id
), numbered AS (
  SELECT total, ROW_NUMBER() OVER (ORDER BY total) AS rn, COUNT(*) OVER () AS n
  FROM order_totals
)
SELECT AVG(total) FROM numbered
WHERE rn IN ((n + 1) / 2, (n + 2) / 2);`],
      wrong: [
        { sql: `WITH t AS (SELECT o.id, SUM(oi.quantity * oi.unit_price) AS total FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled' GROUP BY o.id) SELECT AVG(total) FROM t;` },
        { sql: `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY oi.quantity * oi.unit_price)
FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.status <> 'cancelled';` },
      ],
      why: '77 orders, so the median is the 39th value: 324.48. In the window version, integer division makes <code>(n+1)/2</code> and <code>(n+2)/2</code> both 39 when n is odd, and the two middle positions when n is even. Taking the median over order <i>lines</i> answers a different question.',
    },
    {
      id: 'd39-e2', type: 'query',
      prompt: '<b>Bought every book.</b> Find customers who bought <b>every</b> product in the <code>Books</code> category in non-cancelled orders. Show <code>customer_id</code> and <code>name</code>.',
      hint: 'Relational division: join down to products, keep Books, <code>GROUP BY</code> customer, <code>HAVING COUNT(DISTINCT product_id) = (SELECT COUNT(*) FROM products WHERE category = \'Books\')</code>.',
      solution: `SELECT c.id AS customer_id, c.name
FROM customers c
JOIN orders o       ON o.customer_id = c.id AND o.status <> 'cancelled'
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
WHERE p.category = 'Books'
GROUP BY c.id, c.name
HAVING COUNT(DISTINCT p.id) = (SELECT COUNT(*) FROM products WHERE category = 'Books');`,
      alts: [`SELECT c.id, c.name
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM products p
  WHERE p.category = 'Books'
    AND NOT EXISTS (
      SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.customer_id = c.id AND o.status <> 'cancelled' AND oi.product_id = p.id));`],
      wrong: [
        { sql: `SELECT DISTINCT c.id, c.name FROM customers c
JOIN orders o ON o.customer_id = c.id AND o.status <> 'cancelled'
JOIN order_items oi ON oi.order_id = o.id
WHERE oi.product_id IN (SELECT id FROM products WHERE category = 'Books');` },
      ],
      why: 'Only customers 6 and 24 have all three books. <code>IN (…)</code> means "bought <b>any</b> book" (20 customers). "Every" needs counting, or the double <code>NOT EXISTS</code>: "there is no book this customer hasn\'t bought". Use <code>COUNT(DISTINCT …)</code>, because buying the same book twice must not count as two different books.',
    },
    {
      id: 'd39-e3', type: 'query',
      prompt: '<b>Longest login streak.</b> For each customer in <code>logins</code>, show their longest run of consecutive login days: <code>customer_id</code>, <code>streak_start</code>, <code>streak_end</code>, <code>days</code>. If two streaks tie, keep the <b>earliest</b> one. Order by <code>customer_id</code>.',
      hint: '<code>login_date - ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date)::int</code> is constant within a streak. Group by (customer, that key), then pick the best group per customer with ROW_NUMBER ordered by <code>days DESC, streak_start</code>.',
      solution: `WITH grouped AS (
  SELECT customer_id, login_date,
         login_date - (ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date))::int AS grp
  FROM logins
), streaks AS (
  SELECT customer_id, MIN(login_date) AS streak_start, MAX(login_date) AS streak_end, COUNT(*) AS days
  FROM grouped
  GROUP BY customer_id, grp
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY days DESC, streak_start) AS rn
  FROM streaks
)
SELECT customer_id, streak_start, streak_end, days
FROM ranked
WHERE rn = 1
ORDER BY customer_id;`,
      ordered: true,
      alts: [`WITH g AS (
  SELECT customer_id, login_date,
         login_date - (ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date))::int AS grp
  FROM logins
)
SELECT DISTINCT ON (customer_id) customer_id, MIN(login_date), MAX(login_date), COUNT(*) AS days
FROM g
GROUP BY customer_id, grp
ORDER BY customer_id, days DESC, MIN(login_date);`],
      wrong: [{ sql: `WITH g AS (
  SELECT customer_id, login_date, login_date - (ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date))::int AS grp FROM logins
), s AS (
  SELECT customer_id, MIN(login_date) AS st, MAX(login_date) AS en, COUNT(*) AS days,
         RANK() OVER (PARTITION BY customer_id ORDER BY COUNT(*) DESC) AS r
  FROM g GROUP BY customer_id, grp
)
SELECT customer_id, st, en, days FROM s WHERE r = 1 ORDER BY customer_id;` }],
      why: 'Customers 1 and 2 share the best streak: 7 days, 10–16 March. Several customers have two or three streaks of equal length. RANK keeps all of them and gives extra rows. A tie-breaker in ROW_NUMBER (or DISTINCT ON) makes the answer deterministic, and interviewers check for exactly that.',
    },
    {
      id: 'd39-e4', type: 'query',
      prompt: '<b>Department top earners</b> (LeetCode 185 style). Show every employee whose salary is among the <b>top 3 distinct salaries</b> of their department: <code>department</code> (name), <code>employee</code> (first_name), <code>salary</code>. Employees without a department are ignored.',
      hint: '<code>DENSE_RANK() OVER (PARTITION BY department_id ORDER BY salary DESC)</code> in a subquery, keep rank ≤ 3, join departments.',
      solution: `SELECT d.name AS department, r.first_name AS employee, r.salary
FROM (
  SELECT first_name, salary, department_id,
         DENSE_RANK() OVER (PARTITION BY department_id ORDER BY salary DESC) AS rnk
  FROM employees
) r
JOIN departments d ON d.id = r.department_id
WHERE r.rnk <= 3;`,
      alts: [`SELECT d.name, e.first_name, e.salary
FROM employees e JOIN departments d ON d.id = e.department_id
WHERE (SELECT COUNT(DISTINCT e2.salary) FROM employees e2
       WHERE e2.department_id = e.department_id AND e2.salary > e.salary) < 3;`],
      wrong: [
        { sql: `SELECT d.name, r.first_name, r.salary FROM (
  SELECT first_name, salary, department_id, RANK() OVER (PARTITION BY department_id ORDER BY salary DESC) AS rnk FROM employees) r
JOIN departments d ON d.id = r.department_id WHERE r.rnk <= 3;` },
        { sql: `SELECT d.name, r.first_name, r.salary FROM (
  SELECT first_name, salary, department_id, ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY salary DESC) AS rnk FROM employees) r
JOIN departments d ON d.id = r.department_id WHERE r.rnk <= 3;` },
      ],
      why: 'Engineering returns 5 people: Bilal 180k, Omar and Zainab 140k, Fatima and Hamza 120k. That\'s three distinct salaries. RANK jumps to 4 after the 140k tie and loses the 120k pair. ROW_NUMBER cuts at exactly 3 people.',
    },
    {
      id: 'd39-e5', type: 'query',
      prompt: '<b>Cancellation rate</b> (LeetCode 262 style). Consider only orders from customers who placed <b>at least 2 orders</b> in total (any status). For each month, show <code>month</code> as text <code>\'YYYY-MM\'</code> and <code>cancellation_rate</code> = cancelled orders / all orders of those customers in that month, rounded to 2 decimals (a fraction like 0.22, not a percent). Order by month.',
      hint: 'Find eligible customers with <code>GROUP BY customer_id HAVING COUNT(*) &gt;= 2</code>, filter orders to them, then <code>ROUND(AVG((status = \'cancelled\')::int), 2)</code> per month.',
      solution: `WITH eligible AS (
  SELECT customer_id FROM orders GROUP BY customer_id HAVING COUNT(*) >= 2
)
SELECT to_char(order_date, 'YYYY-MM') AS month,
       ROUND(AVG((status = 'cancelled')::int), 2) AS cancellation_rate
FROM orders
WHERE customer_id IN (SELECT customer_id FROM eligible)
GROUP BY 1
ORDER BY 1;`,
      ordered: true,
      alts: [`SELECT to_char(order_date, 'YYYY-MM'),
       ROUND(COUNT(*) FILTER (WHERE status = 'cancelled') * 1.0 / COUNT(*), 2)
FROM (SELECT *, COUNT(*) OVER (PARTITION BY customer_id) AS n FROM orders) o
WHERE n >= 2
GROUP BY 1 ORDER BY 1;`],
      wrong: [
        { sql: `SELECT to_char(order_date, 'YYYY-MM'), ROUND(AVG((status = 'cancelled')::int), 2) FROM orders GROUP BY 1 ORDER BY 1;` },
        { sql: `WITH e AS (SELECT customer_id FROM orders GROUP BY customer_id HAVING COUNT(*) >= 2)
SELECT to_char(order_date, 'YYYY-MM'), ROUND(COUNT(*) FILTER (WHERE status = 'cancelled') / COUNT(*), 2)
FROM orders WHERE customer_id IN (SELECT customer_id FROM e) GROUP BY 1 ORDER BY 1;` },
      ],
      why: 'Customer 13 placed one order (cancelled, February), so excluding them drops February from 0.30 to 0.22. Integer division (<code>count / count</code>) turns every rate into 0. Note that the eligibility filter looks at <i>all</i> of a customer\'s orders, not only that month\'s. That\'s why it must be a separate step.',
    },
    {
      id: 'd39-e6', type: 'query',
      prompt: '<b>Above-average departments.</b> Show departments whose average salary is <b>higher than the company-wide average salary</b> (all employees, including those without a department) <b>and</b> that have at least 3 employees: <code>department</code> (name), <code>employees</code>, <code>avg_salary</code> rounded to 2 decimals.',
      hint: '<code>GROUP BY</code> department, then <code>HAVING COUNT(*) &gt;= 3 AND AVG(salary) &gt; (SELECT AVG(salary) FROM employees)</code>.',
      solution: `SELECT d.name AS department, COUNT(*) AS employees, ROUND(AVG(e.salary), 2) AS avg_salary
FROM employees e
JOIN departments d ON d.id = e.department_id
GROUP BY d.name
HAVING COUNT(*) >= 3
   AND AVG(e.salary) > (SELECT AVG(salary) FROM employees);`,
      alts: [`WITH x AS (
  SELECT e.department_id, e.salary,
         AVG(e.salary) OVER () AS company_avg
  FROM employees e
)
SELECT d.name, COUNT(*), ROUND(AVG(x.salary), 2)
FROM x JOIN departments d ON d.id = x.department_id
GROUP BY d.name, x.company_avg
HAVING COUNT(*) >= 3 AND AVG(x.salary) > x.company_avg;`],
      wrong: [
        { sql: `SELECT d.name, COUNT(*), ROUND(AVG(e.salary), 2) FROM employees e JOIN departments d ON d.id = e.department_id
GROUP BY d.name HAVING AVG(e.salary) > (SELECT AVG(salary) FROM employees);` },
        { sql: `WITH dep AS (SELECT department_id, COUNT(*) AS n, AVG(salary) AS a FROM employees WHERE department_id IS NOT NULL GROUP BY department_id)
SELECT d.name, dep.n, ROUND(dep.a, 2) FROM dep JOIN departments d ON d.id = dep.department_id
WHERE dep.n >= 3 AND dep.a > (SELECT AVG(a) FROM dep);` },
      ],
      why: 'The company average is 103666.67, which gives Engineering, Product and Finance. Without the size rule the one-person Executive department sneaks in. Comparing with the <i>average of department averages</i> (117932.90) is a different number, because small departments count as much as big ones.',
    },
  ],
  leetcode: [
    { id: 262, title: 'Trips and Users', slug: 'trips-and-users', difficulty: 'Hard' },
    { id: 185, title: 'Department Top Three Salaries', slug: 'department-top-three-salaries', difficulty: 'Hard' },
    { id: 601, title: 'Human Traffic of Stadium', slug: 'human-traffic-of-stadium', difficulty: 'Hard' },
  ],
  ownIt: 'Redo LeetCode 262, 185 and 601 <b>from scratch</b>: no looking at your old submissions. Before typing, write the trigger phrase and the pattern you\'ll use for each one (e.g. "3+ consecutive ids → gaps &amp; islands"). Afterwards, note which edge case almost got you.',
};
