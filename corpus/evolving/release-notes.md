# Meridian Data Platform — Release Notes

## Version 3.2.0 (February 2025) — Latest

### Highlights
- A2A (Agent-to-Agent) protocol support for AI agent integration
- PostgreSQL CDC connector improvements
- Query cache partitioning for multi-tenant workloads

### New Features
- **A2A Protocol Integration**: Meridian now exposes an A2A-compatible interface at `/.well-known/agent-card.json`. AI agents can discover Meridian's capabilities, submit queries, create pipelines, and monitor status through the standard A2A JSON-RPC protocol. Developed by Marcus Rivera's team in collaboration with the open-source A2A community.
- **CDC Connector v2**: The PostgreSQL CDC connector has been rewritten to support logical replication with publication filtering. Throughput improved from 5,200 events/s (v3.1) to 8,500 events/s. Note: This is still below the target of 25,000 events/s; further improvements are planned for v3.3.
- **Query Cache Partitioning**: Cache is now partitioned per organization to prevent cache pollution between tenants. This was requested by GlobalRetail after they observed that cache hit ratios dropped during peak hours when other tenants' queries evicted their cached results.
- **Bulk Import API v2**: New endpoint for importing historical data at up to 500 MB per request. Supports CSV, JSON, and Parquet formats.

### Improvements
- Reduced memory overhead for streaming pipelines by 18% through buffer pool optimization
- Added `schema_evolution` transform type for handling schema changes within pipelines
- Improved error messages for malformed pipeline configurations (now includes line numbers and suggestions)
- API gateway now returns `Retry-After` header on 429 responses

### Bug Fixes
- Fixed race condition in pipeline scheduler that could cause duplicate trigger events (reported by 3 Enterprise customers)
- Fixed incorrect byte count in query response when result set exceeds 10 MB
- Fixed MeridianDB compaction bug that caused temporary spike in read latency during compaction cycles
- Fixed timezone handling in `TIMESTAMP_TRUNC` function for DST transitions

### Breaking Changes
- None

### Deprecations
- SMS-based MFA will be deprecated in v3.3 (Q3 2025). Migrate to TOTP or WebAuthn.
- V2 API endpoints (`/v2/*`) will be sunset on December 31, 2025. Migrate to v3 API.

---

## Version 3.1.0 (November 2024)

### Highlights
- Cross-region replication GA
- SOC 2 Type II re-certification
- Streaming join improvements

### New Features
- **Cross-Region Replication**: Automated data replication across US-East, EU-West, and AP-Southeast regions. RPO of 15 minutes with automated failover. This was the final piece needed for Enterprise tier disaster recovery guarantees, originally designed by Dr. Sarah Chen.
- **Column-Level Security Enhancements**: Added support for dynamic column masking based on user roles. Previously, column-level security only supported full access or no access. Now supports `mask` option (e.g., showing only last 4 digits of SSN).
- **Streaming Join Optimization**: 40% reduction in memory usage for streaming joins with large windows. This improvement was developed during the GlobalRetail migration when Raj Patel's team needed a 24-hour streaming join for real-time recommendations.

### Improvements
- Query engine memory management: automatic spill-to-disk for queries exceeding memory limits
- Pipeline YAML validation now catches 95% of configuration errors before deployment
- Added `merge` write mode for SCD Type 2 slowly-changing dimension support
- Increased maximum Kafka `max_poll_records` from 1000 to 5000

### Bug Fixes
- Fixed critical MeridianDB compaction bug that caused disk space exhaustion (root cause of December 2023 EU-West outage)
- Fixed query optimizer incorrectly pruning partitions when filter predicates reference multiple columns
- Fixed SDK authentication retry logic that could cause token refresh storms under load
- Fixed Airflow-to-Meridian pipeline migration tool incorrectly mapping `trigger_rule` settings

### Breaking Changes
- Minimum TLS version changed from 1.1 to 1.2 (configurable via `network.tls.min_version`)
- `pipeline.trigger()` API now returns run ID instead of status (aligning with API Reference documentation)

### Known Issues
- PostgreSQL CDC connector has limited throughput (~5,200 events/s). Improvement planned for v3.2.
- Query cache does not support partitioning per organization (planned for v3.2)

---

## Version 3.0.0 (October 2024)

### Highlights
- Complete query engine rewrite (vectorized execution on Apache Arrow)
- Multi-region deployment support
- Enterprise tier launch

