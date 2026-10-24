export default {
  day: 12,
  phase: 2,
  title: 'Second highest salary: 4 ways',
  goal: 'Solve the most-asked SQL interview question four ways, and know which ones break on ties.',
  learn: `
<p>"Find the second highest salary" sounds easy, but it hides two traps: <b>ties</b> and
<b>no second value at all</b>. Here are the salaries at the top of our company:</p>

<table class="mini">
<tr><th>first_name</th><th>salary</th><th>ROW_NUMBER</th><th>RANK</th><th>DENSE_RANK</th></tr>
<tr><td>Ayesha</td><td>250000</td><td>1</td><td>1</td><td>1</td></tr>
<tr><td>Bilal</td><td>180000</td><td>2</td><td>2</td><td>2</td></tr>
<tr><td>Sara</td><td>180000</td><td>3</td><td>2</td><td>2</td></tr>
<tr><td>Hina</td><td>170000</td><td>4</td><td class="drop">4</td><td class="keep">3</td></tr>
</table>
<p><code>ROW_NUMBER</code> never ties. <code>RANK</code> ties, then <b>skips</b> numbers (no rank 3).
<code>DENSE_RANK</code> ties <b>without gaps</b>, which makes it the natural choice for "Nth highest <i>value</i>".</p>

<h4>Way 1: MAX below the MAX</h4>
<pre><code>SELECT MAX(salary) AS second_highest
FROM employees
WHERE salary &lt; (SELECT MAX(salary) FROM employees);</code></pre>
<p>Simple, handles ties, and returns <code>NULL</code> when there is no second value. It doesn't extend to "Nth" though.</p>

<h4>Way 2: DISTINCT + ORDER BY + OFFSET</h4>
<pre><code>SELECT (
  SELECT DISTINCT salary FROM employees
  ORDER BY salary DESC
  LIMIT 1 OFFSET 1          -- skip 1, take 1  →  Nth = OFFSET N-1
) AS second_highest;</code></pre>
<p><code>DISTINCT</code> handles ties. The outer <code>SELECT ( … )</code> turns "no rows" into one row containing <code>NULL</code>,
which is what LeetCode 176 expects.</p>

<h4>Way 3: DENSE_RANK (the most general)</h4>
<pre><code>SELECT DISTINCT salary
FROM (
  SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS rnk
  FROM employees
) ranked
WHERE rnk = 2;</code></pre>
<p>Change <code>2</code> to N and you have Nth highest. Add <code>PARTITION BY department_id</code> and you get it <i>per department</i>.</p>

<h4>Way 4: Count how many are bigger (correlated subquery)</h4>
<pre><code>SELECT DISTINCT salary
FROM employees e1
WHERE 1 = (SELECT COUNT(DISTINCT e2.salary)
         FROM employees e2
         WHERE e2.salary &gt; e1.salary);</code></pre>
<p>"The second highest is the salary with exactly one distinct salary above it." This approach is a classic and works in any SQL dialect,
but the inner query runs once per row, so it's slow on big tables.</p>

<div class="callout trap"><b>Trap:</b> <code>ORDER BY salary DESC LIMIT 1 OFFSET 1</code> <i>without</i> DISTINCT gives the
second <b>row</b>, not the second <b>value</b>. It happens to work for 2nd here (Bilal = 180000), but ask for the 3rd and it
returns Sara's 180000 again instead of 170000.</div>`,
  example: {
    sql: `SELECT first_name, salary,
     ROW_NUMBER() OVER (ORDER BY salary DESC) AS row_num,
     RANK()       OVER (ORDER BY salary DESC) AS rnk,
     DENSE_RANK() OVER (ORDER BY salary DESC) AS dense_rnk
FROM employees
ORDER BY salary DESC
LIMIT 10;`,
    note: 'Compare the three ranking columns where salaries tie (180000, 140000, 120000).',
  },
  exercises: [
    {
      id: 'd12-e1', type: 'query',
      prompt: 'Return the <b>second highest salary</b> in the company as a single column named <code>second_highest</code>.',
      hint: 'Way 1 is the quickest: MAX of salaries below the MAX.',
      solution: `SELECT MAX(salary) AS second_highest
FROM employees
WHERE salary < (SELECT MAX(salary) FROM employees);`,
      alts: [
        `SELECT (SELECT DISTINCT salary FROM employees ORDER BY salary DESC LIMIT 1 OFFSET 1) AS second_highest;`,
        `SELECT DISTINCT salary FROM (SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS r FROM employees) t WHERE r = 2;`,
        `SELECT DISTINCT salary FROM employees e1 WHERE 1 = (SELECT COUNT(DISTINCT e2.salary) FROM employees e2 WHERE e2.salary > e1.salary);`,
      ],
      why: 'All four ways give 180000. Try solving it again with a different approach and check it.',
    },
    {
      id: 'd12-e2', type: 'query',
      prompt: 'Return the <b>third highest distinct salary</b>. One column, one row.',
      hint: 'DENSE_RANK = 3, or DISTINCT + OFFSET 2. Watch out for the 180000 tie.',
      solution: `SELECT DISTINCT salary
FROM (SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS rnk FROM employees) ranked
WHERE rnk = 3;`,
      alts: [`SELECT DISTINCT salary FROM employees ORDER BY salary DESC LIMIT 1 OFFSET 2;`],
      wrong: [{ sql: `SELECT salary FROM employees ORDER BY salary DESC LIMIT 1 OFFSET 2;` }],
      why: 'The answer is 170000. Without DISTINCT, OFFSET 2 lands on Sara, who ties at 180000. That is the classic tie bug.',
    },
    {
      id: 'd12-e3', type: 'query',
      prompt: 'For the 8 best-paid employees, show <code>first_name</code>, <code>salary</code>, <code>RANK()</code> and <code>DENSE_RANK()</code> by salary (highest first). Order by salary DESC, then <code>id</code>.',
      hint: 'Two window functions, both <code>OVER (ORDER BY salary DESC)</code>. Finish with <code>ORDER BY salary DESC, id LIMIT 8</code>.',
      solution: `SELECT first_name, salary,
     RANK() OVER (ORDER BY salary DESC) AS rnk,
     DENSE_RANK() OVER (ORDER BY salary DESC) AS dense_rnk
FROM employees
ORDER BY salary DESC, id
LIMIT 8;`,
      ordered: true,
      why: 'Notice that RANK jumps from 2 to 4 and from 6 to 8 after ties, while DENSE_RANK increases one step at a time.',
    },
    {
      id: 'd12-e4', type: 'query',
      prompt: 'Find the <b>second highest salary in each department</b>. Show the department <code>name</code> and that <code>salary</code>. Departments with only one distinct salary should not appear.',
      hint: '<code>DENSE_RANK() OVER (PARTITION BY department_id ORDER BY salary DESC)</code>, then join departments and keep rank 2.',
      solution: `SELECT DISTINCT d.name, r.salary
FROM (
SELECT department_id, salary,
       DENSE_RANK() OVER (PARTITION BY department_id ORDER BY salary DESC) AS rnk
FROM employees
) r
JOIN departments d ON d.id = r.department_id
WHERE r.rnk = 2;`,
      why: 'PARTITION BY restarts the ranking for each department, the same idea as GROUP BY but without collapsing rows.',
    },
    {
      id: 'd12-e5', type: 'query',
      prompt: "Return the second highest salary among <b>HR employees (department_id = 7) living in Islamabad</b> as <code>second_highest</code>. If there isn't one, return a single row containing <code>NULL</code>.",
      hint: 'Only one person matches. Wrap the query as <code>SELECT ( … ) AS second_highest</code> so that "no rows" becomes NULL.',
      solution: `SELECT (
SELECT DISTINCT salary FROM employees
WHERE department_id = 7 AND city = 'Islamabad'
ORDER BY salary DESC
LIMIT 1 OFFSET 1
) AS second_highest;`,
      alts: [`SELECT MAX(salary) AS second_highest FROM employees
WHERE department_id = 7 AND city = 'Islamabad'
AND salary < (SELECT MAX(salary) FROM employees WHERE department_id = 7 AND city = 'Islamabad');`],
      wrong: [{ sql: `SELECT DISTINCT salary FROM employees WHERE department_id = 7 AND city = 'Islamabad' ORDER BY salary DESC LIMIT 1 OFFSET 1;` }],
      why: 'An aggregate (MAX) over zero rows returns NULL, and so does a scalar subquery that finds nothing. A bare LIMIT/OFFSET returns zero rows, which LeetCode 176 marks wrong.',
    },
    {
      id: 'd12-q1', type: 'quiz',
      prompt: 'You need the 3rd highest <i>distinct</i> salary per department. Which function do you reach for?',
      options: ['ROW_NUMBER()', 'RANK()', 'DENSE_RANK()', 'NTILE(3)'],
      answer: 2,
      why: 'DENSE_RANK gives tied values the same number and leaves no gaps, so rank 3 is always the 3rd distinct value. RANK could skip 3 entirely after a tie.',
    },
  ],
  leetcode: [
    { id: 176, title: 'Second Highest Salary', slug: 'second-highest-salary', difficulty: 'Medium' },
    { id: 177, title: 'Nth Highest Salary', slug: 'nth-highest-salary', difficulty: 'Medium' },
    { id: 178, title: 'Rank Scores', slug: 'rank-scores', difficulty: 'Medium' },
  ],
  ownIt: 'Without looking, write "Nth highest salary per department" and explain why DENSE_RANK beats RANK and ROW_NUMBER for it.',
};
