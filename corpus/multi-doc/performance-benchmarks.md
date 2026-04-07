# Meridian Performance Benchmarks — Q1 2025 Report

## Overview

This report presents the results of quarterly performance benchmarking for the Meridian Data Platform, conducted by Lin Wei's query engine team in collaboration with Priya Sharma's SRE team. The benchmarks measure query performance, pipeline throughput, and system resource utilization under controlled conditions.

These benchmarks complement the System Architecture Specification's theoretical performance claims with empirical data. Where discrepancies exist between documented specifications and measured performance, this report takes precedence.

## Test Environment

Benchmarks were executed on a dedicated test cluster mimicking the production US-East configuration:
- 16 worker nodes (32 CPU cores, 128 GB RAM each)
- 3 coordinator nodes
- NVMe SSDs for hot tier storage
- 1 Gbps inter-node network bandwidth

The test dataset consisted of 500 million synthetic events modeled after GlobalRetail's production data schema (see the GlobalRetail Case Study for details on their data model).

## Query Performance Benchmarks

### Single-Table Scans

| Query Type | Rows Scanned | p50 Latency | p95 Latency | p99 Latency |
|-----------|-------------|-------------|-------------|-------------|
| Full table scan (1M rows) | 1,000,000 | 120ms | 340ms | 890ms |
| Filtered scan (10% selectivity) | 100,000 | 45ms | 180ms | 420ms |
| Aggregation (GROUP BY, 1M rows) | 1,000,000 | 280ms | 720ms | 1,400ms |
| Top-N query (ORDER BY LIMIT 100) | 1,000,000 | 95ms | 290ms | 650ms |

### Multi-Table Joins

| Join Type | Left Table | Right Table | p50 | p95 | p99 |
|-----------|-----------|-------------|-----|-----|-----|
| Hash join | 10M rows | 1M rows | 1.2s | 3.1s | 5.8s |
| Sort-merge join | 10M rows | 10M rows | 2.8s | 6.2s | 9.4s |
| Broadcast join | 10M rows | 10K rows | 0.9s | 2.4s | 4.1s |

**Note**: The System Architecture Specification claims p95 query latency of 1.4 seconds for the vectorized engine. This figure was measured on the standard benchmark suite with a single-table analytical query workload. For multi-table joins, actual p95 latency ranges from 2.4 to 6.2 seconds depending on join type and data volume. Lin Wei's team is working on join optimization improvements targeted for Meridian 3.3.

### Comparison with Previous Versions

| Metric | Meridian 2.x (Presto) | Meridian 3.0 | Improvement |
|--------|----------------------|--------------|-------------|
| p95 single-table query | 8.2s | 1.4s | 83% |
| p95 multi-table join | 22.5s | 6.2s | 72% |
| Max concurrent queries | 20 | 50 | 150% |
| Query cache hit ratio | N/A | 67% | New feature |

These improvements align with the performance gains documented in the Project History narrative, which describes the query engine rewrite as the centerpiece of the Meridian 3.0 release.

## Pipeline Throughput Benchmarks

### Ingestion Rate

| Source Type | Events/Second | Bytes/Second | CPU Utilization |
|------------|--------------|-------------|-----------------|
| Kafka (single topic) | 125,000 | 180 MB/s | 45% |
| Kafka (10 topics, parallel) | 890,000 | 1.2 GB/s | 78% |
| HTTP webhooks | 15,000 | 22 MB/s | 12% |
| File watcher (Parquet) | 250,000 | 380 MB/s | 55% |
| PostgreSQL CDC | 8,500 | 12 MB/s | 8% |

**Discrepancy note**: The Configuration Guide states that the Kafka source connector's `max_poll_records` defaults to 500. In our benchmarks, increasing this to 2000 improved throughput by 35% with no measurable impact on latency. Lin Wei has approved updating the default in Meridian 3.3.

### Transform Performance

| Transform | Input Events/s | Output Events/s | Added Latency |
|-----------|---------------|-----------------|---------------|
| Filter (simple predicate) | 125,000 | 112,500 | <1ms |
| Map (3 column transforms) | 125,000 | 125,000 | 2ms |
| Aggregate (1-hour window) | 125,000 | 8,500 | N/A (windowed) |
| Join (streaming, 1-hour window) | 125,000 | 95,000 | 15ms |
| Deduplicate (1-hour window) | 125,000 | 118,000 | 5ms |

### Sink Write Performance

| Sink Type | Write Rate (rows/s) | Average Latency | Notes |
|-----------|-------------------|-----------------|-------|
| MeridianDB (append) | 200,000 | 3ms | Best performance |
| MeridianDB (upsert) | 85,000 | 12ms | Conflict resolution overhead |
| PostgreSQL (append) | 45,000 | 25ms | Network-bound |
| PostgreSQL (upsert) | 22,000 | 48ms | Network + conflict resolution |
| S3 (Parquet files) | 180,000 | 150ms | Batched writes, high throughput |
| Elasticsearch | 35,000 | 35ms | Index refresh overhead |

## Storage Efficiency

### Compression Ratios

MeridianDB achieves the following compression ratios using LZ4 compression with dictionary encoding:

| Data Type | Raw Size | Compressed Size | Ratio |
|-----------|---------|-----------------|-------|
| Integer columns | 1 GB | 180 MB | 5.6x |
| String columns (low cardinality) | 1 GB | 95 MB | 10.5x |
| String columns (high cardinality) | 1 GB | 420 MB | 2.4x |
| Timestamp columns | 1 GB | 120 MB | 8.3x |
| Mixed schema (typical) | 1 GB | 230 MB | 4.3x |

At the production scale documented in the System Architecture Specification (4.7 PB managed data), the actual raw data volume before compression is approximately 20.2 PB, representing an overall 4.3x compression ratio.

## Resource Utilization Benchmarks

### Memory Usage Under Load

| Concurrent Queries | Total Memory Used | Per-Query Average | Cache Hit Ratio |
|-------------------|------------------|-------------------|-----------------|
| 10 | 45 GB | 4.5 GB | 72% |
| 25 | 89 GB | 3.6 GB | 68% |
| 50 | 156 GB | 3.1 GB | 64% |
| 75 | 198 GB | 2.6 GB | 58% |
| 100 | Degraded | N/A | N/A |

**Warning**: The Configuration Guide recommends `query.max_concurrent` of 50 as default. Our benchmarks confirm that exceeding 75 concurrent queries on the reference cluster (16 workers, 128 GB each) causes memory pressure and query degradation. For clusters with fewer workers or less memory, this threshold should be adjusted proportionally.

## Recommendations

Based on these benchmarks, the following improvements are planned for Meridian 3.3:

1. **Join optimization**: Implement hash join with spill-to-disk for large joins (Lin Wei, target: May 2025)
2. **Kafka default tuning**: Increase `max_poll_records` default from 500 to 2000 (approved)
3. **Adaptive memory allocation**: Dynamic per-query memory limits based on cluster load (Priya Sharma, target: June 2025)
4. **CDC throughput improvement**: PostgreSQL CDC connector currently bottlenecked at 8,500 events/s; target 25,000 (Marcus Rivera, target: Q3 2025)

Report prepared by Lin Wei and Priya Sharma, March 2025.
