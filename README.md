# Campus Hiring Evaluation – Backend

**Campus Hiring | Backend Track**

## Repository Structure

```
.
├── logging_middleware/                  # Reusable Log() middleware
│   ├── logger.js                        # Log(stack,level,package,message) + Express middleware
│   ├── auth.js                          # authenticate() helper – obtains Bearer token
│   └── package.json
│
├── vehicle_maintence_scheduler/         # Vehicle Maintenance Scheduler Microservice
│   ├── scheduler.js                     # 0/1 Knapsack DP solver
│   └── package.json
│
├── notification_app_be/                 # Campus Notification Platform – Backend
│   ├── priority_inbox.js                # Stage 6: Priority Inbox (MinHeap + score)
│   └── package.json
│
├── notification_system_design.md        # Stages 1-6 design document
├── .gitignore
└── README.md
```

## Environment Variables

Create a `.env` file (never commit it) with your credentials from the registration step:

```
AUTH_EMAIL=your@college.edu
AUTH_NAME=Your Name
AUTH_ROLL_NO=yourRollNumber
AUTH_ACCESS_CODE=yourAccessCode
AUTH_CLIENT_ID=yourClientID
AUTH_CLIENT_SECRET=yourClientSecret
```

Load it before running any service:
```bash
export $(cat .env | xargs)
```

## Running the Services

### Vehicle Maintenance Scheduler

```bash
cd vehicle_maintence_scheduler
npm install
node scheduler.js
```
The server will start on port 3001. You can test it via:
`GET http://localhost:3001/api/schedule`

### Priority Inbox (Stage 6)

```bash
cd notification_app_be
npm install
node priority_inbox.js
```
The server will start on port 3002. You can test it via:
`GET http://localhost:3002/api/priority-inbox`

## Logging

All services use the shared `logging_middleware/logger.js` which calls the evaluation server's Log API (`POST /evaluation-service/logs`) on every significant event. `console.log` and built-in loggers are not used for application logging.

Log function signature:
```js
Log(stack, level, package, message)
// e.g.
Log('backend', 'info', 'service', 'Scheduler starting')
Log('backend', 'error', 'handler', 'Knapsack failed: budget is negative')
```

## Notes

- No external algorithm libraries are used. Knapsack and MinHeap are implemented from scratch.
- APIs are treated as pre-authorised (no registration/login flow in the app itself).
- No data is hard-coded; all values come from the evaluation APIs.
