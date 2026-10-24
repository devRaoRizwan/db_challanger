export default {
  day: 3,
  phase: 1,
  title: 'Text, numbers & built-in functions',
  goal: 'Search text with patterns, build new text and numbers from columns, and avoid the integer division trap.',
  learn: `
<p>SELECT doesn't just copy columns. It can compute <b>new values</b> from each row, and
<code>AS</code> gives the result a name (an <b>alias</b>):</p>
<pre><code>SELECT first_name || ' ' || last_name AS full_name,
     salary / 12                    AS monthly
FROM employees;</code></pre>

<h4>Pattern matching: LIKE and ILIKE</h4>
<ul>
<li><code>%</code> matches any number of characters (including none). <code>_</code> matches exactly one.</li>
<li><code>name LIKE 'Desk%'</code> → starts with "Desk". <code>'%Desk%'</code> → contains it. <code>'____'</code> → exactly 4 characters.</li>
<li><code>LIKE</code> is <b>case-sensitive</b> in Postgres. <code>ILIKE</code> ignores case (Postgres only; the portable way is <code>LOWER(name) LIKE '%desk%'</code>).</li>
</ul>
<table class="mini">
<tr><th>name</th><th>LIKE '%desk%'</th><th>ILIKE '%desk%'</th></tr>
<tr><td>Standing Desk</td><td class="drop">✗</td><td class="keep">✓</td></tr>
<tr><td>Desk Lamp</td><td class="drop">✗</td><td class="keep">✓</td></tr>
<tr><td>Ergonomic Chair</td><td class="drop">✗</td><td class="drop">✗</td></tr>
</table>
<p>For harder patterns, Postgres has regular expressions: <code>name ~ '^[0-9]'</code> means "starts with a digit"
(<code>~*</code> is the case-insensitive version). LeetCode 1517 (valid emails) needs this; MySQL writes it
<code>REGEXP</code>.</p>

<h4>Text functions</h4>
<table class="mini">
<tr><th>Expression</th><th>Result</th></tr>
<tr><td><code>'Bilal' || ' ' || 'Ahmed'</code></td><td>Bilal Ahmed</td></tr>
<tr><td><code>CONCAT('Bilal', ' ', 'Ahmed')</code></td><td>Bilal Ahmed (CONCAT skips NULLs; <code>||</code> with a NULL gives NULL)</td></tr>
<tr><td><code>UPPER('lahore')</code>, <code>LOWER('LAHORE')</code>, <code>INITCAP('lahore')</code></td><td>LAHORE, lahore, Lahore</td></tr>
<tr><td><code>LENGTH('Sara')</code></td><td>4</td></tr>
<tr><td><code>LEFT('Karachi', 3)</code>, <code>SUBSTRING('Karachi', 2)</code></td><td>Kar, arachi</td></tr>
<tr><td><code>SPLIT_PART('bilal.ahmed@acme.io', '@', 1)</code></td><td>bilal.ahmed</td></tr>
</table>

<h4>Numbers</h4>
<p><code>+ - * /</code> work as you expect, <code>%</code> is the remainder, and <code>ROUND(x, 2)</code> rounds to 2 decimals.
But the type of the inputs decides the type of the result:</p>

<div class="callout trap"><b>Trap: integer ÷ integer = integer.</b> <code>SELECT 5 / 2</code> returns <b>2</b>, not 2.5.
<code>hours</code> in <code>employee_projects</code> is an integer, so <code>hours / 8</code> for 60 hours gives 7, not 7.5.
Make one side a decimal first: <code>hours / 8.0</code> or <code>hours::numeric / 8</code>
(<code>::</code> is Postgres's cast; the portable spelling is <code>CAST(hours AS numeric)</code>).
<code>salary</code> is already <code>numeric</code>, so it's safe.</div>

<div class="callout">Aliases are just labels on the output. You can use them in ORDER BY, but <b>not in WHERE</b>,
because WHERE runs before SELECT has created them. Repeat the expression in WHERE instead.</div>`,
  example: {
    sql: `SELECT first_name || ' ' || last_name AS full_name,
     UPPER(LEFT(city, 3))           AS city_code,
     SPLIT_PART(email, '@', 1)      AS username,
     LENGTH(first_name)             AS name_len,
     7 / 2                          AS int_div,
     7 / 2.0                        AS real_div
FROM employees
WHERE first_name ILIKE 's%';`,
    note: 'Everyone whose first name starts with S. Try LIKE instead of ILIKE, or change the pattern to \'%a\'.',
  },
  exercises: [
    {
      id: 'd3-e1', type: 'query',
      prompt: 'Find products whose name contains <b>"desk"</b> in any capitalisation. Show <code>name</code> and <code>price</code>.',
      hint: '<code>ILIKE \'%desk%\'</code>, or <code>LOWER(name) LIKE \'%desk%\'</code>.',
      solution: `SELECT name, price
FROM products
WHERE name ILIKE '%desk%';`,
      alts: [`SELECT name, price FROM products WHERE LOWER(name) LIKE '%desk%';`],
      wrong: [{ sql: `SELECT name, price FROM products WHERE name LIKE '%desk%';` }],
      why: 'Both product names spell it "Desk" with a capital D, so case-sensitive LIKE finds nothing. Lowercasing first is the portable fix and works in MySQL too.',
    },
    {
      id: 'd3-e2', type: 'query',
      prompt: 'For the Sales department (<code>department_id = 4</code>), show <code>full_name</code> (first name, a space, last name) and <code>job_title</code>.',
      hint: "<code>first_name || ' ' || last_name AS full_name</code>",
      solution: `SELECT first_name || ' ' || last_name AS full_name, job_title
FROM employees
WHERE department_id = 4;`,
      alts: [`SELECT CONCAT(first_name, ' ', last_name), job_title FROM employees WHERE department_id = 4;`],
      wrong: [{ sql: `SELECT first_name || last_name, job_title FROM employees WHERE department_id = 4;` }],
      why: '<code>||</code> glues text together exactly as given, so you have to add the space yourself. CONCAT does the same and is what MySQL uses.',
    },
    {
      id: 'd3-e3', type: 'query',
      prompt: 'Find employees whose <code>first_name</code> is <b>exactly 4 letters</b> long. Show <code>first_name</code>.',
      hint: 'Four underscores in a LIKE pattern, or <code>LENGTH(first_name) = 4</code>.',
      solution: `SELECT first_name
FROM employees
WHERE first_name LIKE '____';`,
      alts: [`SELECT first_name FROM employees WHERE LENGTH(first_name) = 4;`],
      wrong: [{ sql: `SELECT first_name FROM employees WHERE first_name LIKE '%____%';` }],
      why: 'Each <code>_</code> matches exactly one character, so <code>\'____\'</code> means "exactly four". Wrapping it in <code>%</code> turns it into "at least four", which matches almost everyone.',
    },
    {
      id: 'd3-e4', type: 'query',
      prompt: 'For customers <b>outside Pakistan</b>, show <code>name</code> and a <code>city_code</code>: the first 3 letters of their city in UPPERCASE (London → LON).',
      hint: '<code>UPPER(LEFT(city, 3))</code>. Functions can be nested.',
      solution: `SELECT name, UPPER(LEFT(city, 3)) AS city_code
FROM customers
WHERE country <> 'Pakistan';`,
      alts: [`SELECT name, UPPER(SUBSTRING(city, 1, 3)) FROM customers WHERE country <> 'Pakistan';`],
      why: 'LEFT takes the first 3 characters, then UPPER converts them. LeetCode 1667 (Fix Names) is the same idea: <code>UPPER(LEFT(name,1)) || LOWER(SUBSTRING(name,2))</code>.',
    },
    {
      id: 'd3-e5', type: 'query',
      prompt: 'For project 1 (<code>project_id = 1</code>), show <code>employee_id</code> and <code>days</code> = hours divided by 8, as an <b>exact decimal</b> rounded to 2 places.',
      hint: '<code>hours</code> is an integer. Divide by <code>8.0</code> (or cast with <code>::numeric</code>), then ROUND.',
      solution: `SELECT employee_id, ROUND(hours / 8.0, 2) AS days
FROM employee_projects
WHERE project_id = 1;`,
      alts: [`SELECT employee_id, ROUND(hours::numeric / 8, 2) FROM employee_projects WHERE project_id = 1;`,
        `SELECT employee_id, ROUND(CAST(hours AS numeric) / 8, 2) FROM employee_projects WHERE project_id = 1;`],
      wrong: [{ sql: `SELECT employee_id, hours / 8 FROM employee_projects WHERE project_id = 1;` }],
      why: 'Omar worked 60 hours, which is 7.5 days. <code>hours / 8</code> uses integer division and throws the .5 away, giving 7. One decimal operand makes the whole division decimal.',
    },
    {
      id: 'd3-e6', type: 'query',
      prompt: 'Find products whose name <b>starts with a digit</b>. Show <code>name</code>.',
      hint: "Regex: <code>name ~ '^[0-9]'</code>. <code>^</code> means \"start of text\", <code>[0-9]</code> means any digit.",
      solution: `SELECT name FROM products WHERE name ~ '^[0-9]';`,
      alts: [`SELECT name FROM products WHERE LEFT(name, 1) BETWEEN '0' AND '9';`],
      why: 'Only <code>27" Monitor</code> matches. LIKE has no "any digit" wildcard, which is where regular expressions help.',
    },
    {
      id: 'd3-q1', type: 'quiz',
      prompt: 'What does <code>SELECT 7 / 2;</code> return in Postgres?',
      options: ['3.5', '3', '4', 'An error'],
      answer: 1,
      why: 'Both operands are integers, so Postgres does integer division and truncates toward zero. <code>7 / 2.0</code> or <code>7::numeric / 2</code> gives 3.5. (MySQL returns 3.5 here, which is why this trap hits people who switch databases.)',
    },
  ],
  leetcode: [
    { id: 1683, title: 'Invalid Tweets', slug: 'invalid-tweets', difficulty: 'Easy' },
    { id: 1667, title: 'Fix Names in a Table', slug: 'fix-names-in-a-table', difficulty: 'Easy' },
    { id: 1527, title: 'Patients With a Condition', slug: 'patients-with-a-condition', difficulty: 'Easy' },
    { id: 1517, title: 'Find Users With Valid E-Mails', slug: 'find-users-with-valid-e-mails', difficulty: 'Easy' },
  ],
  ownIt: 'Explain why <code>hours / 8</code> and <code>hours / 8.0</code> give different answers, and when you would hit this bug in a real backend report.',
};
