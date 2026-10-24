// Checker helper: pg_temp.try_sql('<statement>') runs a statement and undoes it again,
// returning 'accepted' if Postgres allowed it and 'blocked' if a constraint (or anything else) stopped it.
const TRY = `CREATE FUNCTION pg_temp.try_sql(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'undo';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLSTATE = 'P0099' THEN 'accepted' ELSE 'blocked' END;
END $$;
`;

export default {
  day: 22,
  phase: 3,
  title: 'Keys & constraints',
  goal: 'Make the database itself refuse bad data with primary keys, foreign keys, UNIQUE, CHECK, NOT NULL and DEFAULT.',
  learn: `
<p>Your API validates input, but it is not the only thing that writes to the database: scripts, admin panels,
a second service, a teammate in <code>psql</code>. <b>Constraints are validation that nobody can skip.</b>
If a rule must always be true, put it in the schema.</p>

<h4>Primary key: "which row is this?"</h4>
<p>A <code>PRIMARY KEY</code> is <code>UNIQUE + NOT NULL</code> and identifies each row. Two styles:</p>
<ul>
<li><b>Surrogate key</b>: a meaningless id (<code>id BIGINT GENERATED ALWAYS AS IDENTITY</code>). It never changes. This is the default choice.</li>
<li><b>Natural key</b>: a real-world value (email, ISBN, country code). Tempting, but emails change, and then every table that references it must change too.</li>
</ul>
<p>A <b>composite primary key</b> uses several columns. <code>employee_projects</code> has <code>PRIMARY KEY (employee_id, project_id)</code>:
the same employee can be on many projects, but only <i>once</i> per project.</p>

<h4>Foreign key: "this must point to something real"</h4>
<pre><code>department_id INT REFERENCES departments(id)</code></pre>
<p>Now <code>department_id = 99</code> is rejected because department 99 doesn't exist. No more orphan rows. The interesting question is
what happens when the <i>parent</i> is deleted:</p>
<table class="mini">
<tr><th>ON DELETE …</th><th>Delete department 2 (Engineering) →</th></tr>
<tr><td>NO ACTION / RESTRICT (default)</td><td class="drop">Error: employees still reference it</td></tr>
<tr><td>CASCADE</td><td class="drop">All 11 Engineering employees are deleted too</td></tr>
<tr><td>SET NULL</td><td class="keep">Employees stay, their department_id becomes NULL</td></tr>
</table>
<p>Use CASCADE for rows that have no meaning without the parent (order_items of an order, addresses of a customer).
Use the default for important things (you don't want deleting a department to silently delete people).</p>

<h4>UNIQUE, and its NULL surprise</h4>
<p><code>email TEXT UNIQUE</code> blocks two equal emails, but <b>NULLs are not equal to each other</b>, so many rows can have
<code>NULL</code>. Usually that's what you want. When it isn't (e.g. <code>UNIQUE (tenant_id, handle)</code> where <code>tenant_id</code> can be NULL),
Postgres 15+ has <code>UNIQUE NULLS NOT DISTINCT (tenant_id, handle)</code>.</p>

<h4>CHECK, NOT NULL, DEFAULT</h4>
<pre><code>CREATE TABLE accounts (
  id      INT PRIMARY KEY,
  email   TEXT NOT NULL UNIQUE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance &gt;= 0),
  status  TEXT NOT NULL DEFAULT 'active'
          CONSTRAINT accounts_status_ok CHECK (status IN ('active','frozen','closed'))
);</code></pre>
<p>Naming a constraint (<code>CONSTRAINT name …</code>) gives you readable error messages and makes it easy to drop later.
Constraints can also be added to existing tables: <code>ALTER TABLE products ADD CONSTRAINT price_positive CHECK (price &gt; 0);</code>
(Postgres checks the existing rows first and refuses if any break the rule).</p>

<div class="callout trap"><b>Trap: CHECK passes on NULL.</b> A CHECK only fails when the condition is <i>false</i>; <code>NULL</code> (unknown) is
let through. <code>CHECK (end_date &gt;= start_date)</code> happily accepts <code>end_date = NULL</code>. That's handy for "ongoing" projects,
but if the value is required you also need <code>NOT NULL</code>.</div>`,
  example: {
    sql: `CREATE TABLE teams (id INT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE members (
  id      INT PRIMARY KEY,
  team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name    TEXT NOT NULL
);
INSERT INTO teams VALUES (1, 'Backend'), (2, 'Mobile');
INSERT INTO members VALUES (1, 1, 'Ali'), (2, 1, 'Sana'), (3, 2, 'Omar');

DELETE FROM teams WHERE id = 1;   -- cascades to Ali and Sana
SELECT * FROM members;`,
    note: 'Only Omar is left. Now try changing CASCADE to SET NULL (and drop NOT NULL), or remove the ON DELETE clause and see the error. Also try DELETE FROM departments WHERE id = 2;',
  },
  exercises: [
    {
      id: 'd22-e1', type: 'query',
      prompt: `Create table <code>accounts</code> that blocks bad data:
<ul>
<li><code>id</code> INT primary key</li>
<li><code>email</code> text, required, unique</li>
<li><code>balance</code> NUMERIC(12,2), required, default <code>0</code>, never negative</li>
<li><code>status</code> text, required, default <code>'active'</code>, only <code>'active'</code>, <code>'frozen'</code> or <code>'closed'</code></li>
</ul>The checker inserts a good row, then tries a duplicate email, a NULL email, a negative balance and a bad status.`,
      hint: 'Inline constraints: <code>UNIQUE</code>, <code>NOT NULL</code>, <code>DEFAULT 0</code>, <code>CHECK (balance &gt;= 0)</code>, <code>CHECK (status IN (…))</code>.',
      solution: `CREATE TABLE accounts (
  id      INT PRIMARY KEY,
  email   TEXT NOT NULL UNIQUE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed'))
);`,
      check: TRY + `INSERT INTO accounts (id, email) VALUES (1, 'a@x.com');
SELECT pg_temp.try_sql($q$INSERT INTO accounts (id, email) VALUES (2, 'a@x.com')$q$) AS dup_email,
       pg_temp.try_sql($q$INSERT INTO accounts (id, email) VALUES (3, NULL)$q$) AS null_email,
       pg_temp.try_sql($q$INSERT INTO accounts (id, email, balance) VALUES (4, 'b@x.com', -5)$q$) AS negative,
       pg_temp.try_sql($q$INSERT INTO accounts (id, email, status) VALUES (5, 'c@x.com', 'deleted')$q$) AS bad_status,
       pg_temp.try_sql($q$INSERT INTO accounts (id, email, status) VALUES (6, 'd@x.com', 'frozen')$q$) AS good_row,
       balance, status
FROM accounts WHERE id = 1`,
      alts: [`CREATE TABLE accounts (
  id INT,
  email TEXT NOT NULL,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  CONSTRAINT accounts_pk PRIMARY KEY (id),
  CONSTRAINT accounts_email_uq UNIQUE (email),
  CONSTRAINT accounts_balance_ok CHECK (balance >= 0),
  CONSTRAINT accounts_status_ok CHECK (status = 'active' OR status = 'frozen' OR status = 'closed')
);`],
      wrong: [{ sql: `CREATE TABLE accounts (id INT PRIMARY KEY, email TEXT NOT NULL UNIQUE, balance NUMERIC(12,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')));` }],
      why: 'Each rule lives in the schema, so every client (API, script, admin tool) gets the same protection. Inline constraints and named table-level constraints behave the same; named ones give clearer error messages.',
    },
    {
      id: 'd22-e2', type: 'query',
      prompt: 'Create <code>addresses</code> (<code>id</code> INT primary key, <code>customer_id</code> INT required, referencing <code>customers(id)</code>, <code>line1</code> text required). An address is useless without its customer, so <b>deleting a customer must delete their addresses</b>. The checker adds addresses for customers 25 and 26, tries one for customer 9999, then deletes customer 25.',
      hint: '<code>customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE</code>',
      solution: `CREATE TABLE addresses (
  id          INT PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  line1       TEXT NOT NULL
);`,
      check: TRY + `INSERT INTO addresses (id, customer_id, line1) VALUES (1, 25, 'House 1, Dubai'), (2, 26, 'Flat 2, London');
DELETE FROM customers WHERE id = 25;
SELECT pg_temp.try_sql($q$INSERT INTO addresses (id, customer_id, line1) VALUES (3, 9999, 'Nowhere')$q$) AS missing_customer,
       string_agg(customer_id::text, ',') AS remaining_customer_ids
FROM addresses`,
      alts: [`CREATE TABLE addresses (id INT PRIMARY KEY, customer_id INT NOT NULL, line1 TEXT NOT NULL,
  CONSTRAINT addresses_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE);`],
      wrong: [{ sql: `CREATE TABLE addresses (id INT PRIMARY KEY, customer_id INT NOT NULL REFERENCES customers(id), line1 TEXT NOT NULL);` }],
      why: 'With the default (NO ACTION) the DELETE of customer 25 fails with "violates foreign key constraint". With CASCADE, address 1 disappears together with its customer, and the foreign key still blocks addresses for customer 9999 that doesn\'t exist.',
    },
    {
      id: 'd22-e3', type: 'query',
      prompt: 'HR is being shut down, but its people stay with the company. Replace the foreign key <code>employees_department_id_fkey</code> on <code>employees</code> so that deleting a department sets its employees\' <code>department_id</code> to <code>NULL</code>. The checker deletes HR\'s project, then department 7, and shows employees 28 and 29.',
      hint: '<code>ALTER TABLE employees DROP CONSTRAINT employees_department_id_fkey;</code> then <code>ALTER TABLE employees ADD FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;</code>',
      solution: `ALTER TABLE employees DROP CONSTRAINT employees_department_id_fkey;
ALTER TABLE employees ADD CONSTRAINT employees_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;`,
      check: `DELETE FROM projects WHERE department_id = 7;
DELETE FROM departments WHERE id = 7;
SELECT id, first_name, department_id FROM employees WHERE id IN (28, 29) ORDER BY id`,
      ordered: true,
      alts: [`ALTER TABLE employees
  DROP CONSTRAINT employees_department_id_fkey,
  ADD CONSTRAINT emp_dept_fk FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL;`],
      wrong: [{ sql: `ALTER TABLE employees DROP CONSTRAINT employees_department_id_fkey;
ALTER TABLE employees ADD FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;` }],
      why: 'Postgres cannot edit a foreign key\'s ON DELETE rule in place, so you drop it and add it again (in one ALTER, it\'s a single atomic change). With CASCADE, Tariq and Saima would have been deleted along with HR, which is the bug you want to avoid.',
    },
    {
      id: 'd22-e4', type: 'query',
      prompt: 'Create <code>course_enrollments</code> with <code>student_id</code> INT, <code>course_id</code> INT and <code>enrolled_on</code> DATE (required, defaults to today). A student may enroll in many courses, but <b>only once per course</b>. Use a <b>composite primary key</b> (no separate id column). The checker inserts with <code>(student_id, course_id)</code> only.',
      hint: '<code>PRIMARY KEY (student_id, course_id)</code> at the end of the column list. Default today: <code>DEFAULT CURRENT_DATE</code>.',
      solution: `CREATE TABLE course_enrollments (
  student_id  INT,
  course_id   INT,
  enrolled_on DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (student_id, course_id)
);`,
      check: TRY + `INSERT INTO course_enrollments (student_id, course_id) VALUES (1, 1);
SELECT pg_temp.try_sql($q$INSERT INTO course_enrollments (student_id, course_id) VALUES (1, 1)$q$) AS same_course_twice,
       pg_temp.try_sql($q$INSERT INTO course_enrollments (student_id, course_id) VALUES (1, 2)$q$) AS second_course,
       pg_temp.try_sql($q$INSERT INTO course_enrollments (student_id, course_id) VALUES (NULL, 3)$q$) AS null_student,
       (SELECT count(*) FROM pg_constraint WHERE conrelid = 'course_enrollments'::regclass AND contype = 'p') AS primary_keys,
       enrolled_on = CURRENT_DATE AS defaulted
FROM course_enrollments`,
      alts: [`CREATE TABLE course_enrollments (student_id int NOT NULL, course_id int NOT NULL, enrolled_on date DEFAULT current_date NOT NULL, CONSTRAINT course_enrollments_pk PRIMARY KEY (student_id, course_id));`],
      wrong: [{ sql: `CREATE TABLE course_enrollments (id SERIAL PRIMARY KEY, student_id INT, course_id INT, enrolled_on DATE NOT NULL DEFAULT CURRENT_DATE);` }],
      why: 'The pair (student_id, course_id) is the identity of an enrollment, so it is the key. A surrogate <code>id SERIAL</code> alone lets the same enrollment be inserted twice (you would need an extra <code>UNIQUE (student_id, course_id)</code>). PRIMARY KEY also makes both columns NOT NULL automatically.',
    },
    {
      id: 'd22-e5', type: 'query',
      prompt: 'Add a rule to <code>projects</code>: <code>end_date</code> can never be <b>before</b> <code>start_date</code> (same day is fine, and NULL still means "ongoing"). Name it <code>projects_dates_ok</code>. The checker tries to break it.',
      hint: '<code>ALTER TABLE projects ADD CONSTRAINT projects_dates_ok CHECK (…);</code>. Remember that CHECK lets NULL through on its own.',
      solution: `ALTER TABLE projects ADD CONSTRAINT projects_dates_ok CHECK (end_date >= start_date);`,
      check: TRY + `SELECT pg_temp.try_sql($q$UPDATE projects SET end_date = '2023-01-01' WHERE id = 1$q$) AS end_before_start,
       pg_temp.try_sql($q$UPDATE projects SET end_date = start_date WHERE id = 2$q$) AS same_day,
       pg_temp.try_sql($q$INSERT INTO projects (id, name, department_id, start_date) VALUES (7, 'New thing', 2, '2025-06-01')$q$) AS ongoing,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'projects_dates_ok') AS named_ok`,
      alts: [`ALTER TABLE projects ADD CONSTRAINT projects_dates_ok CHECK (end_date IS NULL OR end_date >= start_date);`],
      wrong: [{ sql: `ALTER TABLE projects ADD CONSTRAINT projects_dates_ok CHECK (end_date > start_date);` }],
      why: 'Because CHECK only rejects <i>false</i>, <code>end_date &gt;= start_date</code> already accepts NULL end dates; adding <code>end_date IS NULL OR</code> just says so explicitly. Using <code>&gt;</code> would wrongly reject one-day projects.',
    },
    {
      id: 'd22-e6', type: 'query',
      prompt: 'Create <code>user_handles</code> (<code>id</code> INT primary key, <code>tenant_id</code> INT <b>nullable</b>, <code>handle</code> text required). A handle must be unique per tenant, and rows with <code>tenant_id</code> NULL (global users) must <b>also</b> not share a handle. The checker inserts <code>(1, NULL, \'ali\')</code> then tries <code>(2, NULL, \'ali\')</code>.',
      hint: 'A plain <code>UNIQUE (tenant_id, handle)</code> treats NULLs as different. Postgres 15+: <code>UNIQUE NULLS NOT DISTINCT (tenant_id, handle)</code>.',
      solution: `CREATE TABLE user_handles (
  id        INT PRIMARY KEY,
  tenant_id INT,
  handle    TEXT NOT NULL,
  UNIQUE NULLS NOT DISTINCT (tenant_id, handle)
);`,
      check: TRY + `INSERT INTO user_handles (id, tenant_id, handle) VALUES (1, NULL, 'ali');
SELECT pg_temp.try_sql($q$INSERT INTO user_handles (id, tenant_id, handle) VALUES (2, NULL, 'ali')$q$) AS global_dup,
       pg_temp.try_sql($q$INSERT INTO user_handles (id, tenant_id, handle) VALUES (3, 1, 'ali')$q$) AS tenant_1_ali,
       pg_temp.try_sql($q$INSERT INTO user_handles (id, tenant_id, handle) VALUES (4, NULL, 'sana')$q$) AS global_sana`,
      alts: [`CREATE TABLE user_handles (id INT PRIMARY KEY, tenant_id INT, handle TEXT NOT NULL);
CREATE UNIQUE INDEX user_handles_uq ON user_handles (tenant_id, handle) NULLS NOT DISTINCT;`],
      wrong: [{ sql: `CREATE TABLE user_handles (id INT PRIMARY KEY, tenant_id INT, handle TEXT NOT NULL, UNIQUE (tenant_id, handle));` }],
      why: 'With plain UNIQUE, <code>(NULL, \'ali\')</code> and <code>(NULL, \'ali\')</code> are not considered equal (NULL = NULL is unknown), so the duplicate gets in. NULLS NOT DISTINCT makes NULLs compare as equal for this constraint only.',
    },
    {
      id: 'd22-q1', type: 'quiz',
      prompt: 'A teammate proposes <code>users.email</code> as the primary key, with <code>orders.user_email</code> referencing it. What is the main problem?',
      options: [
        'Text primary keys are not allowed in Postgres',
        'When a user changes their email, every referencing row in every table must change too',
        'Emails cannot be UNIQUE',
        'Foreign keys only work on INT columns',
      ],
      answer: 1,
      why: 'Natural keys that can change spread that change everywhere. Use a stable surrogate id as the primary key and keep <code>email</code> as <code>UNIQUE NOT NULL</code>: you still get "no duplicate emails" without the pain.',
    },
  ],
  leetcode: [],
  ownIt: 'Pick three tables from a project you worked on. For each foreign key, say whether it should be CASCADE, SET NULL or RESTRICT, and why.',
};
