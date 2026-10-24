export default {
  day: 33,
  phase: 4,
  title: 'Isolation levels & anomalies',
  goal: 'Name the five concurrency anomalies, know which ones each Postgres isolation level prevents, and write updates that cannot lose money.',
  setup: `
CREATE TABLE accounts (
  id      int PRIMARY KEY,
  owner   text NOT NULL,
  balance numeric(10,2) NOT NULL
);
INSERT INTO accounts VALUES (1, 'Ali', 100), (2, 'Sana', 100);

CREATE TABLE doctors (
  name    text PRIMARY KEY,
  on_call boolean NOT NULL
);
INSERT INTO doctors VALUES ('Alice', true), ('Bob', true), ('Carol', false);`,
  learn: `
<p>Yesterday you learned that a transaction is all-or-nothing. Today's question is different: what happens when
<b>two transactions run at the same time</b> and touch the same rows? Your API has many requests in flight at once,
and each one usually gets its own connection and transaction. The <b>isolation level</b> decides how much
one transaction can see of the others.</p>

<p>The problems that come from too little isolation are called <b>anomalies</b>. Each one is easiest to see as a timeline.
Two sessions, time goes down. Account 1 starts with balance 100.</p>

<h4>1. Dirty read: seeing data that was never committed</h4>
<div class="timeline"><table class="mini">
<tr><th>t</th><th>Session A</th><th>Session B</th></tr>
<tr><td>1</td><td>UPDATE accounts SET balance = 0 WHERE id = 1;</td><td></td></tr>
<tr><td>2</td><td></td><td>SELECT balance … → <b>0?</b></td></tr>
<tr><td>3</td><td>ROLLBACK;</td><td></td></tr>
</table></div>
<p>If B saw 0, it acted on a value that never existed. <b>Postgres never allows this</b>, at any level.</p>

<h4>2. Non-repeatable read: same row, two different answers</h4>
<div class="timeline"><table class="mini">
<tr><th>t</th><th>Session A</th><th>Session B</th></tr>
<tr><td>1</td><td>SELECT balance … → 100</td><td></td></tr>
<tr><td>2</td><td></td><td>UPDATE … SET balance = 50; COMMIT;</td></tr>
<tr><td>3</td><td>SELECT balance … → <b>50</b></td><td></td></tr>
</table></div>

<h4>3. Phantom read: same query, new rows appear</h4>
<p>Like the above, but B <i>inserts</i> a row that matches A's <code>WHERE</code>, so A's <code>COUNT(*)</code> changes mid-transaction.</p>

<h4>4. Lost update: read, compute in app code, write back</h4>
<div class="timeline"><table class="mini">
<tr><th>t</th><th>Session A (withdraw 30)</th><th>Session B (withdraw 50)</th></tr>
<tr><td>1</td><td>SELECT balance → 100</td><td></td></tr>
<tr><td>2</td><td></td><td>SELECT balance → 100</td></tr>
<tr><td>3</td><td>UPDATE … SET balance = 70; COMMIT;</td><td></td></tr>
<tr><td>4</td><td></td><td>UPDATE … SET balance = 50; COMMIT;</td></tr>
</table></div>
<p>Final balance 50, but 80 was withdrawn. A's withdrawal is <b>lost</b>. This is the anomaly you are most likely to ship by accident,
because <code>account.balance -= 30; account.save()</code> in an ORM does exactly this.</p>

<h4>5. Write skew: two valid decisions, one invalid result</h4>
<p>Rule: at least one doctor must be on call. Alice and Bob are both on call, and both click "go off call" at the same time.</p>
<div class="timeline"><table class="mini">
<tr><th>t</th><th>Session A (Alice)</th><th>Session B (Bob)</th></tr>
<tr><td>1</td><td>COUNT on-call → 2, fine</td><td></td></tr>
<tr><td>2</td><td></td><td>COUNT on-call → 2, fine</td></tr>
<tr><td>3</td><td>UPDATE Alice off; COMMIT;</td><td></td></tr>
<tr><td>4</td><td></td><td>UPDATE Bob off; COMMIT;</td></tr>
</table></div>
<p>They updated <i>different</i> rows, so no row conflict, yet nobody is on call now.</p>

<h4>The standard table vs what Postgres actually does</h4>
<table class="mini">
<tr><th>Level</th><th>Dirty</th><th>Non-repeatable</th><th>Phantom</th><th>Lost update</th><th>Write skew</th></tr>
<tr><td>Read Uncommitted (= Read Committed in PG)</td><td class="keep">no</td><td class="drop">yes</td><td class="drop">yes</td><td class="drop">yes</td><td class="drop">yes</td></tr>
<tr><td><b>Read Committed</b> (default)</td><td class="keep">no</td><td class="drop">yes</td><td class="drop">yes</td><td class="drop">yes*</td><td class="drop">yes</td></tr>
<tr><td>Repeatable Read (snapshot)</td><td class="keep">no</td><td class="keep">no</td><td class="keep">no in PG</td><td class="keep">error</td><td class="drop">yes</td></tr>
<tr><td>Serializable (SSI)</td><td class="keep">no</td><td class="keep">no</td><td class="keep">no</td><td class="keep">error</td><td class="keep">error</td></tr>
</table>
<p><b>Read Committed</b>: every <i>statement</i> sees a fresh snapshot of committed data.
<b>Repeatable Read</b>: the whole <i>transaction</i> sees one snapshot taken at its first query. The SQL standard allows phantoms here, Postgres doesn't.
If you try to update a row someone else changed after your snapshot, you get
<code>could not serialize access due to concurrent update</code>.
<b>Serializable</b>: Postgres also tracks what you <i>read</i>, and aborts one transaction if the combination could not have happened one-after-the-other.
(*) Read Committed only loses updates when you compute the new value in app code; <code>SET balance = balance - 30</code> is safe because the
second UPDATE waits for the first and then re-reads the committed row.</p>

<pre><code>BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;  -- must be the FIRST statement
SHOW transaction_isolation;                    -- serializable
…
COMMIT;   -- may fail with SQLSTATE 40001: retry the whole transaction</code></pre>

<div class="callout trap"><b>Trap:</b> raising the level is not free. Repeatable Read and Serializable turn races into <b>errors</b>
(<code>40001 serialization_failure</code>). If your code doesn't catch them and <b>retry the whole transaction</b>, you just turned a data bug into a 500.</div>

<div class="callout"><b>Rule of thumb for backend code:</b> stay on Read Committed. Make writes atomic
(<code>SET x = x - 1</code>, with a guard in <code>WHERE</code>), use constraints (<code>UNIQUE</code>, <code>CHECK</code>) to enforce rules,
lock rows explicitly when you must read-then-decide (tomorrow), and use Serializable plus a retry loop for tricky invariants like the doctors rule.</div>`,
  example: {
    sql: `-- Our run is already inside BEGIN, so this SET is the first statement of the transaction.
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SHOW transaction_isolation;
-- The atomic way to withdraw: the database does the arithmetic on the current value.
UPDATE accounts SET balance = balance - 30 WHERE id = 1 AND balance >= 30
RETURNING id, owner, balance;`,
    note: 'Swap the level for SERIALIZABLE or READ COMMITTED. Then put a SELECT before the SET and watch Postgres refuse it.',
  },
  exercises: [
    {
      id: 'd33-e1', type: 'query',
      prompt: 'Start the transaction at <b>REPEATABLE READ</b>, then prove it worked by running <code>SHOW transaction_isolation</code>. (Your SQL already runs inside a <code>BEGIN</code>.)',
      hint: '<code>SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;</code> must be the very first statement, then the SHOW.',
      solution: `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SHOW transaction_isolation;`,
      alts: [
        `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT current_setting('transaction_isolation');`,
      ],
      wrong: [
        { sql: `SHOW transaction_isolation;` },
        { sql: `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SHOW transaction_isolation;` },
      ],
      why: 'Without the SET you get the default, <code>read committed</code>. The level is fixed once the transaction runs its first query, which is why Postgres rejects SET TRANSACTION after a SELECT. In app code you usually write <code>BEGIN ISOLATION LEVEL REPEATABLE READ</code> or pass an option to your driver/ORM.',
    },
    {
      id: 'd33-e2', type: 'query',
      prompt: `Account 1 (Ali) has 100. Two API requests both <b>already read</b> balance = 100. Request A withdraws <b>30</b>, request B withdraws <b>50</b>.
The buggy code sends <code>UPDATE accounts SET balance = 70 WHERE id = 1</code> and then <code>… SET balance = 50 …</code>.
Write the two UPDATE statements the way they <b>should</b> be sent, so neither withdrawal is lost. (Graded on the final balances.)`,
      hint: 'Let the database do the arithmetic: <code>SET balance = balance - 30</code>.',
      solution: `UPDATE accounts SET balance = balance - 30 WHERE id = 1;
UPDATE accounts SET balance = balance - 50 WHERE id = 1;`,
      check: `SELECT id, balance FROM accounts ORDER BY id;`,
      ordered: true,
      alts: [
        `UPDATE accounts SET balance = balance - 30 WHERE id = 1 AND balance >= 30;
UPDATE accounts SET balance = balance - 50 WHERE id = 1 AND balance >= 50;`,
      ],
      wrong: [
        { sql: `UPDATE accounts SET balance = 70 WHERE id = 1;
UPDATE accounts SET balance = 50 WHERE id = 1;` },
      ],
      why: 'The final balance is 20. A value computed in app code (70, 50) is based on a read that may already be stale. <code>balance - 30</code> is evaluated against the row as it is when the UPDATE runs, and a concurrent UPDATE of the same row waits for the first one to commit, then re-reads it. This is the cheapest, most important concurrency fix there is.',
    },
    {
      id: 'd33-e3', type: 'query',
      prompt: `Account 2 (Sana) has 100. Two requests each try to withdraw <b>60</b>. Write the withdrawal as a <b>single UPDATE</b> that refuses to make the balance negative,
and send it twice (two identical statements). The first should succeed, the second should change nothing. Graded on the final balances.`,
      hint: 'Put the rule in the WHERE clause: <code>… WHERE id = 2 AND balance &gt;= 60</code>. Your app checks the affected row count (or RETURNING) to know if it worked.',
      solution: `UPDATE accounts SET balance = balance - 60 WHERE id = 2 AND balance >= 60;
UPDATE accounts SET balance = balance - 60 WHERE id = 2 AND balance >= 60;`,
      check: `SELECT id, balance FROM accounts ORDER BY id;`,
      ordered: true,
      alts: [
        `UPDATE accounts SET balance = balance - 60 WHERE id = 2 AND balance - 60 >= 0 RETURNING id, balance;
UPDATE accounts SET balance = balance - 60 WHERE id = 2 AND balance - 60 >= 0 RETURNING id, balance;`,
      ],
      wrong: [
        { sql: `UPDATE accounts SET balance = balance - 60 WHERE id = 2;
UPDATE accounts SET balance = balance - 60 WHERE id = 2;` },
        { sql: `SELECT id, balance FROM accounts WHERE id = 2;` },
      ],
      why: 'Sana ends at 40, not -20. The check and the write happen in one statement on the current row, so there is no gap between "is there enough money?" and "take it" for another request to slip into. A <code>CHECK (balance &gt;= 0)</code> constraint is a great second safety net.',
    },
    {
      id: 'd33-e4', type: 'query',
      prompt: `The doctors rule: at least one doctor must stay on call. Alice and Bob are on call. Run this transaction at <b>SERIALIZABLE</b>:
set the level first, then send Alice's request and then Bob's request. Each request is one UPDATE that sets <code>on_call = false</code> for that doctor
<b>only if</b> some <i>other</i> doctor is still on call. Graded on the level and who is still on call.`,
      hint: `<code>UPDATE doctors SET on_call = false WHERE name = 'Alice' AND EXISTS (SELECT 1 FROM doctors WHERE on_call AND name &lt;&gt; 'Alice');</code> then the same for Bob.`,
      solution: `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
UPDATE doctors SET on_call = false
WHERE name = 'Alice' AND EXISTS (SELECT 1 FROM doctors WHERE on_call AND name <> 'Alice');
UPDATE doctors SET on_call = false
WHERE name = 'Bob' AND EXISTS (SELECT 1 FROM doctors WHERE on_call AND name <> 'Bob');`,
      check: `SELECT current_setting('transaction_isolation') AS level,
       string_agg(name, ',' ORDER BY name) FILTER (WHERE on_call) AS still_on_call
FROM doctors;`,
      alts: [
        `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
UPDATE doctors SET on_call = false
WHERE name = 'Alice' AND (SELECT count(*) FROM doctors WHERE on_call AND name <> 'Alice') >= 1;
UPDATE doctors SET on_call = false
WHERE name = 'Bob' AND (SELECT count(*) FROM doctors WHERE on_call AND name <> 'Bob') >= 1;`,
      ],
      wrong: [
        { sql: `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
UPDATE doctors SET on_call = false WHERE name = 'Alice';
UPDATE doctors SET on_call = false WHERE name = 'Bob';` },
        { sql: `UPDATE doctors SET on_call = false
WHERE name = 'Alice' AND EXISTS (SELECT 1 FROM doctors WHERE on_call AND name <> 'Alice');
UPDATE doctors SET on_call = false
WHERE name = 'Bob' AND EXISTS (SELECT 1 FROM doctors WHERE on_call AND name <> 'Bob');` },
      ],
      why: `Bob stays on call. Here both requests ran in one session, so the second one saw the first one's change. In real life they run in <b>two</b> transactions with
two snapshots, and under Read Committed both guards would see "2 on call" and both would succeed (write skew). Under Serializable, Postgres notices that each transaction read
what the other one wrote and aborts one of them with SQLSTATE 40001. Your app retries it, the guard now sees only one doctor on call, and the rule holds.`,
    },
    {
      id: 'd33-q1', type: 'quiz',
      prompt: `Both sessions run at the default level. What does Session A's second SELECT return at t4?
<div class="timeline"><table class="mini">
<tr><th>t</th><th>Session A</th><th>Session B</th></tr>
<tr><td>1</td><td>BEGIN; SELECT balance FROM accounts WHERE id = 1; → 100</td><td></td></tr>
<tr><td>2</td><td></td><td>BEGIN; UPDATE accounts SET balance = 40 WHERE id = 1;</td></tr>
<tr><td>3</td><td></td><td>COMMIT;</td></tr>
<tr><td>4</td><td>SELECT balance FROM accounts WHERE id = 1; → ?</td><td></td></tr>
</table></div>`,
      options: ['100, because A is still inside its transaction', '40, because each statement sees the latest committed data', 'An error: could not serialize access', 'A waits until B finishes'],
      answer: 1,
      why: 'The default is Read Committed: every statement takes a fresh snapshot, so A sees B\'s committed 40 (a non-repeatable read). At Repeatable Read, A would still see 100, because its snapshot was taken at t1. Reading never waits for writers in Postgres.',
    },
    {
      id: 'd33-q2', type: 'quiz',
      prompt: 'You run <code>SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED</code> in Postgres. Can your transaction now see another session\'s uncommitted changes?',
      options: ['Yes, that is what Read Uncommitted means', 'No: Postgres treats Read Uncommitted exactly like Read Committed', 'Only for INSERTs, not UPDATEs', 'Postgres rejects the command with a syntax error'],
      answer: 1,
      why: 'The SQL standard only says which anomalies a level <i>may</i> allow. Postgres accepts the syntax but gives you Read Committed, so dirty reads never happen in Postgres.',
    },
    {
      id: 'd33-q3', type: 'quiz',
      prompt: 'Your checkout transaction runs at SERIALIZABLE and the driver throws <code>ERROR: could not serialize access due to read/write dependencies among transactions</code> (SQLSTATE 40001). What is the correct reaction?',
      options: [
        'Retry only the statement that failed',
        'Roll back and run the whole transaction again from the start (with a retry limit)',
        'Switch that endpoint to READ UNCOMMITTED so it never happens',
        'Ignore it: the data was saved anyway',
      ],
      answer: 1,
      why: 'The transaction is aborted and nothing was saved. Its earlier reads may now be outdated, so you must re-run the whole thing (re-read, re-decide, re-write). Wrap serializable transactions in a small retry loop, e.g. 3 attempts with a short backoff.',
    },
  ],
  leetcode: [],
  ownIt: 'Find one place in your code at work (or a past project) that reads a value, changes it in application code and saves it back: a counter, stock, balance or status. Draw the two-session timeline that breaks it, then write the single atomic UPDATE (with a WHERE guard) that fixes it.',
};