### New Features
- **Vectorized Query Engine**: Complete rewrite of the query execution engine, replacing the Presto-based implementation with a custom vectorized engine built on Apache Arrow. Led by Lin Wei's team over 8 months. Key metrics:
  - p95 single-table query latency: 8.2s → 1.4s (83% improvement)
  - Maximum concurrent queries: 20 → 50 (150% improvement)
  - New query result caching layer with 67% hit ratio on typical workloads
- **Multi-Region Support**: Deploy clusters in US-East, EU-West, and AP-Southeast. Each region runs independently with optional cross-region replication (GA in v3.1).
- **Enterprise Tier**: New pricing tier with 10,000 requests/minute rate limit, dedicated support, SLA guarantees, and custom configuration options.
- **Query Result Caching**: Configurable caching with TTL. Default 300 seconds. Controlled via `query.cache.*` configuration parameters.

### Improvements
- MeridianDB compaction now supports configurable target file sizes (default 256 MB)
- Added HTTP webhook source connector
- Expanded monitoring with Prometheus metrics export
- Improved pipeline DAG visualization in web console

### Bug Fixes
- Fixed memory leak in Kafka consumer that occurred during broker failover
- Fixed incorrect results for LEFT JOIN queries with NULL join keys (critical bug)
- Fixed API gateway returning 500 instead of 401 for expired tokens

### Breaking Changes
- Query API response format changed: `execution_time` renamed to `execution_time_ms` for clarity
- Pipeline configuration format v2 → v3: `source.connection` renamed to `source.config`
- Minimum PostgreSQL version for CDC increased from 10 to 12 (logical replication improvements)
- Authentication tokens now include `org_id` claim (SDK update required)

### Migration Guide
For detailed migration instructions from v2.x to v3.0, see the Meridian Migration Guide document.

---

## Version 2.0.0 (November 2023)

### Highlights
- Custom storage engine (MeridianDB)
- Multi-tenancy support
- Commercial launch with SDK availability

### New Features
- **MeridianDB**: Custom LSM-tree storage engine optimized for time-series and event data. Replaces external PostgreSQL for data storage. Supports tiered storage (hot/warm/cold).
- **Multi-Tenancy**: Full tenant isolation with resource quotas, per-tenant encryption, and namespace separation. Designed by James Okafor's security team.
- **Official SDKs**: Released SDKs for Python, TypeScript, Go, and Java. The TypeScript SDK was developed by Marcus Rivera. All SDKs support automatic retry with exponential backoff.
- **PostgreSQL CDC Source**: Change data capture from PostgreSQL using logical replication.
- **BigQuery Sink**: Export data to Google BigQuery.
- **Column-Level Security**: Restrict access to specific columns within datasets (binary access: full or none).

### Improvements
- Pipeline configuration validation with detailed error messages
- Dashboard latency reduced from 8s to 3s average load time
- Added support for Parquet file format in file watcher source
- Introduced `upsert` write mode for sinks

### Bug Fixes
- Fixed Kafka consumer offset management that caused duplicate event processing
- Fixed query planner incorrect cost estimation for large table scans

### Breaking Changes
- Storage backend changed from PostgreSQL to MeridianDB. Full data migration required.
- Authentication system changed from API keys to OAuth 2.0. All clients must be updated.
- Pipeline configuration format v1 → v2: restructured `source` and `sink` sections

### Known Issues
- MeridianDB compaction logic has edge case that can cause disk space exhaustion under high write throughput (fixed in v3.1.0)
- SDK retry logic can cause token refresh storms under certain failure conditions (fixed in v3.1.0)

---

## Version 1.0.0 (September 2022)

### Highlights
- Initial internal release at NovaTech Solutions
- Basic pipeline framework with Kafka and file sources
- Presto-based query engine

### Features
- Data pipeline framework with Kafka source and PostgreSQL sink
- File watcher source for batch CSV and JSON ingestion
- SQL query interface powered by Apache Presto
- Basic web console with pipeline monitoring
- API key-based authentication
- Pipeline orchestration with cron-based scheduling

### Known Limitations
- Single-region deployment only
- No multi-tenancy (single-tenant for NovaTech internal use)
- Query p95 latency >10 seconds for complex queries
- Configuration via YAML files only (no API or web console configuration)
- No encryption at rest
- Limited to PostgreSQL as the only data sink

### Initial Team
Developed by: Dr. Sarah Chen, James Okafor, Lin Wei, Marcus Rivera
Project sponsor: David Park (NovaTech CEO)
