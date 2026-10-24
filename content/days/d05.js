export default {
  day: 5,
  phase: 1,
  title: 'GROUP BY & HAVING, logical execution order',
  goal: 'Compute one summary row per group, filter groups with HAVING, and know the order a query really runs in.',
  learn: `
<p>Yesterday an aggregate squashed the whole table into one row. <code>GROUP BY</code> first splits the rows into
<b>piles</b> that share a value, then runs the aggregates <b>once per pile</b>.</p>

<pre><code>SELECT department_id, COUNT(*) AS headcount, SUM(salary) AS total
FROM employees
GROUP BY department_id;</code></pre>

<p>Picture two of the piles:</p>
<table class="mini">
<tr><th>department_id</th><th>first_name</th><th>salary</th></tr>
<tr><td>3</td><td>Usman</td><td>160000</td></tr>
<tr><td>3</td><td>Ahmed</td><td>115000</td></tr>
<tr><td>3</td><td>Sana</td><td>90000</td></tr>
<tr><td>7</td><td>Tariq</td><td>85000</td></tr>
<tr><td>7</td><td>Saima</td><td>55000</td></tr>
</table>
<p>Each pile becomes <b>one output row</b>:</p>
<table class="mini">
<tr><th>department_id</th><th>headcount</th><th>total</th></tr>
<tr><td>3</td><td>3</td><td>365000</td></tr>
<tr><td>7</td><td>2</td><td>140000</td></tr>
</table>
<p>Junaid has no department, so he lands in his own <b>NULL group</b>. GROUP BY treats all NULLs as one group.</p>

<h4>The rule</h4>
<p>Every column in SELECT must either be in the GROUP BY or be inside an aggregate. Once a pile has become one
row, "the first_name of department 3" no longer means anything: there are three of them.</p>

<h4>Several columns</h4>
<p><code>GROUP BY country, city</code> makes one pile per <b>combination</b>: (Pakistan, Lahore), (UK, London), ...</p>

<h4>WHERE vs HAVING</h4>
<ul>
<li><code>WHERE</code> filters <b>rows</b>, before grouping. It can't see <code>COUNT(*)</code>, because groups don't exist yet.</li>
<li><code>HAVING</code> filters <b>groups</b>, after the aggregates are computed.</li>
</ul>
<pre><code>SELECT city, COUNT(*) AS well_paid
FROM employees
WHERE salary &gt; 80000        -- drop rows first
GROUP BY city
HAVING COUNT(*) &gt;= 6;       -- then drop small groups</code></pre>

<h4>The real order a query runs in</h4>
<p><b>FROM → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT</b></p>
<p>Most "why doesn't this work?" questions are answered by this line. An alias is created in SELECT, so WHERE, GROUP BY and HAVING,
which run earlier, can't see it. ORDER BY runs later, so it can.</p>

<div class="callout trap"><b>Trap: aggregates in WHERE, aliases in WHERE.</b>
<code>WHERE COUNT(*) &gt; 2</code> is an error (use HAVING). <code>SELECT salary * 12 AS annual ... WHERE annual &gt; 1000000</code>
is an error too: repeat the expression, <code>WHERE salary * 12 &gt; 1000000</code>. Postgres does let you write
<code>GROUP BY</code> with an alias as a convenience, but HAVING still needs the full <code>COUNT(*)</code>.</div>

<div class="callout">If you can filter in WHERE, do it there. Throwing rows away before grouping is cheaper than grouping them and throwing groups away.</div>`,
  example: {
    sql: `SELECT department_id,
     COUNT(*)             AS headcount,
     ROUND(AVG(salary), 2) AS avg_salary,
     MAX(salary)          AS top_salary
FROM employees
GROUP BY department_id
ORDER BY department_id;`,
    note: 'Note the NULL group (Junaid) at the bottom. Add HAVING COUNT(*) > 2, then try WHERE city = \'Lahore\' and see which groups shrink.',
  },
  exercises: [
    {
      id: 'd5-e1', type: 'query',
      prompt: 'Show each <code>department_id</code> and its <code>headcount</code> (number of employees), including the group of employees with no department.',
      hint: '<code>GROUP BY department_id</code> plus <code>COUNT(*)</code>.',
      solution: `SELECT department_id, COUNT(*) AS headcount
FROM employees
GROUP BY department_id;`,
      wrong: [{ sql: `SELECT department_id, COUNT(*) FROM employees WHERE department_id IS NOT NULL GROUP BY department_id;` }],
      why: 'One output row per distinct department_id: 8 rows, including <code>NULL → 1</code> for Junaid. Legal (department 8) is missing because it has no employees, so there are no rows to group. Day 7 fixes that with LEFT JOIN.',
    },
    {
      id: 'd5-e2', type: 'query',
      prompt: 'How many customers are in each <code>country</code> and <code>city</code> combination? Show <code>country</code>, <code>city</code>, <code>customers</code>.',
      hint: 'Group by both columns: <code>GROUP BY country, city</code>.',
      solution: `SELECT country, city, COUNT(*) AS customers
FROM customers
GROUP BY country, city;`,
      wrong: [{ sql: `SELECT country, COUNT(DISTINCT city), COUNT(*) FROM customers GROUP BY country;` }],
      why: 'Each unique (country, city) pair becomes a group: 6 rows, e.g. (Pakistan, Lahore, 10) and (UK, London, 3).',
    },
    {
      id: 'd5-e3', type: 'query',
      prompt: 'Show departments with <b>more than 2 employees</b>: <code>department_id</code> and <code>headcount</code>.',
      hint: 'Filtering on a COUNT means filtering groups, so use HAVING.',
      solution: `SELECT department_id, COUNT(*) AS headcount
FROM employees
GROUP BY department_id
HAVING COUNT(*) > 2;`,
      wrong: [{ sql: `SELECT department_id, COUNT(*) FROM employees GROUP BY department_id HAVING COUNT(*) >= 2;` }],
      why: 'HAVING runs after grouping, so <code>COUNT(*)</code> is known by then. Five departments qualify: 2, 3, 4, 5 and 6.',
    },
    {
      id: 'd5-e4', type: 'query',
      prompt: 'Count employees earning <b>more than 80,000</b> per <code>city</code>, and keep only cities with <b>at least 6</b> of them. Show <code>city</code> and <code>well_paid</code>.',
      hint: 'The salary condition is about rows (WHERE). The "at least 6" condition is about groups (HAVING).',
      solution: `SELECT city, COUNT(*) AS well_paid
FROM employees
WHERE salary > 80000
GROUP BY city
HAVING COUNT(*) >= 6;`,
      wrong: [{ sql: `SELECT city, COUNT(*) FROM employees GROUP BY city HAVING COUNT(*) >= 6;` }],
      why: 'WHERE removes the lower-paid rows before the piles are made, so the counts only include people over 80k: Karachi 6, Lahore 7. Skip the WHERE and you are counting everyone (Islamabad sneaks in with 8).',
    },
    {
      id: 'd5-e5', type: 'query',
      prompt: 'Find customers who placed <b>more than 5 orders</b>. Show <code>customer_id</code> and <code>order_count</code>, most orders first, ties broken by <code>customer_id</code>.',
      hint: 'Group <code>orders</code> by customer_id, HAVING COUNT(*) &gt; 5, then ORDER BY order_count DESC, customer_id.',
      solution: `SELECT customer_id, COUNT(*) AS order_count
FROM orders
GROUP BY customer_id
HAVING COUNT(*) > 5
ORDER BY order_count DESC, customer_id;`,
      ordered: true,
      wrong: [{ sql: `SELECT customer_id, COUNT(*) AS order_count FROM orders GROUP BY customer_id HAVING COUNT(*) >= 5 ORDER BY order_count DESC, customer_id;` }],
      why: 'Customer 7 leads with 10; then 2, 4, 6 and 15 tie at 6. ORDER BY can use the alias <code>order_count</code> because it runs after SELECT. Without the tie-breaker, the order of the four ties is not guaranteed. "More than 5" is <code>&gt; 5</code>; <code>&gt;= 5</code> would add customers 5, 14 and 24.',
    },
    {
      id: 'd5-e6', type: 'query',
      prompt: 'Find <code>last_name</code>s shared by <b>more than one employee</b>. Show just <code>last_name</code>.',
      hint: 'This is LeetCode 182 (Duplicate Emails) in disguise: GROUP BY the column, HAVING COUNT(*) &gt; 1.',
      solution: `SELECT last_name
FROM employees
GROUP BY last_name
HAVING COUNT(*) > 1;`,
      wrong: [{ sql: `SELECT DISTINCT last_name FROM employees;` }],
      why: 'Khan, Raza and Noor each appear twice. You don\'t have to SELECT the aggregate to filter on it in HAVING.',
    },
    {
      id: 'd5-q1', type: 'quiz',
      prompt: 'Why does <code>SELECT salary * 12 AS annual FROM employees WHERE annual &gt; 1000000;</code> fail?',
      options: [
        'Aliases cannot contain the word "annual"',
        'WHERE runs before SELECT, so the alias does not exist yet',
        'You need HAVING instead of WHERE for calculated columns',
        'Multiplication is not allowed in SELECT',
      ],
      answer: 1,
      why: 'Logical order: FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY. WHERE never sees SELECT\'s aliases. Repeat the expression (<code>WHERE salary * 12 &gt; 1000000</code>). HAVING is for aggregates over groups, not a fix for aliases.',
    },
  ],
  leetcode: [
    { id: 596, title: 'Classes More Than 5 Students', slug: 'classes-more-than-5-students', difficulty: 'Easy' },
    { id: 1729, title: 'Find Followers Count', slug: 'find-followers-count', difficulty: 'Easy' },
    { id: 182, title: 'Duplicate Emails', slug: 'duplicate-emails', difficulty: 'Easy' },
  ],
  ownIt: 'Walk through <code>FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT</code> for a query of your choice, and explain at each step what the rows look like.',
};
