export default {
  day: 37,
  phase: 5,
  title: 'Scaling: partitioning, replication, sharding, caching',
  goal: 'Pick the right scaling tool for a problem, and split a big table into monthly partitions yourself.',
  setup: `CREATE TABLE orders_part (
  id          integer NOT NULL,
  customer_id integer NOT NULL,
  order_date  date    NOT NULL,
  status      text    NOT NULL,
  PRIMARY KEY (id, order_date)
) PARTITION BY RANGE (order_date);
DO $$
DECLARE m date;
BEGIN
  FOR m IN SELECT generate_series(date '2025-01-01', date '2025-12-01', interval '1 month')::date LOOP
    EXECUTE format('CREATE TABLE %I PARTITION OF orders_part FOR VALUES FROM (%L) TO (%L)',
                   'orders_part_' || to_char(m, 'YYYY_MM'), m, (m + interval '1 month')::date);
  END LOOP;
END $$;
INSERT INTO orders_part SELECT id, customer_id, order_date, status FROM orders;`,
  learn: `
<p>One Postgres server goes surprisingly far: tens of thousands of simple queries per second and terabytes of data.
Before you reach for anything on this page, check the boring things first: missing indexes, N+1 queries, slow queries
in <code>EXPLAIN ANALYZE</code>. When the database is <i>still</i> the bottleneck, you have five tools.</p>

<h4>1. Scale up (vertical) or scale out (horizontal)</h4>
<p><b>Vertical</b> means a bigger machine: more RAM, CPU and faster disks. It needs no code changes, so try it first.
<b>Horizontal</b> means more machines. It has no ceiling, but every extra machine makes the system more complex.</p>

<h4>2. Read replicas (more machines for reads)</h4>
<pre><code>   app writes ──► PRIMARY ──WAL stream──► REPLICA 1  ◄── app reads
                                     └──► REPLICA 2  ◄── app reads</code></pre>
<p>The primary ships every change to the replicas, usually <b>asynchronously</b>, so a replica can be a few
milliseconds (sometimes seconds) behind. This delay is called <b>replication lag</b>, and it causes a classic bug:</p>
<div class="timeline"><table class="mini">
<tr><th>t</th><th>User / app</th><th>Primary</th><th>Replica</th></tr>
<tr><td>1</td><td>UPDATE name = 'Sara K.'</td><td class="keep">Sara K.</td><td>Sara</td></tr>
<tr><td>2</td><td>redirect, SELECT profile (from replica)</td><td>Sara K.</td><td class="drop">Sara (stale!)</td></tr>
<tr><td>3</td><td>"my change was lost?!"</td><td>Sara K.</td><td>Sara K. (caught up)</td></tr>
</table></div>
<p>Fixes for <b>read-your-writes</b>: read from the primary for a few seconds after that user writes, always read
"my own" data (profile, cart) from the primary, or remember the write position and wait until the replica has caught up to it.</p>

<h4>3. Partitioning (one table, many smaller pieces, same server)</h4>
<pre><code>CREATE TABLE orders_part (…, order_date date NOT NULL,
  PRIMARY KEY (id, order_date))       -- the PK must include the partition key
PARTITION BY RANGE (order_date);

CREATE TABLE orders_part_2025_03 PARTITION OF orders_part
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');   -- FROM is inclusive, TO is exclusive</code></pre>
<p>You insert into and query the parent as usual. Postgres sends each row to the right partition. With a
<code>WHERE</code> on the partition key, the planner skips the other partitions entirely (<b>partition pruning</b>).
Old data is removed with <code>DROP</code> or <code>DETACH PARTITION</code> in milliseconds, with no huge <code>DELETE</code> and no bloat.
Partitioning helps with <i>big tables</i>, not with too many users. It's still one server.</p>
<div class="callout trap"><b>Trap:</b> pruning only works when the filter is on the raw column. <code>WHERE order_date &gt;= '2025-03-01' AND order_date &lt; '2025-04-01'</code>
prunes, but <code>WHERE extract(month FROM order_date) = 3</code> scans all 12 partitions.</div>

<h4>4. Sharding (split the data across servers)</h4>
<p>Each server holds a slice of the rows, chosen by a <b>shard key</b> (e.g. <code>tenant_id</code>). A good key spreads
load evenly <i>and</i> keeps the queries you run often on one shard. "All orders of tenant 42" is fast because it hits one
shard. "Top 10 products across all tenants" has to ask every shard and merge the results, and cross-shard joins and
transactions get painful. Shard last, after you've tried everything else.</p>

<h4>5. Caching (don't ask the database at all)</h4>
<p><b>Cache-aside:</b> read from Redis; on a miss, read from Postgres and store the result with a TTL. On a write, update
Postgres and then <b>delete</b> the cache key. Invalidation is the hard part: a forgotten delete serves stale data until
the TTL expires.</p>

<h4>Bonus: connection limits</h4>
<p>Every Postgres connection is a process using several MB of memory, and <code>max_connections</code> defaults to 100.
Fifty app pods with a pool of 20 connections each will hit "too many clients". Put a pooler such as <b>PgBouncer</b>
(transaction mode) in front of the database instead of raising the limit.</p>

<table class="mini">
<tr><th>Symptom</th><th>Reach for</th></tr>
<tr><td>Reads overload the primary</td><td>Cache, then read replicas</td></tr>
<tr><td>One table is huge, old data piles up</td><td>Partitioning</td></tr>
<tr><td>Writes or data outgrow one server</td><td>Sharding</td></tr>
<tr><td>"too many clients already"</td><td>PgBouncer</td></tr>
</table>`,
  example: {
    sql: `-- orders_part is created by today's setup: orders split into 12 monthly partitions.
-- Only one partition is scanned:
EXPLAIN
SELECT count(*) FROM orders_part
WHERE order_date >= '2025-03-01' AND order_date < '2025-04-01';`,
    note: 'The plan scans only orders_part_2025_03. Change the WHERE to extract(month FROM order_date) = 3 and run it again: all 12 partitions show up in an Append node.',
  },
  exercises: [
    {
      id: 'd37-e1', type: 'query',
      prompt: `Build a partitioned copy of orders yourself:
<ol>
<li>Create <code>orders_monthly(id integer, customer_id integer, order_date date NOT NULL, status text)</code>, <b>partitioned by range</b> on <code>order_date</code>.</li>
<li>Create partitions <code>orders_monthly_2025_01</code>, <code>orders_monthly_2025_02</code>, <code>orders_monthly_2025_03</code> (one per month) and a <b>DEFAULT</b> partition <code>orders_monthly_default</code> for everything else.</li>
<li>Copy every row from <code>orders</code> with <code>INSERT … SELECT</code>.</li>
</ol>
The checker counts rows per partition using <code>tableoid::regclass</code>.`,
      hint: '<code>CREATE TABLE … PARTITION BY RANGE (order_date);</code> then <code>CREATE TABLE orders_monthly_2025_01 PARTITION OF orders_monthly FOR VALUES FROM (\'2025-01-01\') TO (\'2025-02-01\');</code> and <code>CREATE TABLE orders_monthly_default PARTITION OF orders_monthly DEFAULT;</code>',
      solution: `CREATE TABLE orders_monthly (
  id integer, customer_id integer, order_date date NOT NULL, status text
) PARTITION BY RANGE (order_date);
CREATE TABLE orders_monthly_2025_01 PARTITION OF orders_monthly FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE orders_monthly_2025_02 PARTITION OF orders_monthly FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE orders_monthly_2025_03 PARTITION OF orders_monthly FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE orders_monthly_default PARTITION OF orders_monthly DEFAULT;
INSERT INTO orders_monthly SELECT id, customer_id, order_date, status FROM orders;`,
      check: `SELECT tableoid::regclass::text AS partition, count(*) AS orders FROM orders_monthly GROUP BY 1
UNION ALL
SELECT 'strategy:' || partstrat::text, 1 FROM pg_partitioned_table WHERE partrelid = 'orders_monthly'::regclass;`,
      alts: [`CREATE TABLE orders_monthly (LIKE orders) PARTITION BY RANGE (order_date);
CREATE TABLE orders_monthly_default PARTITION OF orders_monthly DEFAULT;
CREATE TABLE orders_monthly_2025_01 PARTITION OF orders_monthly FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE orders_monthly_2025_02 PARTITION OF orders_monthly FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE orders_monthly_2025_03 PARTITION OF orders_monthly FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
INSERT INTO orders_monthly SELECT * FROM orders;`],
      wrong: [
        { sql: `CREATE TABLE orders_monthly (id integer, customer_id integer, order_date date NOT NULL, status text) PARTITION BY RANGE (order_date);
CREATE TABLE orders_monthly_2025_01 PARTITION OF orders_monthly FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE orders_monthly_2025_02 PARTITION OF orders_monthly FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE orders_monthly_2025_03 PARTITION OF orders_monthly FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
INSERT INTO orders_monthly SELECT id, customer_id, order_date, status FROM orders;` },
      ],
      why: `You get 6 / 10 / 7 rows in the three monthly partitions and 67 in the default. Without a DEFAULT partition the INSERT fails with
"no partition of relation found for row" as soon as it reaches an April order. The upper bound is <b>exclusive</b>, so writing <code>TO ('2025-01-31')</code>
would quietly send orders from the last day of each month to the default partition (our data happens to have none on those days, so you wouldn't notice until production).`,
    },
    {
      id: 'd37-e2', type: 'query',
      prompt: 'Today\'s setup created <code>orders_part</code> with 12 monthly partitions. Show how many rows each partition holds: <code>partition</code> (the partition\'s table name as text, e.g. <code>orders_part_2025_01</code>) and <code>orders</code>. Order by <code>partition</code>.',
      hint: 'Every row has a hidden <code>tableoid</code> column. Cast it with <code>tableoid::regclass::text</code> to get the name.',
      solution: `SELECT tableoid::regclass::text AS partition, count(*) AS orders
FROM orders_part
GROUP BY 1
ORDER BY 1;`,
      ordered: true,
      alts: [`SELECT c.relname AS partition, count(*) AS orders
FROM orders_part o JOIN pg_class c ON c.oid = o.tableoid
GROUP BY c.relname ORDER BY c.relname;`],
      wrong: [{ sql: `SELECT tableoid AS partition, count(*) AS orders FROM orders_part GROUP BY 1 ORDER BY 1;` }],
      why: '<code>tableoid</code> is the internal id of the physical table a row lives in. <code>::regclass</code> turns that number into a readable name. August is the biggest partition with 14 orders.',
    },
    {
      id: 'd37-e3', type: 'query',
      prompt: 'Retention policy: January 2025 data must leave <code>orders_part</code>. Remove it the <b>partition way</b> (detach or drop the <code>orders_part_2025_01</code> partition), not with a row-by-row <code>DELETE</code>. The checker shows the rows left in <code>orders_part</code> and the number of partitions still attached.',
      hint: '<code>ALTER TABLE orders_part DETACH PARTITION orders_part_2025_01;</code> keeps the data as a normal table (good for archiving). <code>DROP TABLE orders_part_2025_01;</code> deletes it.',
      solution: `ALTER TABLE orders_part DETACH PARTITION orders_part_2025_01;`,
      check: `SELECT (SELECT count(*) FROM orders_part) AS rows_left,
       (SELECT count(*) FROM pg_inherits WHERE inhparent = 'orders_part'::regclass) AS partitions;`,
      alts: [`DROP TABLE orders_part_2025_01;`],
      wrong: [{ sql: `DELETE FROM orders_part WHERE order_date < '2025-02-01';` }],
      why: `84 rows and 11 partitions are left. A DELETE gives the same row count, but on a real table it rewrites millions of rows, generates WAL, leaves dead tuples for VACUUM and holds locks.
DETACH or DROP only changes the catalog, so it finishes almost instantly. That's the main reason teams partition time-series data.`,
    },
    {
      id: 'd37-e4', type: 'query',
      prompt: 'It\'s almost 2026. Add a partition <code>orders_part_2026_01</code> covering January 2026, then insert the order <code>(id 1000, customer_id 1, order_date \'2026-01-15\', status \'pending\')</code> into <code>orders_part</code>. The checker shows which partition the new row landed in.',
      hint: 'Create the partition first with <code>FOR VALUES FROM (\'2026-01-01\') TO (\'2026-02-01\')</code>, then insert into the <b>parent</b> table.',
      solution: `CREATE TABLE orders_part_2026_01 PARTITION OF orders_part
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
INSERT INTO orders_part (id, customer_id, order_date, status)
VALUES (1000, 1, '2026-01-15', 'pending');`,
      check: `SELECT tableoid::regclass::text, id, order_date FROM orders_part WHERE id = 1000;`,
      wrong: [{ sql: `INSERT INTO orders_part (id, customer_id, order_date, status) VALUES (1000, 1, '2026-01-15', 'pending');` }],
      why: 'Without the new partition the insert fails: there is no partition for that date. In production, create partitions ahead of time with a scheduled job (or the <code>pg_partman</code> extension) so the first order on 1 January doesn\'t error.',
    },
    {
      id: 'd37-q1', type: 'quiz',
      prompt: 'Users report: "I changed my address, the page reloaded and still showed the old one. A refresh later it was fine." Reads go to an async read replica. What is the best fix?',
      options: [
        'Raise the isolation level to SERIALIZABLE',
        'Read the user\'s own profile from the primary for a short time after they write (read-your-writes)',
        'Add an index on the address column',
        'Add more read replicas',
      ],
      answer: 1,
      why: 'This is replication lag: the replica hadn\'t received the update yet. Isolation levels apply inside one server, indexes don\'t change lag, and more replicas add more places to read stale data. Route reads that must see "my own" recent writes to the primary.',
    },
    {
      id: 'd37-q2', type: 'quiz',
      prompt: '<code>orders_part</code> is partitioned by month on <code>order_date</code>. Which query reads <b>only one</b> partition?',
      options: [
        "WHERE to_char(order_date, 'YYYY-MM') = '2025-03'",
        'WHERE extract(month FROM order_date) = 3',
        "WHERE order_date >= '2025-03-01' AND order_date < '2025-04-01'",
        'WHERE customer_id = 3',
      ],
      answer: 2,
      why: 'Pruning compares your condition with each partition\'s bounds, so it needs a plain range on the partition key. Wrapping the column in a function hides it, the same sargability rule you learned for indexes. Run the example with each version to see the difference.',
    },
    {
      id: 'd37-q3', type: 'quiz',
      prompt: 'After autoscaling to 60 API pods (each with a pool of 10 connections), the logs fill with <i>"FATAL: sorry, too many clients already"</i>. CPU on the database is at 20%. What do you reach for?',
      options: [
        'Shard the database across 3 servers',
        'Put PgBouncer (transaction pooling) between the app and Postgres',
        'Add a Redis cache',
        'Partition the largest table',
      ],
      answer: 1,
      why: '600 connections against the default limit of 100, while the CPU is mostly idle. The database isn\'t overloaded, it just has too many connections. A pooler multiplexes many client connections onto a few real ones. Sharding or partitioning would be a big, expensive answer to the wrong problem.',
    },
  ],
  leetcode: [],
  ownIt: 'Explain to a teammate, in 4–5 sentences, the difference between partitioning, sharding and a read replica: what each one splits or copies, which problem each solves, and one new problem each introduces.',
};
