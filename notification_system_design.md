# notification_system_design.md

---

## Stage 1 – REST API Design

A front-end colleague needs clear REST endpoints to display notifications when students log in. The platform supports three categories: **Placements**, **Events**, and **Results**.

### Core Endpoints

**1. List notifications for the authenticated student**

```
GET /api/v1/notifications
```

Headers:
```
Authorization: Bearer <token>
Accept: application/json
```

Query parameters (all optional):

| Param | Type | Description |
|---|---|---|
| type | string | Filter by `Placement`, `Event`, or `Result` |
| isRead | boolean | `true` / `false` |
| page | integer | Page number (default 1) |
| limit | integer | Items per page (default 20, max 100) |

Response `200 OK`:
```json
{
  "notifications": [
    {
      "id": "d146095a-0d86-4a34-9e69-3900a14576bc",
      "type": "Result",
      "message": "mid-sem",
      "timestamp": "2026-04-22T17:51:30Z",
      "isRead": false
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 143
  }
}
```

**2. Mark a single notification as read**

```
PATCH /api/v1/notifications/:id/read
```

Response `200 OK`:
```json
{ "id": "d146095a...", "isRead": true }
```

**3. Mark all notifications as read**

```
PATCH /api/v1/notifications/read-all
```

Response `204 No Content`

**4. Get a single notification**

```
GET /api/v1/notifications/:id
```

Response `200 OK` — same shape as a single item from the list endpoint.

**5. Delete a notification**

```
DELETE /api/v1/notifications/:id
```

Response `204 No Content`

### Real-Time Notifications

Real-time delivery is handled via **WebSockets** (Socket.IO / native WS).

On login, the front end opens:
```
WS wss://api.campus.internal/ws?token=<jwt>
```

The server authenticates the token and joins the socket to a room `student:<studentId>`. When a new notification is created:

```js
io.to(`student:${studentId}`).emit('notification:new', {
  id: "...",
  type: "Placement",
  message: "Google hiring",
  timestamp: "2026-04-22T18:00:00Z",
  isRead: false
});
```

For mass broadcasts:
```js
io.to('broadcast:all').emit('notification:new', payload);
```

---

## Stage 2 – Persistent Storage

**Recommended database: PostgreSQL**

PostgreSQL is the right choice here because:
- ACID compliance ensures notifications are marked as read consistently even under high load
- Partial indexes and composite indexes directly match the query patterns we need
- Native `ENUM` types cleanly model the three notification categories
- Scales with read replicas and connection pooling (PgBouncer) as the user base grows

### Schema

```sql
CREATE TYPE notification_type AS ENUM ('Placement', 'Event', 'Result');

CREATE TABLE students (
  id          SERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  email       TEXT        NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
  id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  INTEGER           NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  message     TEXT              NOT NULL,
  is_read     BOOLEAN           NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- Essential indexes
CREATE INDEX idx_notifications_student_unread
  ON notifications (student_id, created_at DESC)
  WHERE is_read = FALSE;

CREATE INDEX idx_notifications_type
  ON notifications (type, created_at DESC);
```

### Scaling problems as volume grows

| Problem | Cause | Solution |
|---|---|---|
| Slow unread queries | Full table scan on 5M+ rows | Partial index on `is_read = FALSE` |
| Write bottleneck on `is_read` updates | Every page load marks rows read | Batch PATCH requests; write-through cache |
| Hot rows for broadcast notifications | Many students share same message | Store broadcast once, fan out lazily |
| `ORDER BY created_at DESC` becomes slow | Index bloat | Partition `notifications` by month |

### Sample queries

```sql
-- GET /api/v1/notifications (unread, page 1)
SELECT id, type, message, is_read, created_at
FROM   notifications
WHERE  student_id = $1
  AND  is_read    = FALSE
ORDER  BY created_at DESC
LIMIT  20 OFFSET 0;

-- PATCH /api/v1/notifications/:id/read
UPDATE notifications
SET    is_read = TRUE
WHERE  id = $1 AND student_id = $2;

-- PATCH /api/v1/notifications/read-all
UPDATE notifications
SET    is_read = TRUE
WHERE  student_id = $1 AND is_read = FALSE;
```

---

## Stage 3 – Slow Query Analysis

The original query:
```sql
SELECT * FROM notifications
WHERE  studentID = 1042
  AND  isRead    = false
ORDER  BY createdAt DESC;
```

**Is the query accurate?** Functionally yes — it returns unread notifications for the student sorted newest-first. However `SELECT *` pulls every column unnecessarily.

**Why is it slow?**

Without indexes, PostgreSQL performs a sequential scan of all 5,000,000 rows, filtering at runtime. Even with an index on `studentID` alone, the database must re-check `isRead = false` against each matched row and sort the result. At scale this is O(N) per request.

**What to change?**

Add a **partial composite index**:

```sql
CREATE INDEX idx_notifications_student_unread
  ON notifications (student_id, created_at DESC)
  WHERE is_read = FALSE;
```

This index is small (only unread rows), pre-sorted by `created_at DESC`, and enables an index-only scan. Cost drops from O(N) to O(log N + k) where k is the number of unread notifications for that student.

Also replace `SELECT *` with explicit columns to avoid fetching unused data.

