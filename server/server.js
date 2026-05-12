const http = require('http');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ALLOWED_ORIGIN = 'https://my.casepeer.com';

// Postgres connection
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create table if it doesn't exist
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_flags (
      case_name TEXT PRIMARY KEY,
      flag      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('DB ready');
}

// CORS + JSON headers
function setHeaders(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

// Parse request body
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch(e) { reject(e); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  setHeaders(res, origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  // GET /health
  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // GET /flags — return all flags as { caseName: flag }
  if (req.method === 'GET' && url === '/flags') {
    try {
      const result = await pool.query('SELECT case_name, flag FROM case_flags');
      const flags = {};
      result.rows.forEach(r => { flags[r.case_name] = r.flag; });
      res.writeHead(200);
      res.end(JSON.stringify(flags));
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'DB error' }));
    }
    return;
  }

  // POST /flags — body: { caseName, flag }
  if (req.method === 'POST' && url === '/flags') {
    try {
      const body = await readBody(req);
      const { caseName, flag } = body;
      if (!caseName || !flag) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'caseName and flag required' }));
        return;
      }
      await pool.query(`
        INSERT INTO case_flags (case_name, flag, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (case_name) DO UPDATE SET flag = $2, updated_at = NOW()
      `, [caseName, flag]);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'DB error' }));
    }
    return;
  }

  // DELETE /flags — body: { caseName }
  if (req.method === 'DELETE' && url === '/flags') {
    try {
      const body = await readBody(req);
      const { caseName } = body;
      if (!caseName) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'caseName required' }));
        return;
      }
      await pool.query('DELETE FROM case_flags WHERE case_name = $1', [caseName]);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'DB error' }));
    }
    return;
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Start server immediately — DB init retries in background
server.listen(PORT, () => console.log(`KAL Ops server running on port ${PORT}`));

async function initDbWithRetry(attempts) {
  for (let i = 0; i < attempts; i++) {
    try {
      await initDb();
      return;
    } catch (err) {
      console.error(`DB init attempt ${i+1} failed:`, err.message);
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.error('DB init failed after all attempts — flags will not persist');
}

initDbWithRetry(10);
