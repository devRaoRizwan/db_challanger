export default {
  day: 8,
  phase: 1,
  title: 'Self joins & CROSS JOIN',
  goal: 'Join a table to itself to compare rows (employee vs manager, pairs), and use CROSS JOIN to build "every combination" grids.',
  learn: `
<p>Look at <code>employees.manager_id</code>. It points at another row <b>in the same table</b>. To print "Hamza reports to Omar"
you need two copies of <code>employees</code> at once: one playing the employee, one playing the manager. That's a <b>self join</b>.
Nothing new in the syntax; the trick is giving each copy its own alias.</p>

<pre><code>SELECT e.first_name AS employee, m.first_name AS manager
FROM employees e                         -- copy 1: the employee
JOIN employees m ON e.manager_id = m.id; -- copy 2: the manager</code></pre>

<table class="mini">
<tr><th>e.id</th><th>e.first_name</th><th>e.manager_id</th><th></th><th>m.id</th><th>m.first_name</th></tr>
<tr><td>8</td><td>Hamza</td><td>6</td><td>→</td><td>6</td><td>Omar</td></tr>
<tr><td>6</td><td>Omar</td><td>2</td><td>→</td><td>2</td><td>Bilal</td></tr>
<tr><td>2</td><td>Bilal</td><td>1</td><td>→</td><td>1</td><td>Ayesha</td></tr>
<tr><td class="drop">1</td><td class="drop">Ayesha</td><td class="drop">NULL</td><td></td><td class="drop">-</td><td class="drop">-</td></tr>
</table>
<p>The inner join gives 29 rows, not 30: Ayesha (the CEO) has <code>manager_id</code> NULL, which matches nobody. Want her too?
Yesterday's lesson applies: <code>LEFT JOIN employees m</code> keeps her with a NULL manager.</p>

<h4>Comparing a row with its partner</h4>
<p>Once both copies sit side by side you can compare their columns. LeetCode 181 asks for employees who earn more than their manager:</p>
<pre><code>WHERE e.salary &gt; m.salary</code></pre>
<p>In our company that returns <b>0 rows</b> (everyone earns less than their boss; Hamza and Fatima are closest, 20,000 below Omar).
Same idea for dates: LeetCode 197 joins a weather table to itself on "yesterday" (<code>w.recordDate = y.recordDate + 1</code> in Postgres,
<code>DATEDIFF(w.recordDate, y.recordDate) = 1</code> in MySQL).</p>

<h4>Pairs without duplicates</h4>
<p>"Which employees live in the same city?" Joining on <code>a.city = b.city</code> alone gives Zainab–Zainab (a row paired with itself)
and both Zainab–Danish <i>and</i> Danish–Zainab. Add <code>a.id &lt; b.id</code>: that removes self-pairs and keeps exactly one order of each pair.</p>
<table class="mini">
<tr><th>a</th><th>b</th><th>a.id &lt; b.id?</th></tr>
<tr><td>Zainab (7)</td><td>Zainab (7)</td><td class="drop">✗ self pair</td></tr>
<tr><td>Zainab (7)</td><td>Danish (12)</td><td class="keep">✓ kept</td></tr>
<tr><td>Danish (12)</td><td>Zainab (7)</td><td class="drop">✗ mirror duplicate</td></tr>
</table>

<h4>CROSS JOIN: every combination</h4>
<p><code>A CROSS JOIN B</code> has no ON clause; it pairs every row of A with every row of B (8 departments × 6 projects = 48 rows).
It sounds useless, but it is how you build a <b>grid</b> of all combinations, then LEFT JOIN the real data onto it so missing cells
show 0 instead of vanishing. That is exactly LeetCode 1280 (every student × every subject, then count exams):</p>
<pre><code>SELECT e.first_name, p.name, COALESCE(ep.hours, 0) AS hours
FROM employees e
CROSS JOIN projects p
LEFT JOIN employee_projects ep
     ON ep.employee_id = e.id AND ep.project_id = p.id;</code></pre>

<div class="callout trap"><b>Trap: the accidental cross join.</b> Forget the join condition (or write <code>FROM a, b</code> with no WHERE) and
you silently get rows × rows. If a result suddenly has way more rows than you expected, check your ON clauses first.</div>`,
  example: {
    sql: `SELECT e.first_name AS employee, e.job_title,
     m.first_name AS manager, m.job_title AS manager_title
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id
ORDER BY e.id;`,
    note: 'Ayesha shows a NULL manager because of the LEFT JOIN. Change LEFT to plain JOIN and count the rows. Then add WHERE e.salary > m.salary.',
  },
  exercises: [
    {
      id: 'd8-e1', type: 'query',
      prompt: 'Show each employee\'s <code>first_name</code> next to their manager\'s <code>first_name</code> (two columns: employee, manager). Only employees who have a manager.',
      hint: '<code>FROM employees e JOIN employees m ON e.manager_id = m.id</code>.',
      solution: `SELECT e.first_name AS employee, m.first_name AS manager
FROM employees e
JOIN employees m ON e.manager_id = m.id;`,
      wrong: [{ sql: `SELECT e.first_name, m.first_name FROM employees e JOIN employees m ON e.id = m.manager_id;` }],
      why: 'The direction matters: <code>e.manager_id = m.id</code> means "m is e\'s manager". Flipping it to <code>e.id = m.manager_id</code> swaps the roles, so the columns come out as (manager, employee).',
    },
    {
      id: 'd8-e2', type: 'query',
      prompt: 'Same as before, but include <b>everyone</b>: show <code>first_name</code>, <code>last_name</code>, and <code>manager_name</code> (manager\'s first_name). The CEO should show NULL.',
      hint: 'Switch to <code>LEFT JOIN</code> so the employee side is always kept.',
      solution: `SELECT e.first_name, e.last_name, m.first_name AS manager_name
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id;`,
      wrong: [{ sql: `SELECT e.first_name, e.last_name, m.first_name FROM employees e JOIN employees m ON e.manager_id = m.id;` }],
      why: 'All 30 employees appear. Ayesha Khan has manager_id NULL, so the LEFT JOIN fills manager_name with NULL instead of dropping her.',
    },
    {
      id: 'd8-e3', type: 'query',
      prompt: 'Nobody here earns more than their manager (LeetCode 181), so let\'s find the closest: employees whose manager earns <b>at most 30,000 more</b> than them. Show <code>employee</code> first_name, employee <code>salary</code>, <code>manager</code> first_name, manager <code>salary</code>.',
      hint: 'Self join, then <code>WHERE m.salary - e.salary &lt;= 30000</code>.',
      solution: `SELECT e.first_name AS employee, e.salary, m.first_name AS manager, m.salary AS manager_salary
FROM employees e
JOIN employees m ON e.manager_id = m.id
WHERE m.salary - e.salary <= 30000;`,
      alts: [`SELECT e.first_name, e.salary, m.first_name, m.salary FROM employees e JOIN employees m ON e.manager_id = m.id WHERE e.salary >= m.salary - 30000;`],
      why: 'Hamza and Fatima (120,000 vs Omar\'s 140,000) and Saima (55,000 vs Tariq\'s 85,000). Comparing two columns that come from different copies of the same table is the whole point of a self join.',
    },
    {
      id: 'd8-e4', type: 'query',
      prompt: '<code>customers.referred_by</code> holds the id of the customer who referred them. Show each referrer\'s <code>name</code> and <code>referrals</code> (how many customers they referred). Only customers who referred at least one person.',
      hint: 'Join <code>customers c</code> to <code>customers r ON c.referred_by = r.id</code>, then GROUP BY the referrer.',
      solution: `SELECT r.name, COUNT(*) AS referrals
FROM customers c
JOIN customers r ON c.referred_by = r.id
GROUP BY r.id, r.name;`,
      wrong: [{ sql: `SELECT c.name, COUNT(*) FROM customers c JOIN customers r ON c.referred_by = r.id GROUP BY c.id, c.name;` }],
      why: 'Group by the referrer copy (r), not the referred copy (c). Dua Lodhi referred 2 customers; six others referred 1 each. LeetCode 1731 is the same shape on employees.',
    },
    {
      id: 'd8-e5', type: 'query',
      prompt: 'List each <b>pair</b> of employees who live in <b>Islamabad</b> and work in the <b>same department</b>. Show both first names; each pair once, never an employee paired with themselves.',
      hint: 'Join <code>employees a</code> to <code>employees b</code> on city and department, and use <code>a.id &lt; b.id</code>.',
      solution: `SELECT a.first_name, b.first_name
FROM employees a
JOIN employees b
ON a.city = b.city
AND a.department_id = b.department_id
AND a.id < b.id
WHERE a.city = 'Islamabad';`,
      wrong: [{ sql: `SELECT a.first_name, b.first_name FROM employees a JOIN employees b ON a.city = b.city AND a.department_id = b.department_id AND a.id <> b.id WHERE a.city = 'Islamabad';` }],
      why: 'There are 7 pairs (6 among the four Engineering people, plus Komal–Waqar in Marketing). With <code>&lt;&gt;</code> you get each pair twice (14 rows); with no id condition you also get self-pairs.',
    },
    {
      id: 'd8-e6', type: 'query',
      prompt: 'Build the 1280-style grid: every <b>Engineering</b> employee (<code>department_id = 2</code>) × every <b>Engineering project</b> (<code>projects.department_id = 2</code>). Show <code>first_name</code>, project <code>name</code> and <code>hours</code> they logged on it, 0 if none.',
      hint: '<code>employees CROSS JOIN projects</code>, then <code>LEFT JOIN employee_projects</code> on both ids, and <code>COALESCE(ep.hours, 0)</code>.',
      solution: `SELECT e.first_name, p.name, COALESCE(ep.hours, 0) AS hours
FROM employees e
CROSS JOIN projects p
LEFT JOIN employee_projects ep
     ON ep.employee_id = e.id AND ep.project_id = p.id
WHERE e.department_id = 2 AND p.department_id = 2;`,
      wrong: [{ sql: `SELECT e.first_name, p.name, ep.hours FROM employees e JOIN employee_projects ep ON ep.employee_id = e.id JOIN projects p ON p.id = ep.project_id WHERE e.department_id = 2 AND p.department_id = 2;` }],
      why: '11 employees × 2 projects = 22 rows. The inner-join version only shows the 7 assignments that exist; the grid shows the gaps (Bilal, 0 hours) too.',
    },
    {
      id: 'd8-q1', type: 'quiz',
      prompt: 'You self-join <code>employees a JOIN employees b ON a.city = b.city</code> to find pairs. Why add <code>a.id &lt; b.id</code> instead of <code>a.id &lt;&gt; b.id</code>?',
      options: [
        'It is faster, but the results are the same',
        '&lt;&gt; removes self-pairs but keeps both (A,B) and (B,A); &lt; keeps each pair once',
        '&lt; is required because &lt;&gt; does not work on integers',
        'It sorts the result by id',
      ],
      answer: 1,
      why: 'Both conditions drop self-pairs, but only <code>&lt;</code> also drops the mirrored duplicate, because exactly one of (A,B) and (B,A) has the smaller id first.',
    },
  ],
  leetcode: [
    { id: 181, title: 'Employees Earning More Than Their Managers', slug: 'employees-earning-more-than-their-managers', difficulty: 'Easy' },
    { id: 197, title: 'Rising Temperature', slug: 'rising-temperature', difficulty: 'Easy' },
    { id: 1280, title: 'Students and Examinations', slug: 'students-and-examinations', difficulty: 'Easy' },
    { id: 1731, title: 'The Number of Employees Which Report to Each Employee', slug: 'the-number-of-employees-which-report-to-each-employee', difficulty: 'Easy' },
  ],
  ownIt: 'Explain how a table can be joined to itself, using employees and managers as the example. Then explain why the 1280 "Students and Examinations" problem needs a CROSS JOIN before the LEFT JOIN.',
};
