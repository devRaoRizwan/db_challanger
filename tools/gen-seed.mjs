// Generates content/seed.js (and seed.sql) — the single practice dataset used by all 40 days.
// Deterministic: same output every run.
import { writeFileSync } from 'node:fs';

let s = 42;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const q = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table, cols, rows) =>
  `INSERT INTO ${table} (${cols.join(', ')}) VALUES\n` + rows.map((r) => `  (${r.map(q).join(', ')})`).join(',\n') + ';\n';
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

const schema = `
CREATE TABLE departments (
  id        INT PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  location  TEXT NOT NULL,
  budget    NUMERIC(12,2) NOT NULL
);

CREATE TABLE employees (
  id             INT PRIMARY KEY,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  email          TEXT,
  department_id  INT REFERENCES departments(id),
  manager_id     INT REFERENCES employees(id),
  job_title      TEXT NOT NULL,
  salary         NUMERIC(10,2) NOT NULL,
  bonus          NUMERIC(10,2),
  hire_date      DATE NOT NULL,
  city           TEXT NOT NULL
);

CREATE TABLE projects (
  id             INT PRIMARY KEY,
  name           TEXT NOT NULL,
  department_id  INT REFERENCES departments(id),
  start_date     DATE NOT NULL,
  end_date       DATE
);

CREATE TABLE employee_projects (
  employee_id  INT REFERENCES employees(id),
  project_id   INT REFERENCES projects(id),
  role         TEXT NOT NULL,
  hours        INT NOT NULL,
  PRIMARY KEY (employee_id, project_id)
);

CREATE TABLE customers (
  id           INT PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  city         TEXT NOT NULL,
  country      TEXT NOT NULL,
  signup_date  DATE NOT NULL,
  referred_by  INT REFERENCES customers(id)
);

CREATE TABLE products (
  id         INT PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,
  price      NUMERIC(10,2) NOT NULL,
  stock      INT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE orders (
  id           INT PRIMARY KEY,
  customer_id  INT NOT NULL REFERENCES customers(id),
  order_date   DATE NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending','shipped','delivered','cancelled'))
);

CREATE TABLE order_items (
  id          INT PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id),
  product_id  INT NOT NULL REFERENCES products(id),
  quantity    INT NOT NULL,
  unit_price  NUMERIC(10,2) NOT NULL
);

CREATE TABLE payments (
  id        INT PRIMARY KEY,
  order_id  INT NOT NULL REFERENCES orders(id),
  amount    NUMERIC(10,2) NOT NULL,
  method    TEXT NOT NULL,
  paid_at   DATE NOT NULL
);

CREATE TABLE logins (
  customer_id  INT NOT NULL REFERENCES customers(id),
  login_date   DATE NOT NULL,
  PRIMARY KEY (customer_id, login_date)
);
`;

const departments = [
  [1, 'Executive', 'Karachi', 500000],
  [2, 'Engineering', 'Lahore', 2400000],
  [3, 'Product', 'Lahore', 800000],
  [4, 'Sales', 'Karachi', 1200000],
  [5, 'Marketing', 'Islamabad', 600000],
  [6, 'Finance', 'Karachi', 450000],
  [7, 'HR', 'Islamabad', 300000],
  [8, 'Legal', 'Karachi', 250000], // no employees -> LEFT JOIN practice
];