**Should we index every column?**

No. Each index consumes disk space and must be maintained on every write. A standalone boolean index on `is_read` has near-zero selectivity (only 2 values). Targeted, composite, partial indexes aligned with real query patterns are always preferred.

**Query: students who received a Placement notification in the last 7 days**

```sql
SELECT DISTINCT s.id, s.name, s.email
FROM   students       s
JOIN   notifications  n ON n.student_id = s.id
WHERE  n.type        = 'Placement'
  AND  n.created_at >= NOW() - INTERVAL '7 days';
```

Supporting partial index:
```sql
CREATE INDEX idx_notifications_placement_recent
  ON notifications (student_id, created_at DESC)
  WHERE type = 'Placement';
```

---

## Stage 4 – Caching Strategy

**Problem:** Every page load triggers a DB query for each student's notifications. At 50,000 concurrent students this saturates the database.

**Recommended solution: Redis read-through cache with write-time invalidation**

1. On the first request for a student's notifications, query PostgreSQL and cache the result in Redis with a 60-second TTL.
2. Subsequent requests within the TTL are served from Redis (sub-millisecond).
3. When a new notification is written or read-status changes, delete the Redis key so the next request refreshes from DB.

**Tradeoffs of each strategy:**

| Strategy | Benefit | Tradeoff |
|---|---|---|
| Redis TTL cache | Very fast reads; simple | Stale data up to TTL; extra infra |
| HTTP caching (ETag/304) | No server-side store | Only reduces client-server round trips; doesn't reduce DB load |
| Pagination + cursor | Limits per-query rows | Doesn't reduce total DB work across all users |
| DB read replica | Spreads read load | Replication lag; higher cost |
| Materialised views | Pre-computed aggregates | Complex invalidation; overkill for per-user lists |

The **Redis TTL cache** offers the best balance for this access pattern (frequent reads, infrequent writes per student).

---

## Stage 5 – Redesigning Bulk Notification Delivery

**Original pseudocode:**
```
function notify_all(student_ids: array, message: string):
    for student_id in student_ids:
        send_email(student_id, message)   # calls Email API
        save_to_db(student_id, message)   # DB insert
        push_to_app(student_id, message)  # real-time push
```

**Shortcomings:**

1. **Sequential processing** — 50,000 iterations in a single blocking loop; wall-clock time: minutes.
2. **No atomicity** — if `send_email` fails at student 200, the remaining 49,800 get nothing.
3. **No retry logic** — transient Email API failures are silently dropped.
4. **Tightly coupled operations** — a slow DB insert blocks the email for the next student.
5. **Single point of failure** — any unhandled exception kills the entire loop.

**Should saving to DB and sending the email happen atomically?**

No. They have different failure modes and performance characteristics. The correct pattern is to write to DB first (single bulk INSERT as the source of truth), then enqueue email and push jobs to a message queue where workers retry failures independently.

**Revised pseudocode:**

```
function notify_all(student_ids: array, message: string):

    # 1. Bulk insert all notification records atomically
    rows = student_ids.map(id => { student_id: id, message, is_read: false, created_at: now() })
    db.bulk_insert('notifications', rows)
    log('backend', 'info', 'db', f'Bulk inserted {len(rows)} notification records')

    # 2. Enqueue one job per student for email + push
    for student_id in student_ids:
        queue.publish('notification.email', { student_id, message })
        queue.publish('notification.push',  { student_id, message })

    log('backend', 'info', 'service', f'Enqueued {len(student_ids)} email and push jobs')

# Worker – runs in parallel, multiple instances
function handle_email_job(job):
    try:
        send_email(job.student_id, job.message)
        log('backend', 'info', 'handler', f'Email sent to {job.student_id}')
    except EmailAPIError as e:
        log('backend', 'error', 'handler', f'Email failed for {job.student_id}: {e}')
        queue.retry(job, delay=exponential_backoff(job.attempt))

function handle_push_job(job):
    try:
        push_to_app(job.student_id, job.message)
    except Exception as e:
        log('backend', 'error', 'handler', f'Push failed for {job.student_id}: {e}')
        queue.retry(job, delay=exponential_backoff(job.attempt))
```

**Handling the 200-student email failure mid-way:**

With a queue, each email job is independent. If 200 fail they are retried automatically via exponential back-off without affecting the other 49,800. A dead-letter queue captures jobs that exhaust all retries. DB records exist for all students regardless of email delivery status.

---

## Stage 6 – Priority Inbox

**Approach: Weighted Score with Recency Decay**

```
score = type_weight + recency_bonus

type_weight:
  Placement → 3
  Result    → 2
  Event     → 1

recency_bonus = 1 / (1 + hours_since_notification)
```

This ensures Placements outrank Results which outrank Events for similar-age notifications, while very recent lower-weight items can surface above stale higher-weight ones.

**Maintaining top-N efficiently as new notifications arrive:**

A **min-heap of size N** is used:
1. Calculate the score of the new notification.
2. If heap size < N, push it directly.
3. If its score > heap minimum, pop the minimum and push the new item.

This keeps the priority inbox updated in **O(log N)** time per notification, regardless of total notification count.

**Implementation:** See `notification_app_be/priority_inbox.js` for the complete working code.
