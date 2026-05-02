
const express = require('express');
const { authenticate, httpGet } = require('../logging_middleware/auth');
const { Log, httpRequestLogger } = require('../logging_middleware/logger');

const app = express();
const PORT = process.env.PORT || 3001;

const BASE_URL = 'http://20.207.122.201/evaluation-service';

app.use(httpRequestLogger);

async function fetchJson(path) {
  const url = `${BASE_URL}${path}`;
  await Log('backend', 'info', 'service', `Fetching ${path}`);

  const result = await httpGet(url, process.env.AUTH_TOKEN);

  if (result.status < 200 || result.status >= 300) {
    await Log('backend', 'error', 'service', `${path} error ${result.status}`);
    throw new Error(`HTTP ${result.status} from ${url}`);
  }

  await Log('backend', 'debug', 'service', `Got response from ${path}`);
  return result.body;
}

async function fetchDepots() {
  await Log('backend', 'info', 'service', 'Fetching depots from evaluation API');
  const data = await fetchJson('/depots');
  const depots = data.depots || [];
  await Log('backend', 'info', 'service', `Got ${depots.length} depots`);
  return depots;
}

async function fetchVehicles() {
  await Log('backend', 'info', 'service', 'Fetching vehicles from evaluation API');
  const data = await fetchJson('/vehicles');
  const vehicles = data.vehicles || [];
  await Log('backend', 'info', 'service', `Got ${vehicles.length} vehicles`);
  return vehicles;
}

function solveKnapsack(tasks, budget) {
  const n = tasks.length;

  const dp = new Array(budget + 1).fill(0);

  for (let i = 0; i < n; i++) {
    const { Duration: w, Impact: v } = tasks[i];
    if (w > budget) continue;

    for (let cap = budget; cap >= w; cap--) {
      if (dp[cap - w] + v > dp[cap]) {
        dp[cap] = dp[cap - w] + v;
      }
    }
  }

  const chosenTasks = [];
  let remaining = budget;
  for (let i = n - 1; i >= 0 && dp[remaining] > 0; i--) {
    const { Duration: w, Impact: v } = tasks[i];
    if (w <= remaining && dp[remaining] === dp[remaining - w] + v) {
      chosenTasks.push(tasks[i]);
      remaining -= w;
    }
  }

  const totalHours = chosenTasks.reduce((sum, t) => sum + t.Duration, 0);
  const totalImpact = chosenTasks.reduce((sum, t) => sum + t.Impact, 0);

  return { selectedTasks: chosenTasks, totalImpact, totalDuration: totalHours };
}

async function scheduleDepot(depot, vehicles) {
  await Log('backend', 'info', 'domain',
    `Scheduling depot ${depot.ID}, budget ${depot.MechanicHours}h`);

  const result = solveKnapsack(vehicles, depot.MechanicHours);

  await Log('backend', 'info', 'domain',
    `Depot ${depot.ID}: ${result.selectedTasks.length} tasks, impact ${result.totalImpact}`);

  return {
    depotId: depot.ID,
    mechanicHoursBudget: depot.MechanicHours,
    ...result,
  };
}

app.get('/api/schedule', async (req, res) => {
  try {
    await Log('backend', 'info', 'route', 'Schedule request received');

    const [depots, vehicles] = await Promise.all([fetchDepots(), fetchVehicles()]);

    if (!depots.length || !vehicles.length) {
      await Log('backend', 'warn', 'service', 'No depots or vehicles found');
      return res.status(400).json({ error: 'No data available from the evaluation API' });
    }

    const schedules = [];
    for (const depot of depots) {
      const result = await scheduleDepot(depot, vehicles);
      schedules.push(result);
    }

    await Log('backend', 'info', 'service', `Done scheduling ${schedules.length} depots`);
    res.json({ success: true, schedules });

  } catch (err) {
    await Log('backend', 'error', 'handler', `Schedule handler error`);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

async function startServer() {
  try {
    await authenticate();
    await Log('backend', 'info', 'service', 'Scheduler service starting');

    app.listen(PORT, () => {
      Log('backend', 'info', 'service', `Scheduler running on port ${PORT}`);
      Log('backend', 'info', 'service', 'GET /api/schedule is ready');
    });
  } catch (err) {
    console.error('Startup failed:', err.message);
    process.exit(1);
  }
}

startServer();
