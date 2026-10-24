export default {
  day: 16,
  phase: 2,
  title: 'CTEs (WITH): multi-step queries',
  goal: 'Break a hard question into named steps with WITH, and build the query one runnable step at a time.',
  learn: `
<p>By now your queries have subqueries inside subqueries. They work, but they read inside-out. A <b>CTE</b>
(Common Table Expression) lets you name each step and read the query top to bottom, like code:</p>
<pre><code>WITH dept_avg AS (                       -- step 1: a named, temporary result
  SELECT department_id, AVG(salary) AS avg_salary
  FROM employees
  GROUP BY department_id
)
SELECT d.name, ROUND(a.avg_salary) AS avg_salary  -- step 2: use it like a table
FROM dept_avg a
JOIN departments d ON d.id = a.department_id
WHERE a.avg_salary &gt; (SELECT AVG(salary) FROM employees);</code></pre>
<p>A CTE only lives for this one statement. It's not a view and nothing is saved.</p>

<h4>Several steps, each building on the last</h4>
<pre><code>WITH spend AS (            -- 1. spend per customer
  SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status &lt;&gt; 'cancelled'
  GROUP BY o.customer_id
),
tiers AS (                 -- 2. label them (uses step 1)
  SELECT customer_id,
         CASE WHEN total &gt;= 2000 THEN 'high'
              WHEN total &gt;= 1000 THEN 'mid' ELSE 'low' END AS tier
  FROM spend
)
SELECT tier, COUNT(*) FROM tiers GROUP BY tier;   -- 3. summarise</code></pre>
<table class="mini">
<tr><th>tier</th><th>count</th></tr>
<tr><td>high</td><td>4</td></tr><tr><td>mid</td><td>10</td></tr><tr><td>low</td><td>9</td></tr>
</table>
<p>Separate CTEs with commas and write <code>WITH</code> only once. A CTE can be used <b>more than once</b> in the final query,
something a subquery can't do without being copy-pasted.</p>

<h4>The interview strategy: build in steps</h4>
<ol>
<li>Write CTE 1 and end with <code>SELECT * FROM step1</code>. Run it and check the rows.</li>
<li>Add CTE 2 below it, change the last line to <code>SELECT * FROM step2</code>, and run it again.</li>
<li>Only then write the final SELECT.</li>
</ol>
<p>Talking through each step out loud ("first I get spend per customer…") is exactly what interviewers want to hear,
and if you run out of time, the finished steps still earn credit.</p>

<div class="callout trap"><b>Trap: fan-out.</b> To compare "amount ordered" with "amount paid" per customer, you might join
<code>orders → order_items</code> <i>and</i> <code>orders → payments</code> in one query. An order with 3 items and 2 payments then
becomes 3 × 2 = 6 rows, and both SUMs are inflated. The fix is to <b>aggregate each side in its own CTE first</b>, then join
the small results.</div>

<div class="callout">Postgres 12+ inlines simple CTEs into the main query, so they are not slower than subqueries.
(Before 12 they were always computed separately, an "optimization fence". You may still hear about that.)
MySQL supports <code>WITH</code> since 8.0.</div>`,
  example: {
    sql: `WITH monthly AS (
  SELECT date_trunc('month', o.order_date)::date AS month,
         SUM(oi.quantity * oi.unit_price) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY 1
)
SELECT month, revenue,
       ROUND(revenue / (SELECT SUM(revenue) FROM monthly) * 100, 1) AS pct_of_year,
       RANK() OVER (ORDER BY revenue DESC) AS rank_in_year
FROM monthly
ORDER BY month;`,
    note: 'The CTE is used twice: once as the FROM, once inside the scalar subquery. Try replacing the last SELECT with SELECT * FROM monthly to "run step 1".',
  },
  exercises: [
    {
      id: 'd16-e1', type: 'query',
      prompt: 'Which departments have an <b>average salary above the company-wide average</b>? Use a CTE. Show department <code>name</code> and <code>avg_salary</code> rounded to 0 decimals.',
      hint: 'CTE: average salary per department_id. Final query: join departments and compare to <code>(SELECT AVG(salary) FROM employees)</code>.',
      solution: `WITH dept_avg AS (
  SELECT department_id, AVG(salary) AS avg_salary
  FROM employees
  GROUP BY department_id
)
SELECT d.name, ROUND(a.avg_salary) AS avg_salary
FROM dept_avg a
JOIN departments d ON d.id = a.department_id
WHERE a.avg_salary > (SELECT AVG(salary) FROM employees);`,
      alts: [
        `SELECT d.name, ROUND(AVG(e.salary)) FROM employees e JOIN departments d ON d.id = e.department_id
GROUP BY d.name HAVING AVG(e.salary) > (SELECT AVG(salary) FROM employees);`,
      ],
      wrong: [{ sql: `WITH dept_avg AS (SELECT department_id, AVG(salary) AS avg_salary FROM employees GROUP BY department_id)
SELECT d.name, ROUND(a.avg_salary) FROM dept_avg a JOIN departments d ON d.id = a.department_id
WHERE a.avg_salary > (SELECT AVG(avg_salary) FROM dept_avg);` }],
      why: 'The company average is 103,666.67, and 4 departments beat it: Executive, Product, Engineering and Finance. The wrong version compares to the <b>average of department averages</b>, which weighs tiny departments (Executive has 1 person) the same as Engineering (11). Always ask "average of what?"',
    },
    {
      id: 'd16-e2', type: 'query',
      prompt: 'Using <b>two chained CTEs</b>: compute each customer\'s spend on non-cancelled orders, label it <code>\'high\'</code> (≥ 2000), <code>\'mid\'</code> (≥ 1000) or <code>\'low\'</code>, then return <code>tier</code> and <code>customers</code> (how many customers per tier).',
      hint: 'CTE <code>spend</code> → CTE <code>tiers</code> with a CASE → <code>SELECT tier, COUNT(*) FROM tiers GROUP BY tier</code>. CASE checks branches in order, so test ≥ 2000 first.',
      solution: `WITH spend AS (
  SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.customer_id
),
tiers AS (
  SELECT customer_id,
         CASE WHEN total >= 2000 THEN 'high'
              WHEN total >= 1000 THEN 'mid'
              ELSE 'low' END AS tier
  FROM spend
)
SELECT tier, COUNT(*) AS customers
FROM tiers
GROUP BY tier;`,
      alts: [
        `SELECT tier, COUNT(*) FROM (
  SELECT CASE WHEN SUM(oi.quantity * oi.unit_price) >= 2000 THEN 'high'
              WHEN SUM(oi.quantity * oi.unit_price) >= 1000 THEN 'mid' ELSE 'low' END AS tier
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled' GROUP BY o.customer_id) t
GROUP BY tier;`,
      ],
      wrong: [{ sql: `WITH spend AS (SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.status <> 'cancelled' GROUP BY o.customer_id)
SELECT CASE WHEN total >= 1000 THEN 'mid' WHEN total >= 2000 THEN 'high' ELSE 'low' END AS tier, COUNT(*)
FROM spend GROUP BY 1;` }],
      why: 'high 4, mid 10, low 9 (23 customers have non-cancelled orders). If you test ≥ 1000 first, the high spenders are caught by the "mid" branch and "high" never appears.',
    },
    {
      id: 'd16-e3', type: 'query',
      prompt: 'Which months beat the <b>average month</b>? Using one CTE <code>monthly</code> (revenue of non-cancelled orders per <code>date_trunc(\'month\', order_date)</code>) <b>twice</b>, show <code>month</code> and <code>revenue</code> for months whose revenue is above the average monthly revenue.',
      hint: '<code>… FROM monthly WHERE revenue &gt; (SELECT AVG(revenue) FROM monthly)</code>.',
      solution: `WITH monthly AS (
  SELECT date_trunc('month', o.order_date) AS month,
         SUM(oi.quantity * oi.unit_price) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY 1
)
SELECT month, revenue
FROM monthly
WHERE revenue > (SELECT AVG(revenue) FROM monthly);`,
      alts: [
        `SELECT month, revenue FROM (
  SELECT date_trunc('month', o.order_date) AS month, SUM(oi.quantity * oi.unit_price) AS revenue,
         AVG(SUM(oi.quantity * oi.unit_price)) OVER () AS avg_rev
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled' GROUP BY 1) t
WHERE revenue > avg_rev;`,
      ],
      wrong: [{ sql: `SELECT date_trunc('month', o.order_date), SUM(oi.quantity * oi.unit_price)
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled' GROUP BY 1
HAVING SUM(oi.quantity * oi.unit_price) > (SELECT AVG(quantity * unit_price) FROM order_items);` }],
      why: '5 months: January, April, August, October and December. The wrong version compares to the average <i>line item</i> instead of the average month, so every month passes. The window alt (<code>AVG(…) OVER ()</code>) is another way to "use the result twice".',
    },
    {
      id: 'd16-e4', type: 'query',
      prompt: 'Finance asks: which <b>non-cancelled</b> orders are not fully paid? Show <code>order_id</code>, <code>total</code> (from order_items), <code>paid</code> (sum of payments, <b>0</b> if none) and <code>due</code> (total − paid), for orders where due &gt; 0.',
      hint: 'CTE 1: total per order. CTE 2: paid per order. Then <code>LEFT JOIN</code> them and use <code>COALESCE(paid, 0)</code>.',
      solution: `WITH totals AS (
  SELECT o.id AS order_id, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.id
),
paid AS (
  SELECT order_id, SUM(amount) AS paid
  FROM payments
  GROUP BY order_id
)
SELECT t.order_id, t.total, COALESCE(p.paid, 0) AS paid, t.total - COALESCE(p.paid, 0) AS due
FROM totals t
LEFT JOIN paid p ON p.order_id = t.order_id
WHERE t.total - COALESCE(p.paid, 0) > 0;`,
      alts: [
        `SELECT o.id, SUM(oi.quantity * oi.unit_price), 0, SUM(oi.quantity * oi.unit_price)
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)
GROUP BY o.id;`,
      ],
      wrong: [{ sql: `WITH totals AS (SELECT o.id AS order_id, SUM(oi.quantity * oi.unit_price) AS total
  FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.status <> 'cancelled' GROUP BY o.id),
paid AS (SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id)
SELECT t.order_id, t.total, p.paid, t.total - p.paid FROM totals t JOIN paid p ON p.order_id = t.order_id
WHERE t.total - p.paid > 0;` }],
      why: '7 pending orders have no payments at all (2, 22, 38, 48, 53, 76, 81). Every order that has payments is fully paid, so the alt (NOT EXISTS) gives the same rows here, but the CTE version would also catch partly-paid orders. With an inner JOIN, unpaid orders vanish and you get 0 rows: the worst possible answer to "who owes us money?".',
    },
    {
      id: 'd16-e5', type: 'query',
      prompt: 'Per customer, compare <code>ordered</code> (item total of their non-cancelled orders) with <code>paid</code> (sum of all their payments, 0 if none). Show <code>customer_id</code>, <code>ordered</code>, <code>paid</code> only for customers where paid &lt; ordered.',
      hint: 'Aggregate items per customer in one CTE and payments per customer in another. Join the two small results. Don\'t join items and payments in the same FROM.',
      solution: `WITH items AS (
  SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS ordered
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.customer_id
),
pays AS (
  SELECT o.customer_id, SUM(p.amount) AS paid
  FROM orders o
  JOIN payments p ON p.order_id = o.id
  GROUP BY o.customer_id
)
SELECT i.customer_id, i.ordered, COALESCE(p.paid, 0) AS paid
FROM items i
LEFT JOIN pays p ON p.customer_id = i.customer_id
WHERE COALESCE(p.paid, 0) < i.ordered;`,
      alts: [
        `SELECT c.id,
       (SELECT SUM(oi.quantity * oi.unit_price) FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.customer_id = c.id AND o.status <> 'cancelled') AS ordered,
       COALESCE((SELECT SUM(p.amount) FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.customer_id = c.id), 0) AS paid
FROM customers c
WHERE COALESCE((SELECT SUM(p.amount) FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.customer_id = c.id), 0)
    < (SELECT SUM(oi.quantity * oi.unit_price) FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE o.customer_id = c.id AND o.status <> 'cancelled');`,
      ],
      wrong: [{ sql: `SELECT o.customer_id, SUM(oi.quantity * oi.unit_price), COALESCE(SUM(p.amount), 0)
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
LEFT JOIN payments p ON p.order_id = o.id
WHERE o.status <> 'cancelled'
GROUP BY o.customer_id
HAVING COALESCE(SUM(p.amount), 0) < SUM(oi.quantity * oi.unit_price);` }],
      why: '6 customers: 2, 8, 9, 11, 14, 22, each with an unpaid pending order. The one-query version fans out: every item row is repeated once per payment and every payment once per item, so both sums are multiplied. It finds only 3 of the 6 customers, and customer 14 suddenly "ordered" 3377.99 instead of 2053.99. Aggregate first, join second.',
    },
    {
      id: 'd16-e6', type: 'query',
      prompt: '<b>LeetCode 602 on our data:</b> a referral link connects two customers (<code>referred_by</code> → <code>id</code>). Count each customer\'s connections in <b>either direction</b> (people they referred + the person who referred them). Return the customer(s) with the most connections: <code>id</code>, <code>connections</code>. Include ties.',
      hint: 'CTE with <code>SELECT referred_by AS id … UNION ALL SELECT id …</code> (both ends of every link), then count per id and keep the max.',
      solution: `WITH ends AS (
  SELECT referred_by AS id FROM customers WHERE referred_by IS NOT NULL
  UNION ALL
  SELECT id FROM customers WHERE referred_by IS NOT NULL
),
counts AS (
  SELECT id, COUNT(*) AS connections
  FROM ends
  GROUP BY id
)
SELECT id, connections
FROM counts
WHERE connections = (SELECT MAX(connections) FROM counts);`,
      alts: [
        `SELECT id, n FROM (
  SELECT id, COUNT(*) AS n, RANK() OVER (ORDER BY COUNT(*) DESC) AS r
  FROM (SELECT referred_by AS id FROM customers WHERE referred_by IS NOT NULL
        UNION ALL SELECT id FROM customers WHERE referred_by IS NOT NULL) e
  GROUP BY id) t
WHERE r = 1;`,
      ],
      wrong: [
        { sql: `WITH ends AS (SELECT referred_by AS id FROM customers WHERE referred_by IS NOT NULL
  UNION SELECT id FROM customers WHERE referred_by IS NOT NULL)
SELECT id, COUNT(*) FROM ends GROUP BY id ORDER BY 2 DESC LIMIT 1;` },
        { sql: `SELECT referred_by, COUNT(*) FROM customers WHERE referred_by IS NOT NULL
GROUP BY referred_by ORDER BY 2 DESC, 1 LIMIT 1;` },
      ],
      why: 'Two customers tie with 2 connections: 4 (referred 5 and 10) and 9 (referred by 7, referred 22). Counting only one direction misses customer 9. <code>UNION</code> (without ALL) removes duplicates, so everyone ends up with 1. In 602, LeetCode promises one winner, but the "follow-up" asks for ties: this is how you handle it.',
    },
    {
      id: 'd16-q1', type: 'quiz',
      prompt: 'Which statement about <code>WITH a AS (…), b AS (…) SELECT …</code> is <b>true</b>?',
      options: [
        'b can reference a, and the final SELECT can use a and b, each as many times as needed',
        'a and b are saved in the database until you DROP them',
        'You must write WITH before each CTE: WITH a AS (…) WITH b AS (…)',
        'A CTE can be referenced only once, otherwise Postgres raises an error',
      ],
      answer: 0,
      why: 'CTEs are scoped to one statement, separated by commas, and later CTEs can read earlier ones. Reusing a CTE is one of the main reasons to write one.',
    },
  ],
  leetcode: [
    { id: 1341, title: 'Movie Rating', slug: 'movie-rating', difficulty: 'Medium' },
    { id: 585, title: 'Investments in 2016', slug: 'investments-in-2016', difficulty: 'Medium' },
    { id: 602, title: 'Friend Requests II: Who Has the Most Friends', slug: 'friend-requests-ii-who-has-the-most-friends', difficulty: 'Medium' },
    { id: 626, title: 'Exchange Seats', slug: 'exchange-seats', difficulty: 'Medium' },
  ],
  ownIt: 'Take the "ordered vs paid per customer" query and explain, with a tiny example (one order, 3 items, 2 payments), why joining both tables at once inflates the sums and how the two-CTE version avoids it.',
};
