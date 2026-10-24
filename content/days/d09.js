export default {
  day: 9,
  phase: 1,
  title: 'Subqueries: scalar, IN, EXISTS, correlated, NOT IN + NULL trap',
  goal: 'Put a query inside a query to answer "compared to what?" questions, and know why NOT IN can silently return nothing.',
  learn: `
<p>"Who earns more than the average?" needs two steps: compute the average, then compare. A <b>subquery</b> lets you do both in one
statement: a <code>SELECT</code> in parentheses, used wherever a value, a list or a table is expected.</p>

<h4>1. Scalar subquery: one value</h4>
<pre><code>SELECT first_name, salary
FROM employees
WHERE salary &gt; (SELECT AVG(salary) FROM employees);   -- 103666.67</code></pre>
<p>The inner query returns exactly one row and one column, so you can use it like a number. (You can't write
<code>WHERE salary &gt; AVG(salary)</code>: aggregates aren't allowed in WHERE, remember Day 5's execution order.) 12 people pass.</p>

<h4>2. IN (subquery): a list</h4>
<pre><code>SELECT name FROM customers
WHERE id IN (SELECT customer_id FROM orders WHERE status = 'cancelled');</code></pre>
<p>Unlike a JOIN, <code>IN</code> never duplicates rows: a customer with two cancelled orders still appears once.</p>

<h4>3. EXISTS / NOT EXISTS: "is there at least one?"</h4>
<pre><code>SELECT c.name FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);</code></pre>
<p><code>EXISTS</code> only asks whether the inner query finds any row; what it selects doesn't matter (<code>SELECT 1</code> is the convention).
Notice the inner query mentions <code>c.id</code> from the outer query. That makes it <b>correlated</b>.</p>

<h4>4. Correlated subquery: runs "per row"</h4>
<pre><code>SELECT e.first_name, e.salary
FROM employees e
WHERE e.salary &gt; (SELECT AVG(x.salary) FROM employees x
                WHERE x.department_id = e.department_id);</code></pre>
<p>Think of it as: for each outer row, re-run the inner query with that row's department.</p>
<table class="mini">
<tr><th>first_name</th><th>dept</th><th>salary</th><th>own dept avg</th><th></th></tr>
<tr><td>Hamza</td><td>2</td><td>120000</td><td>107363.64</td><td class="keep">✓ above</td></tr>
<tr><td>Ali</td><td>2</td><td>95000</td><td>107363.64</td><td class="drop">✗ below</td></tr>
<tr><td>Tariq</td><td>7</td><td>85000</td><td>70000.00</td><td class="keep">✓ above</td></tr>
</table>

<h4>5. Subquery in FROM: a temporary table</h4>
<pre><code>SELECT MAX(order_count)
FROM (SELECT customer_id, COUNT(*) AS order_count
    FROM orders GROUP BY customer_id) AS per_customer;</code></pre>
<p>A "derived table" lets you aggregate an aggregate. Postgres requires the alias (<code>per_customer</code>).</p>

<div class="callout trap"><b>Trap: NOT IN + NULL.</b> "Employees who manage nobody":
<pre><code>WHERE id NOT IN (SELECT manager_id FROM employees)   -- returns 0 rows!</code></pre>
The list contains Ayesha's <code>NULL</code>. <code>x NOT IN (1, 2, NULL)</code> means <code>x &lt;&gt; 1 AND x &lt;&gt; 2 AND x &lt;&gt; NULL</code>, and
<code>x &lt;&gt; NULL</code> is unknown, never true. So <b>every</b> row is rejected. Use <code>NOT EXISTS</code> (NULL-safe), or add
<code>WHERE manager_id IS NOT NULL</code> inside the subquery. The correct answer here is 20 employees.</div>

<div class="callout"><b>"Bought all of them" (LeetCode 1045)</b> is called relational division. The easy portable trick: group per customer and
compare <code>COUNT(DISTINCT product)</code> with a scalar subquery that counts all products:
<code>HAVING COUNT(DISTINCT product_key) = (SELECT COUNT(*) FROM product)</code>.</div>`,
  example: {
    sql: `SELECT e.first_name, e.department_id, e.salary,
     (SELECT ROUND(AVG(x.salary), 2) FROM employees x
      WHERE x.department_id = e.department_id) AS dept_avg
FROM employees e
ORDER BY e.department_id, e.salary DESC;`,
    note: 'A correlated scalar subquery in SELECT: it runs once per employee. Look at Junaid (department NULL): why is his dept_avg NULL? Try adding WHERE e.salary > the same subquery.',
  },
  exercises: [
    {
      id: 'd9-e1', type: 'query',
      prompt: 'Show <code>first_name</code> and <code>salary</code> of employees earning <b>more than the company average</b>.',
      hint: '<code>WHERE salary &gt; (SELECT AVG(salary) FROM employees)</code>.',
      solution: `SELECT first_name, salary
FROM employees
WHERE salary > (SELECT AVG(salary) FROM employees);`,
      why: 'The scalar subquery computes 103666.67 once, and every row is compared against it. 12 employees pass.',
    },
    {
      id: 'd9-e2', type: 'query',
      prompt: 'Show the <code>name</code> of every customer who has <b>at least one cancelled order</b>. Each customer once.',
      hint: '<code>WHERE id IN (SELECT customer_id FROM orders WHERE status = \'cancelled\')</code>.',
      solution: `SELECT name
FROM customers
WHERE id IN (SELECT customer_id FROM orders WHERE status = 'cancelled');`,
      alts: [
        `SELECT c.name FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = 'cancelled');`,
        `SELECT DISTINCT c.name FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.status = 'cancelled';`,
      ],
      why: 'IN and EXISTS return each customer once no matter how many cancelled orders they have. The JOIN version needs DISTINCT to get the same 9 names.',
    },
    {
      id: 'd9-e3', type: 'query',
      prompt: 'Find employees who earn <b>more than the average of their own department</b>. Show <code>first_name</code>, <code>department_id</code>, <code>salary</code>.',
      hint: 'Correlated subquery: <code>(SELECT AVG(x.salary) FROM employees x WHERE x.department_id = e.department_id)</code>.',
      solution: `SELECT e.first_name, e.department_id, e.salary
FROM employees e
WHERE e.salary > (SELECT AVG(x.salary) FROM employees x
                WHERE x.department_id = e.department_id);`,
      alts: [`SELECT e.first_name, e.department_id, e.salary
FROM employees e
JOIN (SELECT department_id, AVG(salary) AS avg_sal FROM employees GROUP BY department_id) d
ON d.department_id = e.department_id
WHERE e.salary > d.avg_sal;`],
      wrong: [{ sql: `SELECT first_name, department_id, salary FROM employees WHERE salary > (SELECT AVG(salary) FROM employees);` }],
      why: 'The inner query is re-evaluated with each employee\'s department, giving 11 rows. The alternative computes all department averages once in a derived table and joins to it; it is often faster.',
    },
    {
      id: 'd9-e4', type: 'query',
      prompt: 'List employees who are <b>nobody\'s manager</b> (no one has them as <code>manager_id</code>). Show <code>id</code> and <code>first_name</code>.',
      hint: 'Use <code>NOT EXISTS</code>. If you use NOT IN, think about Ayesha\'s NULL manager_id first.',
      solution: `SELECT e.id, e.first_name
FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM employees r WHERE r.manager_id = e.id);`,
      alts: [
        `SELECT id, first_name FROM employees WHERE id NOT IN (SELECT manager_id FROM employees WHERE manager_id IS NOT NULL);`,
        `SELECT e.id, e.first_name FROM employees e LEFT JOIN employees r ON r.manager_id = e.id WHERE r.id IS NULL;`,
      ],
      wrong: [{ sql: `SELECT id, first_name FROM employees WHERE id NOT IN (SELECT manager_id FROM employees);` }],
      why: 'The correct answer has 20 rows. Plain NOT IN returns 0, because the subquery\'s list contains NULL and <code>id &lt;&gt; NULL</code> is never true. NOT EXISTS and LEFT JOIN … IS NULL are both NULL-safe.',
    },
    {
      id: 'd9-e5', type: 'query',
      prompt: 'Which customer placed the <b>most orders</b>? Show <code>name</code> and <code>order_count</code>. If several tie for the top, show all of them.',
      hint: 'Derived table of per-customer counts, then keep rows where the count equals <code>(SELECT MAX(...) FROM (...))</code>.',
      solution: `SELECT c.name, t.order_count
FROM (SELECT customer_id, COUNT(*) AS order_count FROM orders GROUP BY customer_id) t
JOIN customers c ON c.id = t.customer_id
WHERE t.order_count = (SELECT MAX(cnt) FROM (SELECT COUNT(*) AS cnt FROM orders GROUP BY customer_id) m);`,
      alts: [`SELECT c.name, COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name
HAVING COUNT(*) = (SELECT MAX(cnt) FROM (SELECT COUNT(*) AS cnt FROM orders GROUP BY customer_id) m);`],
      why: 'Ghazal Effendi has 10 orders. <code>ORDER BY … LIMIT 1</code> would also give her today, but it silently drops ties; comparing with the MAX keeps every customer tied at the top.',
    },
    {
      id: 'd9-e6', type: 'query',
      prompt: 'Relational division (the LeetCode 1045 pattern): find customers who have bought <b>every product in the Books category</b>. Show <code>name</code>.',
      hint: 'Join customers → orders → order_items → products, keep Books, GROUP BY customer, and <code>HAVING COUNT(DISTINCT product id) = (SELECT COUNT(*) FROM products WHERE category = \'Books\')</code>.',
      solution: `SELECT c.name
FROM customers c
JOIN orders o ON o.customer_id = c.id
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
WHERE p.category = 'Books'
GROUP BY c.id, c.name
HAVING COUNT(DISTINCT p.id) = (SELECT COUNT(*) FROM products WHERE category = 'Books');`,
      alts: [`SELECT c.name FROM customers c
WHERE NOT EXISTS (
SELECT 1 FROM products p
WHERE p.category = 'Books'
  AND NOT EXISTS (SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
                  WHERE o.customer_id = c.id AND oi.product_id = p.id));`],
      wrong: [{ sql: `SELECT c.name FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id WHERE p.category = 'Books' GROUP BY c.id, c.name HAVING COUNT(*) = 3;` }],
      why: 'Farah Rana and Zara Memon bought all 3 books. COUNT(DISTINCT) matters: a customer who bought the same book twice must not count it twice. The double NOT EXISTS reads "there is no book they have not bought".',
    },
    {
      id: 'd9-q1', type: 'quiz',
      prompt: 'What does <code>SELECT 5 WHERE 5 NOT IN (1, 2, NULL)</code> return?',
      options: ['One row: 5', 'Zero rows', 'An error', 'One row: NULL'],
      answer: 1,
      why: '<code>5 NOT IN (1, 2, NULL)</code> = <code>5&lt;&gt;1 AND 5&lt;&gt;2 AND 5&lt;&gt;NULL</code> = TRUE AND TRUE AND UNKNOWN = UNKNOWN. WHERE only keeps TRUE, so nothing comes back.',
    },
  ],
  leetcode: [
    { id: 1978, title: 'Employees Whose Manager Left the Company', slug: 'employees-whose-manager-left-the-company', difficulty: 'Easy' },
    { id: 570, title: 'Managers with at Least 5 Direct Reports', slug: 'managers-with-at-least-5-direct-reports', difficulty: 'Medium' },
    { id: 1174, title: 'Immediate Food Delivery II', slug: 'immediate-food-delivery-ii', difficulty: 'Medium' },
    { id: 1045, title: 'Customers Who Bought All Products', slug: 'customers-who-bought-all-products', difficulty: 'Medium' },
  ],
  ownIt: 'Explain, step by step, why <code>WHERE id NOT IN (SELECT manager_id FROM employees)</code> returns zero rows, and give two ways to fix it.',
};
