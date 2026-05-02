// this file handles authentication with the evaluation server
// it gets a bearer token and passes it to the logger so we don't have to do it manually

const { setAuthToken, Log } = require('./logger');
const http = require('http');

const AUTH_URL = 'http://20.207.122.201/evaluation-service/auth';

// simple http POST helper that works on all Node versions without external deps
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

// simple http GET helper with Authorization header support
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

// reads creds from env variables, or you can pass them in directly
async function authenticate(creds = {}) {
  const payload = {
    email: creds.email || process.env.AUTH_EMAIL,
    name: creds.name || process.env.AUTH_NAME,
    rollNo: creds.rollNo || process.env.AUTH_ROLL_NO,
    accessCode: creds.accessCode || process.env.AUTH_ACCESS_CODE,
    clientID: creds.clientID || process.env.AUTH_CLIENT_ID,
    clientSecret: creds.clientSecret || process.env.AUTH_CLIENT_SECRET,
  };

  // check if any required fields are missing before hitting the API
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

  // store the token so the logger can use it right away
  setAuthToken(result.body.access_token);

  // also expose it as an env variable so service fetch calls can reference it
  process.env.AUTH_TOKEN = result.body.access_token;

  // log to the evaluation server — token is already set above so this will succeed
  await Log('backend', 'info', 'auth', `Auth OK. Token expires in ${result.body.expires_in}s`);
  return result.body.access_token;
}

module.exports = { authenticate, httpGet };
