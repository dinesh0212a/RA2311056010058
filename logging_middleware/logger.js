const LOG_URL = 'http://20.207.122.201/evaluation-service/logs';

let authToken = process.env.AUTH_TOKEN || '';

function setAuthToken(token) {
  authToken = token;
}

const validStacks = new Set(['backend', 'frontend']);
const validLevels = new Set(['debug', 'info', 'warn', 'error', 'fatal']);

const backendPackages = new Set([
  'cache', 'controller', 'cron_job', 'db', 'domain',
  'handler', 'repository', 'route', 'service'
]);

const frontendPackages = new Set([
  'api', 'component', 'hook', 'page', 'state', 'style'
]);

const sharedPackages = new Set(['auth', 'config', 'middleware', 'utils']);

function isPackageValid(stack, pkg) {
  if (sharedPackages.has(pkg)) return true;
  if (stack === 'backend') return backendPackages.has(pkg);
  if (stack === 'frontend') return frontendPackages.has(pkg);
  return false;
}

async function Log(stack, level, pkg, message) {
  if (!validStacks.has(stack)) {
    console.error(`Invalid stack: "${stack}". Use 'backend' or 'frontend'`);
    return null;
  }

  if (!validLevels.has(level)) {
    console.error(`Invalid level: "${level}". Use debug/info/warn/error/fatal`);
    return null;
  }

  if (!isPackageValid(stack, pkg)) {
    console.error(`"${pkg}" is not a valid package for stack "${stack}"`);
    return null;
  }

  if (!message || typeof message !== 'string') {
    console.error('Log message must be a non-empty string');
    return null;
  }

  if (!authToken) {
    console.error('No auth token set. Call authenticate() before logging.');
    return null;
  }

  const body = {
    stack,
    level,
    package: pkg,
    message
  };

  try {
    const res = await fetch(LOG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`Log API error ${res.status}:`, data);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Could not reach log API:', err.message);
    return null;
  }
}

const makeLogger = (stack) => ({
  debug: (pkg, msg) => Log(stack, 'debug', pkg, msg),
  info: (pkg, msg) => Log(stack, 'info', pkg, msg),
  warn: (pkg, msg) => Log(stack, 'warn', pkg, msg),
  error: (pkg, msg) => Log(stack, 'error', pkg, msg),
  fatal: (pkg, msg) => Log(stack, 'fatal', pkg, msg),
});

const backendLogger = makeLogger('backend');
const frontendLogger = makeLogger('frontend');

function httpRequestLogger(req, res, next) {
  const startTime = Date.now();

  Log('backend', 'info', 'middleware',
    `${req.method} ${req.url} received`);

  const originalSend = res.send.bind(res);
  res.send = (responseBody) => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 500 ? 'error'
      : res.statusCode >= 400 ? 'warn'
        : 'info';

    Log('backend', logLevel, 'middleware',
      `${req.method} ${req.url} ${res.statusCode} ${duration}ms`);

    return originalSend(responseBody);
  };

  next();
}

module.exports = {
  Log,
  setAuthToken,
  backendLogger,
  frontendLogger,
  httpRequestLogger,
};
