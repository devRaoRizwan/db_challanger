export default {
  day: 17,
  phase: 2,
  title: 'Recursive CTEs: hierarchies & series',
  goal: 'Walk a tree of any depth (org charts, referrals) and generate rows that don\'t exist yet (date series) with WITH RECURSIVE.',
  learn: `
<p><code>employees.manager_id</code> points at another employee. "Who reports to Bilal?" is one self-join. But "everyone
<i>under</i> Bilal, at any depth" needs one join per level, and you don't know how many levels there are. A
<b>recursive CTE</b> keeps joining until nothing new turns up.</p>

<pre><code>WITH RECURSIVE org AS (
  -- 1. anchor: where to start (runs once)
  SELECT id, first_name, manager_id, 1 AS level
  FROM employees
  WHERE manager_id IS NULL
  UNION ALL
  -- 2. recursive member: join the table to the rows found in the LAST step
  SELECT e.id, e.first_name, e.manager_id, o.level + 1
  FROM employees e
  JOIN org o ON e.manager_id = o.id
)
SELECT * FROM org;</code></pre>

<h4>Draw the iterations</h4>
<p>Postgres runs the anchor, then repeats the recursive part, each time feeding in <b>only the rows from the previous round</b>:</p>
<table class="mini">
<tr><th>round</th><th>input (previous round)</th><th>new rows found</th></tr>
<tr><td>anchor</td><td>(none)</td><td>Ayesha (level 1)</td></tr>
<tr><td>1</td><td>Ayesha</td><td>Bilal, Sara, Usman, Hina, Komal, Tariq (level 2)</td></tr>
<tr><td>2</td><td>those 6</td><td>Omar, Zainab, Kamran, Ahmed, Sana, Imran, Ayesha O., Waqar, Nida, Saima (level 3)</td></tr>
<tr><td>3</td><td>those 10</td><td>13 people at level 4 (Hamza, Saad, Rabia, Junaid…)</td></tr>
<tr><td>4</td><td>those 13</td><td class="drop">nobody reports to them → stop</td></tr>
</table>
<p>The result is the <code>UNION ALL</code> of every round: 1 + 6 + 10 + 13 = 30 employees.</p>

<h4>Useful extras</h4>
<ul>
<li><b>Path</b>: carry a string along: <code>o.path || ' &gt; ' || e.first_name</code>, which gives
"Ayesha &gt; Bilal &gt; Zainab &gt; Saad". Cast the anchor with <code>first_name::text</code> so the types match.</li>
<li><b>Start somewhere else</b>: anchor <code>WHERE id = 2</code> gives Bilal's subtree.</li>
<li><b>Walk up instead of down</b>: flip the join to <code>e.id = o.manager_id</code> to climb from Saad to the CEO.</li>
<li><b>Series</b>: the recursion doesn't need a table at all:
<code>SELECT DATE '2025-01-01' AS d UNION ALL SELECT d + 1 FROM s WHERE d &lt; '2025-01-31'</code>.
Postgres also has the built-in <code>generate_series('2025-01-01'::date, '2025-01-31', INTERVAL '1 day')</code>, but MySQL
doesn't, so interviewers like the recursive version.</li>
</ul>

<div class="callout trap"><b>Trap: infinite loops.</b> The recursion stops only when a round finds no new rows. A series with no
<code>WHERE d &lt; …</code>, or data with a cycle (A manages B, B manages A), runs forever. Protect yourself with a depth limit
(<code>WHERE o.level &lt; 20</code>) in the recursive member. Using <code>UNION</code> instead of <code>UNION ALL</code> also stops
exact-duplicate rows from repeating, but a growing <code>level</code> column makes every row unique, so it won't save you there.
Postgres 14+ also has a <code>CYCLE</code> clause.</div>

<div class="callout">Today's LeetCode problems are review (262 is a famous hard join + conditional aggregation, 619 is a subquery classic).
LeetCode has few recursive problems, but "show the whole org chart" or "all reports under X" comes up a lot in backend interviews.</div>`,
  example: {
    sql: `WITH RECURSIVE org AS (
  SELECT id, first_name, 1 AS level, first_name::text AS path
  FROM employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.first_name, o.level + 1, o.path || ' > ' || e.first_name
  FROM employees e
  JOIN org o ON e.manager_id = o.id
  WHERE o.level < 10            -- safety net
)
SELECT repeat('    ', level - 1) || first_name AS org_chart, level, path
FROM org
ORDER BY path;`,
    note: 'Sorting by path prints the tree in "folder" order. Change the anchor to WHERE id = 3 to see only Sara\'s team.',
  },
  exercises: [
    {
      id: 'd17-e1', type: 'query',
      prompt: 'Build the full org chart: every employee\'s <code>id</code>, <code>first_name</code> and <code>level</code> (the CEO is level 1, her direct reports level 2, …).',
      hint: 'Anchor: <code>WHERE manager_id IS NULL</code> with <code>1 AS level</code>. Recursive member: <code>JOIN org o ON e.manager_id = o.id</code>, <code>o.level + 1</code>.',
      solution: `WITH RECURSIVE org AS (
  SELECT id, first_name, 1 AS level
  FROM employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.first_name, o.level + 1
  FROM employees e
  JOIN org o ON e.manager_id = o.id
)
SELECT id, first_name, level FROM org;`,
      alts: [
        `SELECT e.id, e.first_name,
       CASE WHEN e.manager_id IS NULL THEN 1 WHEN m.manager_id IS NULL THEN 2 WHEN g.manager_id IS NULL THEN 3 ELSE 4 END
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id
LEFT JOIN employees g ON g.id = m.manager_id;`,
      ],
      wrong: [{ sql: `SELECT e.id, e.first_name, CASE WHEN e.manager_id IS NULL THEN 1 ELSE 2 END FROM employees e;` }],
      why: '30 rows: 1 at level 1, 6 at level 2, 10 at level 3, 13 at level 4. The alt hard-codes 4 levels with self-joins. It passes today but breaks the day someone hires a level-5 intern. That\'s exactly why recursion exists.',
    },
    {
      id: 'd17-e2', type: 'query',
      prompt: 'List <b>everyone under Bilal</b> (id 2), directly or indirectly. Show <code>id</code>, <code>first_name</code> and <code>depth</code> (1 = reports directly to Bilal). Don\'t include Bilal himself.',
      hint: 'Anchor = Bilal\'s direct reports: <code>WHERE manager_id = 2</code> with depth 1. Then recurse downward.',
      solution: `WITH RECURSIVE team AS (
  SELECT id, first_name, 1 AS depth
  FROM employees
  WHERE manager_id = 2
  UNION ALL
  SELECT e.id, e.first_name, t.depth + 1
  FROM employees e
  JOIN team t ON e.manager_id = t.id
)
SELECT id, first_name, depth FROM team;`,
      alts: [
        `WITH RECURSIVE team AS (
  SELECT id, first_name, 0 AS depth FROM employees WHERE id = 2
  UNION ALL
  SELECT e.id, e.first_name, t.depth + 1 FROM employees e JOIN team t ON e.manager_id = t.id)
SELECT id, first_name, depth FROM team WHERE depth > 0;`,
      ],
      wrong: [{ sql: `SELECT id, first_name, 1 FROM employees WHERE manager_id = 2;` }],
      why: '11 people: Omar and Zainab (depth 1), plus the 5 under Omar (including Junaid, the contractor with no department) and the 4 under Zainab (depth 2). Starting the anchor at Bilal with depth 0 and filtering him out at the end is an equally valid style.',
    },
    {
      id: 'd17-e3', type: 'query',
      prompt: 'Show Saad\'s (id 14) <b>chain of managers</b> all the way to the CEO: <code>first_name</code> and <code>steps_up</code> (1 = his direct manager). Order by <code>steps_up</code>.',
      hint: 'Walk <b>up</b>: anchor = Saad\'s row, recursive member joins <code>employees m ON m.id = c.manager_id</code>.',
      solution: `WITH RECURSIVE chain AS (
  SELECT id, first_name, manager_id, 0 AS steps_up
  FROM employees
  WHERE id = 14
  UNION ALL
  SELECT m.id, m.first_name, m.manager_id, c.steps_up + 1
  FROM employees m
  JOIN chain c ON m.id = c.manager_id
)
SELECT first_name, steps_up
FROM chain
WHERE steps_up > 0
ORDER BY steps_up;`,
      ordered: true,
      alts: [
        `WITH RECURSIVE chain AS (
  SELECT m.id, m.first_name, m.manager_id, 1 AS steps_up
  FROM employees e JOIN employees m ON m.id = e.manager_id WHERE e.id = 14
  UNION ALL
  SELECT m.id, m.first_name, m.manager_id, c.steps_up + 1
  FROM employees m JOIN chain c ON m.id = c.manager_id)
SELECT first_name, steps_up FROM chain ORDER BY steps_up;`,
      ],
      wrong: [{ sql: `WITH RECURSIVE chain AS (
  SELECT id, first_name, 0 AS steps_up FROM employees WHERE id = 14
  UNION ALL
  SELECT e.id, e.first_name, c.steps_up + 1 FROM employees e JOIN chain c ON e.manager_id = c.id)
SELECT first_name, steps_up FROM chain WHERE steps_up > 0 ORDER BY steps_up;` }],
      why: 'Zainab (1), Bilal (2), Ayesha (3). The recursion stops at Ayesha because her manager_id is NULL and the join finds nothing. The wrong version joins in the downward direction (<code>e.manager_id = c.id</code>) and finds Saad\'s reports, which is nobody: 0 rows.',
    },
    {
      id: 'd17-e4', type: 'query',
      prompt: 'Print the org chart as <b>paths</b>, e.g. <code>Ayesha &gt; Bilal &gt; Zainab &gt; Saad</code> (names joined by <code>\' &gt; \'</code>). One column <code>path</code>, ordered by <code>path</code>.',
      hint: 'Anchor: <code>first_name::text AS path</code>. Recursive: <code>o.path || \' &gt; \' || e.first_name</code>.',
      solution: `WITH RECURSIVE org AS (
  SELECT id, first_name::text AS path
  FROM employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, o.path || ' > ' || e.first_name
  FROM employees e
  JOIN org o ON e.manager_id = o.id
)
SELECT path FROM org ORDER BY path;`,
      ordered: true,
      alts: [
        `WITH RECURSIVE org AS (
  SELECT id, ARRAY[first_name] AS names FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, o.names || e.first_name FROM employees e JOIN org o ON e.manager_id = o.id)
SELECT array_to_string(names, ' > ') AS path FROM org ORDER BY path;`,
      ],
      why: '30 paths. Sorting by path groups each manager\'s team right under them, like folders in a file explorer. The alt carries an <b>array</b> of names instead of a string. Arrays are handy if you later need to check "is X somewhere above me?" (<code>\'Bilal\' = ANY(names)</code>), which is also how you detect cycles by hand.',
    },
    {
      id: 'd17-e5', type: 'query',
      prompt: 'Using a <b>recursive CTE</b> (then try <code>generate_series</code>), list every day of <b>January 2025</b> with the number of orders placed that day, <b>including days with 0</b>. Columns: <code>day</code>, <code>orders</code>.',
      hint: 'Series: anchor <code>SELECT DATE \'2025-01-01\' AS day</code>, recursive <code>SELECT day + 1 FROM days WHERE day &lt; DATE \'2025-01-31\'</code>. Then <code>LEFT JOIN orders</code> and <code>COUNT(o.id)</code>.',
      solution: `WITH RECURSIVE days AS (
  SELECT DATE '2025-01-01' AS day
  UNION ALL
  SELECT day + 1 FROM days WHERE day < DATE '2025-01-31'
)
SELECT d.day, COUNT(o.id) AS orders
FROM days d
LEFT JOIN orders o ON o.order_date = d.day
GROUP BY d.day;`,
      alts: [
        `SELECT g::date AS day, COUNT(o.id)
FROM generate_series(DATE '2025-01-01', DATE '2025-01-31', INTERVAL '1 day') AS g
LEFT JOIN orders o ON o.order_date = g::date
GROUP BY g::date;`,
      ],
      wrong: [
        { sql: `SELECT order_date, COUNT(*) FROM orders WHERE order_date BETWEEN '2025-01-01' AND '2025-01-31' GROUP BY order_date;` },
        { sql: `WITH RECURSIVE days AS (SELECT DATE '2025-01-01' AS day UNION ALL SELECT day + 1 FROM days WHERE day < DATE '2025-01-31')
SELECT d.day, COUNT(*) FROM days d LEFT JOIN orders o ON o.order_date = d.day GROUP BY d.day;` },
      ],
      why: '31 rows; only 5 days in January had orders. The orders table can\'t tell you about days when nothing happened, so you generate the days and LEFT JOIN. <code>COUNT(*)</code> counts the LEFT JOIN\'s NULL row as 1, so empty days would show 1. Use <code>COUNT(o.id)</code>.',
    },
    {
      id: 'd17-e6', type: 'query',
      prompt: 'Hard: for each of the <b>CEO\'s direct reports</b>, show <code>first_name</code> and <code>team_size</code>: how many people are below them at <b>any</b> depth (not counting themselves).',
      hint: 'Carry the top-level boss along: anchor = CEO\'s direct reports with <code>id AS root_id</code>; recursive rows keep <code>t.root_id</code>. Then count rows per root_id, minus the root itself.',
      solution: `WITH RECURSIVE tree AS (
  SELECT id, id AS root_id
  FROM employees
  WHERE manager_id = 1
  UNION ALL
  SELECT e.id, t.root_id
  FROM employees e
  JOIN tree t ON e.manager_id = t.id
)
SELECT b.first_name, COUNT(*) - 1 AS team_size
FROM tree t
JOIN employees b ON b.id = t.root_id
GROUP BY b.id, b.first_name;`,
      alts: [
        `SELECT b.first_name, (
  WITH RECURSIVE sub AS (
    SELECT id FROM employees WHERE manager_id = b.id
    UNION ALL
    SELECT e.id FROM employees e JOIN sub s ON e.manager_id = s.id)
  SELECT COUNT(*) FROM sub)
FROM employees b WHERE b.manager_id = 1;`,
      ],
      wrong: [{ sql: `SELECT b.first_name, COUNT(e.id) FROM employees b LEFT JOIN employees e ON e.manager_id = b.id
WHERE b.manager_id = 1 GROUP BY b.id, b.first_name;` }],
      why: 'Bilal 11, Sara 5, Usman 2, Hina 2, Komal 2, Tariq 1. Counting only direct reports gives Bilal 2 and Sara 1. Carrying a "root" column through the recursion is a reusable trick: you can also carry the root\'s name, the path, or a running total of salaries.',
    },
    {
      id: 'd17-q1', type: 'quiz',
      prompt: 'A recursive CTE over a <code>manager_id</code> column never finishes. Which is the most likely cause, and the safest fix?',
      options: [
        'The anchor uses UNION ALL; switch it to JOIN',
        'The data has a cycle (someone is their own indirect manager); add a depth limit like WHERE level < 50 in the recursive member',
        'Recursive CTEs always need an ORDER BY to stop',
        'The final SELECT has no LIMIT',
      ],
      answer: 1,
      why: 'Recursion stops only when a round produces no new rows. A cycle keeps producing rows forever. A depth limit (or tracking visited ids in an array, or Postgres\' CYCLE clause) guarantees it stops. A LIMIT in the outer query is not a reliable fix.',
    },
  ],
  leetcode: [
    { id: 262, title: 'Trips and Users', slug: 'trips-and-users', difficulty: 'Hard' },
    { id: 619, title: 'Biggest Single Number', slug: 'biggest-single-number', difficulty: 'Easy' },
  ],
  ownIt: 'Draw, round by round, how the recursive CTE for "everyone under Bilal" finds its rows. Then explain what would happen if Ayesha\'s manager_id were set to 30 (Junaid), and how you would stop it.',
};
