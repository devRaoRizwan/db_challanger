import d01 from './days/d01.js';
import d02 from './days/d02.js';
import d03 from './days/d03.js';
import d04 from './days/d04.js';
import d05 from './days/d05.js';
import d06 from './days/d06.js';
import d07 from './days/d07.js';
import d08 from './days/d08.js';
import d09 from './days/d09.js';
import d10 from './days/d10.js';
import d11 from './days/d11.js';
import d12 from './days/d12.js';
import d13 from './days/d13.js';
import d14 from './days/d14.js';
import d15 from './days/d15.js';
import d16 from './days/d16.js';
import d17 from './days/d17.js';
import d18 from './days/d18.js';
import d19 from './days/d19.js';
import d20 from './days/d20.js';
import d21 from './days/d21.js';
import d22 from './days/d22.js';
import d23 from './days/d23.js';
import d24 from './days/d24.js';
import d25 from './days/d25.js';
import d26 from './days/d26.js';
import d27 from './days/d27.js';
import d28 from './days/d28.js';
import d29 from './days/d29.js';
import d30 from './days/d30.js';
import d31 from './days/d31.js';
import d32 from './days/d32.js';
import d33 from './days/d33.js';
import d34 from './days/d34.js';
import d35 from './days/d35.js';
import d36 from './days/d36.js';
import d37 from './days/d37.js';
import d38 from './days/d38.js';
import d39 from './days/d39.js';
import d40 from './days/d40.js';

export const START_DATE = '2026-10-27';

export const PHASES = [
  { id: 1, title: 'SQL Foundations', days: '1–10', blurb: 'Read any table. Filter, group, join, and nest queries with confidence.' },
  { id: 2, title: 'Interview SQL', days: '11–20', blurb: 'Window functions, CTEs, ranking, and the classic interview patterns.' },
  { id: 3, title: 'Schema Design', days: '21–27', blurb: 'Model real data: keys, constraints, normalization, relationships, DML.' },
  { id: 4, title: 'Backend Internals', days: '28–36', blurb: 'Indexes, EXPLAIN, transactions, isolation, locks, N+1, pagination.' },
  { id: 5, title: 'Put It Together', days: '37–40', blurb: 'Scaling concepts, mock interviews, and a capstone.' },
];

// Course weeks run Monday → Sunday starting on START_DATE.
export const WEEKS = [
  { n: 1, title: 'SQL basics: filter, group, join' },
  { n: 2, title: 'Joins, subqueries & windows' },
  { n: 3, title: 'Interview SQL patterns' },
  { n: 4, title: 'Schema design & DML' },
  { n: 5, title: 'Indexes, transactions & locks' },
  { n: 6, title: 'Production, scaling & capstone' },
];

export const DAYS = [
  d01, d02, d03, d04, d05, d06, d07, d08, d09, d10, d11, d12, d13, d14, d15, d16, d17, d18, d19, d20, d21, d22, d23, d24, d25, d26, d27, d28, d29, d30, d31, d32, d33, d34, d35, d36, d37, d38, d39, d40,
];
