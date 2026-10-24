export default {
  day: 4,
  phase: 1,
  title: 'Aggregates: COUNT/SUM/AVG/MIN/MAX and NULLs',
  goal: 'Summarise many rows into one, and know exactly how each aggregate treats NULL.',
  learn: `
<p>So far every query returned one output row per input row. An <b>aggregate function</b> does the opposite:
it squashes many rows into <b>one value</b>.</p>

<table class="mini">
<tr><th>first_name</th><th>bonus</th></tr>
<tr><td>Hamza</td><td>10000</td></tr>
<tr><td>Fatima</td><td>NULL</td></tr>
<tr><td>Ali</td><td>NULL</td></tr>
<tr><td>Maryam</td><td>5000</td></tr>
</table>
<p>Over just these 4 rows: <code>COUNT(*)</code> = 4, <code>COUNT(bonus)</code> = 2, <code>SUM(bonus)</code> = 15000,
<code>AVG(bonus)</code> = 7500 (15000 ÷ <b>2</b>, not ÷ 4).</p>

<h4>The three COUNTs</h4>
<ul>
<li><code>COUNT(*)</code> counts <b>rows</b>. Employees: 30.</li>
<li><code>COUNT(bonus)</code> counts rows where bonus is <b>not NULL</b>: 16.</li>
<li><code>COUNT(DISTINCT city)</code> counts <b>different</b> non-NULL values: 4 (Karachi, Lahore, Islamabad, Remote).</li>
</ul>

<h4>Every aggregate ignores NULLs (except COUNT(*))</h4>
<p><code>SUM</code>, <code>AVG</code>, <code>MIN</code> and <code>MAX</code> skip NULLs entirely. Usually that's what you want,
but it changes the meaning of an average:</p>
<table class="mini">
<tr><th>Query</th><th>Result</th><th>Meaning</th></tr>
<tr><td><code>AVG(bonus)</code></td><td>16437.50</td><td>average among the 16 who <i>got</i> a bonus</td></tr>
<tr><td><code>AVG(COALESCE(bonus, 0))</code></td><td>8766.67</td><td>average across all 30 employees</td></tr>
</table>
<p>Both are "correct". They answer different questions, so decide which one the business is asking.</p>

<div class="callout trap"><b>Trap: mixing aggregates with normal columns.</b>
<code>SELECT first_name, MAX(salary) FROM employees</code> is an <b>error</b>. MAX collapses 30 rows into 1, so which of the
30 first_names should go next to it? Postgres refuses to guess (old MySQL guessed silently, which was worse).
To get "who earns the most", sort instead: <code>ORDER BY salary DESC, id LIMIT 1</code>. Tomorrow, GROUP BY lets you
keep a column by making one output row per value of it.</div>

<h4>Useful details</h4>
<ul>
<li>Aggregates take expressions: <code>SUM(quantity * unit_price)</code> computes per row, then adds up.</li>
<li>Over <b>zero rows</b>, <code>COUNT</code> returns 0 but <code>SUM/AVG/MIN/MAX</code> return NULL.</li>
<li><code>MIN/MAX</code> work on text and dates too: <code>MIN(order_date)</code> is the earliest order.</li>
<li>Postgres's <code>FILTER</code> counts several things in one pass:
<code>COUNT(*) FILTER (WHERE status = 'cancelled')</code>. The portable version uses CASE (Day 10).</li>
<li>AVG of integers returns a decimal in Postgres; wrap it in <code>ROUND(..., 2)</code> for clean output.</li>
</ul>
<div class="callout">LeetCode 1141 needs one value <i>per day</i>. That's <code>GROUP BY activity_date</code>, tomorrow's topic.
Try it after Day 5 if it feels out of reach.</div>`,
  example: {
    sql: `SELECT COUNT(*)                         AS employees,
     COUNT(bonus)                     AS with_bonus,
     COUNT(DISTINCT city)             AS cities,
     SUM(bonus)                       AS total_bonus,
     ROUND(AVG(bonus), 2)             AS avg_bonus_receivers,
     ROUND(AVG(COALESCE(bonus, 0)), 2) AS avg_bonus_everyone,
     MIN(hire_date)                   AS first_hire,
     MAX(salary)                      AS top_salary
FROM employees;`,
    note: 'Add WHERE department_id = 2 and see how every number changes. Then try adding first_name to the SELECT and read the error.',
  },
  exercises: [
    {
      id: 'd4-e1', type: 'query',
      prompt: 'In one row, show three counts from <code>employees</code>: total employees, how many have a bonus, how many have an email. Columns in that order.',
      hint: '<code>COUNT(*)</code> counts rows. <code>COUNT(column)</code> skips NULLs.',
      solution: `SELECT COUNT(*) AS total, COUNT(bonus) AS with_bonus, COUNT(email) AS with_email
FROM employees;`,
      wrong: [{ sql: `SELECT COUNT(*), COUNT(*), COUNT(*) FROM employees;` }],
      why: '30, 16 and 29. <code>COUNT(column)</code> is a quick way to measure how many values are missing.',
    },
    {
      id: 'd4-e2', type: 'query',
      prompt: 'How many <b>different countries</b> do our customers come from? One number.',
      hint: '<code>COUNT(DISTINCT country)</code>',
      solution: `SELECT COUNT(DISTINCT country) FROM customers;`,
      wrong: [{ sql: `SELECT COUNT(country) FROM customers;` }],
      why: '<code>COUNT(country)</code> counts 28 non-NULL values. DISTINCT inside COUNT removes repeats first, giving 4 (Pakistan, UK, Canada, UAE). LeetCode 2356 is this plus GROUP BY.',
    },
    {
      id: 'd4-e3', type: 'query',
      prompt: 'For Engineering (<code>department_id = 2</code>) show, in this order: <code>headcount</code>, <code>total_salary</code>, <code>min_salary</code>, <code>max_salary</code>.',
      hint: 'WHERE filters rows first, then the four aggregates summarise what is left.',
      solution: `SELECT COUNT(*) AS headcount, SUM(salary) AS total_salary,
     MIN(salary) AS min_salary, MAX(salary) AS max_salary
FROM employees
WHERE department_id = 2;`,
      why: 'WHERE runs before the aggregates, so they only see the 11 engineers: 1,181,000 in total, from 58,000 (Noor) to 180,000 (Bilal).',
    },
    {
      id: 'd4-e4', type: 'query',
      prompt: 'What is the <b>average bonus across all employees</b>, counting a missing bonus as 0? Round to 2 decimals.',
      hint: 'AVG skips NULLs. Turn them into 0 first with COALESCE.',
      solution: `SELECT ROUND(AVG(COALESCE(bonus, 0)), 2) AS avg_bonus FROM employees;`,
      alts: [`SELECT ROUND(SUM(bonus) / COUNT(*), 2) FROM employees;`],
      wrong: [{ sql: `SELECT ROUND(AVG(bonus), 2) FROM employees;` }],
      why: '263000 ÷ 30 = 8766.67. Plain <code>AVG(bonus)</code> divides by 16 (only the non-NULL rows) and gives 16437.50, nearly double.',
    },
    {
      id: 'd4-e5', type: 'query',
      prompt: 'Across all of <code>order_items</code>, show <code>units_sold</code> (total quantity) and <code>revenue</code> (sum of quantity × unit_price).',
      hint: 'Multiply inside the aggregate: <code>SUM(quantity * unit_price)</code>.',
      solution: `SELECT SUM(quantity) AS units_sold, SUM(quantity * unit_price) AS revenue
FROM order_items;`,
      wrong: [{ sql: `SELECT SUM(quantity), SUM(unit_price) FROM order_items;` }],
      why: 'The multiplication happens per row, then SUM adds up the line totals: 372 units, 34976.75 revenue. <code>SUM(quantity) * SUM(unit_price)</code> would be nonsense.',
    },
    {
      id: 'd4-e6', type: 'query',
      prompt: 'In one row, show the number of <b>delivered</b> orders and the number of <b>cancelled</b> orders, in that order.',
      hint: "<code>COUNT(*) FILTER (WHERE status = 'delivered')</code>, and the same for cancelled.",
      solution: `SELECT COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
     COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
FROM orders;`,
      alts: [`SELECT COUNT(CASE WHEN status = 'delivered' THEN 1 END), COUNT(CASE WHEN status = 'cancelled' THEN 1 END) FROM orders;`,
        `SELECT SUM((status = 'delivered')::int), SUM((status = 'cancelled')::int) FROM orders;`],
      why: '52 delivered, 13 cancelled. FILTER applies a mini WHERE to just one aggregate, so you get several counts in one scan. The CASE version works in every database.',
    },
    {
      id: 'd4-q1', type: 'quiz',
      prompt: 'What happens when you run <code>SELECT first_name, MAX(salary) FROM employees;</code> in Postgres?',
      options: ['Returns Ayesha and 250000', 'Returns 30 rows, each with 250000', 'Error: first_name must appear in GROUP BY or be used in an aggregate', 'Returns a random first_name with 250000'],
      answer: 2,
      why: 'MAX collapses all rows into one, and Postgres won\'t pick one first_name out of 30. Either aggregate it too, GROUP BY it, or use <code>ORDER BY salary DESC LIMIT 1</code> to fetch the top row.',
    },
  ],
  leetcode: [
    { id: 620, title: 'Not Boring Movies', slug: 'not-boring-movies', difficulty: 'Easy' },
    { id: 2356, title: 'Number of Unique Subjects Taught by Each Teacher', slug: 'number-of-unique-subjects-taught-by-each-teacher', difficulty: 'Easy' },
    { id: 1141, title: 'User Activity for the Past 30 Days I', slug: 'user-activity-for-the-past-30-days-i', difficulty: 'Easy' },
  ],
  ownIt: 'Explain the difference between <code>COUNT(*)</code>, <code>COUNT(bonus)</code> and <code>COUNT(DISTINCT bonus)</code>, and why <code>AVG(bonus)</code> might mislead a manager.',
};
