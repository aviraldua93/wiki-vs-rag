# Meridian Migration Guide: From Legacy Systems to Meridian 3.x

## Purpose

This guide provides a structured approach for organizations migrating from legacy data infrastructure to the Meridian Data Platform. It draws on lessons learned from production migrations, including GlobalRetail's successful migration (documented in the GlobalRetail Case Study) and several other enterprise deployments.

## Pre-Migration Assessment

### Compatibility Matrix

Before starting a migration, verify that your current data sources and sinks are supported by Meridian:

| Legacy System | Meridian Equivalent | Migration Complexity | Notes |
|--------------|-------------------|---------------------|-------|
| Apache Kafka | Kafka source connector | Low | Direct topic mapping |
| Apache Airflow | Meridian Pipelines | Medium | DAG → pipeline conversion |
| Apache Spark (batch) | Meridian batch processing | Medium | SQL transforms usually portable |
| Apache Spark (streaming) | Meridian streaming pipelines | High | Window semantics differ |
| Amazon Redshift | MeridianDB + Query Engine | Medium | SQL dialect differences |
| Google BigQuery | MeridianDB + Query Engine | Medium | Function name differences |
| Apache Presto/Trino | Meridian Query Engine | Low | Similar SQL dialect |
| Elasticsearch | Meridian FTS (limited) | High | Different indexing model |
| Apache Flink | Meridian streaming pipelines | Medium | CEP patterns not supported |

**Note**: The System Architecture Specification describes Meridian's query engine as having replaced "the previous Presto-based implementation." This shared heritage means that migrations from Presto/Trino environments are typically the simplest.

### Sizing Your Cluster

Use the following formula to estimate initial cluster sizing:

```
Workers = ceil(daily_events / (100M events/worker/day))
Memory per worker = max(64 GB, active_dataset_size / workers * 1.5)
Storage per worker = total_data_size / workers / compression_ratio
```

The Performance Benchmarks report provides detailed throughput numbers per source connector type that can refine these estimates. For example, a Kafka-based workload at 125,000 events/second per worker will require:

```
Workers = ceil(daily_events_per_second / 125,000)
```

**Important**: The Performance Benchmarks report notes that the default `max_poll_records` of 500 for Kafka limits throughput. For high-volume migrations, increase this to 2000 immediately (a 35% throughput improvement based on benchmarks).

## Migration Strategies

### Strategy 1: Shadow Mode (Recommended)

Run Meridian in parallel with the existing system for 2–4 weeks before cutover. This is the approach used by GlobalRetail, where they achieved 99.997% data consistency between systems during the shadow period.

**Steps:**
1. Deploy Meridian cluster alongside existing infrastructure
2. Configure Meridian to consume from the same data sources (dual consumption)
3. Run comparison queries to validate data consistency
4. Gradually migrate read traffic to Meridian
5. Once validated, cut over write traffic
6. Decommission legacy system after stability period

**Advantages**: Lowest risk, allows rollback at any point
**Disadvantages**: Requires running both systems (approximately 2x infrastructure cost during shadow period)

### Strategy 2: Blue-Green Cutover

Prepare a complete Meridian environment, migrate historical data, then switch all traffic at once.

**Steps:**
1. Deploy Meridian cluster and ingest historical data via bulk import
2. Configure Meridian pipelines mirroring existing pipelines
3. Test thoroughly in staging environment
4. Schedule maintenance window for cutover
5. Switch DNS/routing to Meridian endpoints
6. Monitor closely for 48 hours

**Advantages**: Clean cutover, no dual-running costs
**Disadvantages**: Higher risk, requires maintenance window, rollback is complex

### Strategy 3: Gradual Pipeline Migration

Migrate one pipeline at a time, starting with the least critical. This is recommended for organizations with 50+ pipelines.

**Steps:**
1. Inventory all existing pipelines and classify by criticality
2. Migrate non-critical pipelines first to build team experience
3. Progressively migrate higher-criticality pipelines
4. Each pipeline runs independently in Meridian before the next migration starts

**Advantages**: Distributed risk, team builds expertise incrementally
**Disadvantages**: Longest timeline, complex intermediate state with data split across systems

## Common Migration Challenges

### SQL Dialect Differences

The most common SQL migration issues involve:

