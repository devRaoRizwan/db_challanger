export default {
  day: 28,
  phase: 4,
  title: 'How indexes work + EXPLAIN',
  goal: 'Know what an index really is, read a basic EXPLAIN plan, and decide which column deserves an index.',
  setup: `CREATE TABLE events AS
SELECT g AS id,
       (g * 7919) % 5000 + 1 AS user_id,
       CASE WHEN g % 100 = 0 THEN 'purchase' WHEN g % 10 = 0 THEN 'click' ELSE 'view' END AS event_type,
       timestamp '2025-01-01' + g * interval '2 minutes' AS created_at
FROM generate_series(1, 200000) g;
ALTER TABLE events ADD PRIMARY KEY (id);`,
  learn: `
<p>Today we leave the tiny practice tables behind. This day adds a table called <code>events</code> with
<b>200,000 rows</b>: <code>id</code>, <code>user_id</code> (5,000 users), <code>event_type</code> and <code>created_at</code>.
It's big enough that the database has to make real choices.</p>

<h4>The phone book</h4>
<p>Finding "Rizwan" in a phone book is fast because the names are <b>sorted</b>: you open in the middle, see "M",
jump right, and you're there in a few flips. Now find everyone who lives on "Mall Road". The book isn't sorted by street,
so you read <b>every page</b>. That's the whole idea: an index is a <i>separate, sorted copy</i> of one column,
with a pointer back to each row.</p>

<h4>The real thing: a B-tree</h4>
<pre><code>CREATE INDEX idx_events_user_id ON events (user_id);

                [ 1700 | 3400 ]                 ← root page
           /           |           \\
   [ 1 .. 1699 ]  [ 1700 .. 3399 ]  [ 3400 .. 5000 ]   ← leaf pages, sorted
     42 → (page 3, row 7)
     42 → (page 88, row 2)        ← each key points to a row in the table
     42 → ...</code></pre>
<p>To find <code>user_id = 42</code>, Postgres walks from the root down to the right leaf (a handful of page reads),
then follows the pointers to the actual rows. Each level divides the work, so lookups are <b>O(log n)</b>: 200 rows or 200 million,
it's still only about 3–4 levels deep. Without the index, it's a full scan: <b>O(n)</b>.</p>

<h4>Three ways to read a table</h4>
<table class="mini">
<tr><th>Plan node</th><th>What it does</th><th>Good when</th></tr>
<tr><td>Seq Scan</td><td>Reads every row, tests the WHERE on each</td><td>You need a big chunk of the table, or there's no index</td></tr>
<tr><td>Index Scan</td><td>Walks the index, jumps to each matching row</td><td>Very few rows match (or you need them in index order)</td></tr>
<tr><td>Bitmap Heap Scan</td><td>Collects all matching row locations from the index first, then reads the table pages in order</td><td>In between: dozens to thousands of rows</td></tr>
</table>

<h4>EXPLAIN: ask Postgres for its plan</h4>
<p>Put <code>EXPLAIN</code> in front of any query and Postgres shows the plan instead of running it:</p>
<pre><code>EXPLAIN SELECT * FROM events WHERE user_id = 42;

Seq Scan on events  (cost=0.00..3844.00 rows=40 width=21)
  Filter: (user_id = 42)</code></pre>
<ul>
<li><b>Seq Scan on events</b>: the strategy (the "node"). Indented <code>-&gt;</code> lines are child nodes; read plans from the inside out.</li>
<li><b>cost=0.00..3844.00</b>: startup cost .. total cost, in made-up units. Only useful for <i>comparing</i> plans.</li>
<li><b>rows=40</b>: the planner's <i>estimate</i> of rows coming out. (5,000 users, 200k rows → about 40 each.)</li>
<li><b>width=21</b>: average bytes per row.</li>
</ul>
<p><code>EXPLAIN ANALYZE</code> really <b>runs</b> the query and adds actual times and row counts. (Careful with it on
<code>UPDATE</code>/<code>DELETE</code> in production: it really executes them!)</p>

<h4>Selectivity: why Postgres sometimes ignores your index</h4>
<table class="mini">
<tr><th>event_type</th><th>rows</th><th>share</th><th>index on event_type?</th></tr>
<tr><td>view</td><td>180,000</td><td>90%</td><td class="drop">ignored → Seq Scan</td></tr>
<tr><td>click</td><td>18,000</td><td>9%</td><td>maybe (bitmap)</td></tr>
<tr><td>purchase</td><td>2,000</td><td>1%</td><td class="keep">used</td></tr>
</table>
<p>If 90% of rows match, jumping index → row → index → row is <i>slower</i> than just reading the table straight through.
An index pays off when the condition is <b>selective</b> (matches a small fraction). That's why an index on a column like
<code>status</code> or <code>is_active</code> often does nothing, while <code>user_id</code> or <code>email</code> is a great candidate.</p>

<h4>Indexes aren't free</h4>
<p>Every <code>INSERT</code> must also insert into <b>every</b> index on the table; every <code>UPDATE</code> of an indexed
column and every <code>DELETE</code> touches them too. Indexes also take disk and memory (the primary-key index alone is ~4 MB here).
Add indexes for the queries you actually run, not "just in case".</p>

<div class="callout trap"><b>Trap:</b> "I added an index and EXPLAIN still says Seq Scan, so indexes don't work."
Usually the condition isn't selective, the table is tiny (our seed tables are; everything fits in a few pages), or the query
wraps the column in a function (Day 31). The planner isn't broken; it's choosing the cheaper plan.</div>

<div class="callout">Try it in the <b>Playground</b>: changes there stick until you press "Reset DB". Run
<code>EXPLAIN ANALYZE SELECT * FROM events WHERE user_id = 42;</code>, then <code>CREATE INDEX idx_events_user_id ON events (user_id);</code>,
then the same EXPLAIN again and compare the times.</div>`,
  example: {
    sql: `CREATE INDEX idx_events_user_id ON events (user_id);

EXPLAIN ANALYZE
SELECT * FROM events WHERE user_id = 42;`,
    note: 'Run it and look for "Bitmap Index Scan on idx_events_user_id". Then delete the CREATE INDEX line and run again: you get a Seq Scan with "Rows Removed by Filter: 199960" and a much bigger Execution Time. (Examples are rolled back, so the index disappears after each run.)',
  },
  exercises: [
    {
      id: 'd28-e1', type: 'query',
      prompt: 'Which indexes already exist on <code>events</code>? Query the <code>pg_indexes</code> view and return <code>indexname</code> and <code>indexdef</code> for <code>tablename = \'events\'</code>.',
      hint: "<code>SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'events';</code>",
      solution: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'events';`,
      why: 'You never created an index, yet there is one: <code>events_pkey</code>. Every PRIMARY KEY and UNIQUE constraint is backed by a unique B-tree index automatically. That is why <code>WHERE id = 42</code> is always fast.',
    },
    {
      id: 'd28-e2', type: 'query',
      prompt: 'The endpoint <code>GET /users/:id/events</code> runs <code>SELECT * FROM events WHERE user_id = $1</code> and is slow. Create a B-tree index named exactly <code>idx_events_user_id</code> on <code>events(user_id)</code>.',
      hint: '<code>CREATE INDEX index_name ON table (column);</code> B-tree is the default type, so you don\'t need to write it.',
      solution: `CREATE INDEX idx_events_user_id ON events (user_id);`,
      check: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'events' AND indexname = 'idx_events_user_id';`,
      alts: [
        `CREATE INDEX idx_events_user_id ON events USING btree (user_id);`,
        `create index if not exists idx_events_user_id on public.events(user_id);`,
      ],
      wrong: [{ sql: `CREATE INDEX idx_events_user_id ON events (event_type);` }, { sql: `CREATE INDEX idx_user_id ON events (user_id);` }],
      why: 'Each user has ~40 of the 200,000 rows (0.02%): very selective, perfect for an index. Run the EXPLAIN ANALYZE from the example to see the time drop from milliseconds to microseconds. In production you would write <code>CREATE INDEX CONCURRENTLY</code> so writes aren\'t blocked while it builds (Day 36); it can\'t run inside a transaction, which is why we use the plain form here.',
    },
    {
      id: 'd28-q1', type: 'quiz',
      prompt: `A teammate pastes this plan for a slow endpoint:
<pre>Seq Scan on events  (cost=0.00..3844.00 rows=40 width=21) (actual time=0.685..18.590 rows=40.00 loops=1)
  Filter: (user_id = 42)
  Rows Removed by Filter: 199960</pre>
What is it telling you?`,
      options: [
        'Postgres read 40 rows and returned all of them',
        'Postgres read every row (~200k), threw away 199,960, and kept 40: a selective filter with no usable index',
        'The cost of 3844 means the query took 3.8 seconds',
        'The index on user_id is being used but needs a REINDEX',
      ],
      answer: 1,
      why: 'Seq Scan + a Filter that removes almost everything is the classic "missing index" smell. Cost is in arbitrary units, not milliseconds; the real time is in <code>actual time</code> (18.6 ms here).',
    },
    {
      id: 'd28-e3', type: 'query',
      prompt: 'Before indexing a column, measure its selectivity. For each <code>event_type</code>, return the type, its row count, and its percentage of all rows rounded to 1 decimal (<code>pct</code>).',
      hint: '<code>GROUP BY event_type</code>, and divide by the total: <code>ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM events), 1)</code>.',
      solution: `SELECT event_type, COUNT(*) AS cnt,
       ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM events), 1) AS pct
FROM events
GROUP BY event_type;`,
      alts: [`SELECT event_type, COUNT(*), ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) FROM events GROUP BY event_type;`],
      wrong: [{ sql: `SELECT event_type, COUNT(*), ROUND(COUNT(*) / (SELECT COUNT(*) FROM events), 1) FROM events GROUP BY event_type;` }],
      why: 'view = 90%, click = 9%, purchase = 1%. An index on event_type would only help queries for <code>purchase</code> (and maybe <code>click</code>). Watch the integer-division trap: <code>COUNT(*) / COUNT(*)</code> is integer math and gives 0, so multiply by <code>100.0</code> first.',
    },
    {
      id: 'd28-q2', type: 'quiz',
      prompt: 'Someone adds <code>CREATE INDEX ON events (event_type)</code>. Which query is the planner most likely to answer with a <b>Seq Scan anyway</b>?',
      options: [
        "SELECT * FROM events WHERE event_type = 'purchase'",
        "SELECT * FROM events WHERE event_type = 'view'",
        'SELECT * FROM events WHERE id = 500',
        "SELECT * FROM events WHERE user_id = 42 (with idx_events_user_id present)",
      ],
      answer: 1,
      why: `'view' matches 90% of the table. Here's the real plan, even with the index present:
<pre>Seq Scan on events  (cost=0.00..3844.00 rows=179667 width=21)
  Filter: (event_type = 'view'::text)</pre>
For 'purchase' (1%) the same index gives a Bitmap Index Scan. Same index, different value, different plan: selectivity decides.`,
    },
    {
      id: 'd28-e4', type: 'query',
      prompt: 'The admin dashboard shows "latest 50 events" with <code>ORDER BY created_at DESC LIMIT 50</code>. Create an index named exactly <code>idx_events_created_at</code> on <code>events(created_at)</code>.',
      hint: 'Same shape as before. A B-tree can be read backwards, so an ascending index serves <code>DESC</code> too.',
      solution: `CREATE INDEX idx_events_created_at ON events (created_at);`,
      check: `SELECT indexname, replace(indexdef, ' DESC', '') FROM pg_indexes WHERE tablename = 'events' AND indexname = 'idx_events_created_at';`,
      alts: [`CREATE INDEX idx_events_created_at ON events USING btree (created_at);`, `CREATE INDEX idx_events_created_at ON events (created_at DESC);`],
      wrong: [{ sql: `CREATE INDEX idx_events_created_at ON events (user_id, created_at);` }],
      why: `Indexes are sorted, so they also make <code>ORDER BY … LIMIT</code> cheap: Postgres reads the first entries and stops, no sorting of 200k rows. Here is the plan for <code>LIMIT 10</code>:
<pre>Limit  (cost=0.42..0.75 rows=10 width=21)
  ->  Index Scan Backward using idx_events_created_at on events</pre>
(A <code>DESC</code> index is accepted too, but you rarely need one for a single column: the plain one serves both directions.)`,
    },
    {
      id: 'd28-q3', type: 'quiz',
      prompt: 'A table has a primary key plus 5 secondary indexes. You <code>INSERT</code> one row. Roughly how many structures does Postgres have to write to?',
      options: ['1: just the table', '2: the table and the primary key index', '7: the table plus all 6 indexes', 'None until VACUUM runs'],
      answer: 2,
      why: 'Every index must contain every row, so each insert writes the table plus each index. That is why write-heavy tables (logs, events, queues) should carry only the indexes their reads truly need.',
    },
  ],
  leetcode: [],
  ownIt: 'Your team asks: "Why is GET /users/:id/events slow, and why don\'t we just index every column?" Answer in 4–5 sentences using the words B-tree, Seq Scan, selectivity and write cost. Bonus: paste the before/after EXPLAIN ANALYZE from the Playground.',
};
