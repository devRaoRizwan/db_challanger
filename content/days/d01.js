export default {
  day: 1,
  phase: 1,
  title: 'SELECT, WHERE & thinking in rows',
  goal: 'Pick the columns you want and keep only the rows you need.',
  learn: `
<p>A table is just rows and columns, like a spreadsheet. Every query you'll ever write answers two questions:
<b>which rows?</b> (<code>WHERE</code>) and <b>which columns?</b> (<code>SELECT</code>).</p>

<pre><code>SELECT first_name, salary     -- 3. which columns to show
FROM employees                -- 1. start from this table
WHERE city = 'Lahore';        -- 2. keep only rows where this is TRUE</code></pre>

<p>Read it in the order the database runs it: <b>FROM → WHERE → SELECT</b>. Postgres takes every row from
<code>employees</code>, tests the <code>WHERE</code> condition on each one, throws away the rows that fail,
and only then picks the columns.</p>

<table class="mini">
<tr><th>first_name</th><th>city</th><th>salary</th><th></th></tr>
<tr><td>Bilal</td><td>Lahore</td><td>180000</td><td class="keep">✓ kept</td></tr>
<tr><td>Sara</td><td>Karachi</td><td>180000</td><td class="drop">✗ dropped</td></tr>
<tr><td>Hamza</td><td>Lahore</td><td>120000</td><td class="keep">✓ kept</td></tr>
</table>

<h4>Operators you'll use daily</h4>
<ul>
<li><code>=  &lt;&gt;  &lt;  &gt;  &lt;=  &gt;=</code>. Note that "not equal" is <code>&lt;&gt;</code> (<code>!=</code> works too).</li>
<li><code>AND</code>, <code>OR</code>, <code>NOT</code> combine conditions.</li>
<li><code>city IN ('Lahore', 'Karachi')</code> is a short way to write several <code>OR</code>s.</li>
<li><code>price BETWEEN 30 AND 100</code> includes <b>both</b> ends (same as <code>price &gt;= 30 AND price &lt;= 100</code>).</li>
<li>Text goes in <b>single quotes</b>: <code>'Lahore'</code>. Double quotes mean a column name.</li>
</ul>

<div class="callout trap"><b>Trap: AND runs before OR.</b>
<code>WHERE city = 'Karachi' OR city = 'Lahore' AND salary &gt; 100000</code> means
<i>Karachi (any salary)</i> OR <i>(Lahore AND rich)</i>. When you mix them, always add parentheses:
<code>WHERE (city = 'Karachi' OR city = 'Lahore') AND salary &gt; 100000</code>.</div>

<div class="callout">Before writing any query, run <code>SELECT * FROM employees LIMIT 5;</code> to see what the
data looks like. The <b>Tables</b> panel lists every table in the practice database.</div>`,
  example: {
    sql: `SELECT first_name, last_name, job_title, salary
FROM employees
WHERE department_id = 2
AND salary >= 100000;`,
    note: 'Engineering (department_id = 2) employees earning 100k or more. Try changing the numbers and running it again.',
  },
  exercises: [
    {
      id: 'd1-e1', type: 'query',
      prompt: 'Show the <code>first_name</code>, <code>last_name</code> and <code>salary</code> of every employee who lives in <b>Lahore</b>.',
      hint: "Filter with <code>WHERE city = 'Lahore'</code>. Remember the single quotes.",
      solution: `SELECT first_name, last_name, salary
FROM employees
WHERE city = 'Lahore';`,
      why: 'WHERE keeps the rows where the condition is true, and SELECT then picks three columns from those rows.',
    },
    {
      id: 'd1-e2', type: 'query',
      prompt: 'List the <code>first_name</code> and <code>salary</code> of employees earning <b>more than 100,000</b>.',
      hint: 'Numbers have no quotes: <code>salary &gt; 100000</code>.',
      solution: `SELECT first_name, salary FROM employees WHERE salary > 100000;`,
      why: '<code>&gt;</code> is strict. An employee earning exactly 100000 would be excluded; use <code>&gt;=</code> to include them.',
    },
    {
      id: 'd1-e3', type: 'query',
      prompt: 'Find employees in the <b>Engineering</b> department (<code>department_id = 2</code>) who live in <b>Islamabad</b>. Show <code>first_name</code> and <code>job_title</code>.',
      hint: 'Two conditions that must both be true → <code>AND</code>.',
      solution: `SELECT first_name, job_title
FROM employees
WHERE department_id = 2 AND city = 'Islamabad';`,
      why: 'AND requires both conditions to be true for a row to be kept.',
    },
    {
      id: 'd1-e4', type: 'query',
      prompt: "Show <code>first_name</code> and <code>job_title</code> of everyone whose title is <b>'Backend Engineer'</b>, <b>'Frontend Engineer'</b> or <b>'Junior Engineer'</b>. Use <code>IN</code>.",
      hint: "<code>WHERE job_title IN ('...', '...', '...')</code>",
      solution: `SELECT first_name, job_title
FROM employees
WHERE job_title IN ('Backend Engineer', 'Frontend Engineer', 'Junior Engineer');`,
      alts: [`SELECT first_name, job_title FROM employees
WHERE job_title = 'Backend Engineer' OR job_title = 'Frontend Engineer' OR job_title = 'Junior Engineer';`],
      why: 'IN is shorthand for a chain of ORs on the same column. It is easier to read and harder to get wrong.',
    },
    {
      id: 'd1-e5', type: 'query',
      prompt: 'List <code>name</code> and <code>price</code> of products priced from <b>30 to 100, inclusive</b>, cheapest first.',
      hint: '<code>BETWEEN</code> includes both ends. Sort with <code>ORDER BY price</code>.',
      solution: `SELECT name, price
FROM products
WHERE price BETWEEN 30 AND 100
ORDER BY price;`,
      ordered: true,
      why: '<code>BETWEEN 30 AND 100</code> equals <code>price &gt;= 30 AND price &lt;= 100</code>. ORDER BY sorts ascending by default.',
    },
    {
      id: 'd1-e6', type: 'query',
      prompt: 'Show <code>first_name</code>, <code>city</code> and <code>salary</code> for employees who live in <b>Karachi or Lahore</b> AND earn <b>more than 100,000</b>.',
      hint: 'Mixing AND with OR? Wrap the OR part in parentheses.',
      solution: `SELECT first_name, city, salary
FROM employees
WHERE (city = 'Karachi' OR city = 'Lahore') AND salary > 100000;`,
      alts: [`SELECT first_name, city, salary FROM employees WHERE city IN ('Karachi','Lahore') AND salary > 100000;`],
      wrong: [{ sql: `SELECT first_name, city, salary FROM employees WHERE city = 'Karachi' OR city = 'Lahore' AND salary > 100000;` }],
      why: 'Without parentheses, AND binds first, so every Karachi employee sneaks in regardless of salary. This bug shows up in real code reviews.',
    },
    {
      id: 'd1-q1', type: 'quiz',
      prompt: 'In what order does Postgres <i>logically</i> process this query? <code>SELECT name FROM products WHERE price &gt; 50</code>',
      options: ['SELECT → FROM → WHERE', 'FROM → WHERE → SELECT', 'WHERE → FROM → SELECT', 'FROM → SELECT → WHERE'],
      answer: 1,
      why: 'Postgres first gets the rows (FROM), then filters them (WHERE), then picks columns (SELECT). This is why you cannot use a SELECT alias inside WHERE.',
    },
  ],
  leetcode: [
    { id: 1757, title: 'Recyclable and Low Fat Products', slug: 'recyclable-and-low-fat-products', difficulty: 'Easy' },
    { id: 595, title: 'Big Countries', slug: 'big-countries', difficulty: 'Easy' },
  ],
  ownIt: 'Explain to a junior dev why <code>WHERE a OR b AND c</code> is dangerous, and how you would fix it.',
};
