const http = require('http');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ALLOWED_ORIGIN = 'https://my.casepeer.com';

// Bearer token gating the /quo-data transcript endpoints. Set in Railway env vars.
// These endpoints are server-to-server only (extract job writes, brief tasks read) —
// never called from a browser, so the token never lands in client code.
const SHARED_SECRET = process.env.SHARED_SECRET;

// Transcript retention window. Rows older than this are purged on a sweep.
const TRANSCRIPT_TTL_HOURS = 48;

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Returns true if the request carries the correct bearer token. Otherwise writes
// a 401 and returns false. Constant-time compare to avoid timing leaks.
function requireAuth(req, res) {
  const header = req.headers['authorization'] || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = SHARED_SECRET || '';
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  const ok = expected.length > 0 && a.length === b.length &&
             require('crypto').timingSafeEqual(a, b);
  if (!ok) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS case_flags (case_name TEXT PRIMARY KEY, flag TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS case_notes (case_name TEXT PRIMARY KEY, note TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS case_contacts (case_name TEXT PRIMARY KEY, adjuster_email TEXT, claim_number TEXT, adjuster_name TEXT, adjuster_phone TEXT, fee_amount TEXT, fee_rate TEXT, email_log TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
  // Backfill columns for deployments created before these fields existed.
  await pool.query(`ALTER TABLE case_contacts ADD COLUMN IF NOT EXISTS email_log TEXT`);
  await pool.query(`ALTER TABLE case_contacts ADD COLUMN IF NOT EXISTS adjuster_name TEXT`);
  await pool.query(`ALTER TABLE case_contacts ADD COLUMN IF NOT EXISTS adjuster_phone TEXT`);
  await pool.query(`ALTER TABLE case_contacts ADD COLUMN IF NOT EXISTS fee_amount TEXT`);
  await pool.query(`ALTER TABLE case_contacts ADD COLUMN IF NOT EXISTS fee_rate TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS case_junior (case_name TEXT PRIMARY KEY, liability TEXT, health_insurance TEXT, policy_3p TEXT, uim TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quo_calls (phone TEXT PRIMARY KEY, cm_name TEXT, call_date TEXT, duration_sec INT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
  // Encrypted daily Quo extract. `payload` is a Fernet token (ciphertext) — the
  // server never decrypts it. created_at drives the 48h purge.
  await pool.query(`CREATE TABLE IF NOT EXISTS quo_transcripts (extract_date TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
  console.log('DB ready');
}

function setHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch(e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  setHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/health') { res.writeHead(200); res.end(JSON.stringify({ status: 'ok' })); return; }

  // FLAGS
  if (req.method === 'GET' && url === '/flags') {
    try {
      const result = await pool.query('SELECT case_name, flag FROM case_flags');
      const flags = {}; result.rows.forEach(r => { flags[r.case_name] = r.flag; });
      res.writeHead(200); res.end(JSON.stringify(flags));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }
  if (req.method === 'POST' && url === '/flags') {
    try {
      const { caseName, flag } = await readBody(req);
      if (!caseName || !flag) { res.writeHead(400); res.end(JSON.stringify({ error: 'caseName and flag required' })); return; }
      await pool.query(`INSERT INTO case_flags (case_name, flag, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (case_name) DO UPDATE SET flag=$2, updated_at=NOW()`, [caseName, flag]);
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }
  if (req.method === 'DELETE' && url === '/flags') {
    try {
      const { caseName } = await readBody(req);
      if (!caseName) { res.writeHead(400); res.end(JSON.stringify({ error: 'caseName required' })); return; }
      await pool.query('DELETE FROM case_flags WHERE case_name=$1', [caseName]);
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }

  // NOTES
  if (req.method === 'GET' && url === '/notes') {
    try {
      const result = await pool.query('SELECT case_name, note FROM case_notes');
      const notes = {}; result.rows.forEach(r => { notes[r.case_name] = r.note; });
      res.writeHead(200); res.end(JSON.stringify(notes));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }
  if (req.method === 'POST' && url === '/notes') {
    try {
      const { caseName, note } = await readBody(req);
      if (!caseName || !note) { res.writeHead(400); res.end(JSON.stringify({ error: 'caseName and note required' })); return; }
      await pool.query(`INSERT INTO case_notes (case_name, note, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (case_name) DO UPDATE SET note=$2, updated_at=NOW()`, [caseName, note]);
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }
  if (req.method === 'DELETE' && url === '/notes') {
    try {
      const { caseName } = await readBody(req);
      if (!caseName) { res.writeHead(400); res.end(JSON.stringify({ error: 'caseName required' })); return; }
      await pool.query('DELETE FROM case_notes WHERE case_name=$1', [caseName]);
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }

  // CONTACTS
  if (req.method === 'GET' && url === '/contacts') {
    try {
      const result = await pool.query('SELECT case_name, adjuster_email, claim_number, adjuster_name, adjuster_phone, fee_amount, fee_rate, email_log FROM case_contacts');
      const contacts = {};
      result.rows.forEach(r => {
        contacts[r.case_name] = {
          adjusterEmail: r.adjuster_email,
          claimNumber: r.claim_number,
          adjusterName: r.adjuster_name,
          adjusterPhone: r.adjuster_phone,
          feeAmount: r.fee_amount,
          feeRate: r.fee_rate,
          emailLog: r.email_log ? JSON.parse(r.email_log) : null
        };
      });
      res.writeHead(200); res.end(JSON.stringify(contacts));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }
  if (req.method === 'POST' && url === '/contacts') {
    try {
      const body = await readBody(req);
      const caseName = body.caseName;
      if (!caseName) { res.writeHead(400); res.end(JSON.stringify({ error: 'caseName required' })); return; }

      // Map incoming JSON keys -> DB columns. Whitelisted: column names never come
      // from user input, so this is injection-safe. Only keys actually present in
      // the body are written. A key present with null clears that column; an absent
      // key leaves it unchanged. This is what makes single-field saves (e.g. just
      // adjusterName) not wipe the other fields, and lets the fee-override clear
      // button (feeAmount: null) actually clear.
      const COLMAP = {
        adjusterEmail: 'adjuster_email',
        claimNumber:   'claim_number',
        adjusterName:  'adjuster_name',
        adjusterPhone: 'adjuster_phone',
        feeAmount:     'fee_amount',
        feeRate:       'fee_rate',
        emailLog:      'email_log'
      };

      const cols = [], vals = [];
      Object.keys(COLMAP).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(body, key)) return; // absent -> leave unchanged
        let v = body[key];
        if (v === null || v === undefined) v = null;
        else if (key === 'emailLog') v = JSON.stringify(v);
        else v = String(v);
        cols.push(COLMAP[key]);
        vals.push(v);
      });

      if (cols.length === 0) {
        // No data fields sent — just ensure the row exists.
        await pool.query(`INSERT INTO case_contacts (case_name, updated_at) VALUES ($1, NOW()) ON CONFLICT (case_name) DO UPDATE SET updated_at = NOW()`, [caseName]);
        res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
      }

      const insertCols = ['case_name'].concat(cols).concat('updated_at');
      const insertVals = ['$1'].concat(cols.map((_, i) => '$' + (i + 2))).concat('NOW()');
      const updateSet  = cols.map((c, i) => c + ' = $' + (i + 2)).concat('updated_at = NOW()').join(', ');

      await pool.query(
        `INSERT INTO case_contacts (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')})
         ON CONFLICT (case_name) DO UPDATE SET ${updateSet}`,
        [caseName].concat(vals)
      );
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }
  if (req.method === 'DELETE' && url === '/contacts') {
    try {
      const { caseName } = await readBody(req);
      if (!caseName) { res.writeHead(400); res.end(JSON.stringify({ error: 'caseName required' })); return; }
      await pool.query('DELETE FROM case_contacts WHERE case_name=$1', [caseName]);
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }

  // QUO CALLS — CM intro call tracking, keyed by client phone number
  if (req.method === 'GET' && url === '/quo-calls') {
    try {
      const result = await pool.query('SELECT phone, cm_name, call_date, duration_sec FROM quo_calls');
      const data = {};
      result.rows.forEach(r => {
        data[r.phone] = { cm: r.cm_name, date: r.call_date, duration_sec: r.duration_sec };
      });
      res.writeHead(200); res.end(JSON.stringify(data));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }
  if (req.method === 'POST' && url === '/quo-calls') {
    try {
      const { phone, cm, date, duration_sec } = await readBody(req);
      if (!phone) { res.writeHead(400); res.end(JSON.stringify({ error: 'phone required' })); return; }
      // Only upsert if this call is more recent than what's stored
      await pool.query(`
        INSERT INTO quo_calls (phone, cm_name, call_date, duration_sec, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (phone) DO UPDATE SET
          cm_name      = CASE WHEN $3::text > quo_calls.call_date THEN $2::text ELSE quo_calls.cm_name END,
          duration_sec = CASE WHEN $3::text > quo_calls.call_date THEN $4::int  ELSE quo_calls.duration_sec END,
          call_date    = CASE WHEN $3::text > quo_calls.call_date THEN $3::text ELSE quo_calls.call_date END,
          updated_at   = NOW()
      `, [phone, cm, date, duration_sec || 0]);
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }

  // JUNIOR FIELDS (liability, health_insurance, policy_3p, uim)
  if (req.method === 'GET' && url === '/junior') {
    try {
      const result = await pool.query('SELECT case_name, liability, health_insurance, policy_3p, uim FROM case_junior');
      const data = {};
      result.rows.forEach(r => {
        data[r.case_name] = { liability: r.liability, healthInsurance: r.health_insurance, policy3p: r.policy_3p, uim: r.uim };
      });
      res.writeHead(200); res.end(JSON.stringify(data));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }
  if (req.method === 'POST' && url === '/junior') {
    try {
      const { caseName, liability, healthInsurance, policy3p, uim } = await readBody(req);
      if (!caseName) { res.writeHead(400); res.end(JSON.stringify({ error: 'caseName required' })); return; }
      await pool.query(`
        INSERT INTO case_junior (case_name, liability, health_insurance, policy_3p, uim, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (case_name) DO UPDATE SET
          liability        = CASE WHEN $2::text IS NOT NULL THEN $2::text ELSE case_junior.liability END,
          health_insurance = CASE WHEN $3::text IS NOT NULL THEN $3::text ELSE case_junior.health_insurance END,
          policy_3p        = CASE WHEN $4::text IS NOT NULL THEN $4::text ELSE case_junior.policy_3p END,
          uim              = CASE WHEN $5::text IS NOT NULL THEN $5::text ELSE case_junior.uim END,
          updated_at = NOW()
      `, [caseName,
          liability !== undefined ? liability : null,
          healthInsurance !== undefined ? healthInsurance : null,
          policy3p !== undefined ? policy3p : null,
          uim !== undefined ? uim : null]);
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }
  if (req.method === 'DELETE' && url === '/junior') {
    try {
      const { caseName } = await readBody(req);
      if (!caseName) { res.writeHead(400); res.end(JSON.stringify({ error: 'caseName required' })); return; }
      await pool.query('DELETE FROM case_junior WHERE case_name=$1', [caseName]);
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }

  // QUO TRANSCRIPTS — encrypted daily extract. Bearer-auth, server-to-server only.
  // POST: extract job stores the encrypted payload for a date.
  // GET:  brief tasks fetch the encrypted payload to decrypt locally.
  if (req.method === 'POST' && url === '/quo-data') {
    if (!requireAuth(req, res)) return;
    try {
      const { date, payload } = await readBody(req);
      if (!date || !payload) { res.writeHead(400); res.end(JSON.stringify({ error: 'date and payload required' })); return; }
      await pool.query(`INSERT INTO quo_transcripts (extract_date, payload, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (extract_date) DO UPDATE SET payload=$2, created_at=NOW()`, [date, payload]);
      res.writeHead(200); res.end(JSON.stringify({ ok: true, bytes: payload.length }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }
  if (req.method === 'GET' && url === '/quo-data') {
    if (!requireAuth(req, res)) return;
    try {
      const qs = new URLSearchParams(req.url.split('?')[1] || '');
      const date = qs.get('date');
      if (!date) { res.writeHead(400); res.end(JSON.stringify({ error: 'date query param required' })); return; }
      const result = await pool.query('SELECT extract_date, payload, created_at FROM quo_transcripts WHERE extract_date=$1', [date]);
      if (result.rows.length === 0) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found', date })); return; }
      const row = result.rows[0];
      res.writeHead(200); res.end(JSON.stringify({ date: row.extract_date, payload: row.payload, created_at: row.created_at }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB error' })); }
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
});

// Purge transcript rows older than the retention window. Runs at boot and hourly.
async function purgeOldTranscripts() {
  try {
    const r = await pool.query(`DELETE FROM quo_transcripts WHERE created_at < NOW() - INTERVAL '${TRANSCRIPT_TTL_HOURS} hours'`);
    if (r.rowCount) console.log(`Purged ${r.rowCount} expired transcript row(s)`);
  } catch(e) { console.error('Transcript purge failed:', e.message); }
}
setInterval(purgeOldTranscripts, 60 * 60 * 1000);
setTimeout(purgeOldTranscripts, 15000);

server.listen(PORT, () => console.log(`KAL Ops server running on port ${PORT}`));

async function initDbWithRetry(attempts) {
  for (let i = 0; i < attempts; i++) {
    try { await initDb(); return; }
    catch(err) {
      console.error(`DB init attempt ${i+1} failed:`, err.message);
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.error('DB init failed after all attempts');
}

initDbWithRetry(10);