// id, first, last, email, dept, manager, title, salary, bonus, hire_date, city
const employees = [
  [1, 'Ayesha', 'Khan', 'ayesha.khan@acme.io', 1, null, 'CEO', 250000, 50000, '2018-03-01', 'Karachi'],
  [2, 'Bilal', 'Ahmed', 'bilal.ahmed@acme.io', 2, 1, 'CTO', 180000, 30000, '2018-06-15', 'Lahore'],
  [3, 'Sara', 'Malik', 'sara.malik@acme.io', 4, 1, 'VP Sales', 180000, 40000, '2019-01-10', 'Karachi'],
  [4, 'Usman', 'Tariq', 'usman.tariq@acme.io', 3, 1, 'Head of Product', 160000, 20000, '2019-04-22', 'Lahore'],
  [5, 'Hina', 'Raza', 'hina.raza@acme.io', 6, 1, 'CFO', 170000, 25000, '2019-02-01', 'Karachi'],
  [6, 'Omar', 'Farooq', 'omar.farooq@acme.io', 2, 2, 'Engineering Manager', 140000, 15000, '2019-09-01', 'Lahore'],
  [7, 'Zainab', 'Ali', 'zainab.ali@acme.io', 2, 2, 'Engineering Manager', 140000, null, '2020-01-15', 'Islamabad'],
  [8, 'Hamza', 'Sheikh', 'hamza.sheikh@acme.io', 2, 6, 'Senior Backend Engineer', 120000, 10000, '2020-03-01', 'Lahore'],
  [9, 'Fatima', 'Noor', 'fatima.noor@acme.io', 2, 6, 'Senior Backend Engineer', 120000, null, '2020-07-20', 'Lahore'],
  [10, 'Ali', 'Hassan', 'ali.hassan@acme.io', 2, 6, 'Backend Engineer', 95000, null, '2021-02-11', 'Lahore'],
  [11, 'Maryam', 'Iqbal', 'maryam.iqbal@acme.io', 2, 6, 'Backend Engineer', 92000, 5000, '2021-08-30', 'Karachi'],
  [12, 'Danish', 'Butt', null, 2, 7, 'Frontend Engineer', 88000, null, '2022-01-03', 'Islamabad'],
  [13, 'Iqra', 'Javed', 'iqra.javed@acme.io', 2, 7, 'Frontend Engineer', 88000, null, '2022-05-16', 'Islamabad'],
  [14, 'Saad', 'Mirza', 'saad.mirza@acme.io', 2, 7, 'Junior Engineer', 60000, null, '2023-07-01', 'Lahore'],
  [15, 'Noor', 'Fatima', 'noor.fatima@acme.io', 2, 7, 'Junior Engineer', 58000, null, '2024-02-19', 'Islamabad'],
  [16, 'Ahmed', 'Raza', 'ahmed.raza@acme.io', 3, 4, 'Product Manager', 115000, 8000, '2020-11-09', 'Lahore'],
  [17, 'Sana', 'Qureshi', 'sana.qureshi@acme.io', 3, 4, 'Product Designer', 90000, null, '2021-06-01', 'Karachi'],
  [18, 'Kamran', 'Akmal', 'kamran.akmal@acme.io', 4, 3, 'Sales Manager', 110000, 20000, '2020-02-17', 'Karachi'],
  [19, 'Rabia', 'Anwar', 'rabia.anwar@acme.io', 4, 18, 'Account Executive', 75000, 12000, '2021-03-08', 'Karachi'],
  [20, 'Faisal', 'Shah', 'faisal.shah@acme.io', 4, 18, 'Account Executive', 72000, 9000, '2021-10-25', 'Lahore'],
  [21, 'Mehwish', 'Hayat', 'mehwish.hayat@acme.io', 4, 18, 'Account Executive', 72000, null, '2022-09-12', 'Islamabad'],
  [22, 'Asad', 'Umar', 'asad.umar@acme.io', 4, 18, 'Sales Associate', 50000, 3000, '2023-04-03', 'Karachi'],
  [23, 'Komal', 'Aziz', 'komal.aziz@acme.io', 5, 1, 'Marketing Lead', 105000, 10000, '2020-05-05', 'Islamabad'],
  [24, 'Waqar', 'Younis', 'waqar.younis@acme.io', 5, 23, 'Content Strategist', 65000, null, '2022-03-14', 'Islamabad'],
  [25, 'Nida', 'Yasir', 'nida.yasir@acme.io', 5, 23, 'SEO Specialist', 62000, null, '2023-01-09', 'Lahore'],
  [26, 'Imran', 'Nazir', 'imran.nazir@acme.io', 6, 5, 'Accountant', 70000, null, '2021-01-18', 'Karachi'],
  [27, 'Ayesha', 'Omar', 'ayesha.omar@acme.io', 6, 5, 'Financial Analyst', 78000, 4000, '2022-07-07', 'Karachi'],
  [28, 'Tariq', 'Jameel', 'tariq.jameel@acme.io', 7, 1, 'HR Manager', 85000, null, '2020-08-24', 'Islamabad'],
  [29, 'Saima', 'Noor', 'saima.noor@acme.io', 7, 28, 'Recruiter', 55000, 2000, '2023-10-02', 'Lahore'],
  [30, 'Junaid', 'Khan', 'junaid.khan@acme.io', null, 6, 'Contractor', 65000, null, '2024-06-10', 'Remote'],
];

