export default {
  day: 27,
  phase: 3,
  title: 'Views, materialized views, JSONB, denormalization',
  goal: 'Package queries as views, cache them as materialized views, query JSONB, and know when breaking normalization is worth it.',
  setup: `
CREATE TABLE product_attributes (
  product_id INT PRIMARY KEY REFERENCES products(id),
  attrs      JSONB NOT NULL
);
INSERT INTO product_attributes VALUES
  (1,  '{"color": "black", "wireless": false, "switches": "brown", "layout": "US"}'),
  (2,  '{"color": "white", "wireless": true, "dpi": 1600}'),
  (3,  '{"color": "black", "size_in": 27, "ports": ["HDMI", "DP"], "dimensions": {"width_cm": 61, "height_cm": 36}}'),
  (4,  '{"color": "grey", "ports": ["USB-A", "HDMI", "SD"]}'),
  (5,  '{"color": "black", "wireless": true, "battery_hours": 30}'),
  (6,  '{"color": "white", "motorized": true, "dimensions": {"width_cm": 140, "height_cm": 120}}'),
  (7,  '{"color": "black", "dimensions": {"width_cm": 66, "height_cm": 120}}'),
  (8,  '{"color": "white", "wireless": false}'),
  (10, '{"author": "Martin Kleppmann", "pages": 616, "format": "paperback"}');
`,
  learn: `
<p>Your schema is normalized: every fact lives once. Great for correctness, but reading it means writing the same
four-table join again and again, and some of those joins are slow. Today's tools trade a little of that purity for convenience and speed.</p>

<h4>Views: a saved query with a name</h4>
<pre><code>CREATE VIEW customer_order_totals AS
SELECT c.id AS customer_id, c.name, COUNT(DISTINCT o.id) AS order_count, …
FROM customers c LEFT JOIN orders o … ;

SELECT * FROM customer_order_totals WHERE order_count &gt; 5;</code></pre>
<p>A view stores <b>no data</b>. Every time you select from it, Postgres runs the underlying query (and can merge your WHERE into it).
It's always up to date, and it gives the team one tested definition of "total spent" instead of five slightly different copies in the codebase.</p>

<h4>Materialized views: a saved <i>result</i></h4>
<pre><code>CREATE MATERIALIZED VIEW product_sales AS
SELECT product_id, SUM(quantity) AS units_sold FROM order_items GROUP BY product_id;

REFRESH MATERIALIZED VIEW product_sales;   -- recompute when you decide</code></pre>
<table class="mini">
<tr><th></th><th>VIEW</th><th>MATERIALIZED VIEW</th></tr>
<tr><td>Stores rows?</td><td>No</td><td>Yes, like a table</td></tr>
<tr><td>Fresh?</td><td class="keep">Always</td><td class="drop">Only as of the last REFRESH</td></tr>
<tr><td>Read speed</td><td>Same as the query</td><td class="keep">Fast (can be indexed)</td></tr>
<tr><td>Good for</td><td>Hiding joins, one definition</td><td>Dashboards, reports, heavy aggregates</td></tr>
</table>

<h4>Denormalization: copying facts on purpose</h4>
<p>Sometimes you store a value you <i>could</i> compute: <code>customers.order_count</code>, <code>posts.comment_count</code>, <code>orders.total</code>.
Reads become a single-row lookup instead of a COUNT over millions of rows. The price is <b>consistency</b>: every code path that inserts or
deletes an order must also update the counter (in the same transaction, or with a trigger), or the copies drift apart. That's yesterday's
update anomaly, now chosen deliberately. Denormalize only after measuring a real read problem, and know who keeps the copy correct.</p>

<h4>JSONB: flexible attributes</h4>
<p>A keyboard has switches and a layout, a monitor has a size and ports, a book has pages. A column for each would be mostly NULL.
A <code>JSONB</code> column stores them as a binary JSON document:</p>
<table class="mini">
<tr><th>Operator</th><th>Example</th><th>Returns</th></tr>
<tr><td><code>-&gt;</code></td><td><code>attrs -&gt; 'dimensions'</code></td><td>JSON <code>{"width_cm": 61, …}</code></td></tr>
<tr><td><code>-&gt;&gt;</code></td><td><code>attrs -&gt;&gt; 'color'</code></td><td>text <code>black</code></td></tr>
<tr><td>chain</td><td><code>attrs -&gt; 'dimensions' -&gt;&gt; 'width_cm'</code></td><td>text <code>61</code> (cast with <code>::int</code>)</td></tr>
<tr><td><code>@&gt;</code></td><td><code>attrs @&gt; '{"wireless": true}'</code></td><td>boolean: "contains"</td></tr>
<tr><td><code>?</code></td><td><code>attrs ? 'dpi'</code></td><td>boolean: key exists</td></tr>
</table>
<p><code>@&gt;</code> can use a GIN index (<code>CREATE INDEX … USING GIN (attrs)</code>), so containment searches stay fast on big tables.</p>

<div class="callout trap"><b>Trap: JSONB as a way to skip schema design.</b> If every row has the field, you filter or join on it, or it needs
a foreign key, NOT NULL or CHECK, it should be a real column. <code>orders.data JSONB</code> holding <code>customer_id</code> and
<code>total</code> gives up types, constraints and cheap joins. Good fits: optional attributes that vary by type, raw webhook payloads, user settings.</div>`,
  example: {
    sql: `SELECT p.name,
       a.attrs ->> 'color'                       AS color,
       a.attrs -> 'dimensions'                   AS dimensions_json,
       (a.attrs -> 'dimensions' ->> 'width_cm')::int AS width_cm,
       a.attrs @> '{"wireless": true}'           AS is_wireless
FROM products p
JOIN product_attributes a ON a.product_id = p.id
ORDER BY p.id;`,
    note: 'Missing keys simply give NULL. Try attrs ? \'ports\', or jsonb_pretty(attrs) to see a whole document nicely formatted.',
  },
  exercises: [
    {
      id: 'd27-e1', type: 'query',
      prompt: `Create a view <code>customer_order_totals</code> with one row per customer (<b>all 28</b>) and these columns:
<code>customer_id</code>, <code>name</code>, <code>order_count</code> (number of <b>non-cancelled</b> orders) and <code>total_spent</code>
(sum of <code>quantity * unit_price</code> over those orders, 0 if none). The checker runs <code>SELECT * FROM customer_order_totals</code>.`,
      hint: 'customers LEFT JOIN orders (with <code>o.status &lt;&gt; \'cancelled\'</code> in the ON) LEFT JOIN order_items. Use <code>COUNT(DISTINCT o.id)</code>, because joining items repeats each order.',
      solution: `CREATE VIEW customer_order_totals AS
SELECT c.id AS customer_id,
       c.name,
       COUNT(DISTINCT o.id) AS order_count,
       COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total_spent
FROM customers c
LEFT JOIN orders o       ON o.customer_id = c.id AND o.status <> 'cancelled'
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY c.id, c.name;`,
      check: `SELECT * FROM customer_order_totals ORDER BY 1`,
      ordered: true,
      alts: [`CREATE VIEW customer_order_totals AS
WITH live AS (SELECT * FROM orders WHERE status <> 'cancelled')
SELECT c.id, c.name,
       (SELECT count(*) FROM live o WHERE o.customer_id = c.id),
       (SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0) FROM live o JOIN order_items oi ON oi.order_id = o.id WHERE o.customer_id = c.id)
FROM customers c;`],
      wrong: [
        { sql: `CREATE VIEW customer_order_totals AS SELECT c.id, c.name, COUNT(o.id), COALESCE(SUM(oi.quantity * oi.unit_price), 0)
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status <> 'cancelled' LEFT JOIN order_items oi ON oi.order_id = o.id GROUP BY c.id, c.name;` },
        { sql: `CREATE VIEW customer_order_totals AS SELECT c.id, c.name, COUNT(DISTINCT o.id), COALESCE(SUM(oi.quantity * oi.unit_price), 0)
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id LEFT JOIN order_items oi ON oi.order_id = o.id WHERE o.status <> 'cancelled' GROUP BY c.id, c.name;` },
      ],
      why: 'Ghazal Effendi tops the list with 10 orders and 6746.21. <code>COUNT(o.id)</code> counts order <i>lines</i> after the items join, and putting the status filter in WHERE drops the customers who never ordered. Now the whole team can just <code>SELECT … FROM customer_order_totals</code>.',
    },
    {
      id: 'd27-e2', type: 'query',
      prompt: 'Create a <b>materialized</b> view <code>product_sales</code> with columns <code>product_id</code> and <code>units_sold</code> (sum of <code>quantity</code> over <b>all</b> order_items). The checker then inserts a new order line for product 1, reads the view, refreshes it, and reads it again.',
      hint: '<code>CREATE MATERIALIZED VIEW product_sales AS SELECT product_id, SUM(quantity) AS units_sold FROM order_items GROUP BY product_id;</code>',
      solution: `CREATE MATERIALIZED VIEW product_sales AS
SELECT product_id, SUM(quantity) AS units_sold
FROM order_items
GROUP BY product_id;`,
      check: `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (9999, 2, 1, 100, 89.99);
CREATE TEMP TABLE before_refresh AS SELECT units_sold FROM product_sales WHERE product_id = 1;
REFRESH MATERIALIZED VIEW product_sales;
SELECT (SELECT units_sold FROM before_refresh) AS before_refresh,
       units_sold AS after_refresh,
       (SELECT relkind FROM pg_class WHERE relname = 'product_sales') AS kind
FROM product_sales WHERE product_id = 1`,
      wrong: [{ sql: `CREATE VIEW product_sales AS SELECT product_id, SUM(quantity) AS units_sold FROM order_items GROUP BY product_id;` }],
      why: 'Right after the insert the materialized view still says 38: it is a snapshot. After REFRESH it says 138. A plain view would show 138 immediately, because it reruns the query on every read. That staleness is the price of the speed.',
    },
    {
      id: 'd27-e3', type: 'query',
      prompt: 'From <code>products</code> and <code>product_attributes</code>, list the <code>name</code>, the color (as text) and the width in cm (<code>dimensions.width_cm</code>, as an integer, NULL if missing) of every <b>black</b> product.',
      hint: '<code>a.attrs -&gt;&gt; \'color\' = \'black\'</code>, and <code>(a.attrs -&gt; \'dimensions\' -&gt;&gt; \'width_cm\')::int</code>.',
      solution: `SELECT p.name,
       a.attrs ->> 'color' AS color,
       (a.attrs -> 'dimensions' ->> 'width_cm')::int AS width_cm
FROM products p
JOIN product_attributes a ON a.product_id = p.id
WHERE a.attrs ->> 'color' = 'black';`,
      alts: [`SELECT p.name, a.attrs ->> 'color', (a.attrs #>> '{dimensions,width_cm}')::int
FROM products p JOIN product_attributes a ON a.product_id = p.id
WHERE a.attrs @> '{"color": "black"}';`],
      wrong: [
        { sql: `SELECT p.name, a.attrs ->> 'color', (a.attrs -> 'dimensions' ->> 'width_cm')::int FROM products p JOIN product_attributes a ON a.product_id = p.id WHERE a.attrs -> 'color' = 'black';` },
        { sql: `SELECT p.name, a.attrs ->> 'color', (a.attrs ->> 'width_cm')::int FROM products p JOIN product_attributes a ON a.product_id = p.id WHERE a.attrs ->> 'color' = 'black';` },
      ],
      why: '<code>-&gt;</code> returns JSON (<code>"black"</code> with quotes), <code>-&gt;&gt;</code> returns plain text, so <code>attrs -&gt; \'color\' = \'black\'</code> fails (\'black\' is not valid JSON). <code>width_cm</code> lives inside <code>dimensions</code>, so <code>attrs -&gt;&gt; \'width_cm\'</code> is always NULL. Use <code>-&gt;</code> to walk into nested objects and <code>-&gt;&gt;</code> for the final value, then cast it, because JSON numbers come out as text.',
    },
    {
      id: 'd27-e4', type: 'query',
      prompt: 'List the <code>name</code> of every product whose attributes say it is <b>wireless</b> (<code>"wireless": true</code>). Use the containment operator <code>@&gt;</code>.',
      hint: '<code>WHERE a.attrs @&gt; \'{"wireless": true}\'</code>',
      solution: `SELECT p.name
FROM products p
JOIN product_attributes a ON a.product_id = p.id
WHERE a.attrs @> '{"wireless": true}';`,
      alts: [`SELECT p.name FROM products p JOIN product_attributes a ON a.product_id = p.id WHERE (a.attrs ->> 'wireless')::boolean;`],
      wrong: [{ sql: `SELECT p.name FROM products p JOIN product_attributes a ON a.product_id = p.id WHERE a.attrs ? 'wireless';` }],
      why: 'Only the mouse and the headphones. <code>? \'wireless\'</code> asks whether the key <i>exists</i>, so it also returns the keyboard and lamp whose value is <code>false</code>. <code>@&gt;</code> also works with a GIN index, unlike the <code>-&gt;&gt;</code> cast.',
    },
    {
      id: 'd27-e5', type: 'query',
      prompt: 'The customer list page is slow because it counts orders for every row. Denormalize: add <code>order_count</code> to <code>customers</code> (INT, NOT NULL, default 0) and fill it with each customer\'s number of orders (<b>all statuses</b>). The checker shows every customer\'s count and whether the column is nullable.',
      hint: '<code>ALTER TABLE customers ADD COLUMN order_count INT NOT NULL DEFAULT 0;</code> then <code>UPDATE customers c SET order_count = (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id);</code>',
      solution: `ALTER TABLE customers ADD COLUMN order_count INT NOT NULL DEFAULT 0;
UPDATE customers c
SET order_count = (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id);`,
      check: `SELECT id, order_count,
       (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'order_count') AS nullable
FROM customers ORDER BY id`,
      ordered: true,
      alts: [`ALTER TABLE customers ADD COLUMN order_count integer DEFAULT 0 NOT NULL;
UPDATE customers c SET order_count = t.n
FROM (SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id) t
WHERE t.customer_id = c.id;`],
      wrong: [{ sql: `ALTER TABLE customers ADD COLUMN order_count INT;
UPDATE customers c SET order_count = t.n FROM (SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id) t WHERE t.customer_id = c.id;` }],
      why: 'Now the list page reads one column. But this number is a <i>copy</i>: every INSERT or DELETE on orders must also update it, in the same transaction (or via a trigger), or it silently drifts. With UPDATE … FROM, customers without orders aren\'t touched, which is why the NOT NULL DEFAULT 0 matters.',
    },
    {
      id: 'd27-q1', type: 'quiz',
      prompt: 'Which column is the <b>best</b> fit for JSONB?',
      options: [
        '<code>orders.details</code> holding customer_id, status and total',
        '<code>webhook_events.payload</code>: the raw body Stripe sent, stored for debugging and replays',
        '<code>users.email</code> wrapped as <code>{"email": "…"}</code>',
        '<code>order_items.lines</code>: an array of {product_id, qty} instead of an order_items table',
      ],
      answer: 1,
      why: 'A third-party payload has a shape you don\'t control and you mostly store and read it whole. The others hide core, always-present, relational data (FKs, statuses, totals) inside JSON, losing constraints, types and cheap joins.',
    },
    {
      id: 'd27-q2', type: 'quiz',
      prompt: 'A dashboard shows revenue per month from 50 million order rows. It\'s fine if the numbers are up to an hour old. Best approach?',
      options: [
        'A plain VIEW over orders and order_items',
        'A MATERIALIZED VIEW refreshed every hour (e.g. by a cron job)',
        'Add a revenue column to every order row',
        'Store the report as JSONB in a settings table',
      ],
      answer: 1,
      why: 'A plain view would rerun the heavy aggregate on every page load. A materialized view computes it once per refresh and reads like a small table. <code>REFRESH MATERIALIZED VIEW CONCURRENTLY</code> (needs a unique index) even keeps it readable during the refresh.',
    },
  ],
  leetcode: [],
  ownIt: 'Explain to a teammate when you would use a view, a materialized view, and a denormalized column, and what each one costs you.',
};
