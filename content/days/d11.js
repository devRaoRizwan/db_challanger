export default {
  day: 11,
  phase: 2,
  title: 'Window functions: OVER, PARTITION BY, latest-per-group',
  goal: 'Put a group\'s total or average next to every row, number rows within a group, and pick the latest row per customer.',
  learn: `
<p>Welcome to Phase 2. Here's the one idea that unlocks most interview SQL:</p>
<p><b>GROUP BY collapses rows. A window function keeps them.</b></p>
<p><code>SELECT department_id, AVG(salary) … GROUP BY department_id</code> gives one row per department; the individual employees are gone.
Often you want both: each employee <i>and</i> their department's average next to them. Add <code>OVER (…)</code> to an aggregate
and it becomes a window function:</p>
<pre><code>SELECT first_name, department_id, salary,
     AVG(salary) OVER (PARTITION BY department_id) AS dept_avg
FROM employees;</code></pre>
<table class="mini">
<tr><th>first_name</th><th>department_id</th><th>salary</th><th>dept_avg</th></tr>
<tr><td>Komal</td><td>5</td><td>105000</td><td>77333.33</td></tr>
<tr><td>Waqar</td><td>5</td><td>65000</td><td>77333.33</td></tr>
<tr><td>Nida</td><td>5</td><td>62000</td><td>77333.33</td></tr>
<tr><td>Tariq</td><td>7</td><td>85000</td><td>70000.00</td></tr>
<tr><td>Saima</td><td>7</td><td>55000</td><td>70000.00</td></tr>
</table>
<p>All 30 rows survive. <code>PARTITION BY department_id</code> means "for each row, look at the rows with the same department" (like GROUP BY,
but without collapsing). Compare with Day 9: this replaces the correlated subquery, and Postgres computes it in one pass.</p>

<h4>OVER () vs OVER (PARTITION BY …)</h4>
<ul>
<li><code>SUM(salary) OVER ()</code>: empty window = the <b>whole result</b>. Every row gets the company total (3,110,000).</li>
<li><code>SUM(salary) OVER (PARTITION BY department_id)</code>: every row gets its <b>own department's</b> total.</li>
<li><code>COUNT(*) OVER (PARTITION BY department_id)</code>: department headcount on every row.</li>
</ul>
<p>So "salary as % of department payroll" is just <code>100.0 * salary / SUM(salary) OVER (PARTITION BY department_id)</code>.</p>

<h4>ROW_NUMBER(): number the rows inside each group</h4>
<pre><code>ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC, id DESC)</code></pre>
<p>Within each customer, the newest order gets 1, the next gets 2, and so on. The ORDER BY inside <code>OVER</code> decides who is "first";
the extra <code>id DESC</code> is a tie-breaker so the numbering is predictable. Customer 1's orders:</p>
<table class="mini">
<tr><th>customer_id</th><th>id</th><th>order_date</th><th>rn</th></tr>
<tr><td>1</td><td>86</td><td>2025-05-31</td><td class="keep">1</td></tr>
<tr><td>1</td><td>1</td><td>2025-04-16</td><td class="drop">2</td></tr>
<tr><td>1</td><td>62</td><td>2025-04-11</td><td class="drop">3</td></tr>
</table>
<p>Keep <code>rn = 1</code> and you have "latest order per customer", one of the most common backend queries there is. The same trick removes
duplicates: number the copies, keep number 1. <code>RANK()</code> and <code>DENSE_RANK()</code> are siblings that handle ties differently (Day 12).</p>

<div class="callout trap"><b>Trap: you can't filter a window in WHERE.</b>
<code>WHERE ROW_NUMBER() OVER (…) = 1</code> is an error. Windows are computed <i>after</i> WHERE (and after GROUP BY/HAVING), right before
ORDER BY. Compute it in a subquery and filter outside:
<pre><code>SELECT * FROM (
SELECT o.*, ROW_NUMBER() OVER (PARTITION BY customer_id
                               ORDER BY order_date DESC, id DESC) AS rn
FROM orders o
) t
WHERE rn = 1;</code></pre></div>`,
  example: {
    sql: `SELECT first_name, department_id, salary,
     ROUND(AVG(salary) OVER (PARTITION BY department_id), 2) AS dept_avg,
     COUNT(*)    OVER (PARTITION BY department_id) AS dept_size,
     SUM(salary) OVER () AS company_total
FROM employees
ORDER BY department_id, salary DESC;`,
    note: 'Three windows side by side, and still 30 rows. Remove PARTITION BY from dept_avg and see it turn into the company average.',
  },
  exercises: [
    {
      id: 'd11-e1', type: 'query',
      prompt: 'For every employee show <code>first_name</code>, <code>salary</code> and <code>dept_avg</code>: the average salary of their department, rounded to 2 decimals.',
      hint: '<code>ROUND(AVG(salary) OVER (PARTITION BY department_id), 2)</code>.',
      solution: `SELECT first_name, salary,
     ROUND(AVG(salary) OVER (PARTITION BY department_id), 2) AS dept_avg
FROM employees;`,
      alts: [`SELECT e.first_name, e.salary, d.a FROM employees e
JOIN (SELECT department_id, AVG(salary) AS a FROM employees GROUP BY department_id) d
ON d.department_id IS NOT DISTINCT FROM e.department_id;`],
      wrong: [{ sql: `SELECT first_name, salary, ROUND(AVG(salary) OVER (), 2) FROM employees;` }],
      why: 'All 30 rows stay, each with its department\'s average. OVER () would give everyone the company average instead. (Junaid\'s NULL department is its own partition, so his average is his own 65,000.)',
    },
    {
      id: 'd11-e2', type: 'query',
      prompt: 'Show <code>first_name</code>, <code>department_id</code>, <code>salary</code> and <code>pct_of_dept</code>: the employee\'s salary as a percentage of their department\'s total payroll, rounded to 2 decimals.',
      hint: '<code>100.0 * salary / SUM(salary) OVER (PARTITION BY department_id)</code>.',
      solution: `SELECT first_name, department_id, salary,
     ROUND(100.0 * salary / SUM(salary) OVER (PARTITION BY department_id), 2) AS pct_of_dept
FROM employees;`,
      wrong: [{ sql: `SELECT first_name, department_id, salary, ROUND(100.0 * salary / SUM(salary) OVER (), 2) FROM employees;` }],
      why: 'The window total is per department, so each department\'s percentages add up to 100. Ayesha is 100% of Executive; Tariq is 60.71% of HR.',
    },
    {
      id: 'd11-e3', type: 'query',
      prompt: 'Using a window function this time, find employees who earn <b>more than their department\'s average</b>. Show <code>first_name</code>, <code>department_id</code>, <code>salary</code>.',
      hint: 'Compute <code>AVG(salary) OVER (PARTITION BY department_id)</code> in a subquery, then filter it in the outer WHERE.',
      solution: `SELECT first_name, department_id, salary
FROM (
SELECT first_name, department_id, salary,
       AVG(salary) OVER (PARTITION BY department_id) AS dept_avg
FROM employees
) t
WHERE salary > dept_avg;`,
      alts: [`SELECT e.first_name, e.department_id, e.salary FROM employees e
WHERE e.salary > (SELECT AVG(x.salary) FROM employees x WHERE x.department_id = e.department_id);`],
      why: 'Same 11 people as Day 9\'s correlated subquery. Putting the window in WHERE directly is an error, so it is wrapped in a subquery first.',
    },
    {
      id: 'd11-e4', type: 'query',
      prompt: 'Show the <b>latest order of each customer</b>: <code>customer_id</code>, order <code>id</code>, <code>order_date</code>, <code>status</code>. If a customer had two orders on the same day, take the higher id.',
      hint: '<code>ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC, id DESC)</code> in a subquery, keep <code>rn = 1</code>.',
      solution: `SELECT customer_id, id, order_date, status
FROM (
SELECT o.*,
       ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC, id DESC) AS rn
FROM orders o
) t
WHERE rn = 1;`,
      alts: [`SELECT o.customer_id, o.id, o.order_date, o.status FROM orders o
WHERE o.id = (SELECT o2.id FROM orders o2 WHERE o2.customer_id = o.customer_id
              ORDER BY o2.order_date DESC, o2.id DESC LIMIT 1);`],
      wrong: [{ sql: `SELECT customer_id, id, order_date, status FROM (SELECT o.*, ROW_NUMBER() OVER (ORDER BY order_date DESC, id DESC) AS rn FROM orders o) t WHERE rn = 1;` }],
      why: '24 rows, one per customer who ordered. Without PARTITION BY the numbering runs over the whole table, so only the single newest order overall gets rn = 1.',
    },
    {
      id: 'd11-e5', type: 'query',
      prompt: 'For customers <b>1 to 3</b>, number each customer\'s orders from oldest to newest. Show <code>customer_id</code>, order <code>id</code>, <code>order_date</code>, <code>order_number</code>. Order by <code>customer_id</code>, then <code>order_number</code>.',
      hint: '<code>ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date, id)</code>, with <code>WHERE customer_id &lt;= 3</code>.',
      solution: `SELECT customer_id, id, order_date,
     ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date, id) AS order_number
FROM orders
WHERE customer_id <= 3
ORDER BY customer_id, order_number;`,
      ordered: true,
      wrong: [{ sql: `SELECT customer_id, id, order_date, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY id) FROM orders WHERE customer_id <= 3 ORDER BY 1, 4;` }],
      why: 'The numbering restarts at 1 for each customer. Ordering the window by id is not the same as ordering by date: customer 1\'s order 62 came before order 1. Note that WHERE runs first, so the window only sees customers 1–3.',
    },
    {
      id: 'd11-e6', type: 'query',
      prompt: 'LeetCode 1070 style: for each product, find the date of its <b>first</b> order and return <b>every</b> order_items row from that date. Show <code>product_id</code>, <code>order_date</code>, <code>quantity</code>.',
      hint: 'In a subquery, join order_items to orders and add <code>MIN(o.order_date) OVER (PARTITION BY oi.product_id)</code>. Keep rows where the date equals it.',
      solution: `SELECT product_id, order_date, quantity
FROM (
SELECT oi.product_id, o.order_date, oi.quantity,
       MIN(o.order_date) OVER (PARTITION BY oi.product_id) AS first_date
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
) t
WHERE order_date = first_date;`,
      alts: [`SELECT oi.product_id, o.order_date, oi.quantity
FROM order_items oi JOIN orders o ON o.id = oi.order_id
WHERE (oi.product_id, o.order_date) IN (
SELECT oi2.product_id, MIN(o2.order_date)
FROM order_items oi2 JOIN orders o2 ON o2.id = oi2.order_id
GROUP BY oi2.product_id);`],
      wrong: [{ sql: `SELECT product_id, order_date, quantity FROM (
SELECT oi.product_id, o.order_date, oi.quantity,
       ROW_NUMBER() OVER (PARTITION BY oi.product_id ORDER BY o.order_date, oi.id) AS rn
FROM order_items oi JOIN orders o ON o.id = oi.order_id) t WHERE rn = 1;` }],
      why: '14 rows: the Coffee Mug (product 12) was ordered twice on its first day, 2025-02-04, and the task asks for both. ROW_NUMBER = 1 keeps only one of them; comparing with MIN keeps every tie.',
    },
    {
      id: 'd11-q1', type: 'quiz',
      prompt: 'Why does <code>SELECT … FROM orders WHERE ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC) = 1</code> fail?',
      options: [
        'ROW_NUMBER needs a GROUP BY',
        'Window functions are computed after WHERE, so WHERE cannot see them',
        'PARTITION BY cannot be used with ORDER BY',
        'It doesn\'t fail; it returns the latest order per customer',
      ],
      answer: 1,
      why: 'Logical order: FROM → WHERE → GROUP BY → HAVING → <b>window functions</b> → SELECT → ORDER BY. Compute the window in a subquery (or CTE, Day 16) and filter in the outer query.',
    },
  ],
  leetcode: [
    { id: 1070, title: 'Product Sales Analysis III', slug: 'product-sales-analysis-iii', difficulty: 'Medium' },
    { id: 1789, title: 'Primary Department for Each Employee', slug: 'primary-department-for-each-employee', difficulty: 'Easy' },
  ],
  ownIt: 'Explain the difference between <code>AVG(salary) … GROUP BY department_id</code> and <code>AVG(salary) OVER (PARTITION BY department_id)</code>, and why "latest order per customer" needs a subquery around ROW_NUMBER().',
};