const projects = [
  [1, 'Payments API v2', 2, '2024-01-15', '2024-09-30'],
  [2, 'Mobile App Revamp', 3, '2024-03-01', null],
  [3, 'Search Service', 2, '2024-06-01', null],
  [4, 'Q4 Campaign', 5, '2024-09-01', '2024-12-31'],
  [5, 'ERP Migration', 6, '2025-01-10', null],
  [6, 'Internal Wiki', 7, '2025-02-01', null], // nobody assigned
];

const employee_projects = [
  [8, 1, 'Lead', 320], [9, 1, 'Developer', 280], [10, 1, 'Developer', 300], [6, 1, 'Reviewer', 60],
  [12, 2, 'Developer', 410], [13, 2, 'Developer', 390], [17, 2, 'Designer', 200], [16, 2, 'Lead', 150],
  [9, 3, 'Lead', 260], [11, 3, 'Developer', 240], [14, 3, 'Developer', 180], [30, 3, 'Developer', 220],
  [23, 4, 'Lead', 120], [24, 4, 'Writer', 160], [25, 4, 'Analyst', 140],
  [26, 5, 'Analyst', 90], [27, 5, 'Lead', 110], [10, 5, 'Developer', 70],
];

const firstNames = ['Adeel', 'Bushra', 'Chaudhry', 'Dua', 'Ehsan', 'Farah', 'Ghazal', 'Haris', 'Irfan', 'Javeria', 'Kashif', 'Laiba', 'Moin', 'Nadia', 'Osama', 'Parveen', 'Qasim', 'Rida', 'Shahid', 'Tooba', 'Uzair', 'Warda', 'Yahya', 'Zara', 'Emma', 'Liam', 'Sofia', 'Noah'];
const lastNames = ['Akhtar', 'Baig', 'Chaudhry', 'Durrani', 'Effendi', 'Gill', 'Hashmi', 'Jatoi', 'Kazmi', 'Lodhi', 'Memon', 'Niazi', 'Paracha', 'Rana', 'Siddiqui', 'Zaidi', 'Smith', 'Brown', 'Garcia'];
const places = [['Karachi', 'Pakistan'], ['Lahore', 'Pakistan'], ['Islamabad', 'Pakistan'], ['Dubai', 'UAE'], ['London', 'UK'], ['Toronto', 'Canada']];

const customers = [];
for (let i = 1; i <= 28; i++) {
  const fn = firstNames[i - 1];
  const ln = pick(lastNames);
  const [city, country] = i <= 18 ? places[i % 3] : pick(places);
  const signup = iso(addDays(new Date('2024-01-05'), int(0, 500)));
  const ref = i > 4 && rnd() < 0.35 ? int(1, i - 1) : null;
  customers.push([i, `${fn} ${ln}`, `${fn.toLowerCase()}.${ln.toLowerCase()}@mail.com`, city, country, signup, ref]);
}

const products = [
  [1, 'Mechanical Keyboard', 'Electronics', 89.99, 120, true],
  [2, 'Wireless Mouse', 'Electronics', 29.99, 300, true],
  [3, '27" Monitor', 'Electronics', 249.0, 45, true],
  [4, 'USB-C Hub', 'Electronics', 39.5, 200, true],
  [5, 'Noise Cancelling Headphones', 'Electronics', 199.0, 60, true],
  [6, 'Standing Desk', 'Furniture', 450.0, 15, true],
  [7, 'Ergonomic Chair', 'Furniture', 320.0, 20, true],
  [8, 'Desk Lamp', 'Furniture', 35.0, 90, true],
  [9, 'Clean Code', 'Books', 32.0, 75, true],
  [10, 'Designing Data-Intensive Applications', 'Books', 45.0, 50, true],
  [11, 'SQL Performance Explained', 'Books', 38.0, 40, true],
  [12, 'Coffee Mug', 'Accessories', 12.0, 500, true],
  [13, 'Laptop Sleeve', 'Accessories', 25.0, 150, true],
  [14, 'Webcam HD', 'Electronics', 59.0, 0, false],     // discontinued, never ordered
  [15, 'Sticker Pack', 'Accessories', 5.0, 1000, true], // never ordered
];
const orderable = products.filter((p) => p[0] !== 14 && p[0] !== 15);

