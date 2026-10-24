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
const STRUCTURE = (t) => `(SELECT string_agg(column_name || ' ' || data_type || CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END, ', ' ORDER BY ordinal_position)
        FROM information_schema.columns WHERE table_name = '${t}')`;

export default {
  day: 26,
  phase: 3,
  title: 'Design workshop: schema from requirements',
  goal: 'Turn a written product spec into tables, keys and constraints, including soft deletes, audit columns and multi-tenancy.',
  setup: `
CREATE TABLE organizations (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO organizations (name, slug) VALUES ('Acme Corp', 'acme'), ('Globex', 'globex'), ('Initech', 'initech');

CREATE TABLE plans (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  price_monthly NUMERIC(10,2) NOT NULL CHECK (price_monthly >= 0),
  is_active     BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO plans (code, name, price_monthly, is_active) VALUES
  ('free', 'Free', 0, true), ('pro', 'Pro', 29, true), ('business', 'Business', 99, true), ('legacy', 'Legacy Pro', 19, false);

CREATE TABLE team_members (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  email           TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
INSERT INTO team_members (organization_id, email, role, deleted_at) VALUES
  (1, 'ali@acme.com',     'owner',  NULL),
  (1, 'sana@acme.com',    'admin',  NULL),
  (1, 'omar@acme.com',    'member', '2025-03-01 09:00+05'),
  (1, 'omar@acme.com',    'member', NULL),
  (2, 'ali@acme.com',     'member', NULL),
  (2, 'hira@globex.com',  'owner',  NULL),
  (3, 'zara@initech.com', 'owner',  '2025-04-01 12:00+05');
`,
  learn: `
<p>At work nobody hands you tables. You get a ticket. Today's ticket, for a small SaaS called <b>TaskFlow</b>:</p>
<div class="callout"><i>"Companies (organizations) sign up and get a unique URL slug. They invite team members by email; each member is an owner,
admin or member, and members can be removed and re-invited later. An organization subscribes to a plan (Free, Pro, Business), with
statuses trialing, active, past_due or canceled; only one subscription can be live at a time. Each organization creates boards;
board names must be unique inside the organization."</i></div>

<h4>Step 1: nouns become entities</h4>
<p>organization, team member, plan, subscription, board. Words like "status" or "role" are <i>attributes</i>, not tables (yet).</p>

<h4>Step 2: relationships</h4>
<pre><code>organizations 1──N team_members
organizations 1──N subscriptions N──1 plans
organizations 1──N boards</code></pre>

<h4>Step 3: keys</h4>
<p>Surrogate <code>BIGINT GENERATED ALWAYS AS IDENTITY</code> ids everywhere; natural "business keys" (slug, plan code) become <code>UNIQUE</code>.</p>

<h4>Step 4: constraints from the sentences</h4>
<table class="mini">
<tr><th>Requirement says</th><th>Schema says</th></tr>
<tr><td>"unique URL slug"</td><td>slug TEXT NOT NULL UNIQUE</td></tr>
<tr><td>"owner, admin or member"</td><td>CHECK (role IN (…))</td></tr>
<tr><td>"names unique inside the organization"</td><td>UNIQUE (organization_id, name)</td></tr>
<tr><td>"removed and re-invited"</td><td>soft delete + partial unique index</td></tr>
<tr><td>"only one live subscription"</td><td>partial unique index WHERE status &lt;&gt; 'canceled'</td></tr>
</table>

<h4>Step 5: note the indexes to come</h4>
<p>Every FK column you'll filter by (<code>organization_id</code>!) will need an index. Day 28 covers that; for now just list them.</p>

<h4>Soft deletes and their gotcha</h4>
<p>Instead of <code>DELETE</code>, set <code>deleted_at = now()</code>. You keep history and can undo. The cost: <b>every query</b> must add
<code>WHERE deleted_at IS NULL</code>, and plain <code>UNIQUE (organization_id, email)</code> now blocks re-inviting Omar, because his old deleted row
still holds the email. The fix is a <b>partial unique index</b> that only covers live rows:</p>
<pre><code>CREATE UNIQUE INDEX team_members_live_email_uq
  ON team_members (organization_id, email)
  WHERE deleted_at IS NULL;</code></pre>

<h4>Audit columns</h4>
<p><code>created_at TIMESTAMPTZ NOT NULL DEFAULT now()</code> on every table, and <code>updated_at</code> too. A default only fills
<code>updated_at</code> on insert; keeping it fresh on update needs the app (ORMs do it) or a trigger.</p>

<h4>Enum vs lookup table vs CHECK</h4>
<ul>
<li><b>CHECK (status IN (…))</b>: simple, easy to change with a migration. Great for short fixed lists.</li>
<li><b>Lookup table</b> (<code>plans</code>): when values have their own data (price, name) or change without a deploy.</li>
<li><b>CREATE TYPE … AS ENUM</b>: compact and typed, but removing or renaming a value is painful. Use sparingly.</li>
</ul>

<h4>Multi-tenancy</h4>
<p>In a shared-database SaaS, every tenant-owned row carries <code>organization_id</code> (a.k.a. <code>tenant_id</code>), and every query filters on it.
Uniqueness becomes per tenant: <code>UNIQUE (organization_id, name)</code>, not <code>UNIQUE (name)</code>.</p>

<div class="callout trap"><b>Trap:</b> one forgotten <code>WHERE organization_id = $1</code> shows Acme's data to Globex. That's a data-leak incident, not a bug.
Put <code>organization_id</code> on every tenant table (even when it could be reached through a join), so filtering is always one condition. Postgres Row-Level Security can enforce it for you.</div>`,
  example: {
    sql: `-- Omar was removed, then re-invited. Who is live in each org?
SELECT o.name AS org, m.email, m.role,
       CASE WHEN m.deleted_at IS NULL THEN 'live' ELSE 'removed' END AS state
FROM organizations o
JOIN team_members m ON m.organization_id = o.id
ORDER BY o.id, m.email, m.deleted_at NULLS FIRST;`,
    note: 'Notice omar@acme.com twice (one removed, one live) and ali@acme.com in two different orgs. Both are legal, and your constraints must allow them while still blocking real duplicates.',
  },
  exercises: [
    {
      id: 'd26-e1', type: 'query',
      prompt: `Create <code>subscriptions</code> from the spec, columns in this order:
<ul>
<li><code>id</code>: BIGINT, <code>GENERATED ALWAYS AS IDENTITY</code>, primary key</li>
<li><code>organization_id</code>: BIGINT, required, references <code>organizations(id)</code></li>
<li><code>plan_id</code>: BIGINT, required, references <code>plans(id)</code></li>
<li><code>status</code>: TEXT, required, default <code>'trialing'</code>, one of <code>trialing, active, past_due, canceled</code></li>
<li><code>started_at</code>: TIMESTAMPTZ, required, default now</li>
<li><code>canceled_at</code>: TIMESTAMPTZ, optional</li>
</ul>The checker inspects the columns and tries bad rows.`,
      hint: 'Two foreign keys, one CHECK with IN, two DEFAULTs. Every timestamp is TIMESTAMPTZ.',
      solution: `CREATE TABLE subscriptions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  plan_id         BIGINT NOT NULL REFERENCES plans(id),
  status          TEXT NOT NULL DEFAULT 'trialing'
                  CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  canceled_at     TIMESTAMPTZ
);`,
      check: TRY + `INSERT INTO subscriptions (organization_id, plan_id) VALUES (1, 2);
SELECT ${STRUCTURE('subscriptions')} AS structure,
       pg_temp.try_sql($q$INSERT INTO subscriptions (organization_id, plan_id) VALUES (99, 2)$q$) AS missing_org,
       pg_temp.try_sql($q$INSERT INTO subscriptions (organization_id, plan_id) VALUES (1, 99)$q$) AS missing_plan,
       pg_temp.try_sql($q$INSERT INTO subscriptions (organization_id, plan_id, status) VALUES (1, 2, 'paused')$q$) AS bad_status,
       pg_temp.try_sql($q$INSERT INTO subscriptions (organization_id, plan_id, status) VALUES (2, 3, 'past_due')$q$) AS good_row,
       (SELECT status FROM subscriptions LIMIT 1) AS default_status`,
      alts: [`CREATE TABLE subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY,
  organization_id bigint NOT NULL,
  plan_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'trialing',
  started_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  canceled_at timestamp with time zone,
  CONSTRAINT subscriptions_pk PRIMARY KEY (id),
  CONSTRAINT subscriptions_org_fk FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT subscriptions_plan_fk FOREIGN KEY (plan_id) REFERENCES plans (id),
  CONSTRAINT subscriptions_status_ok CHECK (status IN ('trialing', 'active', 'past_due', 'canceled'))
);`],
      wrong: [
        { sql: `CREATE TABLE subscriptions (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id BIGINT NOT NULL, plan_id BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'trialing', started_at TIMESTAMPTZ NOT NULL DEFAULT now(), canceled_at TIMESTAMPTZ);` },
        { sql: `CREATE TABLE subscriptions (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id BIGINT NOT NULL REFERENCES organizations(id), plan_id BIGINT NOT NULL REFERENCES plans(id), status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','canceled')), started_at TIMESTAMP NOT NULL DEFAULT now(), canceled_at TIMESTAMP);` },
      ],
      why: 'Each sentence of the spec became a constraint, so the table refuses subscriptions to plans or organizations that don\'t exist and statuses nobody defined. <code>plans</code> is a lookup table (it has a price), while <code>status</code> is a short fixed list, so a CHECK is enough.',
    },
    {
      id: 'd26-e2', type: 'query',
      prompt: '"Members can be removed and re-invited." <code>team_members</code> uses soft deletes (<code>deleted_at</code>). Create a unique index named <code>team_members_live_email_uq</code> so that an email is unique per organization <b>among live members only</b>. (Try a plain <code>UNIQUE (organization_id, email)</code> first and read the error.)',
      hint: '<code>CREATE UNIQUE INDEX team_members_live_email_uq ON team_members (organization_id, email) WHERE deleted_at IS NULL;</code>',
      solution: `CREATE UNIQUE INDEX team_members_live_email_uq
  ON team_members (organization_id, email)
  WHERE deleted_at IS NULL;`,
      check: TRY + `SELECT pg_temp.try_sql($q$INSERT INTO team_members (organization_id, email, role) VALUES (1, 'ali@acme.com', 'member')$q$) AS dup_live_ali,
       pg_temp.try_sql($q$INSERT INTO team_members (organization_id, email, role) VALUES (1, 'omar@acme.com', 'admin')$q$) AS dup_live_omar,
       pg_temp.try_sql($q$INSERT INTO team_members (organization_id, email, role) VALUES (3, 'zara@initech.com', 'owner')$q$) AS reinvite_zara,
       pg_temp.try_sql($q$INSERT INTO team_members (organization_id, email, role) VALUES (3, 'ali@acme.com', 'member')$q$) AS ali_in_initech,
       pg_temp.try_sql($q$UPDATE team_members SET deleted_at = now() WHERE id = 4$q$) AS remove_omar_again,
       (SELECT count(*) FROM pg_indexes WHERE indexname = 'team_members_live_email_uq') AS index_exists`,
      wrong: [
        { sql: `ALTER TABLE team_members ADD CONSTRAINT team_members_email_uq UNIQUE (organization_id, email);` },
        { sql: `CREATE UNIQUE INDEX team_members_live_email_uq ON team_members (email) WHERE deleted_at IS NULL;` },
        { sql: `CREATE INDEX team_members_live_email_uq ON team_members (organization_id, email) WHERE deleted_at IS NULL;` },
      ],
      why: 'A plain UNIQUE fails right away because Omar\'s removed row and his live row share an email. The partial index ignores deleted rows, so Zara can be re-invited while two <i>live</i> Alis in Acme are blocked. Leaving out <code>organization_id</code> would wrongly stop Ali from belonging to two companies.',
    },
    {
      id: 'd26-e3', type: 'query',
      prompt: `Create <code>boards</code>, columns in this order:
<ul>
<li><code>id</code>: BIGINT identity primary key</li>
<li><code>organization_id</code>: BIGINT, required, references <code>organizations(id)</code></li>
<li><code>name</code>: TEXT, required, <b>unique within its organization</b></li>
<li><code>created_at</code> and <code>updated_at</code>: TIMESTAMPTZ, required, default now</li>
</ul>The checker tries the same board name in the same org and in a different org.`,
      hint: 'Add <code>UNIQUE (organization_id, name)</code> as a table constraint at the end.',
      solution: `CREATE TABLE boards (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);`,
      check: TRY + `INSERT INTO boards (organization_id, name) VALUES (1, 'Roadmap');
SELECT ${STRUCTURE('boards')} AS structure,
       pg_temp.try_sql($q$INSERT INTO boards (organization_id, name) VALUES (1, 'Roadmap')$q$) AS same_org_same_name,
       pg_temp.try_sql($q$INSERT INTO boards (organization_id, name) VALUES (2, 'Roadmap')$q$) AS other_org_same_name,
       pg_temp.try_sql($q$INSERT INTO boards (organization_id, name) VALUES (NULL, 'Orphan')$q$) AS no_org,
       pg_temp.try_sql($q$INSERT INTO boards (organization_id, name) VALUES (42, 'Ghost')$q$) AS missing_org`,
      alts: [`CREATE TABLE boards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT boards_org_name_uq UNIQUE (organization_id, name)
);`],
      wrong: [{ sql: `CREATE TABLE boards (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id BIGINT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());` }],
      why: 'In a multi-tenant app uniqueness is almost always <i>per tenant</i>. A global <code>UNIQUE (name)</code> would stop Globex from creating "Roadmap" just because Acme has one, and even leaks that the name exists. Bonus: the composite unique index also speeds up "boards of org X" queries.',
    },
    {
      id: 'd26-e4', type: 'query',
      prompt: 'For the admin dashboard, show <b>every</b> organization\'s <code>name</code> and its number of <b>live</b> members (not soft-deleted). Organizations with no live members must show 0.',
      hint: 'Put <code>m.deleted_at IS NULL</code> in the <b>ON</b> of the LEFT JOIN, not in WHERE (the Day 7 trap!). Count <code>m.id</code>.',
      solution: `SELECT o.name, COUNT(m.id) AS live_members
FROM organizations o
LEFT JOIN team_members m
  ON m.organization_id = o.id
 AND m.deleted_at IS NULL
GROUP BY o.id, o.name;`,
      alts: [`SELECT o.name, (SELECT count(*) FROM team_members m WHERE m.organization_id = o.id AND m.deleted_at IS NULL) FROM organizations o;`],
      wrong: [
        { sql: `SELECT o.name, COUNT(m.id) FROM organizations o LEFT JOIN team_members m ON m.organization_id = o.id WHERE m.deleted_at IS NULL GROUP BY o.id, o.name;` },
        { sql: `SELECT o.name, COUNT(m.id) FROM organizations o LEFT JOIN team_members m ON m.organization_id = o.id GROUP BY o.id, o.name;` },
      ],
      why: 'Acme 3, Globex 2, Initech 0. Filtering in WHERE throws away Initech\'s NULL row, so it vanishes. Forgetting the filter counts Omar\'s removed copy and Zara: the everyday soft-delete bug. Many teams add a view such as <code>live_team_members</code> so nobody has to remember.',
    },
    {
      id: 'd26-q1', type: 'quiz',
      prompt: '"Only one subscription can be live at a time" per organization. Which constraint expresses that?',
      options: [
        'UNIQUE (organization_id) on subscriptions',
        'CREATE UNIQUE INDEX … ON subscriptions (organization_id) WHERE status &lt;&gt; \'canceled\'',
        'CHECK (status = \'active\')',
        'A foreign key from organizations to subscriptions',
      ],
      answer: 1,
      why: 'A plain UNIQUE would forbid keeping canceled subscriptions as history. The partial unique index only applies to non-canceled rows: any number of old canceled ones, at most one live one. Same trick as soft deletes.',
    },
    {
      id: 'd26-q2', type: 'quiz',
      prompt: 'Order <code>status</code> has four values that rarely change and carry no extra data. Product now wants to add <code>\'refunded\'</code> next month. Best fit?',
      options: ['A separate statuses lookup table with prices', 'TEXT with CHECK (status IN (…))', 'CREATE TYPE … AS ENUM, then remove values when they are retired', 'Free TEXT, validated only in the app'],
      answer: 1,
      why: 'A CHECK is changed with one migration (drop and re-add the constraint) and is as safe as an enum. Enums are awkward to change (no removing values), a lookup table is worth it when values carry data, and app-only validation is skipped by every other writer.',
    },
    {
      id: 'd26-q3', type: 'quiz',
      prompt: '<code>board_cards</code> belongs to <code>boards</code>, which already has <code>organization_id</code>. Why do many SaaS teams still add <code>organization_id</code> to <code>board_cards</code>?',
      options: [
        'Postgres requires it for foreign keys',
        'So every tenant query and security rule is a single <code>WHERE organization_id = $1</code>, with no join needed to prove ownership',
        'It makes the table normalized',
        'It removes the need for a primary key',
      ],
      answer: 1,
      why: 'It is a deliberate bit of denormalization: one predicate on every table makes tenant isolation easy to review, index and enforce (including with Row-Level Security). The cost is keeping it consistent, often with a composite FK <code>(organization_id, board_id)</code>.',
    },
  ],
  leetcode: [],
  ownIt: 'Take a feature you built recently. Write its spec in 3–4 sentences, then list the entities, relationships, keys and every constraint you\'d derive from the sentences.',
};
