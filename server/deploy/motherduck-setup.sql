-- MESS Exchange - MotherDuck Setup
-- Run this in MotherDuck to set up views for querying events from R2
--
-- Prerequisites:
-- 1. Create R2 API token in Cloudflare dashboard (Account → R2 → Manage R2 API Tokens)
-- 2. Run CREATE SECRET below with your credentials

-- ============ Setup ============

-- Create database
CREATE DATABASE IF NOT EXISTS mess_exchange;
USE mess_exchange;

-- Create R2 credentials secret (run once, replace with your values)
-- Find these in Cloudflare dashboard: R2 → Manage R2 API Tokens → Create API Token
--
-- CREATE SECRET r2_creds (
--   TYPE R2,
--   KEY_ID 'your-access-key-id',
--   SECRET 'your-secret-access-key', 
--   ACCOUNT_ID 'your-cloudflare-account-id'
-- );

-- ============ Views ============

-- Raw events view
CREATE OR REPLACE VIEW raw_events AS
SELECT 
  *,
  regexp_extract(filename, 'exchange=([^/]+)', 1) AS exchange_from_path
FROM read_json_auto(
  'r2://mess-exchange/events/**/*.jsonl',
  hive_partitioning = true,
  filename = true,
  union_by_name = true
);

-- Current thread state (latest status for each thread)
CREATE OR REPLACE VIEW threads AS
WITH creates AS (
  SELECT 
    thread_ref,
    exchange_id,
    ts AS created_at,
    payload->>'intent' AS intent,
    payload->>'priority' AS priority,
    payload->>'requestor_id' AS requestor_id
  FROM raw_events
  WHERE event_type = 'thread_created'
),
latest_status AS (
  SELECT 
    thread_ref,
    exchange_id,
    payload->>'new_status' AS status,
    payload->>'executor_id' AS executor_id,
    ts AS status_changed_at,
    ROW_NUMBER() OVER (PARTITION BY exchange_id, thread_ref ORDER BY ts DESC) AS rn
  FROM raw_events
  WHERE event_type = 'status_changed'
),
last_activity AS (
  SELECT 
    thread_ref,
    exchange_id,
    MAX(ts) AS updated_at
  FROM raw_events
  WHERE thread_ref IS NOT NULL
  GROUP BY thread_ref, exchange_id
)
SELECT 
  c.thread_ref AS ref,
  c.exchange_id,
  COALESCE(s.status, 'pending') AS status,
  c.intent,
  c.priority,
  c.requestor_id,
  s.executor_id,
  c.created_at,
  a.updated_at
FROM creates c
LEFT JOIN latest_status s 
  ON c.thread_ref = s.thread_ref 
  AND c.exchange_id = s.exchange_id 
  AND s.rn = 1
LEFT JOIN last_activity a
  ON c.thread_ref = a.thread_ref
  AND c.exchange_id = a.exchange_id;

-- Messages view
CREATE OR REPLACE VIEW messages AS
SELECT 
  thread_ref AS ref,
  exchange_id,
  actor_id AS from_id,
  ts AS received_at,
  payload->'mess' AS mess
FROM raw_events
WHERE event_type IN ('message_added')
  AND thread_ref IS NOT NULL
ORDER BY ts;

-- Executors view (from registration events)
CREATE OR REPLACE VIEW executor_registrations AS
SELECT 
  exchange_id,
  actor_id AS executor_id,
  payload->>'display_name' AS display_name,
  payload->'capabilities' AS capabilities,
  ts AS registered_at
FROM raw_events
WHERE event_type = 'executor_registered';

-- ============ Example Queries ============

-- List pending requests for an exchange
-- SELECT * FROM threads WHERE exchange_id = 'home' AND status = 'pending';

-- Get all messages for a thread
-- SELECT * FROM messages WHERE exchange_id = 'home' AND ref = '2025-01-31-ABCD';

-- Daily request count
-- SELECT 
--   DATE_TRUNC('day', created_at::timestamp) AS day,
--   COUNT(*) AS requests,
--   COUNT(*) FILTER (WHERE status = 'completed') AS completed
-- FROM threads
-- WHERE exchange_id = 'home'
-- GROUP BY 1 ORDER BY 1;

-- Average time to completion
-- SELECT 
--   AVG(EPOCH(updated_at::timestamp) - EPOCH(created_at::timestamp)) / 60 AS avg_minutes
-- FROM threads
-- WHERE status = 'completed';

-- Executor activity
-- SELECT 
--   executor_id,
--   COUNT(*) AS threads_handled,
--   COUNT(*) FILTER (WHERE status = 'completed') AS completed
-- FROM threads
-- WHERE executor_id IS NOT NULL
-- GROUP BY executor_id;