// customers 25..28 never order (anti-join practice)
const orders = [], order_items = [], payments = [];
let itemId = 1, payId = 1;
const methods = ['card', 'card', 'card', 'wallet', 'bank_transfer', 'cod'];
for (let id = 1; id <= 90; id++) {
  const cust = id <= 24 ? id : int(1, 24);
  const date = new Date(Date.UTC(2025, 0, 1) + int(0, 364) * 86400000);
  const r = rnd();
  const status = r < 0.55 ? 'delivered' : r < 0.75 ? 'shipped' : r < 0.88 ? 'pending' : 'cancelled';
  orders.push([id, cust, iso(date), status]);
  const n = int(1, 4);
  const used = new Set();
  let total = 0;
  for (let k = 0; k < n; k++) {
    const p = pick(orderable);
    if (used.has(p[0])) continue;
    used.add(p[0]);
    const qty = p[2] === 'Furniture' ? 1 : int(1, 3);
    const price = rnd() < 0.15 ? Math.round(p[3] * 0.9 * 100) / 100 : p[3]; // sometimes discounted
    order_items.push([itemId++, id, p[0], qty, price]);
    total += qty * price;
  }
  total = Math.round(total * 100) / 100;
  if (status === 'cancelled') continue;
  if (status === 'pending' && rnd() < 0.6) continue; // unpaid pending orders
  const paidAt = iso(addDays(date, int(0, 3)));
  if (total > 400 && rnd() < 0.5) {
    const half = Math.round((total / 2) * 100) / 100;
    payments.push([payId++, id, half, pick(methods), paidAt]);
    payments.push([payId++, id, Math.round((total - half) * 100) / 100, pick(methods), iso(addDays(date, int(5, 20)))]);
  } else {
    payments.push([payId++, id, total, pick(methods), paidAt]);
  }
}
orders.sort((a, b) => a[2].localeCompare(b[2]) || a[0] - b[0]);

// logins in March 2025 with streaks (gaps & islands)
const logins = [];
for (let c = 1; c <= 12; c++) {
  let d = new Date(Date.UTC(2025, 2, int(1, 5)));
  const end = Date.UTC(2025, 2, 31);
  while (d.getTime() <= end) {
    const streak = int(1, c <= 3 ? 7 : 4);
    for (let k = 0; k < streak && d.getTime() <= end; k++) {
      logins.push([c, iso(d)]);
      d = addDays(d, 1);
    }
    d = addDays(d, int(1, 4));
  }
}

const sql =
  schema +
  '\n' +
  insert('departments', ['id', 'name', 'location', 'budget'], departments) +
  insert('employees', ['id', 'first_name', 'last_name', 'email', 'department_id', 'manager_id', 'job_title', 'salary', 'bonus', 'hire_date', 'city'], employees) +
  insert('projects', ['id', 'name', 'department_id', 'start_date', 'end_date'], projects) +
  insert('employee_projects', ['employee_id', 'project_id', 'role', 'hours'], employee_projects) +
  insert('customers', ['id', 'name', 'email', 'city', 'country', 'signup_date', 'referred_by'], customers) +
  insert('products', ['id', 'name', 'category', 'price', 'stock', 'is_active'], products.map((p) => [...p.slice(0, 5), p[5] ? 'true' : 'false'])) +
  insert('orders', ['id', 'customer_id', 'order_date', 'status'], orders.sort((a, b) => a[0] - b[0])) +
  insert('order_items', ['id', 'order_id', 'product_id', 'quantity', 'unit_price'], order_items) +
  insert('payments', ['id', 'order_id', 'amount', 'method', 'paid_at'], payments) +
  insert('logins', ['customer_id', 'login_date'], logins);

writeFileSync(new URL('../seed.sql', import.meta.url), '-- DB Journey practice dataset (PostgreSQL)\n' + sql);
writeFileSync(new URL('../content/seed.js', import.meta.url), '// Generated by tools/gen-seed.mjs — do not edit by hand.\nexport const SEED_SQL = ' + JSON.stringify(sql) + ';\n');
console.log({ customers: customers.length, orders: orders.length, order_items: order_items.length, payments: payments.length, logins: logins.length });
