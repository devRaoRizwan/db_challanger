const COLS = (t) => `SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = '${t}'
ORDER BY ordinal_position`;

export default {
  day: 21,
  phase: 3,
  title: 'DDL & choosing data types',
  goal: 'Create and change tables yourself, and pick the right type for every column without guessing.',
  learn: `
<p>Until now you only <i>read</i> tables. Today you build them. The commands that define structure are called
<b>DDL</b> (Data Definition Language): <code>CREATE</code>, <code>ALTER</code>, <code>DROP</code>. Your ORM migrations
generate exactly these statements, so knowing them is how you review a migration instead of trusting it blindly.</p>

<pre><code>CREATE TABLE coupons (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         TEXT NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL,      -- up to 999.99
  is_active    BOOLEAN NOT NULL DEFAULT true,
  expires_at   TIMESTAMPTZ                  -- NULL = never expires
);</code></pre>
<p>Each line is <b>name, type, rules</b>. The type is a promise: Postgres will reject <code>'abc'</code> in a number
column, so bad data is stopped at the door instead of crashing your API later.</p>

<h4>The types you'll actually use</h4>
<table class="mini">
<tr><th>Data</th><th>Use</th><th>Avoid</th></tr>
<tr><td>Counts, ids</td><td class="keep">INT (±2.1 billion), BIGINT for ids that grow forever</td><td></td></tr>
<tr><td>Money</td><td class="keep">NUMERIC(12,2)</td><td class="drop">REAL / DOUBLE PRECISION</td></tr>
<tr><td>Text</td><td class="keep">TEXT (or VARCHAR(n) if a max length is a real business rule)</td><td class="drop">CHAR(n)</td></tr>
<tr><td>Yes/no</td><td class="keep">BOOLEAN</td><td class="drop">INT 0/1, 'Y'/'N'</td></tr>
<tr><td>Birthday, due date</td><td class="keep">DATE</td><td></td></tr>
<tr><td>Something that happened</td><td class="keep">TIMESTAMPTZ</td><td class="drop">TIMESTAMP (no time zone)</td></tr>
<tr><td>Public / distributed ids</td><td class="keep">UUID</td><td></td></tr>
</table>

<h4>Why never FLOAT for money</h4>
<p>Floats are stored in binary, and most decimal fractions can't be represented exactly.
<code>0.1::float8 + 0.2::float8</code> gives <code>0.30000000000000004</code>, so <code>= 0.3</code> is <b>false</b>.
<code>NUMERIC</code> stores exact decimal digits: <code>0.1 + 0.2 = 0.3</code> is true. Add up a million float prices and
your invoice is off by cents that accountants <i>will</i> find.</p>

<h4>TEXT vs VARCHAR(n)</h4>
<p>In Postgres they are stored the same way and are equally fast. <code>VARCHAR(255)</code> is a habit from MySQL; it only adds a
length check. Use <code>TEXT</code> unless the limit is a real rule (a 2-letter country code, a 20-char username).</p>

<h4>TIMESTAMP vs TIMESTAMPTZ</h4>
<p><code>TIMESTAMPTZ</code> stores an exact instant (internally UTC) and converts to the session's time zone when shown.
<code>TIMESTAMP</code> stores "wall clock" digits with no zone: <code>2025-03-01 10:00</code>... in Karachi or in London?
Nobody knows anymore. <b>For events (created_at, paid_at, logged_in_at) always use TIMESTAMPTZ.</b></p>

<h4>Ids: IDENTITY vs SERIAL vs UUID</h4>
<ul>
<li><code>GENERATED ALWAYS AS IDENTITY</code>: the modern, SQL-standard auto-increment. <code>ALWAYS</code> stops code from inserting its own ids by accident.</li>
<li><code>SERIAL</code>: the old Postgres shortcut (an INT + a sequence). Still works, but prefer identity in new tables.</li>
<li><code>UUID DEFAULT gen_random_uuid()</code>: ids that can be generated anywhere and don't reveal "we have 1,204 users". Bigger (16 bytes) and random, which makes indexes a bit slower.</li>
</ul>

<h4>Changing tables later</h4>
<pre><code>ALTER TABLE products ADD COLUMN weight_kg NUMERIC(6,3);
ALTER TABLE products RENAME COLUMN stock TO stock_qty;
ALTER TABLE products ALTER COLUMN name TYPE VARCHAR(120);
ALTER TABLE products DROP COLUMN weight_kg;
DROP TABLE IF EXISTS coupons;</code></pre>

<div class="callout trap"><b>Trap:</b> <code>ALTER TABLE customers ADD COLUMN created_at TIMESTAMPTZ NOT NULL</code> fails on a table
that already has rows: what value should existing rows get? Give it a <code>DEFAULT</code> (e.g. <code>DEFAULT now()</code>) and
Postgres fills the old rows for you.</div>

<div class="callout"><b>JSONB teaser:</b> Postgres also has a <code>JSONB</code> type for semi-structured data
(<code>'{"color": "black"}'</code>). It's powerful, and easy to abuse. Day 27 covers when it's a good fit.</div>`,
  example: {
    sql: `SET LOCAL TIME ZONE 'UTC';
SELECT 0.1::float8 + 0.2::float8          AS float_sum,
       0.1::float8 + 0.2::float8 = 0.3    AS float_equals,
       0.1::numeric + 0.2::numeric        AS numeric_sum,
       0.1::numeric + 0.2::numeric = 0.3  AS numeric_equals,
       '2025-03-01 10:00:00+05'::timestamptz::text AS stored_as_instant,
       '2025-03-01 10:00:00+05'::timestamp::text   AS zone_thrown_away;`,
    note: 'Look at float_equals: false. The timestamptz value was converted to the same instant shown in the session time zone, set to UTC on the first line (05:00+00), while the plain timestamp silently dropped the +05 and kept 10:00 with no zone. Then try: CREATE TABLE t (id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, price NUMERIC(10,2)); INSERT INTO t (price) VALUES (9.999); SELECT * FROM t; (everything is rolled back afterwards).',
  },
  exercises: [
    {
      id: 'd21-e1', type: 'query',
      prompt: `Create a table <code>coupons</code> with these columns, in this order:
<ul>
<li><code>id</code>: BIGINT, auto-generated with <code>GENERATED ALWAYS AS IDENTITY</code>, primary key</li>
<li><code>code</code>: text, required</li>
<li><code>discount_pct</code>: exact decimal <code>NUMERIC(5,2)</code>, required</li>
<li><code>is_active</code>: boolean, required, defaults to <code>true</code></li>
<li><code>expires_at</code>: a moment in time with time zone, optional</li>
</ul>The checker inspects the table's structure.`,
      hint: 'Copy the shape from the lesson. "Required" means <code>NOT NULL</code>; "a moment in time with time zone" is <code>TIMESTAMPTZ</code>.',
      solution: `CREATE TABLE coupons (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         TEXT NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  expires_at   TIMESTAMPTZ
);`,
      check: `SELECT column_name, data_type, is_nullable, is_identity, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'coupons'
ORDER BY ordinal_position`,
      ordered: true,
      alts: [
        `create table coupons (id bigint generated always as identity, code text not null, discount_pct numeric(5,2) not null, is_active boolean not null default true, expires_at timestamp with time zone, primary key (id));`,
      ],
      wrong: [
        { sql: `CREATE TABLE coupons (id SERIAL PRIMARY KEY, code TEXT NOT NULL, discount_pct NUMERIC(5,2) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true, expires_at TIMESTAMPTZ);` },
        { sql: `CREATE TABLE coupons (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, code TEXT NOT NULL, discount_pct FLOAT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true, expires_at TIMESTAMP);` },
      ],
      why: '<code>TIMESTAMPTZ</code> is short for <code>TIMESTAMP WITH TIME ZONE</code>, so both spellings pass. <code>SERIAL</code> would create an INT column without the identity flag, and FLOAT would bring rounding errors into discounts.',
    },
    {
      id: 'd21-e2', type: 'query',
      prompt: 'The warehouse team wants two changes to <code>products</code>: rename <code>stock</code> to <code>stock_qty</code>, and add a new optional column <code>weight_kg</code> of type <code>NUMERIC(6,3)</code> (grams precision). The checker lists the columns of <code>products</code>.',
      hint: 'Two statements: <code>ALTER TABLE products RENAME COLUMN … TO …;</code> and <code>ALTER TABLE products ADD COLUMN …;</code>',
      solution: `ALTER TABLE products RENAME COLUMN stock TO stock_qty;
ALTER TABLE products ADD COLUMN weight_kg NUMERIC(6,3);`,
      check: COLS('products'),
      ordered: true,
      alts: [`ALTER TABLE products ADD COLUMN weight_kg numeric(6,3);
ALTER TABLE products RENAME stock TO stock_qty;`],
      wrong: [{ sql: `ALTER TABLE products ADD COLUMN stock_qty INT; ALTER TABLE products ADD COLUMN weight_kg NUMERIC(6,3);` }],
      why: 'RENAME keeps the data and just changes the name. Adding a brand-new <code>stock_qty</code> column would leave the old one in place and the new one empty. In a real deploy, renaming a column breaks old app code still reading <code>stock</code>, which is why teams often add-copy-drop in steps (Day 36).',
    },
    {
      id: 'd21-e3', type: 'query',
      prompt: 'Add a column <code>created_at</code> to <code>customers</code>: a time-zone-aware timestamp that is <b>NOT NULL</b> and defaults to the current time. The table already has 28 rows, so they must get a value too.',
      hint: '<code>ALTER TABLE customers ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();</code>. Try it without the DEFAULT first to see the error.',
      solution: `ALTER TABLE customers ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();`,
      check: `SELECT data_type, is_nullable,
       (SELECT count(*) FROM customers WHERE created_at IS NULL) AS rows_without_value
FROM information_schema.columns
WHERE table_name = 'customers' AND column_name = 'created_at'`,
      alts: [`ALTER TABLE customers ADD COLUMN created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL;`],
      wrong: [
        { sql: `ALTER TABLE customers ADD COLUMN created_at TIMESTAMPTZ NOT NULL;` },
        { sql: `ALTER TABLE customers ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT now();` },
      ],
      why: 'Without a default Postgres refuses ("column contains null values") because the 28 existing rows would break the NOT NULL rule. With <code>DEFAULT now()</code> every existing row gets the current time. Note that the default is the migration time, not the real signup time, so you would backfill it from <code>signup_date</code> in a real project.',
    },
    {
      id: 'd21-e4', type: 'query',
      prompt: 'Clean up <code>employees</code>: <b>drop</b> the <code>bonus</code> column, and change <code>city</code> to <code>VARCHAR(60)</code>. The checker lists every column with its type and max length.',
      hint: '<code>ALTER TABLE employees DROP COLUMN …</code> and <code>ALTER TABLE employees ALTER COLUMN city TYPE VARCHAR(60)</code>. One ALTER can also hold both, separated by a comma.',
      solution: `ALTER TABLE employees DROP COLUMN bonus;
ALTER TABLE employees ALTER COLUMN city TYPE VARCHAR(60);`,
      check: `SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'employees'
ORDER BY ordinal_position`,
      ordered: true,
      alts: [`ALTER TABLE employees DROP COLUMN bonus, ALTER COLUMN city TYPE varchar(60);`],
      wrong: [{ sql: `ALTER TABLE employees ALTER COLUMN city TYPE VARCHAR(60);` }],
      why: 'DROP COLUMN deletes the data in it for good (outside a transaction there is no undo). ALTER COLUMN … TYPE rewrites every value; if one city were longer than 60 characters, the whole statement would fail.',
    },
    {
      id: 'd21-e5', type: 'query',
      prompt: `Create a table <code>events</code> with:
<ul>
<li><code>id</code>: UUID primary key, defaulting to <code>gen_random_uuid()</code></li>
<li><code>name</code>: text, required</li>
<li><code>happened_at</code>: TIMESTAMPTZ, required, defaults to now</li>
<li><code>payload</code>: JSONB, optional</li>
</ul>The checker inserts <code>INSERT INTO events (name) VALUES ('signup')</code> and checks that the defaults filled in the rest.`,
      hint: '<code>id UUID PRIMARY KEY DEFAULT gen_random_uuid()</code>',
      solution: `CREATE TABLE events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload     JSONB
);`,
      check: `INSERT INTO events (name) VALUES ('signup');
SELECT (SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ', ' ORDER BY ordinal_position)
        FROM information_schema.columns WHERE table_name = 'events') AS structure,
       name, id IS NOT NULL AS has_id, happened_at IS NOT NULL AS has_time, payload IS NULL AS no_payload
FROM events`,
      alts: [`CREATE TABLE events (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, name text NOT NULL, happened_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, payload jsonb);`],
      wrong: [{ sql: `CREATE TABLE events (id UUID PRIMARY KEY, name TEXT NOT NULL, happened_at TIMESTAMPTZ NOT NULL DEFAULT now(), payload JSONB);` }],
      why: 'Without the DEFAULT, inserting only a name fails because the primary key cannot be NULL. Defaults let the app send only what it knows, and the database fills in ids and timestamps the same way every time.',
    },
    {
      id: 'd21-q1', type: 'quiz',
      prompt: 'You store <code>paid_at</code> for payments from users in Pakistan, the UK and Canada. Which type?',
      options: ['DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'TEXT in ISO format'],
      answer: 2,
      why: 'TIMESTAMPTZ stores an absolute instant, so "10:00 in Karachi" and "05:00 in London" compare correctly. TIMESTAMP loses the zone, DATE loses the time, and TEXT loses sorting, validation and date math.',
    },
    {
      id: 'd21-q2', type: 'quiz',
      prompt: 'In Postgres, what is the real difference between <code>TEXT</code> and <code>VARCHAR(255)</code>?',
      options: ['VARCHAR is faster to search', 'TEXT uses more disk space', 'Only the length check: VARCHAR(255) rejects longer values', 'TEXT cannot be indexed'],
      answer: 2,
      why: 'Both use the same storage and speed in Postgres. VARCHAR(n) only adds a length limit, so use it when the limit is a real business rule, not out of habit.',
    },
  ],
  leetcode: [],
  ownIt: 'Explain to a teammate why <code>price FLOAT</code> and <code>created_at TIMESTAMP</code> are both bugs waiting to happen, and what you would write instead.',
};
