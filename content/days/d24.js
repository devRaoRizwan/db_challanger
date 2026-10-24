// Checker helper: pg_temp.try_sql('<statement>') runs a statement and undoes it again,
// returning 'accepted' if Postgres allowed it and 'blocked' if a constraint stopped it.
const TRY = `CREATE FUNCTION pg_temp.try_sql(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'undo';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLSTATE = 'P0099' THEN 'accepted' ELSE 'blocked' END;
END $$;
`;

export default {
  day: 24,
  phase: 3,
  title: 'Relationships & ER modeling',
  goal: 'Model 1:1, 1:N, M:N and self-referencing relationships, and read a schema as an ER diagram.',
  setup: `
CREATE TABLE articles (id INT PRIMARY KEY, title TEXT NOT NULL);
CREATE TABLE labels (id INT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE article_labels (
  article_id INT REFERENCES articles(id) ON DELETE CASCADE,
  label_id   INT REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, label_id)
);
INSERT INTO articles VALUES
  (1, 'Indexes explained'), (2, 'Joins for beginners'), (3, 'Tuning autovacuum'),
  (4, 'Why I left MongoDB'), (5, 'CTE tricks'), (6, 'Draft: Redis caching');
INSERT INTO labels VALUES (1, 'sql'), (2, 'postgres'), (3, 'performance'), (4, 'nosql'), (5, 'career');
INSERT INTO article_labels VALUES
  (1, 1), (1, 2), (1, 3),
  (2, 1),
  (3, 2), (3, 3),
  (4, 2), (4, 4),
  (5, 1), (5, 2);
`,
  learn: `
<p>Every relationship between two tables is one of a few shapes. Once you can name the shape, you know where the foreign key goes.</p>

<h4>1:N (one-to-many): the everyday one</h4>
<p>One department has many employees; each employee has one department. The FK goes on the <b>"many" side</b>:
<code>employees.department_id → departments.id</code>. A department can't store a list of employees (that would break 1NF).</p>

<h4>1:1 (one-to-one)</h4>
<p>One customer has at most one profile. It's a 1:N whose FK is also <b>UNIQUE</b>; the simplest form makes the FK the primary key:</p>
<pre><code>CREATE TABLE customer_profiles (
  customer_id INT PRIMARY KEY REFERENCES customers(id),
  bio TEXT, avatar_url TEXT
);</code></pre>
<p>Why split at all? Optional or rarely-read data (big text, settings), or data with different access rules.</p>

<h4>M:N (many-to-many): the junction table</h4>
<p>An employee works on many projects; a project has many employees. Neither side can hold the FK, so a third table
holds <b>pairs</b>:</p>
<table class="mini">
<tr><th>employee_id</th><th>project_id</th><th>role</th><th>hours</th></tr>
<tr><td>9 (Fatima)</td><td>1 (Payments API v2)</td><td>Developer</td><td>280</td></tr>
<tr><td>9 (Fatima)</td><td>3 (Search Service)</td><td>Lead</td><td>260</td></tr>
<tr><td>10 (Ali)</td><td>1 (Payments API v2)</td><td>Developer</td><td>300</td></tr>
</table>
<p>The primary key <code>(employee_id, project_id)</code> stops duplicate pairs, and the junction can carry facts about the
pair itself (<code>role</code>, <code>hours</code>). To query across it you join <b>three</b> tables: employees → employee_projects → projects.</p>

<h4>Self-reference</h4>
<p>A table pointing at itself: <code>employees.manager_id → employees.id</code>, <code>customers.referred_by → customers.id</code>.
Query it with a self join (Day 8) or a recursive CTE for whole trees (Day 17).</p>

<h4>Our database as an ER diagram</h4>
<pre><code>departments ─1───N─ employees ──┐
     │                  │   ▲   │ manager_id → employees.id (self)
     1                  1   └───┘
     │                  │
     N                  N
 projects ──1───N── employee_projects     ← junction: employees M:N projects

customers ─1───N─ orders ─1───N─ order_items ─N───1─ products
  │  ▲               │
  │  └─ referred_by  1
  │     (self)       │
  1                  N
  │               payments
  N
logins</code></pre>

<div class="callout trap"><b>Anti-pattern: polymorphic associations.</b> Rails/Laravel make it easy to write
<code>comments(commentable_type, commentable_id)</code> where the id points to a post <i>or</i> a photo <i>or</i> a video depending on the type
column. The database can't put a foreign key on that, so orphans and typos ("Psot") get in. Better: one nullable FK per parent
(<code>post_id</code>, <code>photo_id</code>) plus <code>CHECK (num_nonnulls(post_id, photo_id) = 1)</code>, or a separate comments table per parent.</div>

<div class="callout">Reading an unknown schema at work? Look at the foreign keys first:
<code>SELECT conrelid::regclass, conname FROM pg_constraint WHERE contype = 'f';</code> gives you the diagram's edges.</div>`,
  example: {
    sql: `SELECT e.first_name, p.name AS project, ep.role, ep.hours
FROM employees e
JOIN employee_projects ep ON ep.employee_id = e.id
JOIN projects p           ON p.id = ep.project_id
ORDER BY e.first_name, p.name;`,
    note: 'One row per (employee, project) pair. Fatima and Ali appear twice because they are on two projects. Who is on no project? Try a LEFT JOIN from employees and look for NULLs.',
  },
  exercises: [
    {
      id: 'd24-e1', type: 'query',
      prompt: 'For <b>every</b> project, show its <code>name</code>, the number of employees on it, and their total <code>hours</code> (0 when nobody is on it).',
      hint: '<code>projects LEFT JOIN employee_projects</code>, then <code>GROUP BY</code>. Count a column from the junction table, not <code>*</code>, and wrap the sum in <code>COALESCE(…, 0)</code>.',
      solution: `SELECT p.name, COUNT(ep.employee_id) AS people, COALESCE(SUM(ep.hours), 0) AS total_hours
FROM projects p
LEFT JOIN employee_projects ep ON ep.project_id = p.id
GROUP BY p.id, p.name;`,
      wrong: [
        { sql: `SELECT p.name, COUNT(*), COALESCE(SUM(ep.hours), 0) FROM projects p LEFT JOIN employee_projects ep ON ep.project_id = p.id GROUP BY p.id, p.name;` },
        { sql: `SELECT p.name, COUNT(ep.employee_id), SUM(ep.hours) FROM projects p JOIN employee_projects ep ON ep.project_id = p.id GROUP BY p.id, p.name;` },
      ],
      why: 'Internal Wiki has nobody, so the LEFT JOIN gives it one row of NULLs. <code>COUNT(*)</code> counts that row (1), while <code>COUNT(ep.employee_id)</code> skips NULLs and correctly says 0.',
    },
    {
      id: 'd24-e2', type: 'query',
      prompt: 'List <b>every</b> customer\'s <code>name</code> next to the name of the customer who referred them (<code>referred_by</code>), or NULL if nobody did.',
      hint: 'Self join with two aliases: <code>customers c LEFT JOIN customers r ON r.id = c.referred_by</code>.',
      solution: `SELECT c.name, r.name AS referred_by_name
FROM customers c
LEFT JOIN customers r ON r.id = c.referred_by;`,
      wrong: [{ sql: `SELECT c.name, r.name FROM customers c JOIN customers r ON r.id = c.referred_by;` }],
      why: 'Same table, two roles: <code>c</code> is the customer, <code>r</code> is the referrer. An inner join keeps only the 8 referred customers; LEFT JOIN keeps all 28.',
    },
    {
      id: 'd24-e3', type: 'query',
      prompt: 'Model a <b>1:1</b> relationship: create <code>customer_profiles</code> with <code>customer_id</code> (INT, referencing <code>customers(id)</code>), <code>bio</code> TEXT and <code>avatar_url</code> TEXT, so that a customer can have <b>at most one</b> profile. The checker inserts with <code>(customer_id, bio)</code>, then tries a second profile for customer 1 and a profile for customer 9999.',
      hint: 'Make <code>customer_id</code> the primary key, or keep a separate id and add <code>UNIQUE</code> to <code>customer_id</code>.',
      solution: `CREATE TABLE customer_profiles (
  customer_id INT PRIMARY KEY REFERENCES customers(id),
  bio         TEXT,
  avatar_url  TEXT
);`,
      check: TRY + `INSERT INTO customer_profiles (customer_id, bio) VALUES (1, 'Loves keyboards');
SELECT pg_temp.try_sql($q$INSERT INTO customer_profiles (customer_id, bio) VALUES (1, 'Second profile')$q$) AS second_profile,
       pg_temp.try_sql($q$INSERT INTO customer_profiles (customer_id, bio) VALUES (9999, 'Ghost')$q$) AS missing_customer,
       pg_temp.try_sql($q$INSERT INTO customer_profiles (customer_id, bio) VALUES (2, 'Hello')$q$) AS other_customer`,
      alts: [`CREATE TABLE customer_profiles (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id INT NOT NULL UNIQUE REFERENCES customers(id),
  bio TEXT, avatar_url TEXT
);`],
      wrong: [{ sql: `CREATE TABLE customer_profiles (id SERIAL PRIMARY KEY, customer_id INT REFERENCES customers(id), bio TEXT, avatar_url TEXT);` }],
      why: 'A foreign key alone gives you 1:N (a customer could get ten profiles). Making the FK unique, either as the primary key or with UNIQUE, turns it into 1:1.',
    },
    {
      id: 'd24-e4', type: 'query',
      prompt: `Model a blog where posts have many tags and tags belong to many posts. Create:
<ul>
<li><code>posts</code>: <code>id</code> INT primary key, <code>title</code> TEXT NOT NULL</li>
<li><code>tags</code>: <code>id</code> INT primary key, <code>name</code> TEXT NOT NULL and unique</li>
<li><code>post_tags</code>: <code>post_id</code>, <code>tag_id</code> referencing them, primary key on the pair, and deleting a post (or tag) removes its links</li>
</ul>The checker inserts data, deletes post 2, then tries a duplicate link, a link to a missing tag and a duplicate tag name.`,
      hint: '<code>post_id INT REFERENCES posts(id) ON DELETE CASCADE</code>, same for tag_id, then <code>PRIMARY KEY (post_id, tag_id)</code>.',
      solution: `CREATE TABLE posts (id INT PRIMARY KEY, title TEXT NOT NULL);
CREATE TABLE tags  (id INT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE post_tags (
  post_id INT REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INT REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);`,
      check: TRY + `INSERT INTO posts (id, title) VALUES (1, 'Hello world'), (2, 'SQL tips');
INSERT INTO tags (id, name) VALUES (1, 'sql'), (2, 'career');
INSERT INTO post_tags (post_id, tag_id) VALUES (1, 2), (2, 1), (2, 2);
DELETE FROM posts WHERE id = 2;
SELECT pg_temp.try_sql($q$INSERT INTO post_tags (post_id, tag_id) VALUES (1, 2)$q$) AS duplicate_link,
       pg_temp.try_sql($q$INSERT INTO post_tags (post_id, tag_id) VALUES (1, 99)$q$) AS missing_tag,
       pg_temp.try_sql($q$INSERT INTO tags (id, name) VALUES (3, 'sql')$q$) AS duplicate_tag_name,
       pg_temp.try_sql($q$INSERT INTO post_tags (post_id, tag_id) VALUES (1, 1)$q$) AS new_link,
       (SELECT count(*) FROM post_tags) AS links_left`,
      alts: [`CREATE TABLE posts (id int, title text NOT NULL, PRIMARY KEY (id));
CREATE TABLE tags (id int PRIMARY KEY, name text NOT NULL, CONSTRAINT tags_name_uq UNIQUE (name));
CREATE TABLE post_tags (post_id int NOT NULL, tag_id int NOT NULL,
  CONSTRAINT post_tags_pk PRIMARY KEY (post_id, tag_id),
  FOREIGN KEY (post_id) REFERENCES posts ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags ON DELETE CASCADE);`],
      wrong: [{ sql: `CREATE TABLE posts (id INT PRIMARY KEY, title TEXT NOT NULL);
CREATE TABLE tags (id INT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE post_tags (post_id INT REFERENCES posts(id), tag_id INT REFERENCES tags(id), PRIMARY KEY (post_id, tag_id));` }],
      why: 'This is the same shape as employee_projects. Without ON DELETE CASCADE, deleting post 2 fails because its links still point at it. CASCADE is right here: a link means nothing without its post.',
    },
    {
      id: 'd24-e5', type: 'query',
      prompt: 'Using <code>articles</code>, <code>labels</code> and <code>article_labels</code>, find the <code>title</code> of articles labelled with <b>both</b> <code>\'sql\'</code> <b>and</b> <code>\'postgres\'</code>.',
      hint: 'Filter to those two labels with <code>WHERE l.name IN (…)</code>, group by article, and keep groups with <code>COUNT(DISTINCT l.name) = 2</code>.',
      solution: `SELECT a.title
FROM articles a
JOIN article_labels al ON al.article_id = a.id
JOIN labels l          ON l.id = al.label_id
WHERE l.name IN ('sql', 'postgres')
GROUP BY a.id, a.title
HAVING COUNT(DISTINCT l.name) = 2;`,
      alts: [`SELECT title FROM articles a
WHERE EXISTS (SELECT 1 FROM article_labels al JOIN labels l ON l.id = al.label_id WHERE al.article_id = a.id AND l.name = 'sql')
  AND EXISTS (SELECT 1 FROM article_labels al JOIN labels l ON l.id = al.label_id WHERE al.article_id = a.id AND l.name = 'postgres');`],
      wrong: [{ sql: `SELECT DISTINCT a.title FROM articles a JOIN article_labels al ON al.article_id = a.id JOIN labels l ON l.id = al.label_id WHERE l.name IN ('sql', 'postgres');` }],
      why: 'A single row can\'t have name = \'sql\' AND name = \'postgres\', so "both" means looking across rows: group per article and count matches. IN alone means "either", which also returns Joins for beginners, Tuning autovacuum and Why I left MongoDB.',
    },
    {
      id: 'd24-q1', type: 'quiz',
      prompt: 'Each order has exactly one customer, and a customer has many orders. Where does the foreign key go?',
      options: ['customers.order_id', 'orders.customer_id', 'A junction table customer_orders', 'Both tables point at each other'],
      answer: 1,
      why: 'In 1:N the FK lives on the "many" side, because each order has exactly one customer to point at. A junction table is only needed for M:N.',
    },
    {
      id: 'd24-q2', type: 'quiz',
      prompt: 'A <code>likes</code> table has <code>likeable_type TEXT</code> (\'post\', \'comment\') and <code>likeable_id INT</code>. What can the database <b>not</b> do for you here?',
      options: ['Count likes per post', 'Enforce that likeable_id points to an existing row', 'Store the time of the like', 'Index likeable_id'],
      answer: 1,
      why: 'A foreign key must point to one specific table, so a polymorphic id can\'t have one. Deleted posts leave orphan likes behind. Separate nullable FKs (post_id, comment_id) with a CHECK that exactly one is set keep the guarantees.',
    },
  ],
  leetcode: [],
  ownIt: 'Draw (on paper or in ASCII) the ER diagram of a project you worked on. Mark each relationship as 1:1, 1:N or M:N and point to the column that implements it.',
};
