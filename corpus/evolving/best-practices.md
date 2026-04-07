# Meridian Best Practices Guide

## About This Document

This guide collects recommended practices for operating the Meridian Data Platform. It is maintained by the Meridian Developer Relations team and updated regularly as the platform evolves.

**Document History:**
- v1.0 (September 2022): Initial publication with Meridian 1.0
- v1.1 (March 2023): Updated for multi-source pipeline patterns
- v2.0 (November 2023): Major revision for Meridian 2.0 (MeridianDB, multi-tenancy)
- v2.1 (June 2024): Added GlobalRetail migration lessons
- v3.0 (October 2024): Major revision for Meridian 3.0 (vectorized query engine)
- v3.1 (February 2025): Updated with performance benchmark data and security hardening

Each section indicates the version when the recommendation was last updated, helping readers distinguish current best practices from potentially outdated advice.

## Pipeline Design Best Practices

### Naming Conventions (Updated v2.0)

Use descriptive, hierarchical names for pipelines:
```
{team}-{data_domain}-{purpose}-v{version}
```
Example: `analytics-customer-daily-aggregation-v2`

~~Previously (v1.0), we recommended flat names like `customer_analytics`. This proved unmanageable as organizations scaled beyond 20 pipelines.~~

### Source Configuration (Updated v3.1)

**Kafka Sources:**
- Set `max_poll_records` to 2000 for optimal throughput. ~~The previous recommendation of 500 (default) was based on v2.x performance characteristics. Benchmarks from Q1 2025 show that 2000 provides 35% better throughput with no latency impact.~~
- Use `auto_offset_reset: earliest` for new consumer groups to avoid data loss
- Configure `session_timeout_ms` to at least 30000 (30 seconds) to prevent unnecessary rebalancing
- Enable compression (`compression.type: lz4`) for topics with high message volume

**File Watcher Sources:**
- Use Parquet format over CSV for 3–5x faster ingestion and better type safety
- Set `archive_processed: true` to prevent re-processing (updated v2.0; previously files were deleted by default)
- ~~Use `poll_interval_seconds: 300` for batch workloads~~ (v1.0 recommendation, now outdated). Use `poll_interval_seconds: 60` as the minimum. For near-real-time file processing, consider switching to Kafka-based ingestion.

**PostgreSQL CDC Sources (Updated v3.1):**
- Use publication filtering to capture only the tables you need
- Current maximum throughput is approximately 8,500 events/second per connector instance. For higher throughput requirements, deploy multiple connector instances across different publications.
- ~~CDC was not recommended for tables with >1000 writes/second (v2.0 limitation)~~. This limitation was relaxed in v3.2 with the connector rewrite.

### Transform Ordering (Updated v3.0)

