export default {
  day: 7,
  phase: 1,
  title: 'LEFT/RIGHT/FULL JOIN, anti-joins, ON vs WHERE trap',
  goal: 'Keep rows that have no match, find "things that never happened", and avoid the WHERE clause that silently turns a LEFT JOIN back into an INNER JOIN.',
  learn: `
<p>Yesterday's <code>INNER JOIN</code> keeps a row only when <b>both sides match</b>. That sounds fine until your boss asks
"show me <i>every</i> department and its people". The <b>Legal</b> department (id 8) has nobody, so an inner join quietly drops it.</p>

<h4>LEFT JOIN: keep everything on the left</h4>
<pre><code>SELECT d.name, e.first_name
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id;</code></pre>
<p>Every row of the <b>left</b> table (<code>departments</code>) survives. If no employee matches, Postgres still outputs the
department and fills the employee columns with <code>NULL</code>:</p>
<table class="mini">
<tr><th>d.name</th><th>e.first_name</th><th>e.id</th></tr>
<tr><td>HR</td><td>Tariq</td><td>28</td></tr>
<tr><td>HR</td><td>Saima</td><td>29</td></tr>
<tr><td class="keep">Legal</td><td class="keep">NULL</td><td class="keep">NULL</td></tr>
</table>
<p><code>RIGHT JOIN</code> is the mirror image (keep everything on the right). Nobody needs it: just swap the tables and use LEFT.
<code>FULL JOIN</code> keeps unmatched rows from <b>both</b> sides. <code>departments FULL JOIN employees</code> shows Legal with a NULL
employee <i>and</i> Junaid (id 30, <code>department_id</code> NULL) with a NULL department.</p>

<h4>Anti-join: "who never …?"</h4>
<p>Those NULL-filled rows are exactly the ones with no match. Keep only them and you get "customers who never ordered":</p>
<pre><code>SELECT c.id, c.name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;          -- no matching order → customers 25–28</code></pre>
<table class="mini">
<tr><th>c.id</th><th>c.name</th><th>o.id</th><th></th></tr>
<tr><td>13</td><td>Moin Akhtar</td><td>13</td><td class="drop">✗ has an order</td></tr>
<tr><td>25</td><td>Emma Hashmi</td><td>NULL</td><td class="keep">✓ kept</td></tr>
<tr><td>26</td><td>Liam Kazmi</td><td>NULL</td><td class="keep">✓ kept</td></tr>
</table>
<p>Test a column that can never be NULL in a real match, like the right table's primary key (<code>o.id</code>).</p>

<div class="callout trap"><b>Trap: filtering the right table in WHERE.</b> You want every customer with their <i>cancelled</i> orders:
<pre><code>FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'cancelled'      -- ✗</code></pre>
WHERE runs <b>after</b> the join. For the NULL-filled rows <code>o.status</code> is NULL, so <code>NULL = 'cancelled'</code> is not true and
they get thrown away. Your LEFT JOIN has become an INNER JOIN. Put conditions on the right table <b>in the ON clause</b>:
<code>LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'cancelled'</code>. Conditions on the <i>left</i> table still belong in WHERE.</div>

<h4>Counting after a LEFT JOIN</h4>
<p><code>COUNT(*)</code> counts rows, and Legal has one row (the NULL-filled one), so it says <b>1</b>. <code>COUNT(e.id)</code> skips NULLs
(Day 4), so it says <b>0</b>. When counting "children", always count a column from the right table.</p>
<table class="mini">
<tr><th>name</th><th>COUNT(*)</th><th>COUNT(e.id)</th></tr>
<tr><td>HR</td><td>2</td><td>2</td></tr>
<tr><td>Legal</td><td class="drop">1</td><td class="keep">0</td></tr>
</table>`,
  example: {
    sql: `SELECT d.name AS department, e.first_name, e.job_title
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id
ORDER BY d.name, e.first_name;`,
    note: 'Find the Legal row: its employee columns are NULL. Change LEFT to INNER and run again: Legal disappears. Then try FULL JOIN and look for Junaid.',
  },
  exercises: [
    {
      id: 'd7-e1', type: 'query',
      prompt: 'List <b>every</b> department <code>name</code> with the <code>first_name</code> of each employee in it. Departments with no employees must still appear (with NULL).',
      hint: 'Start <code>FROM departments</code> and <code>LEFT JOIN employees</code>.',
      solution: `SELECT d.name, e.first_name
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id;`,
      alts: [`SELECT d.name, e.first_name FROM employees e RIGHT JOIN departments d ON e.department_id = d.id;`],
      wrong: [{ sql: `SELECT d.name, e.first_name FROM departments d JOIN employees e ON e.department_id = d.id;` }],
      why: 'LEFT JOIN keeps all 8 departments. Legal has no match, so it appears once with first_name NULL. The RIGHT JOIN version is the same query with the tables swapped.',
    },
    {
      id: 'd7-e2', type: 'query',
      prompt: 'Find customers who have <b>never placed an order</b>. Show <code>id</code> and <code>name</code>.',
      hint: 'LEFT JOIN orders, then keep rows where the order side is NULL: <code>WHERE o.id IS NULL</code>.',
      solution: `SELECT c.id, c.name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;`,
      alts: [
        `SELECT c.id, c.name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);`,
        `SELECT id, name FROM customers WHERE id NOT IN (SELECT customer_id FROM orders);`,
      ],
      wrong: [{ sql: `SELECT c.id, c.name FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL;` }],
      why: 'Customers 25–28 have no orders, so their order columns come back NULL. An INNER JOIN never produces those rows in the first place, so filtering for NULL finds nothing. (NOT EXISTS and NOT IN are Day 9 tools; both work here.)',
    },
    {
      id: 'd7-e3', type: 'query',
      prompt: 'Which products have <b>never been ordered</b>? Show <code>id</code>, <code>name</code> and <code>is_active</code>.',
      hint: '<code>products LEFT JOIN order_items</code> on <code>product_id</code>, keep the unmatched ones.',
      solution: `SELECT p.id, p.name, p.is_active
FROM products p
LEFT JOIN order_items oi ON oi.product_id = p.id
WHERE oi.id IS NULL;`,
      alts: [`SELECT p.id, p.name, p.is_active FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id);`],
      why: 'Webcam HD (14, inactive) and Sticker Pack (15, active) have no order_items rows. The Sticker Pack is the interesting one: it is on sale and nobody buys it.',
    },
    {
      id: 'd7-e4', type: 'query',
      prompt: 'Show every department <code>name</code> and its <code>headcount</code> (number of employees). Legal must show <b>0</b>.',
      hint: 'LEFT JOIN, GROUP BY the department, and count a column from the <i>employees</i> side.',
      solution: `SELECT d.name, COUNT(e.id) AS headcount
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.id, d.name;`,
      wrong: [{ sql: `SELECT d.name, COUNT(*) AS headcount FROM departments d LEFT JOIN employees e ON e.department_id = d.id GROUP BY d.id, d.name;` }],
      why: 'COUNT(*) counts the NULL-filled row, so Legal would show 1. COUNT(e.id) ignores NULLs and correctly shows 0.',
    },
    {
      id: 'd7-e5', type: 'query',
      prompt: 'For <b>every</b> customer, show <code>name</code> and <code>cancelled_orders</code>, the number of their orders with status <code>cancelled</code>. Customers with none must show 0.',
      hint: 'The status filter belongs in the <code>ON</code> clause, not in WHERE.',
      solution: `SELECT c.name, COUNT(o.id) AS cancelled_orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'cancelled'
GROUP BY c.id, c.name;`,
      wrong: [{ sql: `SELECT c.name, COUNT(o.id) AS cancelled_orders FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.status = 'cancelled' GROUP BY c.id, c.name;` }],
      why: 'With the filter in ON, the join only matches cancelled orders but still keeps all 28 customers. With the filter in WHERE, every customer without a cancelled order is removed after the join, leaving only 9 rows.',
    },
    {
      id: 'd7-e6', type: 'query',
      prompt: 'Find the mismatches between <code>employees</code> and <code>departments</code> in one query: employees with no department <b>and</b> departments with no employees. Show employee <code>first_name</code> and department <code>name</code>.',
      hint: '<code>FULL JOIN</code>, then keep rows where either side\'s id is NULL.',
      solution: `SELECT e.first_name, d.name
FROM employees e
FULL JOIN departments d ON e.department_id = d.id
WHERE e.id IS NULL OR d.id IS NULL;`,
      why: 'FULL JOIN keeps unmatched rows from both tables: (Junaid, NULL) because his department_id is NULL, and (NULL, Legal) because nobody works there.',
    },
    {
      id: 'd7-q1', type: 'quiz',
      prompt: '<code>SELECT d.name, COUNT(*) FROM departments d LEFT JOIN employees e ON e.department_id = d.id GROUP BY d.name</code>. What does the Legal row show?',
      options: ['0', '1', 'NULL', 'Legal is not in the result'],
      answer: 1,
      why: 'The LEFT JOIN creates one NULL-filled row for Legal, and COUNT(*) counts rows, not values. Use COUNT(e.id) to get 0.',
    },
  ],
  leetcode: [
    { id: 175, title: 'Combine Two Tables', slug: 'combine-two-tables', difficulty: 'Easy' },
    { id: 1378, title: 'Replace Employee ID With The Unique Identifier', slug: 'replace-employee-id-with-the-unique-identifier', difficulty: 'Easy' },
    { id: 1581, title: 'Customer Who Visited but Did Not Make Any Transactions', slug: 'customer-who-visited-but-did-not-make-any-transactions', difficulty: 'Easy' },
    { id: 183, title: 'Customers Who Never Order', slug: 'customers-who-never-order', difficulty: 'Easy' },
    { id: 577, title: 'Employee Bonus', slug: 'employee-bonus', difficulty: 'Easy' },
    { id: 1251, title: 'Average Selling Price', slug: 'average-selling-price', difficulty: 'Easy' },
  ],
  ownIt: 'Explain to a teammate why <code>LEFT JOIN orders o … WHERE o.status = \'cancelled\'</code> behaves like an INNER JOIN, and where the condition should go instead.',
};
