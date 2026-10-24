export default {
  day: 10,
  phase: 1,
  title: 'CASE, conditional aggregation, set operations + review',
  goal: 'Turn values into categories with CASE, count several things in one pass, compute clean percentages, and combine result sets with UNION/INTERSECT/EXCEPT.',
  learn: `
<p><code>CASE</code> is SQL's if/else. It goes anywhere a value can go and is checked <b>top to bottom</b>; the first true branch wins.</p>
<pre><code>SELECT first_name, salary,
     CASE WHEN salary &gt;= 150000 THEN 'High'
          WHEN salary &gt;=  80000 THEN 'Mid'
          ELSE 'Low'
     END AS band
FROM employees;</code></pre>
<p>Bilal (180000) hits the first branch and stops; he is not also "Mid". Without <code>ELSE</code>, unmatched rows get <code>NULL</code>.
Our 30 employees split into 5 High, 13 Mid, 12 Low.</p>

<h4>Conditional aggregation: many counts, one row</h4>
<p>Want orders per status side by side? Put the CASE <i>inside</i> the aggregate. Each row contributes 1 to the column it belongs to and 0 elsewhere:</p>
<pre><code>SELECT SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
     SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
     COUNT(*) AS total
FROM orders;</code></pre>
<table class="mini">
<tr><th>status</th><th>delivered +</th><th>cancelled +</th></tr>
<tr><td>delivered</td><td class="keep">1</td><td>0</td></tr>
<tr><td>cancelled</td><td>0</td><td class="keep">1</td></tr>
<tr><td>pending</td><td>0</td><td>0</td></tr>
</table>
<p>Result: 52 delivered, 13 cancelled, 90 total. This is portable (works on MySQL/LeetCode). Postgres has a neater spelling:
<code>COUNT(*) FILTER (WHERE status = 'cancelled')</code>. Combine it with GROUP BY and you get one row per group with several counts.</p>

<div class="callout trap"><b>Trap: integer division.</b> <code>13 / 90</code> in Postgres is <b>0</b>: both are integers, so the decimals are thrown away.
Make one side numeric first: <code>ROUND(100.0 * 13 / 90, 2)</code> or <code>ROUND(13::numeric / 90 * 100, 2)</code> → <b>14.44</b>.
(MySQL's <code>/</code> always returns decimals, which is why LeetCode answers sometimes "work" there and break in Postgres.)</div>

<h4>Set operations: stacking results</h4>
<p>JOIN puts tables side by side; set operations stack two queries <b>on top of each other</b>. Both queries need the same number of
columns with compatible types.</p>
<ul>
<li><code>UNION</code>: rows from either, <b>duplicates removed</b>. Employee cities ∪ customer cities = 7 cities.</li>
<li><code>UNION ALL</code>: everything, duplicates kept (58 rows: 30 + 28). Faster, because there's no dedup step. Use it when you know there are no duplicates or you want them.</li>
<li><code>INTERSECT</code>: rows in both (cities with employees <i>and</i> customers: Islamabad, Karachi, Lahore).</li>
<li><code>EXCEPT</code>: rows in the first but not the second (customer cities with no employees: Dubai, London, Toronto). MySQL 8.0.31+ has it; older MySQL needs <code>NOT IN</code>/<code>NOT EXISTS</code>.</li>
</ul>
<p>An <code>ORDER BY</code> at the very end sorts the combined result.</p>`,
  example: {
    sql: `SELECT status,
     COUNT(*) AS orders,
     ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM orders), 2) AS pct
FROM orders
GROUP BY status
ORDER BY orders DESC;`,
    note: 'Percent of orders per status. Remove the "100.0 *" and replace it with "100 *" to see integer division in action (and why 0.0 decimals matter).',
  },
  exercises: [
    {
      id: 'd10-e1', type: 'query',
      prompt: 'Show <code>first_name</code>, <code>salary</code> and <code>band</code>: <b>High</b> for 150,000 or more, <b>Mid</b> for 80,000 or more, otherwise <b>Low</b>.',
      hint: '<code>CASE WHEN … THEN … WHEN … THEN … ELSE … END</code>. Put the highest threshold first.',
      solution: `SELECT first_name, salary,
     CASE WHEN salary >= 150000 THEN 'High'
          WHEN salary >= 80000 THEN 'Mid'
          ELSE 'Low'
     END AS band
FROM employees;`,
      wrong: [{ sql: `SELECT first_name, salary, CASE WHEN salary >= 80000 THEN 'Mid' WHEN salary >= 150000 THEN 'High' ELSE 'Low' END FROM employees;` }],
      why: 'CASE stops at the first true branch. If you test 80000 first, every high earner is labelled Mid and the High branch can never run.',
    },
    {
      id: 'd10-e2', type: 'query',
      prompt: 'In <b>one row</b>, show how many orders are <code>pending</code>, <code>shipped</code>, <code>delivered</code> and <code>cancelled</code> (four columns, in that order).',
      hint: '<code>SUM(CASE WHEN status = \'pending\' THEN 1 ELSE 0 END)</code>, repeated per status. Or Postgres\' <code>COUNT(*) FILTER (WHERE …)</code>.',
      solution: `SELECT SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
     SUM(CASE WHEN status = 'shipped'   THEN 1 ELSE 0 END) AS shipped,
     SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
     SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
FROM orders;`,
      alts: [
        `SELECT COUNT(*) FILTER (WHERE status = 'pending'), COUNT(*) FILTER (WHERE status = 'shipped'),
     COUNT(*) FILTER (WHERE status = 'delivered'), COUNT(*) FILTER (WHERE status = 'cancelled') FROM orders;`,
        `SELECT COUNT(CASE WHEN status = 'pending' THEN 1 END), COUNT(CASE WHEN status = 'shipped' THEN 1 END),
     COUNT(CASE WHEN status = 'delivered' THEN 1 END), COUNT(CASE WHEN status = 'cancelled' THEN 1 END) FROM orders;`,
      ],
      wrong: [{ sql: `SELECT status, COUNT(*) FROM orders GROUP BY status;` }],
      why: '12, 13, 52, 13. GROUP BY gives the same numbers as four rows; conditional aggregation pivots them into columns of one row. COUNT(CASE … THEN 1 END) works too, because COUNT skips the NULLs from the missing ELSE.',
    },
    {
      id: 'd10-e3', type: 'query',
      prompt: 'What percentage of all orders were <b>cancelled</b>? One column, rounded to 2 decimals (e.g. 12.34).',
      hint: 'Count the cancelled ones conditionally, divide by <code>COUNT(*)</code>, and make sure you aren\'t dividing two integers.',
      solution: `SELECT ROUND(100.0 * SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) / COUNT(*), 2) AS cancelled_pct
FROM orders;`,
      alts: [
        `SELECT ROUND(COUNT(*) FILTER (WHERE status = 'cancelled')::numeric / COUNT(*) * 100, 2) FROM orders;`,
        `SELECT ROUND(AVG(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) * 100, 2) FROM orders;`,
      ],
      wrong: [{ sql: `SELECT 100 * (SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) / COUNT(*)) FROM orders;` }],
      why: '13 of 90 orders = 14.44%. In the wrong version 13 / 90 is integer division (0) before the 100 is applied. The AVG trick is handy: the average of 1s and 0s is the fraction of 1s.',
    },
    {
      id: 'd10-e4', type: 'query',
      prompt: 'Which cities have customers but <b>no employees</b>? Show <code>city</code>.',
      hint: '<code>EXCEPT</code>: customer cities minus employee cities.',
      solution: `SELECT city FROM customers
EXCEPT
SELECT city FROM employees;`,
      alts: [
        `SELECT DISTINCT city FROM customers WHERE city NOT IN (SELECT city FROM employees);`,
        `SELECT DISTINCT c.city FROM customers c WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.city = c.city);`,
      ],
      wrong: [{ sql: `SELECT city FROM employees EXCEPT SELECT city FROM customers;` }],
      why: 'Dubai, London and Toronto. Order matters for EXCEPT: flipping it gives employee cities with no customers (Remote). EXCEPT also removes duplicates, like UNION.',
    },
    {
      id: 'd10-e5', type: 'query',
      prompt: '<b>Review (Days 5–10):</b> for <b>every</b> department show <code>name</code>, <code>headcount</code>, and <code>high_earners</code> (employees earning 100,000 or more). Departments with nobody show 0 and 0. Order by <code>name</code>.',
      hint: 'LEFT JOIN employees, GROUP BY department, <code>COUNT(e.id)</code> and <code>SUM(CASE WHEN e.salary &gt;= 100000 THEN 1 ELSE 0 END)</code>.',
      solution: `SELECT d.name,
     COUNT(e.id) AS headcount,
     SUM(CASE WHEN e.salary >= 100000 THEN 1 ELSE 0 END) AS high_earners
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.id, d.name
ORDER BY d.name;`,
      ordered: true,
      alts: [`SELECT d.name, COUNT(e.id), COUNT(e.id) FILTER (WHERE e.salary >= 100000)
FROM departments d LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.id, d.name ORDER BY d.name;`],
      wrong: [{ sql: `SELECT d.name, COUNT(e.id), SUM(CASE WHEN e.salary >= 100000 THEN 1 END)
FROM departments d LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.id, d.name ORDER BY d.name;` }],
      why: 'Without <code>ELSE 0</code>, HR and Legal have nothing to sum, and SUM of only NULLs is NULL, not 0. Engineering has 11 people, 5 of them at 100k+.',
    },
    {
      id: 'd10-e6', type: 'query',
      prompt: '<b>Review (Days 6–10):</b> for each payment <code>method</code>, show the number of payments as <code>payments</code> and its <code>pct</code> share of all payments (2 decimals). Order by <code>payments</code> descending.',
      hint: 'GROUP BY method; divide <code>COUNT(*)</code> by a scalar subquery <code>(SELECT COUNT(*) FROM payments)</code>, using 100.0.',
      solution: `SELECT method,
     COUNT(*) AS payments,
     ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM payments), 2) AS pct
FROM payments
GROUP BY method
ORDER BY payments DESC;`,
      ordered: true,
      wrong: [{ sql: `SELECT method, COUNT(*), 100 * COUNT(*) / (SELECT COUNT(*) FROM payments) FROM payments GROUP BY method ORDER BY 2 DESC;` }],
      why: 'Card is 44 of 86 payments = 51.16%. The counts are all different, so ordering by count alone is deterministic. With <code>100 *</code> instead of <code>100.0 *</code>, integer division chops 51.16 down to 51.',
    },
    {
      id: 'd10-q1', type: 'quiz',
      prompt: 'Employees live in 4 distinct cities, customers in 6, and 3 cities are shared. How many rows does <code>SELECT city FROM employees UNION SELECT city FROM customers</code> return?',
      options: ['10', '7', '58', '3'],
      answer: 1,
      why: 'UNION removes duplicates across the whole result: 4 + 6 − 3 shared = 7. UNION ALL would return every row from both tables: 30 + 28 = 58.',
    },
  ],
  leetcode: [
    { id: 1907, title: 'Count Salary Categories', slug: 'count-salary-categories', difficulty: 'Medium' },
    { id: 610, title: 'Triangle Judgement', slug: 'triangle-judgement', difficulty: 'Easy' },
    { id: 1633, title: 'Percentage of Users Attended a Contest', slug: 'percentage-of-users-attended-a-contest', difficulty: 'Easy' },
    { id: 1211, title: 'Queries Quality and Percentage', slug: 'queries-quality-and-percentage', difficulty: 'Easy' },
  ],
  ownIt: 'Explain how <code>SUM(CASE WHEN … THEN 1 ELSE 0 END)</code> turns several GROUP BY rows into columns of one row, and why <code>13 / 90</code> gives 0 in Postgres.',
};