Apply transforms in this order for optimal performance:
1. **Filter first**: Reduce data volume as early as possible
2. **Map second**: Transform only the rows that passed filtering
3. **Deduplicate**: Remove duplicates before aggregation
4. **Aggregate/Join**: Expensive operations on minimal data
5. **Schema evolution**: Apply after all processing (corrected in v3.0; the System Architecture Specification's data flow diagram places schema evolution before processing, which reflects the ingestion path, not the transform pipeline path)

### Error Handling (Updated v3.0)

- Configure dead letter queues for pipelines processing external data
- Set `max_retry_count` to 3 for transient failures (network, timeout)
- Use `on_error: skip` for non-critical pipelines (logging/analytics)
- Use `on_error: pause` for critical pipelines (billing, compliance)
- ~~Set `on_error: fail` for all pipelines (v1.0 recommendation)~~. This is too aggressive for production; prefer `pause` with alerting.

## Query Optimization Best Practices

### Partitioning Strategy (Updated v3.0)

- **Always** partition by timestamp for time-series data. The query engine's partition pruning is most effective on timestamp predicates.
- For multi-tenant datasets, add a secondary partition by `tenant_id` or `organization_id`
- ~~Use daily partitions for most workloads (v2.0)~~. With the vectorized engine in v3.0, hourly partitions are now recommended for high-volume datasets (>100M events/day) as the engine handles finer partitions more efficiently.

### Query Patterns (Updated v3.1)

**Do:**
- Use `TIMESTAMP_TRUNC` for time-based grouping (optimized in v3.0)
- Apply filters on partitioned columns to enable partition pruning
- Use `LIMIT` with `ORDER BY` for top-N queries (short-circuits execution)
- Leverage the query cache for repeated analytical queries (300-second default TTL)

**Avoid:**
- `SELECT *` on large tables — specify only needed columns
- Cross-partition `JOIN` without filters — causes full table scan
- ~~Using `ORDER BY` without `LIMIT` (v2.0: caused OOM in Presto engine)~~. This is no longer a concern in v3.0 as the vectorized engine handles large sorts efficiently, but it remains a performance anti-pattern.
- Nested subqueries deeper than 3 levels — flatten with CTEs for better optimization

### Caching Strategy (Updated v3.1)

- Set `cache_ttl` to match your data freshness requirements:
  - Real-time dashboards: 0 (no caching)
  - Hourly reports: 300 seconds (default)
  - Daily reports: 3600 seconds
  - Historical analysis: 86400 seconds
- ~~Cache was per-cluster in v3.0 and v3.1~~. As of v3.2, cache is partitioned per organization, preventing cross-tenant cache pollution. GlobalRetail reported a 15% improvement in cache hit ratio after this change.

## Security Best Practices

### Authentication (Updated v3.1)

- Use service accounts (client credentials) for automated workloads, never user tokens
- Rotate service account credentials every 90 days
- ~~API keys were the recommended authentication method (v1.0)~~. API keys were removed in v2.0 in favor of OAuth 2.0. Any remaining API key usage should be migrated immediately.
- Enable MFA for all human users. ~~MFA was optional in v2.0~~. As of v3.2, MFA is mandatory and cannot be disabled (the `security.auth.mfa_required` configuration parameter is effectively ignored per James Okafor's security team directive).

### Encryption (Updated v3.0)

- Use AES-256-GCM for data at rest (Meridian default)
- Ensure TLS 1.3 for all external connections. ~~TLS 1.2 was the minimum in v2.x~~. While TLS 1.2 is still supported in v3.x, the Security Architecture document recommends TLS 1.3 exclusively, and TLS 1.2 support will be removed in v4.0.
- Configure key rotation to 90 days or less
- Store all encryption keys in a dedicated secrets manager (HashiCorp Vault or AWS KMS)

### Compliance (Updated v3.1)

- Enable audit logging with maximum retention (365 days) for regulated industries
- Configure GDPR data residency before ingesting any EU customer data
- Run quarterly access reviews to remove stale user accounts
- Use Priya Sharma's automated compliance testing framework (available since January 2025 security hardening initiative) to validate GDPR data deletion propagation

## Operational Best Practices

### Monitoring (Updated v3.0)

Monitor these key metrics:
- Pipeline lag (seconds behind real-time)
- Query p95 latency (target: <5 seconds per the System Architecture Specification)
- Storage utilization per tier
- Error rate per pipeline
- Cache hit ratio (target: >60%)

Set up alerts for:
- Pipeline lag exceeding 5 minutes
- Query latency exceeding 10 seconds at p95
- Storage utilization exceeding 80% on any tier
- Error rate exceeding 1% on any pipeline

### Capacity Planning (Updated v3.1)

Based on the Performance Benchmarks Q1 2025 report:
- Plan for 1 worker per 100M events/day for ingestion workloads
- Plan for 1 worker per 10 concurrent queries for query workloads
- ~~Plan for 1 worker per 50M events/day (v2.0 recommendation)~~. The vectorized engine in v3.0 doubled per-worker throughput.
- ~~Limit concurrent queries to 20 per coordinator (v2.0)~~. The v3.0 engine supports 50 concurrent queries per coordinator, with degradation observed above 75 (per the Performance Benchmarks report).

### Backup and Recovery (Updated v3.0)

- RPO target: 15 minutes (achievable with cross-region replication in v3.1+)
- RTO target: 30 minutes (automated failover with manual approval)
- Test disaster recovery procedures quarterly
- Maintain at least 7 days of hot-tier data for rapid recovery
- ~~Weekly full backups plus daily incrementals (v1.0/v2.0)~~. With cross-region replication in v3.1, continuous WAL shipping has replaced the scheduled backup model for Enterprise tier customers. Standard tier customers should continue with the scheduled backup approach.
