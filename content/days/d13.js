export default {
  day: 13,
  phase: 2,
  title: 'Top-N per group',
  goal: 'Return the top N rows inside every group, and pick the right ranking function when there are ties.',
  learn: `
<p>"Top 3 products per category", "two best-paid people in each department", "latest 5 orders per customer".
This is the single most common pattern in SQL interviews. A plain <code>ORDER BY … LIMIT 3</code> can't do it,
because <code>LIMIT</code> works on the <b>whole result</b>, not per group.</p>

<h4>The recipe: rank inside each group, then filter</h4>
<pre><code>SELECT name, first_name, salary
FROM (
  SELECT d.name, e.first_name, e.salary,
         DENSE_RANK() OVER (PARTITION BY e.department_id
                            ORDER BY e.salary DESC) AS rnk
  FROM employees e
  JOIN departments d ON d.id = e.department_id
) ranked
WHERE rnk &lt;= 2;</code></pre>
<p>You can't write <code>WHERE rnk &lt;= 2</code> in the same SELECT that creates <code>rnk</code>, because
WHERE runs <i>before</i> window functions. So you rank in a subquery (or CTE) and filter outside.</p>

<h4>Which ranking function? It depends on ties</h4>
<p>Here is Engineering, where salaries tie at 140000 and 120000:</p>
<table class="mini">
<tr><th>first_name</th><th>salary</th><th>ROW_NUMBER</th><th>RANK</th><th>DENSE_RANK</th></tr>
<tr><td>Bilal</td><td>180000</td><td>1</td><td>1</td><td>1</td></tr>
<tr><td>Omar</td><td>140000</td><td>2</td><td>2</td><td>2</td></tr>
<tr><td>Zainab</td><td>140000</td><td class="drop">3</td><td>2</td><td class="keep">2</td></tr>
<tr><td>Hamza</td><td>120000</td><td>4</td><td>4</td><td class="keep">3</td></tr>
<tr><td>Fatima</td><td>120000</td><td>5</td><td>4</td><td class="keep">3</td></tr>
</table>
<ul>
<li><b>ROW_NUMBER</b>: exactly N rows per group, ties broken arbitrarily. Use it for "give me 2 rows per department, no more"
(and add a tie-breaker like <code>ORDER BY salary DESC, id</code> so the result is repeatable).</li>
<li><b>RANK</b>: "top 2 <i>people</i>, ties included". <code>rnk &lt;= 2</code> keeps Bilal, Omar and Zainab, and a third place may not exist.</li>
<li><b>DENSE_RANK</b>: "top 2 <i>salary values</i>". <code>rnk &lt;= 3</code> gives 180000, 140000 and 120000 with everyone who earns them. This is LeetCode 185.</li>
</ul>

<div class="callout trap"><b>Trap:</b> using ROW_NUMBER when the question says "top earners". With <code>rn &lt;= 2</code>
Zainab disappears even though she earns exactly as much as Omar. In an interview, <b>ask</b>: "If two people tie, do we keep both?"</div>

<h4>Approach 2: correlated COUNT (works in any SQL)</h4>
<pre><code>SELECT e1.first_name, e1.salary
FROM employees e1
WHERE (SELECT COUNT(DISTINCT e2.salary)
       FROM employees e2
       WHERE e2.department_id = e1.department_id
         AND e2.salary &gt; e1.salary) &lt; 3;</code></pre>
<p>"Keep me if fewer than 3 distinct salaries in my department beat mine." That's DENSE_RANK ≤ 3 without window functions,
the classic answer to 185 from before MySQL 8.</p>

<h4>Approach 3: LATERAL (Postgres)</h4>
<pre><code>SELECT d.name, top.first_name, top.salary
FROM departments d
LEFT JOIN LATERAL (
  SELECT first_name, salary FROM employees e
  WHERE e.department_id = d.id
  ORDER BY salary DESC, id
  LIMIT 2
) top ON true;</code></pre>
<p><code>LATERAL</code> lets a subquery in FROM refer to the row on its left, so it runs "once per department",
and <code>LIMIT</code> now works per group. With an index on <code>(department_id, salary)</code> this is often the fastest
option on big tables. <code>LEFT JOIN … ON true</code> keeps departments with no employees (Legal).</p>`,
  example: {
    sql: `SELECT d.name, e.first_name, e.salary,
       ROW_NUMBER() OVER w AS row_num,
       RANK()       OVER w AS rnk,
       DENSE_RANK() OVER w AS dense_rnk
FROM employees e
JOIN departments d ON d.id = e.department_id
WINDOW w AS (PARTITION BY e.department_id ORDER BY e.salary DESC)
ORDER BY d.name, e.salary DESC, e.id;`,
    note: 'WINDOW w AS (...) names a window so you can reuse it. Look at Engineering and Sales: that is where the three functions disagree.',
  },
  exercises: [
    {
      id: 'd13-e1', type: 'query',
      prompt: 'Find the <b>top 2 earners in each department, ties included</b> (anyone whose salary is one of the top 2 positions, so a tie for 2nd keeps both). Show department <code>name</code>, <code>first_name</code>, <code>salary</code>. Skip employees with no department.',
      hint: '<code>RANK() OVER (PARTITION BY department_id ORDER BY salary DESC)</code> in a subquery, then <code>WHERE rnk &lt;= 2</code>.',
      solution: `SELECT name, first_name, salary
FROM (
  SELECT d.name, e.first_name, e.salary,
         RANK() OVER (PARTITION BY e.department_id ORDER BY e.salary DESC) AS rnk
  FROM employees e
  JOIN departments d ON d.id = e.department_id
) ranked
WHERE rnk <= 2;`,
      alts: [
        `SELECT d.name, e.first_name, e.salary FROM employees e JOIN departments d ON d.id = e.department_id
WHERE (SELECT COUNT(*) FROM employees e2 WHERE e2.department_id = e.department_id AND e2.salary > e.salary) < 2;`,
      ],
      wrong: [{ sql: `SELECT name, first_name, salary FROM (
  SELECT d.name, e.first_name, e.salary,
         ROW_NUMBER() OVER (PARTITION BY e.department_id ORDER BY e.salary DESC) AS rn
  FROM employees e JOIN departments d ON d.id = e.department_id) t
WHERE rn <= 2;` }],
      why: 'Engineering returns 3 people: Bilal, Omar and Zainab (tied at 140000). ROW_NUMBER silently drops one of the tied pair, and which one it drops can change between runs. The correlated version reads "fewer than 2 people earn more than me", which is exactly RANK ≤ 2.',
    },
    {
      id: 'd13-e2', type: 'query',
      prompt: 'For each department, list its <b>2 longest-serving employees</b> (earliest <code>hire_date</code>). Exactly 2 per department (or fewer if the department is smaller). Show department <code>name</code>, <code>first_name</code>, <code>hire_date</code>.',
      hint: 'Here you want exactly N rows, so <code>ROW_NUMBER()</code> with <code>ORDER BY hire_date, id</code> as the tie-breaker.',
      solution: `SELECT name, first_name, hire_date
FROM (
  SELECT d.name, e.first_name, e.hire_date,
         ROW_NUMBER() OVER (PARTITION BY e.department_id ORDER BY e.hire_date, e.id) AS rn
  FROM employees e
  JOIN departments d ON d.id = e.department_id
) t
WHERE rn <= 2;`,
      alts: [
        `SELECT d.name, top.first_name, top.hire_date FROM departments d
JOIN LATERAL (SELECT first_name, hire_date FROM employees e WHERE e.department_id = d.id ORDER BY hire_date, id LIMIT 2) top ON true;`,
      ],
      wrong: [{ sql: `SELECT d.name, e.first_name, e.hire_date FROM employees e JOIN departments d ON d.id = e.department_id ORDER BY e.hire_date LIMIT 2;` }],
      why: 'Executive has only Ayesha, so it returns 1 row; everyone else returns 2, for 13 rows. A global <code>LIMIT 2</code> gives the 2 oldest hires in the <i>whole company</i>, not per department. The LATERAL version uses <code>JOIN</code> (not LEFT JOIN), so Legal, which has nobody, is skipped.',
    },
    {
      id: 'd13-e3', type: 'query',
      prompt: 'Find the <b>top 3 products by revenue in each category</b>. Revenue = <code>SUM(quantity * unit_price)</code> over order_items whose order is <b>not cancelled</b>. Show <code>category</code>, product <code>name</code>, <code>revenue</code>.',
      hint: 'Step 1: GROUP BY category, product to get revenue. Step 2: <code>RANK() OVER (PARTITION BY category ORDER BY revenue DESC)</code>. Step 3: keep rank ≤ 3. You can put a window function over an aggregate in the same SELECT.',
      solution: `SELECT category, name, revenue
FROM (
  SELECT p.category, p.name,
         SUM(oi.quantity * oi.unit_price) AS revenue,
         RANK() OVER (PARTITION BY p.category
                      ORDER BY SUM(oi.quantity * oi.unit_price) DESC) AS rnk
  FROM order_items oi
  JOIN orders o   ON o.id = oi.order_id
  JOIN products p ON p.id = oi.product_id
  WHERE o.status <> 'cancelled'
  GROUP BY p.category, p.name
) t
WHERE rnk <= 3;`,
      alts: [
        `WITH rev AS (
  SELECT p.category, p.name, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
  WHERE o.status <> 'cancelled' GROUP BY p.category, p.name)
SELECT category, name, revenue FROM (
  SELECT *, DENSE_RANK() OVER (PARTITION BY category ORDER BY revenue DESC) AS r FROM rev) t
WHERE r <= 3;`,
      ],
      wrong: [{ sql: `SELECT p.category, p.name, SUM(oi.quantity * oi.unit_price) AS revenue
FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
WHERE o.status <> 'cancelled'
GROUP BY p.category, p.name ORDER BY revenue DESC LIMIT 3;` }],
      why: 'Window functions run after GROUP BY, so <code>OVER (… ORDER BY SUM(…))</code> ranks the grouped rows. Accessories only has 2 products with sales, so the result has 11 rows, not 12. "Top 3" never promises 3.',
    },
    {
      id: 'd13-e4', type: 'query',
      prompt: '<b>LeetCode 185 style:</b> a "high earner" is someone whose salary is among the <b>top 3 distinct salaries</b> of their department. Show department <code>name</code>, <code>first_name</code>, <code>salary</code>. Solve it <b>without window functions</b> first, then try DENSE_RANK.',
      hint: 'Correlated subquery: <code>(SELECT COUNT(DISTINCT e2.salary) FROM employees e2 WHERE e2.department_id = e1.department_id AND e2.salary &gt; e1.salary) &lt; 3</code>.',
      solution: `SELECT d.name, e1.first_name, e1.salary
FROM employees e1
JOIN departments d ON d.id = e1.department_id
WHERE (SELECT COUNT(DISTINCT e2.salary)
       FROM employees e2
       WHERE e2.department_id = e1.department_id
         AND e2.salary > e1.salary) < 3;`,
      alts: [
        `SELECT name, first_name, salary FROM (
  SELECT d.name, e.first_name, e.salary,
         DENSE_RANK() OVER (PARTITION BY e.department_id ORDER BY e.salary DESC) AS r
  FROM employees e JOIN departments d ON d.id = e.department_id) t
WHERE r <= 3;`,
      ],
      wrong: [
        { sql: `SELECT name, first_name, salary FROM (
  SELECT d.name, e.first_name, e.salary,
         RANK() OVER (PARTITION BY e.department_id ORDER BY e.salary DESC) AS r
  FROM employees e JOIN departments d ON d.id = e.department_id) t
WHERE r <= 3;` },
        { sql: `SELECT d.name, e1.first_name, e1.salary FROM employees e1 JOIN departments d ON d.id = e1.department_id
WHERE (SELECT COUNT(*) FROM employees e2 WHERE e2.department_id = e1.department_id AND e2.salary > e1.salary) < 3;` },
      ],
      why: 'Engineering keeps 5 people: Bilal (180000), Omar and Zainab (140000), Hamza and Fatima (120000). RANK skips from 2 to 4 after the tie, so it loses the 120000 pair. <code>COUNT(*)</code> without DISTINCT has the same bug: it counts people above you, not salary values.',
    },
    {
      id: 'd13-e5', type: 'query',
      prompt: 'Using <code>LATERAL</code>, show <b>every department</b> with its single best-paid employee (ties broken by lowest <code>id</code>). Departments with no employees must appear with <code>NULL</code>s. Columns: department <code>name</code>, <code>first_name</code>, <code>salary</code>.',
      hint: '<code>FROM departments d LEFT JOIN LATERAL (SELECT … WHERE e.department_id = d.id ORDER BY salary DESC, id LIMIT 1) top ON true</code>.',
      solution: `SELECT d.name, top.first_name, top.salary
FROM departments d
LEFT JOIN LATERAL (
  SELECT first_name, salary
  FROM employees e
  WHERE e.department_id = d.id
  ORDER BY salary DESC, id
  LIMIT 1
) top ON true;`,
      alts: [
        `SELECT d.name, t.first_name, t.salary FROM departments d
LEFT JOIN (SELECT department_id, first_name, salary,
                  ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY salary DESC, id) AS rn
           FROM employees) t ON t.department_id = d.id AND t.rn = 1;`,
      ],
      wrong: [{ sql: `SELECT d.name, top.first_name, top.salary FROM departments d
JOIN LATERAL (SELECT first_name, salary FROM employees e WHERE e.department_id = d.id ORDER BY salary DESC, id LIMIT 1) top ON true;` }],
      why: '8 rows: Legal shows NULL, NULL. A plain <code>JOIN LATERAL</code> drops departments where the subquery returns nothing, just like an inner join. In the window alt, note that <code>t.rn = 1</code> sits in the ON clause; in WHERE it would remove Legal again (the Day 7 ON vs WHERE trap).',
    },
    {
      id: 'd13-e6', type: 'query',
      prompt: '<b>LeetCode 184 style:</b> show the employee(s) with the <b>highest salary in each department</b>, ties included, <i>using GROUP BY</i> (no window functions). Columns: department <code>name</code>, <code>first_name</code>, <code>salary</code>.',
      hint: 'Compute <code>MAX(salary)</code> per department_id in a subquery, then keep rows where <code>(department_id, salary) IN (…)</code>.',
      solution: `SELECT d.name, e.first_name, e.salary
FROM employees e
JOIN departments d ON d.id = e.department_id
WHERE (e.department_id, e.salary) IN (
  SELECT department_id, MAX(salary)
  FROM employees
  GROUP BY department_id
);`,
      alts: [
        `SELECT d.name, e.first_name, e.salary FROM employees e JOIN departments d ON d.id = e.department_id
JOIN (SELECT department_id, MAX(salary) AS mx FROM employees GROUP BY department_id) m
  ON m.department_id = e.department_id AND m.mx = e.salary;`,
        `SELECT d.name, e.first_name, e.salary FROM employees e JOIN departments d ON d.id = e.department_id
WHERE e.salary = (SELECT MAX(salary) FROM employees e2 WHERE e2.department_id = e.department_id);`,
      ],
      wrong: [{ sql: `SELECT d.name, e.first_name, e.salary FROM employees e JOIN departments d ON d.id = e.department_id
WHERE e.salary IN (SELECT MAX(salary) FROM employees GROUP BY department_id);` }],
      why: 'Match the <b>pair</b> (department, salary), not just the salary. The salary-only version returns 8 rows instead of 7: Waqar (Marketing, 65000) sneaks in because 65000 is the max of a <i>different</i> group (Junaid, who has no department). His salary matches someone else\'s max, not his own department\'s. The correlated alt avoids this by comparing to the max of <i>my</i> department.',
    },
    {
      id: 'd13-q1', type: 'quiz',
      prompt: 'Product wants "the 3 most recent orders for each customer" to show on a dashboard card that has exactly 3 slots. Two orders could share a date. Which ranking do you use?',
      options: ['RANK() OVER (PARTITION BY customer_id ORDER BY order_date DESC)', 'DENSE_RANK() OVER (PARTITION BY customer_id ORDER BY order_date DESC)', 'ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC, id DESC)', 'ORDER BY order_date DESC LIMIT 3'],
      answer: 2,
      why: 'The UI needs at most 3 rows, so ROW_NUMBER with a tie-breaker (id) is right. RANK/DENSE_RANK could return 4+ rows on a tie, and a bare LIMIT is not per customer.',
    },
  ],
  leetcode: [
    { id: 184, title: 'Department Highest Salary', slug: 'department-highest-salary', difficulty: 'Medium' },
    { id: 185, title: 'Department Top Three Salaries', slug: 'department-top-three-salaries', difficulty: 'Hard' },
  ],
  ownIt: 'Explain to a teammate the difference between "top 3 employees" and "top 3 salaries" per department, which ranking function each needs, and why a plain LIMIT cannot do either.',
};
