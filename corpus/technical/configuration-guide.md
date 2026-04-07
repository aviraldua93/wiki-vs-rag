# Meridian Data Platform — Configuration Guide

## Introduction

This guide covers configuration options for the Meridian Data Platform, including cluster setup, pipeline configuration, security settings, and performance tuning. Configuration can be managed through the web console, CLI tool (`meridian-ctl`), or directly via the Configuration API.

All configuration values follow a hierarchical namespace pattern: `<subsystem>.<component>.<parameter>`. Organization-level settings override system defaults, and pipeline-level settings override organization defaults.

## Cluster Configuration

### Compute Resources

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `cluster.workers.count` | 8 | 2–256 | Number of worker nodes per region |
| `cluster.workers.cpu_cores` | 16 | 4–128 | CPU cores allocated per worker |
| `cluster.workers.memory_gb` | 64 | 16–512 | RAM allocated per worker |
| `cluster.workers.disk_type` | `nvme` | `nvme`, `ssd`, `hdd` | Storage type for hot tier |
| `cluster.workers.disk_gb` | 500 | 100–4000 | Disk capacity per worker |
| `cluster.coordinator.count` | 3 | 3–7 | Must be odd number for Raft consensus |

### Networking

The cluster networking configuration controls inter-node communication, API gateway settings, and external connectivity.

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `network.api_gateway.port` | 443 | 1–65535 | External API port |
| `network.grpc.port` | 9090 | 1–65535 | Internal gRPC port |
| `network.grpc.max_message_size_mb` | 64 | 1–256 | Maximum gRPC message size |
| `network.tls.min_version` | `1.3` | `1.2`, `1.3` | Minimum TLS version |
| `network.mTLS.enabled` | `true` | boolean | Inter-service mTLS |

**Important**: Changing `network.grpc.port` requires a rolling restart of all services. Plan for approximately 15 minutes of degraded performance during the restart window.

## Pipeline Configuration

### Source Connectors

Meridian supports the following source connector types:

**Kafka**: For streaming event data
```yaml
source:
  type: kafka
  config:
    brokers:
      - kafka-1.meridian.io:9092
      - kafka-2.meridian.io:9092
    topic: customer-events
    group_id: meridian-consumer
    auto_offset_reset: earliest
    max_poll_records: 500
    session_timeout_ms: 30000
```

**HTTP**: For webhook-based data ingestion
```yaml
source:
  type: http
  config:
    path: /ingest/webhooks
    auth_type: hmac_sha256
    secret_env_var: WEBHOOK_SECRET
    max_body_size_mb: 10
    batch_timeout_ms: 5000
```

**File Watcher**: For batch file processing
```yaml
source:
  type: file_watcher
  config:
    path: /data/incoming/
    pattern: "*.parquet"
    poll_interval_seconds: 60
    archive_processed: true
    archive_path: /data/processed/
```

**PostgreSQL CDC**: For change data capture from PostgreSQL databases
```yaml
source:
  type: postgres_cdc
  config:
    connection_string: $POSTGRES_CDC_URL
    publication: meridian_pub
    slot_name: meridian_slot
    tables:
      - public.orders
      - public.customers
```

### Transform Configuration

Transforms are applied sequentially in the order defined. Each transform receives the output of the previous transform as input.

| Transform Type | Description | Key Parameters |
|---------------|-------------|----------------|
| `filter` | Row-level filtering | `condition` (SQL WHERE clause) |
| `map` | Column transformations | `expressions` (SQL SELECT list) |
| `aggregate` | Windowed aggregation | `window`, `group_by`, `metrics` |
| `join` | Cross-stream joining | `right_source`, `join_key`, `window` |
| `deduplicate` | Remove duplicates | `key_columns`, `window` |
| `schema_evolution` | Handle schema changes | `strategy`: `permissive` or `strict` |

### Sink Configuration

Sinks define where processed data is written. Supported sinks include PostgreSQL, BigQuery, S3, Elasticsearch, and Meridian's internal MeridianDB.

**Write Modes:**
- `append`: Always insert new rows
- `upsert`: Insert or update based on conflict key
- `replace`: Drop and recreate table on each write
- `merge`: SCD Type 2 merge (maintains history)

## Storage Configuration

### Tiered Storage

| Parameter | Default | Description |
|-----------|---------|-------------|
| `storage.hot.retention_days` | 7 | Days to keep data in hot tier |
| `storage.warm.retention_days` | 90 | Days to keep data in warm tier |
| `storage.cold.retention_days` | 365 | Days to keep data in cold tier (0 = forever) |
| `storage.compaction.interval_hours` | 4 | Background compaction frequency |
| `storage.compaction.target_file_size_mb` | 256 | Target file size after compaction |
| `storage.replication_factor` | 3 | Number of data replicas |

**Note**: Changing `storage.replication_factor` on an existing cluster triggers a rebalance operation that can take several hours depending on data volume. Dr. Sarah Chen recommends scheduling this during maintenance windows.

## Query Engine Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `query.max_concurrent` | 50 | Maximum concurrent queries per coordinator |
| `query.timeout_ms` | 30000 | Default query timeout |
| `query.max_rows_returned` | 1000000 | Maximum rows in a single result set |
| `query.cache.enabled` | true | Enable query result caching |
| `query.cache.max_size_mb` | 1024 | Maximum cache size |
| `query.cache.ttl_seconds` | 300 | Default cache TTL |
| `query.optimizer.join_reorder` | true | Enable join reordering optimization |
| `query.optimizer.predicate_pushdown` | true | Push filters to storage layer |

### Query Performance Tuning

For latency-sensitive workloads, the following tuning parameters are recommended by Lin Wei's query engine team:

1. **Increase parallelism**: Set `query.execution.parallelism` to 2x the number of CPU cores
2. **Enable adaptive execution**: Set `query.optimizer.adaptive` to `true` to allow runtime plan modifications
3. **Partition pruning**: Ensure tables are partitioned by frequently-filtered columns (especially timestamp)
4. **Memory management**: Set `query.execution.memory_per_query_mb` to at least 2048 for complex analytical queries

## Security Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `security.auth.token_ttl_seconds` | 3600 | OAuth token lifetime |
| `security.auth.refresh_token_ttl_days` | 30 | Refresh token lifetime |
| `security.rbac.enabled` | true | Enable role-based access control |
| `security.audit.enabled` | true | Enable audit logging |
| `security.audit.retention_days` | 365 | Audit log retention period |
| `security.encryption.algorithm` | `AES-256-GCM` | Data encryption algorithm |
| `security.encryption.key_rotation_days` | 90 | Encryption key rotation frequency |

For detailed security configuration, refer to the Meridian Security Architecture document maintained by James Okafor's team.

## Environment Variables

Critical configuration values should be stored as environment variables rather than in configuration files:

| Variable | Required | Description |
|----------|----------|-------------|
| `MERIDIAN_LICENSE_KEY` | Yes | Platform license key |
| `POSTGRES_URL` | If using PostgreSQL sink | PostgreSQL connection string |
| `POSTGRES_CDC_URL` | If using CDC source | PostgreSQL CDC connection string |
| `KAFKA_SASL_PASSWORD` | If using SASL auth | Kafka authentication password |
| `WEBHOOK_SECRET` | If using HTTP source | HMAC signing secret |
| `ENCRYPTION_MASTER_KEY` | Yes | Master key for encryption at rest |

**Warning**: Never commit environment variables to version control. Use a secrets manager (HashiCorp Vault, AWS Secrets Manager) in production deployments. This is enforced by the security team's automated compliance checks, introduced by Priya Sharma in the January 2025 security hardening initiative.
