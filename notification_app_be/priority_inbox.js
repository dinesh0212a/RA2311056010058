
const express = require('express');
const { authenticate, httpGet } = require('../logging_middleware/auth');
const { Log, httpRequestLogger } = require('../logging_middleware/logger');

const app = express();
const PORT = process.env.PORT || 3002;

const NOTIFICATIONS_URL = 'http://20.207.122.201/evaluation-service/notifications';
const TOP_N = 10;

const typeWeights = {
  Placement: 3,
  Result: 2,
  Event: 1
};

app.use(httpRequestLogger);

function calcScore(notification) {
  const weight = typeWeights[notification.Type] ?? 0;
  const ageHours = (Date.now() - new Date(notification.Timestamp).getTime()) / 3_600_000;
  const recencyBonus = 1 / (1 + ageHours);
  return weight + recencyBonus;
}

class MinHeap {
  constructor() {
    this.heap = [];
  }

  get size() {
    return this.heap.length;
  }

  peek() {
    return this.heap[0] ?? null;
  }

  push(item) {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop() {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].score <= this.heap[i].score) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  bubbleDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;

      if (left < n && this.heap[left].score < this.heap[smallest].score) smallest = left;
      if (right < n && this.heap[right].score < this.heap[smallest].score) smallest = right;

      if (smallest === i) break;

      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

async function getTopN(notifications, n = TOP_N) {
  await Log('backend', 'info', 'service',
    `Picking top ${n} from ${notifications.length} total notifications`);

  const heap = new MinHeap();

  for (const notif of notifications) {
    const score = calcScore(notif);

    if (heap.size < n) {
      heap.push({ score, notif });
    } else if (score > heap.peek().score) {
      heap.pop();
      heap.push({ score, notif });
    }
  }

  const sorted = [];
  while (heap.size > 0) sorted.unshift(heap.pop());

  await Log('backend', 'info', 'service',
    `Computed top ${sorted.length}, best score: ${sorted[0]?.score.toFixed(4) ?? 'n/a'}`);

  return sorted.map(({ score, notif }) => ({
    ...notif,
    priorityScore: +score.toFixed(4),
  }));
}

async function fetchNotifications() {
  await Log('backend', 'info', 'route', 'Fetching notifications from API');

  const result = await httpGet(NOTIFICATIONS_URL, process.env.AUTH_TOKEN);

  if (result.status < 200 || result.status >= 300) {
    await Log('backend', 'error', 'route',
      `Notifications API error ${result.status}`);
    throw new Error(`HTTP ${result.status}`);
  }

  const list = result.body.notifications || [];

  await Log('backend', 'info', 'route', `Got ${list.length} notifications from API`);
  return list;
}

app.get('/api/priority-inbox', async (req, res) => {
  try {
    await Log('backend', 'info', 'route', 'Priority inbox request received');

    const notifications = await fetchNotifications();

    if (!notifications.length) {
      await Log('backend', 'warn', 'service', 'No notifications found, inbox is empty');
      return res.status(404).json({ message: 'No notifications found' });
    }

    const topNotifications = await getTopN(notifications, TOP_N);

    await Log('backend', 'info', 'service',
      `Returning top ${topNotifications.length} notifications`);

    res.json({ success: true, topNotifications });

  } catch (err) {
    await Log('backend', 'fatal', 'service',
      `Priority inbox handler error`);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

async function startServer() {
  try {
    await authenticate();
    await Log('backend', 'info', 'service', 'Priority inbox service is starting up');

    app.listen(PORT, () => {
      Log('backend', 'info', 'service', `Priority Inbox on port ${PORT}`);
      Log('backend', 'info', 'service', 'GET /api/priority-inbox ready');
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

startServer();

module.exports = { getTopN, calcScore, MinHeap };
