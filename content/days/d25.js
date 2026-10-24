export default {
  day: 25,
  phase: 3,
  title: 'DML: INSERT/UPDATE/DELETE, UPSERT, RETURNING',
  goal: 'Change data safely: insert, update through joins, delete duplicates, upsert, and get the changed rows back.',
  setup: `
CREATE TABLE newsletter_signups (id INT PRIMARY KEY, email TEXT NOT NULL);
INSERT INTO newsletter_signups VALUES
  (1, 'ali@x.com'), (2, 'sana@x.com'), (3, 'ali@x.com'), (4, 'omar@x.com'),
  (5, 'sana@x.com'), (6, 'ali@x.com'), (7, 'hira@x.com');
`,
  learn: `
<p>DDL builds the tables; <b>DML</b> (Data Manipulation Language) changes the rows inside them. This is what your API runs
on every request, and it is where the scariest production bugs live, because a wrong <code>SELECT</code> shows wrong data but a
wrong <code>UPDATE</code> <i>destroys</i> it.</p>

<h4>INSERT</h4>
<pre><code>INSERT INTO departments (id, name, location, budget)
VALUES (9, 'Data', 'Lahore', 900000),
       (10, 'Support', 'Karachi', 200000);        -- many rows, one statement

INSERT INTO vip_customers (customer_id)           -- copy rows from a query
SELECT id FROM customers WHERE country &lt;&gt; 'Pakistan';</code></pre>
<p>Always list the columns. <code>INSERT INTO t VALUES (…)</code> without a column list breaks the day someone adds a column.</p>

<h4>UPDATE, and the forgotten WHERE</h4>
<pre><code>UPDATE employees SET salary = salary * 1.10 WHERE id = 14;</code></pre>
<div class="callout trap"><b>Trap:</b> forget the <code>WHERE</code> and <b>every</b> row is updated, with no warning and
"UPDATE 30" as the only hint. Habit that saves careers: write the <code>SELECT … WHERE</code> first, check the rows, then turn it into
an UPDATE. In a console, run it inside <code>BEGIN;</code> and check the row count before <code>COMMIT;</code>.</div>

<h4>UPDATE … FROM: update using another table</h4>
<pre><code>UPDATE employees e
SET salary = e.salary * 1.10
FROM departments d
WHERE d.id = e.department_id
  AND d.name = 'Engineering';</code></pre>
<p>The <code>FROM</code> works like a join: each employee row is matched with its department, and only matches are updated.</p>

<h4>DELETE</h4>
<pre><code>DELETE FROM order_items
WHERE order_id IN (SELECT id FROM orders WHERE status = 'cancelled');
-- or with a join:
DELETE FROM order_items oi USING orders o
WHERE o.id = oi.order_id AND o.status = 'cancelled';</code></pre>

<h4>Deleting duplicates (LeetCode 196)</h4>
<table class="mini">
<tr><th>id</th><th>email</th><th></th></tr>
<tr><td>1</td><td>ali@x.com</td><td class="keep">keep (lowest id)</td></tr>
<tr><td>3</td><td>ali@x.com</td><td class="drop">delete</td></tr>
<tr><td>6</td><td>ali@x.com</td><td class="drop">delete</td></tr>
</table>
<pre><code>DELETE FROM newsletter_signups a
USING newsletter_signups b
WHERE a.email = b.email AND a.id &gt; b.id;   -- a has a smaller twin → a goes</code></pre>

<h4>UPSERT: insert, or update if it already exists</h4>
<pre><code>INSERT INTO products (id, name, category, price, stock)
VALUES (2, 'Wireless Mouse', 'Electronics', 29.99, 50)
ON CONFLICT (id) DO UPDATE SET stock = products.stock + EXCLUDED.stock;</code></pre>
<p><code>EXCLUDED</code> is the row you <i>tried</i> to insert. <code>ON CONFLICT DO NOTHING</code> just skips it. The conflict
target must be a primary key or unique constraint. This is atomic, unlike "SELECT, then INSERT or UPDATE" in app code, which races
when two requests arrive together.</p>

<h4>RETURNING: get the changed rows back</h4>
<pre><code>INSERT INTO … RETURNING id;          -- the generated id, no second query
UPDATE … RETURNING id, salary;       -- the new values
DELETE … RETURNING *;                -- what you just deleted</code></pre>

<h4>CASE inside UPDATE (LeetCode 627)</h4>
<p>To swap two values, use <b>one</b> UPDATE with CASE. Two separate UPDATEs would turn A into B and then turn <i>all</i> the Bs (old and new) back into A.</p>`,
  example: {
    sql: `UPDATE employees
SET salary = salary + 5000
WHERE job_title = 'Junior Engineer'
RETURNING id, first_name, salary;`,
    note: 'RETURNING shows the rows exactly as they are after the update. Remove the WHERE and run it again to see how many rows a forgotten WHERE touches (it is rolled back, relax).',
  },
  exercises: [
    {
      id: 'd25-e1', type: 'query',
      prompt: 'Add two departments in <b>one</b> INSERT: <code>(9, \'Data\', \'Lahore\', 900000)</code> and <code>(10, \'Support\', \'Karachi\', 200000)</code> (columns <code>id, name, location, budget</code>). Use <code>RETURNING</code> to return the <code>id</code> and <code>name</code> of the inserted rows.',
      hint: '<code>INSERT INTO departments (id, name, location, budget) VALUES (…), (…) RETURNING id, name;</code>',
      solution: `INSERT INTO departments (id, name, location, budget)
VALUES (9, 'Data', 'Lahore', 900000),
       (10, 'Support', 'Karachi', 200000)
RETURNING id, name;`,
      wrong: [{ sql: `INSERT INTO departments (id, name, location, budget) VALUES (9, 'Data', 'Lahore', 900000), (10, 'Support', 'Karachi', 200000);` }],
      why: 'One multi-row INSERT is one round trip and one atomic statement: both rows go in, or neither does. RETURNING hands back what was written, which is how ORMs get generated ids without a second query.',
    },
    {
      id: 'd25-e2', type: 'query',
      prompt: 'Give everyone in the <b>Engineering</b> department a <b>10% raise</b>. Find the department by its <code>name</code> (don\'t hard-code id 2). The checker shows every employee\'s salary, so nobody else may change.',
      hint: '<code>UPDATE employees e SET salary = e.salary * 1.10 FROM departments d WHERE d.id = e.department_id AND d.name = \'Engineering\';</code>',
      solution: `UPDATE employees e
SET salary = e.salary * 1.10
FROM departments d
WHERE d.id = e.department_id
  AND d.name = 'Engineering';`,
      check: `SELECT id, salary FROM employees ORDER BY id`,
      ordered: true,
      alts: [`UPDATE employees SET salary = salary * 1.1
WHERE department_id IN (SELECT id FROM departments WHERE name = 'Engineering');`],
      wrong: [
        { sql: `UPDATE employees SET salary = salary * 1.10;` },
        { sql: `UPDATE employees SET salary = salary + 10;` },
      ],
      why: '11 Engineering salaries change and the other 19 stay. UPDATE … FROM is Postgres\'s join-update; the IN-subquery version does the same thing and works in every database. Without WHERE, all 30 salaries would rise.',
    },
    {
      id: 'd25-e3', type: 'query',
      prompt: 'A delivery arrives: <b>50</b> more <code>Wireless Mouse</code> (product id 2, Electronics, 29.99) and <b>100</b> of a new product <code>(16, \'Mouse Pad\', \'Accessories\', 9.50)</code>. In <b>one</b> INSERT into <code>products (id, name, category, price, stock)</code>, add the new product and, for an existing id, <b>add</b> the incoming stock to the current stock.',
      hint: '<code>ON CONFLICT (id) DO UPDATE SET stock = products.stock + EXCLUDED.stock</code>',
      solution: `INSERT INTO products (id, name, category, price, stock)
VALUES (2, 'Wireless Mouse', 'Electronics', 29.99, 50),
       (16, 'Mouse Pad', 'Accessories', 9.50, 100)
ON CONFLICT (id) DO UPDATE SET stock = products.stock + EXCLUDED.stock;`,
      check: `SELECT id, name, stock FROM products WHERE id IN (2, 16) ORDER BY id`,
      ordered: true,
      wrong: [
        { sql: `INSERT INTO products (id, name, category, price, stock) VALUES (2, 'Wireless Mouse', 'Electronics', 29.99, 50), (16, 'Mouse Pad', 'Accessories', 9.50, 100) ON CONFLICT (id) DO NOTHING;` },
        { sql: `INSERT INTO products (id, name, category, price, stock) VALUES (2, 'Wireless Mouse', 'Electronics', 29.99, 50), (16, 'Mouse Pad', 'Accessories', 9.50, 100) ON CONFLICT (id) DO UPDATE SET stock = EXCLUDED.stock;` },
      ],
      why: 'The mouse goes from 300 to 350 and the pad is inserted with 100. <code>products.stock</code> is the current row, <code>EXCLUDED.stock</code> the incoming 50. <code>SET stock = EXCLUDED.stock</code> would overwrite the count with 50, and DO NOTHING would ignore the delivery.',
    },
    {
      id: 'd25-e4', type: 'query',
      prompt: 'Purge all <b>cancelled</b> orders. <code>order_items</code> references <code>orders</code>, so delete the cancelled orders\' items first, then the orders. The checker counts what is left.',
      hint: 'Two DELETEs. The first uses <code>WHERE order_id IN (SELECT id FROM orders WHERE status = \'cancelled\')</code> or <code>USING orders</code>.',
      solution: `DELETE FROM order_items
WHERE order_id IN (SELECT id FROM orders WHERE status = 'cancelled');
DELETE FROM orders WHERE status = 'cancelled';`,
      check: `SELECT (SELECT count(*) FROM orders) AS orders_left,
       (SELECT count(*) FROM order_items) AS items_left,
       (SELECT count(*) FROM orders WHERE status = 'cancelled') AS cancelled_left`,
      alts: [`DELETE FROM order_items oi USING orders o WHERE o.id = oi.order_id AND o.status = 'cancelled';
DELETE FROM orders WHERE status = 'cancelled';`],
      wrong: [
        { sql: `DELETE FROM orders WHERE status = 'cancelled';` },
        { sql: `DELETE FROM order_items; DELETE FROM orders WHERE status = 'cancelled';` },
      ],
      why: '13 orders and their 33 items go; 77 orders and 170 items remain. Deleting the orders first fails with a foreign key error, which is the FK protecting you from orphaned items. (Cancelled orders have no payments, otherwise those would need handling too.)',
    },
    {
      id: 'd25-e5', type: 'query',
      prompt: '<code>newsletter_signups(id, email)</code> has duplicate emails. <b>Delete</b> the duplicates, keeping only the row with the <b>lowest id</b> for each email (LeetCode 196).',
      hint: 'Self join: <code>DELETE FROM newsletter_signups a USING newsletter_signups b WHERE a.email = b.email AND a.id &gt; b.id;</code>. Or keep only <code>MIN(id)</code> per email.',
      solution: `DELETE FROM newsletter_signups a
USING newsletter_signups b
WHERE a.email = b.email
  AND a.id > b.id;`,
      check: `SELECT id, email FROM newsletter_signups ORDER BY id`,
      ordered: true,
      alts: [
        `DELETE FROM newsletter_signups WHERE id NOT IN (SELECT MIN(id) FROM newsletter_signups GROUP BY email);`,
        `DELETE FROM newsletter_signups WHERE id IN (
  SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY email ORDER BY id) AS rn FROM newsletter_signups) t WHERE rn > 1);`,
      ],
      wrong: [{ sql: `DELETE FROM newsletter_signups a USING newsletter_signups b WHERE a.email = b.email AND a.id < b.id;` }],
      why: 'A row is deleted if a twin with a smaller id exists, so only the smallest id per email survives: 1, 2, 4, 7. Flip the comparison and you keep the <i>newest</i> instead. NOT IN is safe here because MIN(id) can\'t be NULL.',
    },
    {
      id: 'd25-e6', type: 'query',
      prompt: 'A bug swapped two order statuses. In <b>one UPDATE</b>, change every <code>\'pending\'</code> order to <code>\'shipped\'</code> and every <code>\'shipped\'</code> order to <code>\'pending\'</code> (LeetCode 627). Leave other statuses alone. The checker counts orders per status.',
      hint: '<code>SET status = CASE status WHEN \'pending\' THEN \'shipped\' ELSE \'pending\' END WHERE status IN (\'pending\', \'shipped\')</code>',
      solution: `UPDATE orders
SET status = CASE status WHEN 'pending' THEN 'shipped' ELSE 'pending' END
WHERE status IN ('pending', 'shipped');`,
      check: `SELECT status, count(*) FROM orders GROUP BY status ORDER BY status`,
      ordered: true,
      alts: [`UPDATE orders SET status = CASE WHEN status = 'pending' THEN 'shipped' WHEN status = 'shipped' THEN 'pending' ELSE status END;`],
      wrong: [
        { sql: `UPDATE orders SET status = 'shipped' WHERE status = 'pending';
UPDATE orders SET status = 'pending' WHERE status = 'shipped';` },
        { sql: `UPDATE orders SET status = CASE status WHEN 'pending' THEN 'shipped' ELSE 'pending' END;` },
      ],
      why: 'Every row\'s new value is computed from its <i>old</i> value within one statement, so 12 pending ↔ 13 shipped swap cleanly. Two separate UPDATEs end with all 25 as pending. Without the WHERE (and without ELSE status), delivered and cancelled orders would become pending too.',
    },
    {
      id: 'd25-q1', type: 'quiz',
      prompt: 'Your app does: <code>SELECT</code> the cart row; if none exists, <code>INSERT</code> it, else <code>UPDATE</code>. Two requests from the same user arrive at the same moment. What can happen, and what fixes it?',
      options: [
        'Nothing, Postgres serializes requests automatically',
        'Both see "no row" and both INSERT: a duplicate or a unique-violation error. Use INSERT … ON CONFLICT',
        'The UPDATE runs twice, fix it with RETURNING',
        'Use DELETE then INSERT instead',
      ],
      answer: 1,
      why: 'Between your SELECT and INSERT another request can do the same check. ON CONFLICT makes "insert or update" one atomic statement backed by a unique constraint. (Day 33–34 dig into why this race exists.)',
    },
  ],
  leetcode: [
    { id: 196, title: 'Delete Duplicate Emails', slug: 'delete-duplicate-emails', difficulty: 'Easy' },
    { id: 627, title: 'Swap Salary', slug: 'swap-salary', difficulty: 'Easy' },
  ],
  ownIt: 'Describe your personal checklist before running an UPDATE or DELETE on a production database. Include how you\'d check the row count before committing.',
};
