export default {
  day: 23,
  phase: 3,
  title: 'Normalization (1NF → 3NF)',
  goal: 'Spot duplicated facts in a table, name the normal form it breaks, and split it into clean tables.',
  setup: `
CREATE TABLE orders_flat (
  order_id       INT,
  order_date     DATE,
  customer_email TEXT,
  customer_name  TEXT,
  customer_city  TEXT,
  product_sku    TEXT,
  product_name   TEXT,
  product_price  NUMERIC(10,2),
  quantity       INT,
  PRIMARY KEY (order_id, product_sku)
);
INSERT INTO orders_flat VALUES
  (1001, '2025-05-01', 'ali@mail.com',  'Ali Raza',   'Lahore',    'KB-01',  'Mechanical Keyboard', 89.99, 1),
  (1001, '2025-05-01', 'ali@mail.com',  'Ali Raza',   'Lahore',    'MS-02',  'Wireless Mouse',      29.99, 2),
  (1002, '2025-05-02', 'sana@mail.com', 'Sana Tariq', 'Karachi',   'KB-01',  'Mechanical Keyboard', 89.99, 1),
  (1003, '2025-05-09', 'ali@mail.com',  'Ali Raza',   'Islamabad', 'MUG-1',  'Coffee Mug',          12.00, 4),
  (1003, '2025-05-09', 'ali@mail.com',  'Ali Raza',   'Islamabad', 'MS-02',  'Wireless Mouse',      29.99, 1),
  (1004, '2025-05-10', 'omar@mail.com', 'Omar Khan',  'Islamabad', 'LMP-1',  'Desk Lamp',           35.00, 1),
  (1004, '2025-05-10', 'omar@mail.com', 'Omar Khan',  'Islamabad', 'MUG-1',  'Coffee Mug',          12.00, 2),
  (1005, '2025-05-12', 'sana@mail.com', 'Sana Tariq', 'Karachi',   'LMP-1',  'Desk Lamp',           35.00, 3);

CREATE TABLE customers_flat (
  id     INT PRIMARY KEY,
  name   TEXT NOT NULL,
  phones TEXT              -- comma-separated list: a 1NF violation
);
INSERT INTO customers_flat VALUES
  (1, 'Ali Raza',   '0300-1111111, 0321-2222222'),
  (2, 'Sana Tariq', '0333-3333333'),
  (3, 'Omar Khan',  '0345-4444444, 0300-5555555, 042-6666666'),
  (4, 'Hira Aslam', NULL);

-- Already normalized versions (used by exercise 4)
CREATE TABLE shop_customers (
  id    INT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL,
  city  TEXT NOT NULL
);
INSERT INTO shop_customers VALUES
  (1, 'ali@mail.com', 'Ali Raza', 'Islamabad'),
  (2, 'sana@mail.com', 'Sana Tariq', 'Karachi'),
  (3, 'omar@mail.com', 'Omar Khan', 'Islamabad');
CREATE TABLE shop_products (
  sku   TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL
);
INSERT INTO shop_products SELECT DISTINCT product_sku, product_name, product_price FROM orders_flat;
`,
  learn: `
<p>Normalization sounds academic, but the idea is one sentence: <b>store every fact exactly once.</b>
When a fact is stored in many rows, those copies eventually disagree, and then nobody knows which one is true.</p>

<p>Here is a table the way a spreadsheet person would build it (<code>orders_flat</code>, already in your database):</p>
<table class="mini">
<tr><th>order_id</th><th>customer_email</th><th>customer_city</th><th>product_sku</th><th>product_name</th><th>price</th><th>qty</th></tr>
<tr><td>1001</td><td>ali@mail.com</td><td class="drop">Lahore</td><td>KB-01</td><td>Mechanical Keyboard</td><td>89.99</td><td>1</td></tr>
<tr><td>1001</td><td>ali@mail.com</td><td class="drop">Lahore</td><td>MS-02</td><td>Wireless Mouse</td><td>29.99</td><td>2</td></tr>
<tr><td>1003</td><td>ali@mail.com</td><td class="keep">Islamabad</td><td>MUG-1</td><td>Coffee Mug</td><td>12.00</td><td>4</td></tr>
</table>
<p>Ali's city is stored in every one of his order lines, and the copies already disagree. That's an <b>anomaly</b>, and there are three kinds:</p>
<ul>
<li><b>Update anomaly</b>: Ali moves; you must update <i>every</i> row, and missing one leaves contradicting data (exactly what happened above).</li>
<li><b>Insert anomaly</b>: you can't add a new product until somebody orders it, because a row needs an order_id.</li>
<li><b>Delete anomaly</b>: delete the only order that contains a product, and the fact "this product exists and costs X" disappears with it.</li>
</ul>

<h4>1NF: one value per cell</h4>
<p>No lists, no "phone1, phone2, phone3" columns. <code>phones = '0300-1111111, 0321-2222222'</code> can't be searched, indexed or
constrained properly. Fix: a child table with one row per phone.</p>

<h4>2NF: every column depends on the <i>whole</i> key</h4>
<p>The key of <code>orders_flat</code> is <code>(order_id, product_sku)</code>. But <code>product_name</code> depends only on
<code>product_sku</code>, and <code>order_date</code> only on <code>order_id</code>. These are <b>partial dependencies</b>: they depend on <i>part</i> of the
key. Fix: move them to <code>products(sku, …)</code> and <code>orders(id, order_date, …)</code>. 2NF can only be broken when the key has several columns.</p>

<h4>3NF: no column depends on another non-key column</h4>
<p>In a table <code>orders(id, customer_email, customer_name, customer_city)</code>, <code>customer_city</code> depends on
<code>customer_email</code>, which depends on the key. That chain (<i>id → email → city</i>) is a <b>transitive dependency</b>.
Fix: <code>customers(id, email, name, city)</code>, and orders keep only <code>customer_id</code>.</p>

<p>The classic summary: every non-key column must depend on <b>the key (1NF), the whole key (2NF), and nothing but the key (3NF)</b>.
<b>BCNF</b> is a slightly stricter 3NF (every column that determines another must be a candidate key). In practice, a schema in 3NF is almost always in BCNF too.</p>

<pre><code>customers(id, email, name, city)
products(sku, name, price)
orders(id, customer_id → customers, order_date)
order_lines(order_id → orders, sku → products, quantity)   PK (order_id, sku)</code></pre>

<div class="callout trap"><b>Trap: "price" looks duplicated in order lines, but it isn't always.</b> The price a customer
<i>paid</i> is a historical fact of the order; the price in the catalog is today's price. Our seed's <code>order_items.unit_price</code>
exists on purpose. Normalization removes copies of the <i>same</i> fact, not facts that just look alike.</div>

<p>To split a table, create the new one and fill it with <code>INSERT INTO new_table (cols) SELECT DISTINCT … FROM old_table;</code></p>`,
  example: {
    sql: `-- Update anomaly in action: Sana moves, but only one row gets updated
UPDATE orders_flat SET customer_city = 'Lahore'
WHERE order_id = 1002;

SELECT customer_email, customer_city, count(*) AS order_lines
FROM orders_flat
GROUP BY customer_email, customer_city
ORDER BY customer_email;`,
    note: 'Now both Ali and Sana have two "truths" about their city. In a normalized schema the city lives in exactly one row, so this can\'t happen. Run SELECT * FROM orders_flat; to see the whole table.',
  },
  exercises: [
    {
      id: 'd23-e1', type: 'query',
      prompt: 'Find the damage the update anomaly already did: list each <code>customer_email</code> in <code>orders_flat</code> that has <b>more than one distinct city</b>, with the number of distinct cities.',
      hint: '<code>GROUP BY customer_email HAVING COUNT(DISTINCT customer_city) &gt; 1</code>',
      solution: `SELECT customer_email, COUNT(DISTINCT customer_city) AS cities
FROM orders_flat
GROUP BY customer_email
HAVING COUNT(DISTINCT customer_city) > 1;`,
      wrong: [{ sql: `SELECT customer_email, COUNT(customer_city) FROM orders_flat GROUP BY customer_email HAVING COUNT(customer_city) > 1;` }],
      why: 'Only Ali has two cities (Lahore and Islamabad). COUNT without DISTINCT counts rows, so every customer with several order lines would show up.',
    },
    {
      id: 'd23-e2', type: 'query',
      prompt: 'Fix the 2NF problem for products. Create <code>products_n</code> (<code>sku</code> TEXT primary key, <code>name</code> TEXT NOT NULL, <code>price</code> NUMERIC(10,2) NOT NULL) and fill it with one row per product from <code>orders_flat</code>.',
      hint: '<code>INSERT INTO products_n (sku, name, price) SELECT DISTINCT product_sku, product_name, product_price FROM orders_flat;</code>',
      solution: `CREATE TABLE products_n (
  sku   TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL
);
INSERT INTO products_n (sku, name, price)
SELECT DISTINCT product_sku, product_name, product_price
FROM orders_flat;`,
      check: `SELECT sku, name, price FROM products_n ORDER BY sku`,
      ordered: true,
      alts: [`CREATE TABLE products_n (sku text PRIMARY KEY, name text NOT NULL, price numeric(10,2) NOT NULL);
INSERT INTO products_n SELECT product_sku, MIN(product_name), MIN(product_price) FROM orders_flat GROUP BY product_sku;`],
      wrong: [{ sql: `CREATE TABLE products_n (sku TEXT PRIMARY KEY, name TEXT NOT NULL, price NUMERIC(10,2) NOT NULL);
INSERT INTO products_n SELECT product_sku, product_name, product_price FROM orders_flat;` }],
      why: 'Without DISTINCT, "KB-01" arrives twice and the primary key rejects the second copy. That error is the database telling you the flat table was storing the same fact many times. Now the 4 products live in exactly 4 rows.',
    },
    {
      id: 'd23-e3', type: 'query',
      prompt: 'Fix the 3NF problem for customers. Create <code>customers_n</code> (<code>id</code> INT <code>GENERATED ALWAYS AS IDENTITY</code> primary key, <code>email</code> TEXT NOT NULL UNIQUE, <code>name</code> TEXT NOT NULL, <code>city</code> TEXT NOT NULL) and fill it with <b>one row per email</b>. Where the copies disagree, take the city from that customer\'s <b>most recent</b> order. The checker shows email, name and city.',
      hint: 'Plain DISTINCT gives Ali twice. <code>SELECT DISTINCT ON (customer_email) customer_email, customer_name, customer_city FROM orders_flat ORDER BY customer_email, order_date DESC</code> keeps the first (latest) row per email.',
      solution: `CREATE TABLE customers_n (
  id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL,
  city  TEXT NOT NULL
);
INSERT INTO customers_n (email, name, city)
SELECT DISTINCT ON (customer_email) customer_email, customer_name, customer_city
FROM orders_flat
ORDER BY customer_email, order_date DESC;`,
      check: `SELECT email, name, city FROM customers_n ORDER BY email`,
      ordered: true,
      alts: [`CREATE TABLE customers_n (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, city text NOT NULL);
INSERT INTO customers_n (email, name, city)
SELECT customer_email, customer_name, customer_city
FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY customer_email ORDER BY order_date DESC) AS rn FROM orders_flat) t
WHERE rn = 1;`],
      wrong: [{ sql: `CREATE TABLE customers_n (id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, city TEXT NOT NULL);
INSERT INTO customers_n (email, name, city) SELECT DISTINCT customer_email, customer_name, customer_city FROM orders_flat;` }],
      why: 'The UNIQUE on email forces you to decide which copy is true, which is exactly the decision the flat table avoided. DISTINCT ON (Postgres-only) or ROW_NUMBER (latest-per-group, Day 11) keeps one row per email. You don\'t list <code>id</code> in the INSERT because identity generates it.',
    },
    {
      id: 'd23-e4', type: 'query',
      prompt: `<code>shop_customers(id, email, name, city)</code> and <code>shop_products(sku, name, price)</code> already exist. Finish the split:
<ul>
<li><code>shop_orders</code>: <code>id</code> INT primary key, <code>customer_id</code> INT NOT NULL referencing <code>shop_customers(id)</code>, <code>order_date</code> DATE NOT NULL</li>
<li><code>shop_order_lines</code>: <code>order_id</code> INT referencing <code>shop_orders(id)</code>, <code>sku</code> TEXT referencing <code>shop_products(sku)</code>, <code>quantity</code> INT NOT NULL, primary key <code>(order_id, sku)</code></li>
</ul>Fill both from <code>orders_flat</code>. The checker joins everything back together.`,
      hint: 'Orders: <code>SELECT DISTINCT f.order_id, c.id, f.order_date FROM orders_flat f JOIN shop_customers c ON c.email = f.customer_email</code>. Lines: a plain SELECT of order_id, product_sku, quantity. Fill orders first, because lines reference them.',
      solution: `CREATE TABLE shop_orders (
  id          INT PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES shop_customers(id),
  order_date  DATE NOT NULL
);
CREATE TABLE shop_order_lines (
  order_id INT REFERENCES shop_orders(id),
  sku      TEXT REFERENCES shop_products(sku),
  quantity INT NOT NULL,
  PRIMARY KEY (order_id, sku)
);
INSERT INTO shop_orders (id, customer_id, order_date)
SELECT DISTINCT f.order_id, c.id, f.order_date
FROM orders_flat f
JOIN shop_customers c ON c.email = f.customer_email;

INSERT INTO shop_order_lines (order_id, sku, quantity)
SELECT order_id, product_sku, quantity
FROM orders_flat;`,
      check: `SELECT o.id, c.email, o.order_date, l.sku, p.name, l.quantity
FROM shop_orders o
JOIN shop_customers c ON c.id = o.customer_id
JOIN shop_order_lines l ON l.order_id = o.id
JOIN shop_products p ON p.sku = l.sku
ORDER BY o.id, l.sku`,
      ordered: true,
      alts: [`CREATE TABLE shop_orders (id int PRIMARY KEY, customer_id int NOT NULL REFERENCES shop_customers, order_date date NOT NULL);
CREATE TABLE shop_order_lines (order_id int REFERENCES shop_orders, sku text REFERENCES shop_products, quantity int NOT NULL, PRIMARY KEY (order_id, sku));
INSERT INTO shop_orders
SELECT f.order_id, MIN(c.id), MIN(f.order_date)
FROM orders_flat f JOIN shop_customers c ON c.email = f.customer_email
GROUP BY f.order_id;
INSERT INTO shop_order_lines SELECT order_id, product_sku, quantity FROM orders_flat;`],
      why: 'Every fact now lives once: the order date in <code>shop_orders</code>, the quantity per product in <code>shop_order_lines</code>, the city in <code>shop_customers</code>. The join in the checker rebuilds the flat view whenever you need it, which is what a <b>view</b> (Day 27) is for.',
    },
    {
      id: 'd23-e5', type: 'query',
      prompt: 'Fix the 1NF problem in <code>customers_flat.phones</code>. Create <code>customer_phones</code> (<code>customer_id</code> INT referencing <code>customers_flat(id)</code>, <code>phone</code> TEXT, primary key <code>(customer_id, phone)</code>) and fill it with <b>one row per phone number</b>, without leading/trailing spaces.',
      hint: '<code>unnest(string_to_array(phones, \',\'))</code> turns one cell into many rows. Wrap the result in <code>trim(…)</code>. Rows with NULL phones produce nothing, which is fine.',
      solution: `CREATE TABLE customer_phones (
  customer_id INT REFERENCES customers_flat(id),
  phone       TEXT,
  PRIMARY KEY (customer_id, phone)
);
INSERT INTO customer_phones (customer_id, phone)
SELECT id, trim(p)
FROM customers_flat, unnest(string_to_array(phones, ',')) AS p;`,
      check: `SELECT customer_id, phone FROM customer_phones ORDER BY customer_id, phone`,
      ordered: true,
      alts: [`CREATE TABLE customer_phones (customer_id int REFERENCES customers_flat (id), phone text, PRIMARY KEY (customer_id, phone));
INSERT INTO customer_phones SELECT id, regexp_split_to_table(phones, '\\s*,\\s*') FROM customers_flat WHERE phones IS NOT NULL;`],
      wrong: [{ sql: `CREATE TABLE customer_phones (customer_id INT REFERENCES customers_flat(id), phone TEXT, PRIMARY KEY (customer_id, phone));
INSERT INTO customer_phones SELECT id, unnest(string_to_array(phones, ',')) FROM customers_flat;` }],
      why: 'Six phone numbers become six rows. Now "who owns 0300-5555555?" is a simple <code>WHERE phone = …</code> that can use an index, and the primary key stops duplicates. Without <code>trim</code>, numbers after a comma keep a leading space and never match.',
    },
    {
      id: 'd23-q1', type: 'quiz',
      prompt: 'Table <code>enrollments(student_id, course_id, course_title, grade)</code> with primary key <code>(student_id, course_id)</code>. Which normal form does it break?',
      options: ['1NF: a cell holds a list', '2NF: course_title depends on only part of the key', '3NF: grade depends on course_title', 'None, it is fine'],
      answer: 1,
      why: '<code>course_title</code> is determined by <code>course_id</code> alone, half of the composite key: a partial dependency. Move it to <code>courses(id, title)</code>. <code>grade</code> is fine because it needs both student and course.',
    },
    {
      id: 'd23-q2', type: 'quiz',
      prompt: 'Table <code>employees(id, name, department_id, department_name)</code> with primary key <code>id</code>. Which normal form does it break?',
      options: ['1NF', '2NF', '3NF: department_name depends on department_id, not directly on id', 'BCNF only'],
      answer: 2,
      why: 'id → department_id → department_name is a transitive dependency. Rename a department and you must update every employee row. Our real schema keeps the name only in <code>departments</code>. (It can\'t be a 2NF problem: the key is a single column.)',
    },
  ],
  leetcode: [],
  ownIt: 'Explain "the key, the whole key, and nothing but the key" using orders_flat, with one example of each anomaly (update, insert, delete).',
};
