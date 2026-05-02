

const { setAuthToken, Log } = require('./logger');
const http = require('http');

const AUTH_URL = 'http://20.207.122.201/evaluation-service/auth';

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(url, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + (parsed.search || ''),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function authenticate(creds = {}) {
  const payload = {
    email: creds.email || process.env.AUTH_EMAIL,
    name: creds.name || process.env.AUTH_NAME,
    rollNo: creds.rollNo || process.env.AUTH_ROLL_NO,
    accessCode: creds.accessCode || process.env.AUTH_ACCESS_CODE,
    clientID: creds.clientID || process.env.AUTH_CLIENT_ID,
    clientSecret: creds.clientSecret || process.env.AUTH_CLIENT_SECRET,
  };

  const missing = Object.entries(payload)
    .filter(([, val]) => !val)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing credentials: ${missing.join(', ')}`);
  }

  const result = await httpPost(AUTH_URL, payload);

  if (result.status < 200 || result.status >= 300 || !result.body.access_token) {
    throw new Error(`Auth failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  setAuthToken(result.body.access_token);

  process.env.AUTH_TOKEN = result.body.access_token;

  await Log('backend', 'info', 'auth', `Auth OK. Token expires in ${result.body.expires_in}s`);
  return result.body.access_token;
}

module.exports = { authenticate, httpGet };
