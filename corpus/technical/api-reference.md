# Meridian Data Platform — API Reference v3.2

## Overview

The Meridian Data Platform exposes a RESTful API for managing data pipelines, executing queries against distributed datasets, and monitoring system health. All endpoints require authentication via OAuth 2.0 bearer tokens issued by the Meridian Identity Service. The base URL for all API calls is `https://api.meridian.io/v3/`.

The API follows semantic versioning. Breaking changes are introduced only in major version increments. The current stable version is v3, which was released on January 15, 2025. Legacy v2 endpoints remain available but are deprecated and will be sunset on December 31, 2025.

## Authentication

All requests must include an `Authorization` header with a valid bearer token:

```
Authorization: Bearer <token>
```

Tokens are obtained from the `/auth/token` endpoint using client credentials or authorization code flow. Tokens expire after 3600 seconds (1 hour) by default. Refresh tokens are valid for 30 days.

### Rate Limiting

API calls are rate-limited per organization:
- **Free tier**: 100 requests/minute, 10,000 requests/day
- **Professional tier**: 1,000 requests/minute, 100,000 requests/day
- **Enterprise tier**: 10,000 requests/minute, unlimited daily

Rate limit headers are included in every response:
- `X-RateLimit-Limit`: Maximum requests per window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Unix timestamp when the window resets

## Core Endpoints

### Pipelines

#### POST /pipelines

Creates a new data pipeline. Requires `pipeline:create` scope.

**Request Body:**
```json
{
  "name": "customer-analytics-v2",
  "description": "Daily aggregation of customer behavior data",
  "source": {
    "type": "kafka",
    "config": {
      "brokers": ["kafka-1.meridian.io:9092"],
      "topic": "customer-events",
      "group_id": "analytics-consumer"
    }
  },
  "transforms": [
    {
      "type": "filter",
      "condition": "event_type IN ('purchase', 'view', 'cart_add')"
    },
    {
      "type": "aggregate",
      "window": "1h",
      "group_by": ["customer_id", "event_type"],
      "metrics": ["count", "sum(amount)"]
    }
  ],
  "sink": {
    "type": "postgresql",
    "config": {
      "connection_string": "$POSTGRES_URL",
      "table": "customer_hourly_metrics",
      "write_mode": "upsert",
      "conflict_key": ["customer_id", "event_type", "window_start"]
    }
  },
  "schedule": "0 */1 * * *"
}
```

**Response (201 Created):**
```json
{
  "id": "pipe_7f3a2b1c",
  "name": "customer-analytics-v2",
  "status": "created",
  "created_at": "2025-03-15T10:30:00Z",
  "created_by": "user_a1b2c3"
}
```

#### GET /pipelines/{pipeline_id}

Returns pipeline details including current status, last run timestamp, and error count.

#### GET /pipelines/{pipeline_id}/runs

Lists execution history for a pipeline. Supports pagination via `cursor` and `limit` parameters. Default limit is 50, maximum is 200.

#### POST /pipelines/{pipeline_id}/trigger

Manually triggers a pipeline run outside its schedule. Returns a run ID for tracking. The trigger endpoint is idempotent — calling it while a run is in progress returns the existing run ID.

### Queries

#### POST /queries

Executes a SQL query against the Meridian query engine. The engine supports ANSI SQL with extensions for time-series operations.

**Request Body:**
```json
{
  "sql": "SELECT customer_id, SUM(amount) as total FROM transactions WHERE timestamp > NOW() - INTERVAL '7 days' GROUP BY customer_id ORDER BY total DESC LIMIT 100",
  "timeout_ms": 30000,
  "cache_ttl": 300
}
```

Queries exceeding `timeout_ms` are cancelled automatically. Results are cached for `cache_ttl` seconds. Set `cache_ttl` to 0 to bypass caching.

**Response (200 OK):**
```json
{
  "query_id": "qry_8e4f5a2d",
  "status": "completed",
  "rows": 100,
  "columns": ["customer_id", "total"],
  "data": [...],
  "execution_time_ms": 1247,
  "bytes_scanned": 52428800
}
```

### Datasets

#### GET /datasets

Lists all datasets accessible to the authenticated user. Each dataset represents a logical collection of tables.

#### POST /datasets/{dataset_id}/ingest

Uploads data to a dataset. Supports CSV, JSON, and Parquet formats. Maximum file size is 500MB per request. For larger uploads, use the multipart upload API.

## Error Handling

All errors follow RFC 7807 Problem Details format:

```json
{
  "type": "https://api.meridian.io/errors/rate-limited",
  "title": "Rate Limit Exceeded",
  "status": 429,
  "detail": "Organization org_abc123 has exceeded the rate limit of 1000 requests per minute",
  "instance": "/pipelines/pipe_7f3a2b1c/trigger"
}
```

Common error codes:
- **400** Bad Request: Invalid parameters or malformed request body
- **401** Unauthorized: Missing or expired token
- **403** Forbidden: Valid token but insufficient scopes
- **404** Not Found: Resource does not exist
- **409** Conflict: Resource state conflict (e.g., pipeline already running)
- **429** Rate Limited: Too many requests
- **500** Internal Server Error: Unexpected server-side failure
- **503** Service Unavailable: System under maintenance or overloaded

## SDKs and Client Libraries

Official SDKs are available for:
- **Python**: `pip install meridian-sdk` (maintained by Dr. Sarah Chen's platform team)
- **TypeScript/Node.js**: `npm install @meridian/sdk`
- **Go**: `go get github.com/meridian-io/sdk-go`
- **Java**: Available via Maven Central as `io.meridian:sdk-java:3.2.0`

All SDKs support automatic retry with exponential backoff, connection pooling, and request signing. The TypeScript SDK was originally developed by Marcus Rivera during the Meridian 2.0 rewrite in Q3 2024.
