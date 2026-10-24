export default {
  day: 6,
  phase: 1,
  title: 'INNER JOIN & multi-table joins',
  goal: 'Combine rows from several tables by matching keys, and spot when a join silently drops or multiplies rows.',
  learn: `
<p>Real data is split across tables. <code>employees</code> stores <code>department_id = 2</code>, but the word
"Engineering" lives in <code>departments</code>. A <b>JOIN</b> glues them back together:</p>

<pre><code>SELECT e.first_name, d.name AS department
FROM employees e
JOIN departments d ON d.id = e.department_id;</code></pre>

<p><code>e</code> and <code>d</code> are <b>table aliases</b>, short names so you can write <code>e.first_name</code>.
Once two tables are involved, always prefix columns: both tables have an <code>id</code> column, and Postgres errors on an ambiguous name.
(<code>JOIN</code> and <code>INNER JOIN</code> mean the same thing.)</p>

<h4>What happens, row by row</h4>
<p>For each employee, Postgres looks for department rows where the <code>ON</code> condition is TRUE, and outputs one
combined row per match:</p>
<table class="mini">
<tr><th>e.first_name</th><th>e.department_id</th><th>d.id</th><th>d.name</th><th></th></tr>
<tr><td>Ayesha</td><td>1</td><td>1</td><td>Executive</td><td class="keep">✓ match</td></tr>
<tr><td>Bilal</td><td>2</td><td>2</td><td>Engineering</td><td class="keep">✓ match</td></tr>
<tr><td>Hamza</td><td>2</td><td>2</td><td>Engineering</td><td class="keep">✓ match</td></tr>
<tr><td>Junaid</td><td>NULL</td><td>-</td><td>-</td><td class="drop">✗ no match, row gone</td></tr>
</table>
<p>An INNER JOIN keeps <b>only rows that found a partner</b>. Junaid (department NULL, and NULL = 1 is never TRUE)
disappears, and so does the Legal department, which nobody points to. 30 employees in, 29 rows out.
Tomorrow's LEFT JOIN keeps them.</p>

<h4>Chaining joins</h4>
<p>Follow the keys like a path: <code>orders → order_items → products</code>.</p>
<pre><code>SELECT o.id, p.name, oi.quantity
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
WHERE o.id = 3;</code></pre>
<p>Each JOIN adds one table to the rows built so far. After joining you can WHERE, GROUP BY and ORDER BY as usual.</p>

<h4>One-to-many multiplies rows</h4>
<p>Order 3 has <b>3 items</b> and was paid in <b>2 parts</b> (377.49 + 377.48 = 754.97). Join both to the order and every item
pairs with every payment:</p>
<table class="mini">
<tr><th>order</th><th>item</th><th>payment</th></tr>
<tr><td>3</td><td>Standing Desk</td><td>377.49</td></tr>
<tr><td>3</td><td>Standing Desk</td><td>377.48</td></tr>
<tr><td>3</td><td>Mechanical Keyboard</td><td>377.49</td></tr>
<tr><td>3</td><td>Mechanical Keyboard</td><td>377.48</td></tr>
<tr><td>3</td><td>Desk Lamp</td><td>377.49</td></tr>
<tr><td>3</td><td>Desk Lamp</td><td>377.48</td></tr>
</table>

<div class="callout trap"><b>Trap: the fan-out.</b> Six rows, so <code>SUM(amount)</code> says 2264.91, three times the real 754.97.
No error, just a wrong number in a finance report. Before you SUM after a join, ask: "how many rows does each thing
I'm summing appear in now?" Only join the tables you actually need.</div>

<div class="callout">To check a join, count rows before and after. If 29 became 29, fine. If 86 payments became 200 rows, something fanned out.</div>`,
  example: {
    sql: `SELECT o.id AS order_id, c.name AS customer, p.name AS product,
     oi.quantity, oi.unit_price, oi.quantity * oi.unit_price AS line_total
FROM orders o
JOIN customers c    ON c.id = o.customer_id
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
WHERE o.id IN (3, 4)
ORDER BY o.id, oi.id;`,
    note: 'Four tables, one row per order item. Try adding JOIN payments pay ON pay.order_id = o.id and watch order 3 double.',
  },
  exercises: [
    {
      id: 'd6-e1', type: 'query',
      prompt: 'Show every employee\'s <code>first_name</code> with their department <code>name</code>.',
      hint: '<code>FROM employees e JOIN departments d ON d.id = e.department_id</code>',
      solution: `SELECT e.first_name, d.name
FROM employees e
JOIN departments d ON d.id = e.department_id;`,
      alts: [`SELECT e.first_name, d.name FROM departments d INNER JOIN employees e ON e.department_id = d.id;`],
      wrong: [{ sql: `SELECT e.first_name, d.name FROM employees e JOIN departments d ON d.id = e.id;` }],
      why: '29 rows: Junaid has no department, so he finds no partner and drops out. Joining on <code>d.id = e.id</code> is the classic wrong key: it matches employee 3 with department 3 by accident.',
    },
    {
      id: 'd6-e2', type: 'query',
      prompt: 'Who works on the <b>Search Service</b> project? Show <code>first_name</code> and <code>hours</code>.',
      hint: '<code>employees → employee_projects → projects</code>. Filter on <code>p.name = \'Search Service\'</code>.',
      solution: `SELECT e.first_name, ep.hours
FROM employees e
JOIN employee_projects ep ON ep.employee_id = e.id
JOIN projects p           ON p.id = ep.project_id
WHERE p.name = 'Search Service';`,
      alts: [`SELECT e.first_name, ep.hours FROM employee_projects ep JOIN employees e ON e.id = ep.employee_id WHERE ep.project_id = 3;`],
      why: '<code>employee_projects</code> is a junction table: it links employees and projects many-to-many. Four people: Fatima, Maryam, Saad and Junaid. Junaid shows up here because this join doesn\'t involve departments.',
    },
    {
      id: 'd6-e3', type: 'query',
      prompt: 'List what was bought in <b>order 1</b>: product <code>name</code>, <code>quantity</code>, <code>unit_price</code>.',
      hint: 'Start from <code>order_items</code> and join <code>products</code> on <code>p.id = oi.product_id</code>.',
      solution: `SELECT p.name, oi.quantity, oi.unit_price
FROM order_items oi
JOIN products p ON p.id = oi.product_id
WHERE oi.order_id = 1;`,
      wrong: [{ sql: `SELECT p.name, oi.quantity, p.price FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = 1;` }],
      why: 'Desk Lamp, Laptop Sleeve ×2, Wireless Mouse and Clean Code ×2. Use <code>oi.unit_price</code> (what was charged), not <code>p.price</code> (today\'s list price). The Desk Lamp lists at 35.00 but sold for 31.50 here, and the table prefix is how you say which one you mean.',
    },
    {
      id: 'd6-e4', type: 'query',
      prompt: 'Revenue per product <b>category</b>: show <code>category</code> and <code>revenue</code> (sum of quantity × unit_price), highest revenue first.',
      hint: 'Join <code>order_items</code> to <code>products</code>, GROUP BY <code>p.category</code>, ORDER BY revenue DESC.',
      solution: `SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue
FROM order_items oi
JOIN products p ON p.id = oi.product_id
GROUP BY p.category
ORDER BY revenue DESC;`,
      ordered: true,
      wrong: [{ sql: `SELECT p.category, SUM(oi.quantity * p.price) AS revenue FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.category ORDER BY revenue DESC;` }],
      why: 'Join first, then group: Electronics 20954.45, Furniture 9287.50, Books 3598.20, Accessories 1136.60. Using the list price instead of <code>unit_price</code> ignores discounts and overstates revenue.',
    },
    {
      id: 'd6-e5', type: 'query',
      prompt: 'For customers living in <b>Lahore</b> who have made at least one payment, show <code>name</code> and <code>total_paid</code> (sum of their payment amounts).',
      hint: '<code>customers → orders → payments</code>, then <code>GROUP BY c.id, c.name</code>. Do you need order_items at all?',
      solution: `SELECT c.name, SUM(pay.amount) AS total_paid
FROM customers c
JOIN orders o     ON o.customer_id = c.id
JOIN payments pay ON pay.order_id = o.id
WHERE c.city = 'Lahore'
GROUP BY c.id, c.name;`,
      wrong: [{ sql: `SELECT c.name, SUM(pay.amount) FROM customers c
JOIN orders o ON o.customer_id = c.id
JOIN order_items oi ON oi.order_id = o.id
JOIN payments pay ON pay.order_id = o.id
WHERE c.city = 'Lahore'
GROUP BY c.id, c.name;` }],
      why: 'Eight Lahore customers have payments. Adding <code>order_items</code> repeats each payment once per item in the order, so totals get multiplied: the fan-out trap. Group by <code>c.id</code> as well as the name so two customers who share a name stay separate.',
    },
    {
      id: 'd6-q1', type: 'quiz',
      prompt: '<code>employees</code> has 30 rows. One employee has <code>department_id</code> NULL; every other department_id exists in <code>departments</code>. How many rows does <code>employees e JOIN departments d ON d.id = e.department_id</code> return?',
      options: ['30', '29', '8', '31'],
      answer: 1,
      why: 'Each employee matches at most one department (d.id is unique), so there is no multiplication. Junaid matches nothing and INNER JOIN drops him: 29.',
    },
    {
      id: 'd6-q2', type: 'quiz',
      prompt: 'An order has 4 items and 2 payments. You join <code>orders</code> to both <code>order_items</code> and <code>payments</code>. How many rows does that order produce?',
      options: ['2', '4', '6', '8'],
      answer: 3,
      why: 'Every item pairs with every payment: 4 × 2 = 8. That\'s why SUM(amount) after such a join counts each payment 4 times.',
    },
  ],
  leetcode: [
    { id: 1068, title: 'Product Sales Analysis I', slug: 'product-sales-analysis-i', difficulty: 'Easy' },
    { id: 1075, title: 'Project Employees I', slug: 'project-employees-i', difficulty: 'Easy' },
  ],
  ownIt: 'Explain the fan-out trap to a teammate using order 3 (3 items, 2 payments): why the total paid comes out tripled, and how you would avoid it.',
};
