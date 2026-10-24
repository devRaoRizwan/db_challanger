export default {
  day: 2,
  phase: 1,
  title: 'NULL, DISTINCT, ORDER BY, LIMIT',
  goal: 'Handle missing values correctly, remove duplicates, and sort and page through results.',
  learn: `
<p><code>NULL</code> is not zero and not an empty string. It means <b>"unknown"</b> or "no value".
In our data, 14 of 30 employees have no <code>bonus</code>, Danish has no <code>email</code>, and most customers have no
<code>referred_by</code>.</p>

<h4>NULL breaks normal logic</h4>
<p>Ask "is unknown equal to 4?" and the honest answer is "unknown". SQL agrees: any comparison with NULL
(<code>=</code>, <code>&lt;&gt;</code>, <code>&gt;</code>, ...) gives <b>NULL</b>, not TRUE or FALSE. Even
<code>NULL = NULL</code> is NULL. And <code>WHERE</code> keeps a row only when the condition is <b>TRUE</b>,
so it drops both FALSE rows and NULL rows.</p>

<p>Here is <code>WHERE referred_by &lt;&gt; 4</code> ("customers not referred by customer 4"):</p>
<table class="mini">
<tr><th>id</th><th>name</th><th>referred_by</th><th>referred_by &lt;&gt; 4</th><th></th></tr>
<tr><td>1</td><td>Adeel Niazi</td><td>NULL</td><td>NULL</td><td class="drop">✗ dropped (wrong!)</td></tr>
<tr><td>5</td><td>Ehsan Akhtar</td><td>4</td><td>FALSE</td><td class="drop">✗ dropped</td></tr>
<tr><td>9</td><td>Irfan Gill</td><td>7</td><td>TRUE</td><td class="keep">✓ kept</td></tr>
</table>
<p>Adeel was referred by nobody, so he is obviously "not referred by 4", yet he disappears. That query returns
6 customers; the right answer is 26.</p>

<div class="callout trap"><b>Trap: <code>&lt;&gt;</code> and <code>NOT IN</code> silently drop NULLs.</b>
Write <code>WHERE referred_by &lt;&gt; 4 OR referred_by IS NULL</code>. And never write <code>= NULL</code>:
it is always NULL, so it matches nothing. Use <code>IS NULL</code> / <code>IS NOT NULL</code>.
This is exactly LeetCode 584.</div>

<h4>Replacing NULL: COALESCE</h4>
<p><code>COALESCE(a, b, c)</code> returns the first value that isn't NULL. <code>COALESCE(bonus, 0)</code> turns a
missing bonus into 0. That matters in arithmetic, because <b>anything + NULL = NULL</b>: Zainab's
<code>salary + bonus</code> is NULL, but <code>salary + COALESCE(bonus, 0)</code> is 140000.</p>

<h4>DISTINCT</h4>
<p><code>SELECT DISTINCT city FROM employees</code> returns each city once (4 rows instead of 30).
DISTINCT applies to the <b>whole row</b>: <code>SELECT DISTINCT city, job_title</code> removes rows where
<i>both</i> columns repeat.</p>

<h4>ORDER BY and LIMIT</h4>
<ul>
<li><code>ORDER BY salary DESC, id</code> sorts by salary (highest first), then breaks ties by id.
Without a tie-breaker, Bilal and Sara (both 180000) can come back in either order.</li>
<li>Postgres puts NULLs <b>last</b> when sorting ascending and <b>first</b> when descending.
Control it with <code>NULLS FIRST</code> / <code>NULLS LAST</code>. (MySQL does the opposite by default.)</li>
<li><code>LIMIT 3</code> keeps the first 3 rows; <code>LIMIT 3 OFFSET 3</code> skips 3, then takes 3 (page 2).
LIMIT without ORDER BY gives you "some 3 rows", not the top 3.</li>
</ul>

<div class="callout">Logical order so far: <b>FROM → WHERE → SELECT → DISTINCT → ORDER BY → LIMIT</b>.
Because ORDER BY runs after SELECT, it <i>can</i> use a column alias; WHERE can't.</div>`,
  example: {
    sql: `SELECT first_name, salary, bonus,
     salary + bonus             AS broken_total,
     salary + COALESCE(bonus, 0) AS total_pay
FROM employees
ORDER BY bonus DESC NULLS LAST, id
LIMIT 20;`,
    note: 'Look at broken_total for people with no bonus. Then try NULLS FIRST, or remove LIMIT to see all 30 rows.',
  },
  exercises: [
    {
      id: 'd2-e1', type: 'query',
      prompt: 'Find employees who have <b>no email</b>. Show <code>first_name</code> and <code>last_name</code>.',
      hint: '<code>= NULL</code> never matches anything. Use <code>IS NULL</code>.',
      solution: `SELECT first_name, last_name
FROM employees
WHERE email IS NULL;`,
      wrong: [{ sql: `SELECT first_name, last_name FROM employees WHERE email = NULL;` }],
      why: '<code>email = NULL</code> evaluates to NULL for every row, so WHERE keeps nothing. <code>IS NULL</code> is the only test that answers TRUE for a missing value. Danish is the one.',
    },
    {
      id: 'd2-e2', type: 'query',
      prompt: 'List the <code>name</code> of every customer who was <b>not referred by customer 4</b>. Customers referred by nobody count as "not referred by 4".',
      hint: 'You need two cases: referred by someone else, or referred by nobody (<code>IS NULL</code>).',
      solution: `SELECT name
FROM customers
WHERE referred_by <> 4 OR referred_by IS NULL;`,
      alts: [
        `SELECT name FROM customers WHERE COALESCE(referred_by, 0) <> 4;`,
        `SELECT name FROM customers WHERE referred_by IS DISTINCT FROM 4;`,
      ],
      wrong: [{ sql: `SELECT name FROM customers WHERE referred_by <> 4;` }],
      why: 'The answer is 26 customers. <code>referred_by &lt;&gt; 4</code> alone returns only 6, because for the 20 NULL rows the comparison is NULL, not TRUE. Postgres also has <code>IS DISTINCT FROM</code>, a NULL-safe "not equal".',
    },
    {
      id: 'd2-e3', type: 'query',
      prompt: 'Which cities do our employees live in? Show each <code>city</code> <b>once</b>.',
      hint: '<code>SELECT DISTINCT ...</code>',
      solution: `SELECT DISTINCT city FROM employees;`,
      alts: [`SELECT city FROM employees GROUP BY city;`],
      wrong: [{ sql: `SELECT city FROM employees;` }],
      why: 'Without DISTINCT you get one row per employee (30). DISTINCT collapses identical rows, leaving 4 cities.',
    },
    {
      id: 'd2-e4', type: 'query',
      prompt: 'For Engineering (<code>department_id = 2</code>), show <code>first_name</code> and <code>total_pay</code> = salary plus bonus, where a missing bonus counts as 0. Order by total_pay <b>highest first</b>, ties broken by <code>id</code>.',
      hint: '<code>salary + COALESCE(bonus, 0) AS total_pay</code>, then <code>ORDER BY total_pay DESC, id</code>.',
      solution: `SELECT first_name, salary + COALESCE(bonus, 0) AS total_pay
FROM employees
WHERE department_id = 2
ORDER BY total_pay DESC, id;`,
      ordered: true,
      wrong: [{ sql: `SELECT first_name, salary + bonus AS total_pay FROM employees WHERE department_id = 2 ORDER BY total_pay DESC, id;` }],
      why: 'Anything plus NULL is NULL, so <code>salary + bonus</code> gives NULL for 7 of the 11 engineers. COALESCE swaps NULL for 0 before adding. Danish and Iqra tie at 88000, so <code>id</code> decides their order.',
    },
    {
      id: 'd2-e5', type: 'query',
      prompt: 'List projects by <code>end_date</code>, <b>latest first</b>, with ongoing projects (no end_date) at the <b>bottom</b>, sorted among themselves by name. Show <code>name</code> and <code>end_date</code>.',
      hint: 'In Postgres, DESC puts NULLs first. Add <code>NULLS LAST</code>, then <code>, name</code>.',
      solution: `SELECT name, end_date
FROM projects
ORDER BY end_date DESC NULLS LAST, name;`,
      ordered: true,
      alts: [`SELECT name, end_date FROM projects ORDER BY end_date IS NULL, end_date DESC, name;`],
      wrong: [{ sql: `SELECT name, end_date FROM projects ORDER BY end_date DESC, name;` }],
      why: 'Postgres treats NULL as larger than any value, so it sorts NULLs first in DESC order. <code>NULLS LAST</code> overrides that. The alt sorts by the boolean <code>end_date IS NULL</code> first (false before true), a trick that also works in MySQL.',
    },
    {
      id: 'd2-e6', type: 'query',
      prompt: 'Page 2 of the salary leaderboard: show the <b>4th, 5th and 6th</b> best-paid employees. Columns: <code>first_name</code>, <code>salary</code>. Order by salary DESC, ties broken by <code>id</code>.',
      hint: 'Skip 3 rows, then take 3: <code>LIMIT 3 OFFSET 3</code>.',
      solution: `SELECT first_name, salary
FROM employees
ORDER BY salary DESC, id
LIMIT 3 OFFSET 3;`,
      ordered: true,
      wrong: [{ sql: `SELECT first_name, salary FROM employees ORDER BY salary DESC, id LIMIT 3;` }],
      why: 'Rows 1–3 are Ayesha, Bilal and Sara, so page 2 is Hina (170000), Usman (160000) and Omar (140000). Omar ties with Zainab at 140000; the <code>id</code> tie-breaker makes the page stable.',
    },
    {
      id: 'd2-q1', type: 'quiz',
      prompt: 'What does <code>SELECT NULL = NULL;</code> return in Postgres?',
      options: ['TRUE', 'FALSE', 'NULL', 'An error'],
      answer: 2,
      why: 'Two unknowns are not known to be equal, so the answer is unknown: NULL. That is why <code>WHERE x = NULL</code> never matches and you must use <code>IS NULL</code>.',
    },
  ],
  leetcode: [
    { id: 584, title: 'Find Customer Referee', slug: 'find-customer-referee', difficulty: 'Easy' },
    { id: 1148, title: 'Article Views I', slug: 'article-views-i', difficulty: 'Easy' },
  ],
  ownIt: 'Explain to a teammate why <code>WHERE referred_by &lt;&gt; 4</code> loses rows, and give two ways to fix it.',
};
