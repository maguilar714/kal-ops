{
  "name": "kal-ops-server",
  "version": "1.0.0",
  "description": "KAL Ops backend — flags, shared state",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "pg": "^8.11.3"
  },
  "engines": {
    "node": ">=18"
  }
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

initDb()
  .then(() => {
    server.listen(PORT, () => console.log(`KAL Ops server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to init DB:', err);
    process.exit(1);
  });
