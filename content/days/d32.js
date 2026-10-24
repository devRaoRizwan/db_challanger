const BALANCES = `SELECT id, owner, balance FROM accounts ORDER BY id;`;

export default {
  day: 32,
  phase: 4,
  title: 'Transactions & ACID',
  goal: 'Group writes so they succeed or fail together, recover with SAVEPOINT, and explain what ACID actually promises.',
  setup: `CREATE TABLE accounts (
  id      INT PRIMARY KEY,
  owner   TEXT NOT NULL,
  balance NUMERIC(12,2) NOT NULL CHECK (balance >= 0)
);
INSERT INTO accounts VALUES (1, 'Ali', 1000), (2, 'Sana', 500), (3, 'Omar', 250), (4, 'Zara', 0);
CREATE TABLE transfers (
  id         SERIAL PRIMARY KEY,
  from_id    INT NOT NULL REFERENCES accounts(id),
  to_id      INT NOT NULL REFERENCES accounts(id),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
  learn: `
<p>This day adds <code>accounts(id, owner, balance)</code> with <code>CHECK (balance &gt;= 0)</code>, and an empty
<code>transfers</code> log. Ali has 1000, Sana 500, Omar 250, Zara 0.</p>

<h4>The problem</h4>
<p>"Send 200 from Ali to Sana" is two writes:</p>
<pre><code>UPDATE accounts SET balance = balance - 200 WHERE id = 1;   -- Ali: 1000 → 800
-- CRASH: server dies / app throws / network drops here
UPDATE accounts SET balance = balance + 200 WHERE id = 2;   -- never happens</code></pre>
<p>200 just vanished. A <b>transaction</b> makes a group of statements one all-or-nothing unit:</p>
<pre><code>BEGIN;
UPDATE accounts SET balance = balance - 200 WHERE id = 1;
UPDATE accounts SET balance = balance + 200 WHERE id = 2;
COMMIT;     -- both become permanent together
-- or ROLLBACK;  -- both are undone, as if nothing happened</code></pre>

<h4>ACID with the bank transfer</h4>
<table class="mini">
<tr><th>Letter</th><th>Promise</th><th>In the transfer</th></tr>
<tr><td><b>A</b>tomicity</td><td>All statements apply, or none</td><td>Never "Ali debited, Sana not credited"</td></tr>
<tr><td><b>C</b>onsistency</td><td>Constraints hold before and after</td><td><code>CHECK (balance &gt;= 0)</code> rejects an overdraft; the whole transaction fails</td></tr>
<tr><td><b>I</b>solation</td><td>Concurrent transactions don't see each other's half-done work</td><td>Nobody sees Ali at 800 before Sana is at 700</td></tr>
<tr><td><b>D</b>urability</td><td>Once COMMIT returns, it survives a crash</td><td>Written to the WAL (write-ahead log) on disk before "COMMIT" comes back</td></tr>
</table>

<h4>Isolation, in two sessions</h4>
<div class="timeline"><table class="mini">
<tr><th>Session A (transfer)</th><th>Session B (balance page)</th></tr>
<tr><td><code>BEGIN;</code></td><td></td></tr>
<tr><td><code>UPDATE … -200 WHERE id = 1;</code></td><td></td></tr>
<tr><td></td><td><code>SELECT balance … id = 1;</code> → <b>1000</b> (A's change is invisible)</td></tr>
<tr><td><code>UPDATE … +200 WHERE id = 2;</code></td><td></td></tr>
<tr><td><code>COMMIT;</code></td><td></td></tr>
<tr><td></td><td><code>SELECT balance … id = 1;</code> → <b>800</b></td></tr>
</table></div>
<p>(Day 33 covers what B sees in trickier cases: isolation levels.)</p>

<h4>Autocommit</h4>
<p>Without <code>BEGIN</code>, every single statement is its own transaction and commits immediately. That's what happens when
your backend calls <code>db.query()</code> twice in a row: two separate transactions, with the crash window between them.
Use your driver/ORM's transaction helper (<code>prisma.$transaction</code>, <code>session.begin()</code>,
<code>@Transactional</code>, <code>BEGIN … COMMIT</code> on one connection) for anything that must happen together.</p>

<h4>Errors abort the whole transaction</h4>
<pre><code>BEGIN;
UPDATE accounts SET balance = balance - 5000 WHERE id = 1;
-- ERROR: new row for relation "accounts" violates check constraint "accounts_balance_check"
SELECT * FROM accounts;
-- ERROR: current transaction is aborted, commands ignored until end of transaction block
COMMIT;
-- ROLLBACK   ← yes: COMMIT on a failed transaction rolls back</code></pre>
<p>After any error, Postgres refuses everything until you end the transaction. This is a feature: your app can't
accidentally commit half of a failed operation.</p>

<h4>SAVEPOINT: undo part of a transaction</h4>
<pre><code>BEGIN;
UPDATE …;                          -- step 1 (keep)
SAVEPOINT before_risky;
UPDATE …;                          -- step 2 (fails, or turns out wrong)
ROLLBACK TO SAVEPOINT before_risky; -- undo step 2 only, transaction is healthy again
UPDATE …;                          -- step 3
COMMIT;                            -- steps 1 and 3 are saved</code></pre>
<p>ORMs use savepoints for "nested transactions". <code>RELEASE SAVEPOINT name</code> forgets a savepoint you no longer need.</p>

<div class="callout"><b>How exercises run here:</b> the checker already wraps your SQL in its own <code>BEGIN … ROLLBACK</code>,
so you don't need BEGIN/COMMIT and the data resets after each run. <code>SAVEPOINT</code> / <code>ROLLBACK TO SAVEPOINT</code> work normally inside it.
If you do write <code>COMMIT</code> or <code>ROLLBACK</code>, you end the checker's transaction early: answers are still graded,
and the app reloads the data afterwards.</div>

<div class="callout trap"><b>Trap:</b> catching the error in app code and carrying on with the same transaction. Every following
query fails with "current transaction is aborted". Either roll back and retry the whole unit, or wrap the risky part in a savepoint.</div>

<div class="callout">Feel it in the <b>Playground</b>, one statement per run: <code>BEGIN;</code> → an overdraft UPDATE →
<code>SELECT * FROM accounts;</code> (aborted!) → <code>ROLLBACK;</code>. Press "Reset DB" if anything gets stuck.</div>`,
  example: {
    sql: `UPDATE accounts SET balance = balance - 200 WHERE id = 1;
UPDATE accounts SET balance = balance + 200 WHERE id = 2;

SAVEPOINT before_mistake;
UPDATE accounts SET balance = 999999 WHERE id = 4;   -- oops
ROLLBACK TO SAVEPOINT before_mistake;

SELECT * FROM accounts ORDER BY id;`,
    note: 'Ali 800, Sana 700, and Zara is still 0: the savepoint undid only the mistake. Delete the ROLLBACK TO line and run again to see Zara\'s 999999. The whole run is rolled back afterwards either way.',
  },
  exercises: [
    {
      id: 'd32-e1', type: 'query',
      prompt: 'Transfer <b>300</b> from Ali (id 1) to Zara (id 4). Two UPDATEs. The checker then shows all balances.',
      hint: 'Subtract from one, add to the other: <code>SET balance = balance - 300 WHERE id = 1</code>, then <code>+ 300</code> for id 4. No BEGIN/COMMIT needed (the checker opens a transaction), but it also works with them.',
      solution: `UPDATE accounts SET balance = balance - 300 WHERE id = 1;
UPDATE accounts SET balance = balance + 300 WHERE id = 4;`,
      check: BALANCES,
      ordered: true,
      alts: [
        `BEGIN;
UPDATE accounts SET balance = balance - 300 WHERE id = 1;
UPDATE accounts SET balance = balance + 300 WHERE id = 4;
COMMIT;`,
        `UPDATE accounts SET balance = balance + CASE id WHEN 1 THEN -300 ELSE 300 END WHERE id IN (1, 4);`,
      ],
      wrong: [{ sql: `UPDATE accounts SET balance = balance - 300 WHERE id = 1;` }, { sql: `UPDATE accounts SET balance = 300 WHERE id = 1;
UPDATE accounts SET balance = balance + 300 WHERE id = 4;` }],
      why: 'Ali 700, Zara 300; the total (1750) is unchanged, which is a good invariant to test in your own code. Always write <code>balance = balance - 300</code>, never "read the balance in the app, compute, write the number back": that read-then-write races with other requests (Day 34).',
    },
    {
      id: 'd32-e2', type: 'query',
      prompt: 'A real transfer also writes an audit row. Move <b>150</b> from Sana (id 2) to Omar (id 3) <b>and</b> insert the matching row into <code>transfers(from_id, to_id, amount)</code>. The checker shows balances and the transfer log.',
      hint: 'Two UPDATEs + <code>INSERT INTO transfers (from_id, to_id, amount) VALUES (2, 3, 150);</code>. Let <code>id</code> and <code>created_at</code> use their defaults.',
      solution: `UPDATE accounts SET balance = balance - 150 WHERE id = 2;
UPDATE accounts SET balance = balance + 150 WHERE id = 3;
INSERT INTO transfers (from_id, to_id, amount) VALUES (2, 3, 150);`,
      check: `SELECT 'account' AS kind, id AS a, NULL::int AS b, balance AS amount FROM accounts
UNION ALL
SELECT 'transfer', from_id, to_id, amount FROM transfers
ORDER BY 1, 2;`,
      ordered: true,
      alts: [`INSERT INTO transfers (from_id, to_id, amount) VALUES (2, 3, 150);
UPDATE accounts SET balance = balance + CASE WHEN id = 2 THEN -150 ELSE 150 END WHERE id IN (2, 3);`],
      wrong: [{ sql: `UPDATE accounts SET balance = balance - 150 WHERE id = 2;
UPDATE accounts SET balance = balance + 150 WHERE id = 3;` }],
      why: 'Three writes, one unit. If the INSERT failed (say, a bad account id breaking the foreign key), the transaction would abort and the balance changes would roll back with it: the money never moves without a log entry. The order of the statements inside the transaction does not matter to anyone outside it.',
    },
    {
      id: 'd32-e3', type: 'query',
      prompt: `Do this in one run, using a savepoint to undo only the mistake:
<ol>
<li>Transfer 100 from Ali (1) to Omar (3).</li>
<li><code>SAVEPOINT before_bonus;</code></li>
<li>Someone "accidentally" runs <code>UPDATE accounts SET balance = balance + 1000 WHERE id = 4;</code></li>
<li>Undo just step 3.</li>
<li>Transfer 50 from Sana (2) to Zara (4).</li>
</ol>`,
      hint: '<code>ROLLBACK TO SAVEPOINT before_bonus;</code> undoes everything after the savepoint and keeps the transaction alive. A plain <code>ROLLBACK</code> would throw away step 1 too.',
      solution: `UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 3;
SAVEPOINT before_bonus;
UPDATE accounts SET balance = balance + 1000 WHERE id = 4;
ROLLBACK TO SAVEPOINT before_bonus;
UPDATE accounts SET balance = balance - 50 WHERE id = 2;
UPDATE accounts SET balance = balance + 50 WHERE id = 4;`,
      check: BALANCES,
      ordered: true,
      alts: [`UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 3;
SAVEPOINT before_bonus;
UPDATE accounts SET balance = balance + 1000 WHERE id = 4;
ROLLBACK TO before_bonus;
RELEASE SAVEPOINT before_bonus;
UPDATE accounts SET balance = balance - 50 WHERE id = 2;
UPDATE accounts SET balance = balance + 50 WHERE id = 4;`],
      wrong: [
        { sql: `UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 3;
SAVEPOINT before_bonus;
UPDATE accounts SET balance = balance + 1000 WHERE id = 4;
ROLLBACK;
UPDATE accounts SET balance = balance - 50 WHERE id = 2;
UPDATE accounts SET balance = balance + 50 WHERE id = 4;` },
        { sql: `UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 3;
SAVEPOINT before_bonus;
UPDATE accounts SET balance = balance + 1000 WHERE id = 4;
UPDATE accounts SET balance = balance - 50 WHERE id = 2;
UPDATE accounts SET balance = balance + 50 WHERE id = 4;` },
      ],
      why: 'Ali 900, Sana 450, Omar 350, Zara 50. A full <code>ROLLBACK</code> would have ended the whole transaction (losing transfer 1), and the following statements would have run in autocommit, each committing on its own. That is exactly the partial state transactions exist to prevent.',
    },
    {
      id: 'd32-q1', type: 'quiz',
      prompt: 'Your API returned 200 OK for a payment right after <code>COMMIT</code> succeeded. One second later the database server loses power. When it restarts, the payment is still there. Which ACID property is that?',
      options: ['Atomicity', 'Consistency', 'Isolation', 'Durability'],
      answer: 3,
      why: 'Durability: COMMIT only returns after the change is safely in the write-ahead log on disk. On restart Postgres replays the WAL. (Atomicity is about the <i>other</i> crash: one in the <i>middle</i> of the transaction, which leaves no trace at all.)',
    },
    {
      id: 'd32-q2', type: 'quiz',
      prompt: `In psql you run, one at a time:
<pre>BEGIN;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;   -- UPDATE 1
INSERT INTO accounts VALUES (1, 'Dup', 0);                    -- ERROR: duplicate key
UPDATE accounts SET balance = balance - 100 WHERE id = 1;   -- ?
COMMIT;                                                       -- ?</pre>
What happens to the last two statements?`,
      options: [
        'The UPDATE works; COMMIT saves both UPDATEs and skips the failed INSERT',
        'The UPDATE fails with "current transaction is aborted…", and COMMIT actually performs a ROLLBACK: nothing is saved',
        'The UPDATE works, COMMIT fails',
        'Postgres automatically retries the INSERT',
      ],
      answer: 1,
      why: 'After an error the transaction is poisoned: every command is rejected until it ends, and COMMIT replies <code>ROLLBACK</code>. Even Sana\'s +100 from before the error is gone. To survive an expected error mid-transaction, put a <code>SAVEPOINT</code> before the risky statement and <code>ROLLBACK TO</code> it.',
    },
    {
      id: 'd32-e4', type: 'query',
      prompt: `The /transfer endpoint must never crash on "insufficient funds"; it should just move nothing. Write a <b>guarded transfer</b>: one statement that debits only if the balance is enough and credits only if the debit happened. Run it twice:
<ul><li>300 from Omar (3, has 250) to Zara (4): must change nothing.</li>
<li>300 from Sana (2, has 500) to Zara (4): must go through.</li></ul>`,
      hint: `A data-modifying CTE:
<pre>WITH debit AS (
  UPDATE accounts SET balance = balance - 300
  WHERE id = 3 AND balance &gt;= 300
  RETURNING id
)
UPDATE accounts SET balance = balance + 300
WHERE id = 4 AND EXISTS (SELECT 1 FROM debit);</pre>
Then repeat it with id 2.`,
      solution: `WITH debit AS (
  UPDATE accounts SET balance = balance - 300 WHERE id = 3 AND balance >= 300 RETURNING id
)
UPDATE accounts SET balance = balance + 300 WHERE id = 4 AND EXISTS (SELECT 1 FROM debit);

WITH debit AS (
  UPDATE accounts SET balance = balance - 300 WHERE id = 2 AND balance >= 300 RETURNING id
)
UPDATE accounts SET balance = balance + 300 WHERE id = 4 AND EXISTS (SELECT 1 FROM debit);`,
      check: BALANCES,
      ordered: true,
      wrong: [
        { sql: `UPDATE accounts SET balance = balance - 300 WHERE id = 3;
UPDATE accounts SET balance = balance + 300 WHERE id = 4;
UPDATE accounts SET balance = balance - 300 WHERE id = 2;
UPDATE accounts SET balance = balance + 300 WHERE id = 4;` },
        { sql: `UPDATE accounts SET balance = balance - 300 WHERE id = 3 AND balance >= 300;
UPDATE accounts SET balance = balance + 300 WHERE id = 4;
UPDATE accounts SET balance = balance - 300 WHERE id = 2 AND balance >= 300;
UPDATE accounts SET balance = balance + 300 WHERE id = 4;` },
      ],
      why: 'Sana 200, Omar still 250, Zara 300. The naive version hits the CHECK constraint and aborts everything (the CHECK is your last line of defense, not your business logic). Guarding only the debit is worse: Zara gets 600 and 300 is created out of thin air. Your app can read the CTE\'s row count to answer "insufficient funds".',
    },
    {
      id: 'd32-q3', type: 'quiz',
      prompt: `Two requests hit the API at the same time:
<div class="timeline"><table class="mini">
<tr><th>Session A</th><th>Session B</th></tr>
<tr><td><code>BEGIN;</code></td><td></td></tr>
<tr><td><code>UPDATE accounts SET balance = balance - 200 WHERE id = 1;</code></td><td></td></tr>
<tr><td></td><td><code>SELECT balance FROM accounts WHERE id = 1;</code></td></tr>
<tr><td><code>ROLLBACK;</code></td><td></td></tr>
</table></div>
Ali started with 1000. What does Session B's SELECT return?`,
      options: ['800', '1000', 'It waits until A finishes', 'An error'],
      answer: 1,
      why: 'Postgres never shows uncommitted data (no "dirty reads"). B reads the last committed version, 1000, without waiting: readers don\'t block writers and writers don\'t block readers (MVCC, Day 36). Good thing too, since A rolled back and 800 never really existed.',
    },
  ],
  leetcode: [],
  ownIt: 'Find a place in your backend where two or more writes happen for one user action (order + stock, payment + status, signup + profile). Explain to your team what can go wrong today if the process dies between them, and sketch how you would wrap it in a transaction (with a savepoint if one step is allowed to fail).',
};
