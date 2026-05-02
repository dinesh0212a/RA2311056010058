# Backend Track – Campus Hiring Evaluation

## Overview

This repository contains my submission for the **Backend Track** of the campus hiring evaluation. It includes a reusable logging middleware and two backend microservices, each with the logging middleware integrated throughout.

---

## Repository Structure

```
.
├── logging_middleware/               # Shared logging package
│   ├── logger.js                     # Log(stack, level, package, message) + Express middleware
│   ├── auth.js                       # authenticate() – obtains Bearer token from evaluation server
│   └── package.json
│
├── vehicle_maintence_scheduler/      # Vehicle Maintenance Scheduler Microservice
│   ├── scheduler.js                  # 0/1 Knapsack DP – picks optimal tasks per depot
│   ├── screenshots/                  # Postman output screenshots
│   └── package.json
│
├── notification_app_be/              # Campus Notification Platform – Backend
│   ├── priority_inbox.js             # Stage 6: Priority Inbox using MinHeap + scoring
│   ├── screenshots/                  # Postman output screenshots
│   └── package.json
│
├── notification_system_design.md     # Stages 1–6 design and architecture document
├── .gitignore
└── README.md
```

---

## Logging Middleware

Every service uses a shared `Log(stack, level, package, message)` function defined in `logging_middleware/logger.js`. This function sends each log entry to the evaluation server's log API as a POST request with a Bearer token.

```js
Log('backend', 'info', 'service', 'Scheduler starting')
Log('backend', 'error', 'handler', 'Knapsack failed: budget is negative')
```

Allowed values:
- **stack**: `backend`, `frontend`
- **level**: `debug`, `info`, `warn`, `error`, `fatal`
- **package** (backend): `cache`, `controller`, `cron_job`, `db`, `domain`, `handler`, `repository`, `route`, `service`
- **package** (shared): `auth`, `config`, `middleware`, `utils`

An Express middleware (`httpRequestLogger`) is also included and applied to every route — it logs each incoming request and its response automatically.

---

## Vehicle Maintenance Scheduler

Fetches depots and vehicle maintenance tasks from the evaluation API and uses a **0/1 Knapsack dynamic programming** algorithm to select the optimal set of tasks for each depot without exceeding its mechanic-hour budget.

- **Algorithm**: Bottom-up DP, O(n × budget) time, O(budget) space
- **No external algorithm libraries used** — implemented from scratch
- **Endpoint**: `GET /api/schedule`

---

## Campus Notification Platform – Backend

Implements Stages 1–6 of the notification platform design. The Stage 6 code fetches live notifications from the evaluation API and ranks them using a **weighted priority score with recency decay**, maintained efficiently via a **Min-Heap of size N**.

```
score = type_weight + recency_bonus
type_weight:  Placement = 3, Result = 2, Event = 1
recency_bonus = 1 / (1 + hours_since_notification)
```

- **Endpoint**: `GET /api/priority-inbox`
- **No database** — notifications are fetched live and ranked in-memory

---

## Environment Variables

Create a `.env` file at the root (never commit it) with:

```
AUTH_EMAIL=your@college.edu
AUTH_NAME=Your Name
AUTH_ROLL_NO=yourRollNumber
AUTH_ACCESS_CODE=yourAccessCode
AUTH_CLIENT_ID=yourClientID
AUTH_CLIENT_SECRET=yourClientSecret
```

---

## Running the Services

### Vehicle Maintenance Scheduler
```bash
cd vehicle_maintence_scheduler
npm install
node scheduler.js
# GET http://localhost:3001/api/schedule
```

### Priority Inbox
```bash
cd notification_app_be
npm install
node priority_inbox.js
# GET http://localhost:3002/api/priority-inbox
```

---

## Notes

- No data is hardcoded — all values come from the evaluation APIs
- No external algorithm libraries used
- `console.log` is not used for application logging — all logs go through the `Log()` middleware