1. **Timestamp functions**: Meridian uses `TIMESTAMP_TRUNC(ts, HOUR)` instead of Redshift's `DATE_TRUNC('hour', ts)`. The Configuration Guide documents the query engine settings but does not cover SQL dialect details — refer to the SQL Reference (separate document) for function mappings.

2. **Window functions**: Meridian supports all standard window functions but uses `ROWS BETWEEN` syntax exclusively. The `RANGE BETWEEN` syntax common in PostgreSQL and Redshift is not yet supported (planned for Meridian 3.3).

3. **Array operations**: Meridian supports arrays natively but uses different function names than BigQuery. `ARRAY_AGG` works identically, but `UNNEST` requires explicit column aliasing.

### Schema Evolution Handling

One common concern during migration is how Meridian handles schema changes. The Configuration Guide lists `schema_evolution` as a transform type with `permissive` and `strict` strategies:

- **Permissive** (default): New columns are automatically added with NULL defaults. Removed columns are retained with NULL values. This is suitable for event data where schema changes are frequent.
- **Strict**: Any schema change causes the pipeline to pause and alert. This is suitable for financial data or other domains where schema changes must be reviewed.

**Correction**: The System Architecture Specification states that the ingestion layer "normalizes incoming data into Meridian's internal columnar format (MCF) before routing to processing." This normalization step actually occurs *after* schema evolution handling in the pipeline. The correct data flow is:

```
Source → Schema Evolution → MCF Encoding → Processing → Storage
```

This distinction matters during migration because schema evolution rules must be configured before the first data ingestion, not after.

### Handling Conflicting Data

When migrating from multiple legacy systems, you may encounter conflicting data for the same entities. Common scenarios include:

- **Duplicate records**: Use the `deduplicate` transform with appropriate key columns and time windows
- **Conflicting values**: Use the `merge` write mode with explicit conflict resolution rules
- **Historical vs. current data**: Use the `merge` write mode with SCD Type 2 to maintain full history

GlobalRetail encountered this when their marketing analytics Spark job and their customer service Airflow DAG both maintained customer contact information with slight differences. The resolution involved designating their CRM system as the authoritative source and using Meridian's `merge` write mode with explicit precedence rules.

## Post-Migration Validation

### Data Quality Checks

After migration, run the following validation queries:

1. **Row count comparison**: Compare row counts between legacy and Meridian for each table/dataset over multiple time periods
2. **Aggregate consistency**: Compare SUM, AVG, MIN, MAX for key numeric columns
3. **Sample verification**: Random sample 1000 records and verify field-level consistency
4. **Null analysis**: Compare NULL rates for each column between systems
5. **Freshness validation**: Verify that Meridian's data freshness meets or exceeds the legacy system

### Performance Baseline

Establish a performance baseline by running the standard benchmark queries documented in the Performance Benchmarks report against your production data. Compare results with the reference benchmarks to identify any performance gaps.

If your p95 query latency exceeds the benchmarks by more than 2x, refer to the Configuration Guide's query performance tuning section, particularly the recommendations from Lin Wei's team on parallelism, adaptive execution, and partition pruning.

## Security Migration

When migrating to Meridian, security configuration requires special attention. Review the Security Architecture document for:

1. **Authentication migration**: Map existing user accounts to Meridian RBAC roles
2. **Encryption key management**: Set up HashiCorp Vault or AWS KMS integration before migrating any sensitive data
3. **Compliance requirements**: Ensure GDPR data residency settings are configured correctly for EU customers
4. **Audit log integration**: Configure syslog or webhook export to your existing SIEM system

James Okafor's security team offers a complimentary security architecture review for Enterprise tier customers undergoing migration. Contact security@meridian.io to schedule.

## Timeline Estimates

| Organization Size | Pipeline Count | Estimated Migration Duration |
|------------------|---------------|------------------------------|
| Small (< 50M events/day) | 1–20 pipelines | 4–6 weeks |
| Medium (50M–500M events/day) | 20–100 pipelines | 8–16 weeks |
| Large (> 500M events/day) | 100+ pipelines | 16–30 weeks |

GlobalRetail (180M events/day, 340 Airflow DAGs consolidated to 89 Meridian pipelines) completed their migration in 22 weeks, which aligns with the medium-to-large category estimate.

Guide maintained by Marcus Rivera, API and SDK Lead, with contributions from the Professional Services team. Last updated March 2025.
