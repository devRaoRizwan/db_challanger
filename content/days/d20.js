export default {
  day: 20,
  phase: 2,
  title: 'Mock interview #1',
  goal: 'Solve a timed set of realistic interview questions using a repeatable method: clarify, look, build in steps, check edge cases.',
  learn: `
<p>An SQL interview round is not only "did you get the right rows". The interviewer is watching <b>how you think</b>.
Use the same five steps every time and say them out loud.</p>

<h4>1. Clarify (1 minute)</h4>
<p>Every interview question hides decisions. Ask before you type:</p>
<ul>
<li><b>Ties</b>: "If two customers tie for top spender, do you want both?" (RANK vs ROW_NUMBER)</li>
<li><b>NULLs</b>: "Do employees without a bonus count as 0 bonus?"</li>
<li><b>Empty groups</b>: "Should a city with no orders appear with 0, or not at all?" (LEFT JOIN or not)</li>
<li><b>Duplicates</b>: "Count orders or order lines? Customers or distinct customers?"</li>
<li><b>Definitions</b>: "Does revenue include cancelled orders? Average over <i>all</i> customers, or only those who bought?"</li>
</ul>
<p>Here's how much that last one matters on our data: the average spend per customer is <b>1375.54</b> if you only count the 23 who bought,
and <b>1129.91</b> if you divide by all 28. Two different answers to "above-average customers".</p>

<h4>2. Look at the data (1 minute)</h4>
<p><code>SELECT * FROM orders LIMIT 5</code>. Check the grain (one row per what?), which columns can be NULL, and the join keys.</p>

<h4>3. Build in steps</h4>
<p>Write CTE 1, run it, check it. Add CTE 2. Then the final SELECT. Narrate: "first I compute spend per customer, then the average,
then I filter." A half-finished query with clear steps scores better than a silent, broken one-liner.</p>

<h4>4. Check edge cases</h4>
<p>Before saying "done", run through the list: ties, NULLs, empty groups, duplicates from joins (fan-out), integer division,
and "first/last" ordering ties. Change a filter and see whether the row count makes sense.</p>

<h4>5. Mention alternatives</h4>
<p>"I used a window function; the same thing works with a correlated subquery, which is slower on large tables."
One sentence like that shows depth.</p>

<div class="callout trap"><b>Trap: NULLs sort first in DESC.</b> In Postgres, <code>ORDER BY x DESC</code> puts NULLs <b>on top</b>
(MySQL puts them last). <code>salary + bonus</code> is NULL whenever bonus is NULL, so a "top 5 total pay" query can return five
people with no bonus. Use <code>COALESCE(bonus, 0)</code> or <code>NULLS LAST</code>.</div>

<div class="callout"><b>The timed set.</b> Give yourself <b>20 minutes</b> for the six problems below. Don't open hints until you
have something running. Each problem says which earlier days it draws on, so you know what to review if you get stuck.</div>`,
  example: {
    sql: `-- Step 1 of problem 1: always look at the intermediate result first.
SELECT c.id, c.name, SUM(oi.quantity * oi.unit_price) AS total_spend
FROM customers c
JOIN orders o       ON o.customer_id = c.id
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled'
GROUP BY c.id, c.name
ORDER BY total_spend DESC;`,
    note: '23 rows, one per customer who bought something. Now ask yourself: what is "the average customer" here?',
  },
  exercises: [
    {
      id: 'd20-e1', type: 'query',
      prompt: '<b>Problem 1 (Days 5, 9, 16):</b> "Find customers whose total spend is above the average customer\'s spend." Spend = item total of their non-cancelled orders; the average is over customers who have spent something. Show <code>name</code> and <code>total_spend</code>.',
      hint: 'CTE <code>spend</code> per customer, then <code>WHERE total_spend &gt; (SELECT AVG(total_spend) FROM spend)</code>.',
      solution: `WITH spend AS (
  SELECT c.id, c.name, SUM(oi.quantity * oi.unit_price) AS total_spend
  FROM customers c
  JOIN orders o       ON o.customer_id = c.id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY c.id, c.name
)
SELECT name, total_spend
FROM spend
WHERE total_spend > (SELECT AVG(total_spend) FROM spend);`,
      alts: [
        `SELECT name, total_spend FROM (
  SELECT c.name, SUM(oi.quantity * oi.unit_price) AS total_spend,
         AVG(SUM(oi.quantity * oi.unit_price)) OVER () AS avg_spend
  FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled' GROUP BY c.id, c.name) t
WHERE total_spend > avg_spend;`,
      ],
      wrong: [
        { sql: `SELECT c.name, SUM(oi.quantity * oi.unit_price)
FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_items oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled' GROUP BY c.id, c.name
HAVING SUM(oi.quantity * oi.unit_price) > (SELECT AVG(quantity * unit_price) FROM order_items);` },
        { sql: `WITH spend AS (SELECT c.id, c.name, SUM(oi.quantity * oi.unit_price) AS total_spend
  FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled' GROUP BY c.id, c.name)
SELECT name, total_spend FROM spend WHERE total_spend > (SELECT SUM(total_spend) / (SELECT COUNT(*) FROM customers) FROM spend);` },
      ],
      why: '11 customers beat the average of 1375.54; Ghazal Effendi leads with 6746.21. Comparing to the average <i>line item</i> lets almost everyone through. Dividing by all 28 customers (average 1129.91) is a different, defensible definition, which is exactly why you clarify first.',
    },
    {
      id: 'd20-e2', type: 'query',
      prompt: '<b>Problem 2 (Days 5, 7, 9):</b> "Which products were bought by more than 5 distinct customers but never appeared in a cancelled order?" Show product <code>name</code>.',
      hint: 'GROUP BY product with <code>HAVING COUNT(DISTINCT o.customer_id) &gt; 5</code> and <code>AND COUNT(*) FILTER (WHERE o.status = \'cancelled\') = 0</code>. Or use NOT EXISTS for the "never" part.',
      solution: `SELECT p.name
FROM products p
JOIN order_items oi ON oi.product_id = p.id
JOIN orders o       ON o.id = oi.order_id
GROUP BY p.id, p.name
HAVING COUNT(DISTINCT o.customer_id) > 5
   AND COUNT(*) FILTER (WHERE o.status = 'cancelled') = 0;`,
      alts: [
        `SELECT p.name FROM products p
WHERE (SELECT COUNT(DISTINCT o.customer_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id) > 5
  AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                  WHERE oi.product_id = p.id AND o.status = 'cancelled');`,
        `SELECT p.name FROM products p JOIN order_items oi ON oi.product_id = p.id JOIN orders o ON o.id = oi.order_id
GROUP BY p.id, p.name
HAVING COUNT(DISTINCT o.customer_id) > 5 AND NOT bool_or(o.status = 'cancelled');`,
      ],
      wrong: [{ sql: `SELECT p.name FROM products p JOIN order_items oi ON oi.product_id = p.id JOIN orders o ON o.id = oi.order_id
WHERE o.status <> 'cancelled'
GROUP BY p.id, p.name HAVING COUNT(DISTINCT o.customer_id) > 5;` }],
      why: 'Only 2 products: Ergonomic Chair and 27" Monitor. <code>WHERE status &lt;&gt; \'cancelled\'</code> doesn\'t mean "never cancelled". It just hides the cancelled rows, so every popular product still passes (all 13 products that were ever ordered). "Never" is a property of the <b>whole group</b>, so check it in HAVING or with NOT EXISTS.',
    },
    {
      id: 'd20-e3', type: 'query',
      prompt: '<b>Problem 3 (Days 2, 4):</b> "Show the 5 employees with the highest total pay (salary + bonus)." A missing bonus counts as 0. Columns: <code>first_name</code>, <code>total_pay</code>. Order by total_pay DESC, then <code>id</code>.',
      hint: '<code>salary + COALESCE(bonus, 0)</code>. Try it without COALESCE first and look at the top rows.',
      solution: `SELECT first_name, salary + COALESCE(bonus, 0) AS total_pay
FROM employees
ORDER BY total_pay DESC, id
LIMIT 5;`,
      ordered: true,
      alts: [
        `SELECT first_name, total_pay FROM (
  SELECT id, first_name, salary + COALESCE(bonus, 0) AS total_pay,
         ROW_NUMBER() OVER (ORDER BY salary + COALESCE(bonus, 0) DESC, id) AS rn FROM employees) t
WHERE rn <= 5 ORDER BY rn;`,
      ],
      wrong: [{ sql: `SELECT first_name, salary + bonus AS total_pay FROM employees ORDER BY total_pay DESC, id LIMIT 5;` }],
      why: 'Ayesha 300000, Sara 220000, Bilal 210000, Hina 195000, Usman 180000. Without COALESCE, everyone with a NULL bonus gets a NULL total, and Postgres sorts NULLs <b>first</b> in DESC order: your "top 5" becomes five people with no bonus at all. <code>ORDER BY total_pay DESC NULLS LAST</code> fixes the sort but still shows NULL pay.',
    },
    {
      id: 'd20-e4', type: 'query',
      prompt: '<b>Problem 4 (Days 10, 4):</b> "Among customers with at least 4 orders, who cancels a lot?" Show <code>name</code>, <code>orders</code>, <code>cancelled</code> and <code>cancel_pct</code> (percentage, 1 decimal) for those with at least one cancellation. Order by cancel_pct DESC, then name.',
      hint: '<code>COUNT(*) FILTER (WHERE status = \'cancelled\')</code>, and multiply by <code>100.0</code> (not 100) before dividing.',
      solution: `SELECT c.name,
       COUNT(*) AS orders,
       COUNT(*) FILTER (WHERE o.status = 'cancelled') AS cancelled,
       ROUND(100.0 * COUNT(*) FILTER (WHERE o.status = 'cancelled') / COUNT(*), 1) AS cancel_pct
FROM customers c
JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name
HAVING COUNT(*) >= 4
   AND COUNT(*) FILTER (WHERE o.status = 'cancelled') > 0
ORDER BY cancel_pct DESC, c.name;`,
      ordered: true,
      alts: [
        `SELECT c.name, COUNT(*), SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END),
       ROUND(AVG(CASE WHEN o.status = 'cancelled' THEN 100.0 ELSE 0 END), 1) AS pct
FROM customers c JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name
HAVING COUNT(*) >= 4 AND SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) > 0
ORDER BY pct DESC, c.name;`,
      ],
      wrong: [{ sql: `SELECT c.name, COUNT(*), COUNT(*) FILTER (WHERE o.status = 'cancelled'),
       ROUND(100 * (COUNT(*) FILTER (WHERE o.status = 'cancelled') / COUNT(*)), 1) AS pct
FROM customers c JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name
HAVING COUNT(*) >= 4 AND COUNT(*) FILTER (WHERE o.status = 'cancelled') > 0
ORDER BY pct DESC, c.name;` }],
      why: '6 customers; Haris Smith cancelled 3 of 4 (75.0%), Osama Zaidi 3 of 6 (50.0%). Integer ÷ integer is integer division in Postgres (and in SQL Server), so 3/4 = 0 and every percentage becomes 0. MySQL\'s <code>/</code> returns a decimal, which is why this bug hides on LeetCode and bites you at work. The AVG(CASE …) alt is a neat trick: the average of 100s and 0s <i>is</i> the percentage.',
    },
    {
      id: 'd20-e5', type: 'query',
      prompt: '<b>Problem 5 (Days 11, 14, 18):</b> "Which customers placed their <b>second</b> order within 30 days of their <b>first</b>?" (Any status.) Show <code>customer_id</code>, <code>first_order</code>, <code>second_order</code>, <code>days_between</code>.',
      hint: 'ROW_NUMBER per customer by order_date, plus <code>LEAD(order_date)</code>. Keep row 1 where the next date is ≤ 30 days later.',
      solution: `WITH ranked AS (
  SELECT customer_id, order_date,
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date, id) AS rn,
         LEAD(order_date) OVER (PARTITION BY customer_id ORDER BY order_date, id) AS next_date
  FROM orders
)
SELECT customer_id, order_date AS first_order, next_date AS second_order,
       next_date - order_date AS days_between
FROM ranked
WHERE rn = 1
  AND next_date - order_date <= 30;`,
      alts: [
        `SELECT a.customer_id, a.order_date, b.order_date, b.order_date - a.order_date
FROM (SELECT customer_id, order_date, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date, id) AS rn FROM orders) a
JOIN (SELECT customer_id, order_date, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date, id) AS rn FROM orders) b
  ON b.customer_id = a.customer_id AND a.rn = 1 AND b.rn = 2
WHERE b.order_date - a.order_date <= 30;`,
      ],
      wrong: [{ sql: `SELECT customer_id, order_date, next_date, next_date - order_date FROM (
  SELECT customer_id, order_date, LEAD(order_date) OVER (PARTITION BY customer_id ORDER BY order_date, id) AS next_date FROM orders) t
WHERE next_date - order_date <= 30;` }],
      why: '3 customers: 1 (5 days, though that second order was cancelled; worth mentioning to the interviewer), 7 and 17 (10 days each). Without <code>rn = 1</code> you get <i>any</i> pair of consecutive orders within 30 days, which is a different question ("repeat within 30 days at any time"). Customers with a single order have <code>next_date</code> NULL, and NULL &lt;= 30 is not true, so they drop out by themselves.',
    },
    {
      id: 'd20-e6', type: 'query',
      prompt: '<b>Problem 6 (Days 11, 13, 16):</b> "For each city, who is the top-spending customer?" Spend = non-cancelled item total. Include ties. Only cities where someone has spent money. Show <code>city</code>, <code>name</code>, <code>total_spend</code>.',
      hint: 'CTE for spend per customer (keep city), then <code>RANK() OVER (PARTITION BY city ORDER BY total_spend DESC)</code> = 1.',
      solution: `WITH spend AS (
  SELECT c.city, c.name, SUM(oi.quantity * oi.unit_price) AS total_spend
  FROM customers c
  JOIN orders o       ON o.customer_id = c.id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY c.id, c.city, c.name
),
ranked AS (
  SELECT *, RANK() OVER (PARTITION BY city ORDER BY total_spend DESC) AS rnk
  FROM spend
)
SELECT city, name, total_spend
FROM ranked
WHERE rnk = 1;`,
      alts: [
        `WITH spend AS (
  SELECT c.city, c.name, SUM(oi.quantity * oi.unit_price) AS total_spend
  FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled' GROUP BY c.id, c.city, c.name)
SELECT city, name, total_spend FROM spend s
WHERE total_spend = (SELECT MAX(total_spend) FROM spend s2 WHERE s2.city = s.city);`,
      ],
      wrong: [{ sql: `SELECT c.city, MAX(c.name), MAX(t.total)
FROM customers c
JOIN (SELECT o.customer_id, SUM(oi.quantity * oi.unit_price) AS total FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status <> 'cancelled' GROUP BY o.customer_id) t ON t.customer_id = c.id
GROUP BY c.city;` }],
      why: '5 cities: Lahore → Ghazal Effendi, Islamabad → Bushra Brown, Karachi → Laiba Siddiqui, London → Tooba Niazi, Toronto → Zara Memon. Dubai\'s only customer never ordered. The wrong version is a classic: <code>MAX(name)</code> and <code>MAX(total)</code> are computed <b>independently</b>, so it pairs the alphabetically-last name with the highest total. They usually belong to different people.',
    },
    {
      id: 'd20-q1', type: 'quiz',
      prompt: 'The interviewer asks: "Show each department\'s number of employees." What should you clarify <b>first</b>?',
      options: [
        'Whether to use COUNT(*) or COUNT(1), since one is faster',
        'Whether departments with no employees (like Legal) should appear with 0, and what to do with employees who have no department',
        'Whether to alias the column as cnt or count',
        'Nothing; it\'s a simple GROUP BY',
      ],
      answer: 1,
      why: 'Empty groups and NULL keys change the query (LEFT JOIN from departments, COUNT(e.id)) and the answer (Legal = 0; Junaid has no department). COUNT(*) vs COUNT(1) makes no difference in Postgres.',
    },
  ],
  leetcode: [
    { id: 1050, title: 'Actors and Directors Who Cooperated At Least Three Times', slug: 'actors-and-directors-who-cooperated-at-least-three-times', difficulty: 'Easy' },
    { id: 1084, title: 'Sales Analysis III', slug: 'sales-analysis-iii', difficulty: 'Easy' },
    { id: 607, title: 'Sales Person', slug: 'sales-person', difficulty: 'Easy' },
  ],
  ownIt: 'Pick the problem from today\'s set that took you longest. Write down the clarifying questions you should have asked first, the steps (CTEs) you used, and one edge case that would break a naive answer.',
};
