export default {
  day: 35,
  phase: 4,
  title: 'N+1 queries & pagination (offset vs keyset)',
  goal: 'Spot and fix N+1 query loops, and paginate big lists with keyset (cursor) pagination instead of OFFSET.',
  setup: `
CREATE TABLE posts (
  id         int PRIMARY KEY,
  author_id  int NOT NULL,
  title      text NOT NULL,
  created_at timestamp NOT NULL
);
INSERT INTO posts
SELECT g, (g * 37) % 50 + 1, 'Post #' || g,
       timestamp '2025-01-01' + ((g * 7919) % 2000) * interval '1 hour'
FROM generate_series(1, 5000) g;`,
  learn: `
<p>Two performance bugs show up in almost every backend codebase. Neither is visible in a single query: you find them by
looking at <b>how many</b> queries an endpoint sends, and <b>which page</b> of a list the user is on.</p>

<h4>N+1: the loop that looks innocent</h4>
<pre><code>orders = db.query("SELECT * FROM orders WHERE customer_id = ?", [5])   // 1 query
for (order of orders) {
  order.items = db.query(
    "SELECT * FROM order_items WHERE order_id = ?", [order.id])         // N queries
}</code></pre>
<p>Five orders = 6 queries. A page of 50 orders = 51 queries. Each query is fast (1 ms), but each one also pays a network
round-trip, parsing and planning, so the endpoint takes 100+ ms for data one query could fetch in 2 ms.
ORMs hide this behind lazy loading: <code>order.items</code> looks like a field but fires a query.</p>

<h4>Fix 1: one JOIN</h4>
<pre><code>SELECT o.id, o.order_date, oi.product_id, oi.quantity
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 5;</code></pre>

<h4>Fix 2: two queries, batched (what ORM "eager loading" does)</h4>
<pre><code>SELECT * FROM orders WHERE customer_id = 5;                  -- ids: 5, 55, 61, 74, 89
SELECT * FROM order_items WHERE order_id = ANY($1);          -- $1 = '{5,55,61,74,89}'
-- then group the items by order_id in app code</code></pre>
<p>Always 2 queries, however many orders. <code>= ANY($1)</code> takes one array parameter, so the SQL text stays the same
(<code>IN (…)</code> works too, but the number of placeholders changes with the list size). In ORMs this is
<code>includes</code> / <code>prefetch_related</code> / <code>with</code> / <code>Include</code>.</p>

<h4>Fix 3: let Postgres build the nested JSON</h4>
<pre><code>SELECT o.id,
       json_agg(json_build_object('pid', oi.product_id, 'qty', oi.quantity)
                ORDER BY oi.product_id) AS items
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 5
GROUP BY o.id;</code></pre>
<table class="mini">
<tr><th>id</th><th>items</th></tr>
<tr><td>55</td><td>[{"pid":1,"qty":2}, {"pid":2,"qty":3}, {"pid":3,"qty":2}]</td></tr>
</table>

<h4>Pagination with OFFSET: simple, then slow and wrong</h4>
<pre><code>SELECT id, title, created_at FROM posts
ORDER BY created_at DESC, id DESC
LIMIT 10 OFFSET 990;      -- page 100</code></pre>
<p>Two problems. <b>Cost:</b> Postgres can't jump to row 991; it produces and throws away 990 rows first, so page 1000 is
100× slower than page 10. <b>Correctness:</b> if a new post arrives while the user is reading page 1, everything shifts down
one place and the last post of page 1 shows up <i>again</i> at the top of page 2 (a delete makes one get skipped).</p>

<h4>Keyset (cursor) pagination</h4>
<p>Instead of "skip 990 rows", say "continue after the last row I showed you". The API returns a cursor
(the last row's <code>created_at</code> and <code>id</code>) and the client sends it back:</p>
<pre><code>SELECT id, title, created_at FROM posts
WHERE (created_at, id) &lt; ($1, $2)          -- row-value comparison
ORDER BY created_at DESC, id DESC
LIMIT 10;</code></pre>
<p><code>(a, b) &lt; (x, y)</code> means <code>a &lt; x OR (a = x AND b &lt; y)</code>: compare the first column, and use the second only on a tie.
With an index on <code>(created_at, id)</code>, Postgres jumps straight to the cursor and reads 10 rows. Page 1000 costs the same as page 1,
and inserts don't cause duplicates.</p>

<div class="callout trap"><b>Trap:</b> a cursor on <code>created_at</code> alone. Many rows share a timestamp (our posts have 2–3 per hour), so
<code>WHERE created_at &lt; $1</code> silently skips the rest of the rows with that timestamp. Always add a unique tie-breaker (<code>id</code>) to
both the <code>ORDER BY</code> and the cursor.</div>

<div class="callout">Keyset can't jump to "page 37", only next/previous. That's fine for feeds, infinite scroll and API exports, which is most of what backends paginate.
Keep OFFSET for small admin tables with page numbers.</div>`,
  example: {
    sql: `-- Page 3 with OFFSET (10 per page, newest first).
SELECT id, author_id, title, created_at
FROM posts
ORDER BY created_at DESC, id DESC
LIMIT 10 OFFSET 20;`,
    note: 'Note the repeated created_at values: that is why id is part of the ORDER BY. Try OFFSET 4990, then put EXPLAIN ANALYZE in front and compare the row counts.',
  },
  exercises: [
    {
      id: 'd35-e1', type: 'query',
      prompt: `Your endpoint loops <code>SELECT * FROM order_items WHERE order_id = ?</code> for orders <b>3, 7 and 12</b>. Replace the loop with <b>one query</b> that
returns <code>order_id, product_id, quantity</code> for all three orders.`,
      hint: '<code>WHERE order_id = ANY(ARRAY[3, 7, 12])</code> or <code>WHERE order_id IN (3, 7, 12)</code>.',
      solution: `SELECT order_id, product_id, quantity
FROM order_items
WHERE order_id = ANY (ARRAY[3, 7, 12]);`,
      alts: [
        `SELECT order_id, product_id, quantity FROM order_items WHERE order_id IN (3, 7, 12);`,
        `SELECT order_id, product_id, quantity FROM order_items WHERE order_id = ANY ('{3,7,12}'::int[]);`,
      ],
      wrong: [{ sql: `SELECT order_id, product_id, quantity FROM order_items WHERE order_id = 3;` }],
      why: 'One round-trip instead of three (or fifty). In app code you pass the ids as a single array parameter, <code>= ANY($1)</code>, then group the rows by order_id in a map.',
    },
    {
      id: 'd35-e2', type: 'query',
      prompt: `The "My orders" page shows, for <b>customer 5</b>, each order's <code>id</code>, <code>order_date</code>, number of item lines (<code>item_count</code>) and
<code>total</code> = SUM(quantity × unit_price). Today it runs 1 + N queries. Write it as <b>one</b> query.`,
      hint: 'JOIN orders to order_items, filter <code>o.customer_id = 5</code>, <code>GROUP BY o.id, o.order_date</code>.',
      solution: `SELECT o.id, o.order_date, COUNT(oi.id) AS item_count, SUM(oi.quantity * oi.unit_price) AS total
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 5
GROUP BY o.id, o.order_date;`,
      alts: [
        `SELECT o.id, o.order_date, COUNT(oi.id), SUM(oi.quantity * oi.unit_price)
FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 5 GROUP BY o.id;`,
        `SELECT o.id, o.order_date,
       (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id),
       (SELECT SUM(quantity * unit_price) FROM order_items oi WHERE oi.order_id = o.id)
FROM orders o WHERE o.customer_id = 5;`,
      ],
      wrong: [{ sql: `SELECT o.id, o.order_date, SUM(oi.quantity), SUM(oi.quantity * oi.unit_price)
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 5 GROUP BY o.id, o.order_date;` }],
      why: 'Five orders, one query. The correlated-subquery version also counts as one query sent from the app: Postgres runs the "loop" internally without network round-trips, which is far cheaper than N+1 from code (though a JOIN is usually cheaper still). Use a LEFT JOIN if orders can have zero items.',
    },
    {
      id: 'd35-e3', type: 'query',
      prompt: `Return <b>customer 5</b>'s orders with their items nested as JSON, in one query: columns <code>id</code> (order id) and <code>items</code>, a JSON array of objects
<code>{"pid": product_id, "qty": quantity}</code> (keys in that order) sorted by <code>product_id</code>.`,
      hint: '<code>json_agg(json_build_object(\'pid\', oi.product_id, \'qty\', oi.quantity) ORDER BY oi.product_id)</code>, grouped by <code>o.id</code>.',
      solution: `SELECT o.id,
       json_agg(json_build_object('pid', oi.product_id, 'qty', oi.quantity) ORDER BY oi.product_id) AS items
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 5
GROUP BY o.id;`,
      alts: [
        `SELECT o.id,
       jsonb_agg(jsonb_build_object('pid', oi.product_id, 'qty', oi.quantity) ORDER BY oi.product_id) AS items
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 5 GROUP BY o.id;`,
        `SELECT o.id,
       (SELECT json_agg(json_build_object('pid', oi.product_id, 'qty', oi.quantity) ORDER BY oi.product_id)
        FROM order_items oi WHERE oi.order_id = o.id) AS items
FROM orders o WHERE o.customer_id = 5;`,
      ],
      wrong: [{ sql: `SELECT o.id, json_build_object('pid', oi.product_id, 'qty', oi.quantity) AS items
FROM orders o JOIN order_items oi ON oi.order_id = o.id
WHERE o.customer_id = 5;` }],
      why: 'json_agg folds many rows into one array per group, so the API gets exactly the nested shape it returns, with no N+1 and no regrouping in app code. Without the aggregate you get one row per item, which is the flat JOIN result again.',
    },
    {
      id: 'd35-e4', type: 'query',
      prompt: `The feed shows posts newest first (<code>created_at DESC, id DESC</code>), 10 per page. Page 2 ended with the post
<code>created_at = '2025-03-25 00:00'</code>, <code>id = 2568</code>. Using <b>keyset pagination</b> (no OFFSET), return page 3: <code>id, title</code>.`,
      hint: '<code>WHERE (created_at, id) &lt; (\'2025-03-25 00:00\', 2568) ORDER BY created_at DESC, id DESC LIMIT 10</code>',
      solution: `SELECT id, title
FROM posts
WHERE (created_at, id) < ('2025-03-25 00:00', 2568)
ORDER BY created_at DESC, id DESC
LIMIT 10;`,
      ordered: true,
      alts: [
        `SELECT id, title FROM posts
WHERE created_at < '2025-03-25 00:00' OR (created_at = '2025-03-25 00:00' AND id < 2568)
ORDER BY created_at DESC, id DESC LIMIT 10;`,
        `SELECT id, title FROM posts ORDER BY created_at DESC, id DESC LIMIT 10 OFFSET 20;`,
      ],
      wrong: [
        { sql: `SELECT id, title FROM posts WHERE created_at < '2025-03-25 00:00' ORDER BY created_at DESC, id DESC LIMIT 10;` },
        { sql: `SELECT id, title FROM posts WHERE created_at <= '2025-03-25 00:00' AND id < 2568 ORDER BY created_at DESC, id DESC LIMIT 10;` },
      ],
      why: 'Page 3 starts with post 568, which shares the midnight timestamp with 2568. <code>created_at &lt; …</code> alone skips it, and <code>created_at &lt;= … AND id &lt; …</code> drops every older post with a bigger id. The row-value comparison means exactly "after this row in the sort order". OFFSET 20 gives the same rows today, but gets slower with every page and shifts when posts are added.',
    },
    {
      id: 'd35-e5', type: 'query',
      prompt: 'Create the index that lets the keyset query jump straight to the cursor: a B-tree on <code>posts</code> over <code>created_at</code> and <code>id</code>, in that order. Name it <code>posts_feed_idx</code>.',
      hint: '<code>CREATE INDEX posts_feed_idx ON posts (created_at, id);</code> (DESC, DESC works too: a B-tree can be read in both directions.)',
      solution: `CREATE INDEX posts_feed_idx ON posts (created_at, id);`,
      check: `SELECT EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE tablename = 'posts'
    AND (indexdef LIKE '%(created_at, id)%' OR indexdef LIKE '%(created_at DESC, id DESC)%')
) AS has_feed_index;`,
      alts: [`CREATE INDEX posts_feed_idx ON posts (created_at DESC, id DESC);`],
      wrong: [
        { sql: `CREATE INDEX posts_feed_idx ON posts (created_at);` },
        { sql: `CREATE INDEX posts_feed_idx ON posts (id, created_at);` },
      ],
      why: 'The index columns must match the ORDER BY (and the cursor) in the same order. Then the plan is an Index Scan (Backward) that starts at the cursor and stops after 10 rows. (created_at DESC, id ASC) would <i>not</i> work for this query, because the directions must all match or all be flipped.',
    },
    {
      id: 'd35-q1', type: 'quiz',
      prompt: 'An endpoint lists 50 posts, and for each post it lazily loads the author <i>and</i> the comment count, one query each. How many queries per request?',
      options: ['3', '51', '101', '150'],
      answer: 2,
      why: '1 query for the posts + 50 for authors + 50 for comment counts = 101. With batching it is 3 (posts, authors WHERE id = ANY(…), counts GROUP BY post_id WHERE post_id = ANY(…)), or 1 with JOINs. Logging the query count per request is the quickest way to catch N+1.',
    },
    {
      id: 'd35-q2', type: 'quiz',
      prompt: `A user reads page 1 (<code>LIMIT 10 OFFSET 0</code>, newest first). Before they click "next", 2 new posts are published. What do they see on page 2 (<code>OFFSET 10</code>)?`,
      options: [
        'Exactly the next 10 posts, nothing repeated',
        'The last 2 posts of page 1 again, then 8 new-to-them posts',
        'The 2 new posts at the top',
        'An error, because the data changed',
      ],
      answer: 1,
      why: 'OFFSET counts positions, not rows. The 2 new posts push everything down 2 places, so positions 11–12 are now the old 9th and 10th posts. A keyset cursor says "older than this post", which doesn\'t move when new rows arrive.',
    },
  ],
  leetcode: [],
  ownIt: 'Pick one list endpoint at work. Count the queries it sends for one page (turn on your ORM\'s SQL logging) and note whether it uses OFFSET. Write the eager-loading or JOIN fix and the keyset version of its pagination query, including the cursor you would return to the client.',
};
