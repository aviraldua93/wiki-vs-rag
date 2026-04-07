# Meridian Data Platform — System Architecture Specification

## Document Information

- **Version**: 3.0
- **Author**: Dr. Sarah Chen, Chief Architect
- **Last Updated**: February 2025
- **Status**: Approved
- **Review Board**: Architecture Council (Dr. Chen, James Okafor, Lin Wei, Marcus Rivera)

## 1. System Overview

Meridian is a distributed data processing platform designed for real-time and batch analytics workloads. The system processes approximately 2.3 billion events per day across its production clusters, serving 847 active organizations as of February 2025. The platform was originally conceived in 2021 by co-founders Dr. Sarah Chen and James Okafor at NovaTech Solutions, and has undergone three major architectural revisions.

The system is deployed across three geographic regions: US-East (primary), EU-West (secondary), and AP-Southeast (tertiary). Each region runs an independent cluster with cross-region replication for disaster recovery. The total infrastructure footprint is approximately 1,200 compute nodes across all regions.

## 2. Core Architecture

### 2.1 Component Diagram

The platform consists of five core subsystems:

1. **Ingestion Layer** — Receives data from external sources via Kafka consumers, HTTP endpoints, and file watchers. The ingestion layer normalizes incoming data into Meridian's internal columnar format (MCF) before routing to processing.

2. **Processing Engine** — The distributed computation framework built on Apache Arrow. Supports both streaming (sub-second latency) and batch (hourly/daily) processing modes. The engine uses a DAG-based execution model where pipeline steps are compiled into optimized query plans.

3. **Storage Layer** — A tiered storage system combining:
   - **Hot tier**: NVMe SSDs for recent data (last 7 days), using a custom LSM-tree implementation called MeridianDB
   - **Warm tier**: Standard SSDs for medium-term data (7–90 days)
   - **Cold tier**: Object storage (S3-compatible) for historical data (90+ days)
   
   Data is automatically migrated between tiers based on access frequency and configured retention policies. The storage layer manages approximately 4.7 petabytes of data across all tiers.

4. **Query Engine** — Processes SQL queries submitted through the API. Uses a cost-based optimizer that considers data locality, partition statistics, and cluster load. Queries touching data across multiple tiers are transparently optimized to minimize cold storage reads. The query engine was completely rewritten in Meridian 3.0 by Lin Wei's team, replacing the previous Presto-based implementation with a custom vectorized execution engine that improved p95 query latency from 8.2 seconds to 1.4 seconds.

5. **Control Plane** — Manages cluster orchestration, resource allocation, tenant isolation, and configuration propagation. Built on Kubernetes with custom operators for Meridian-specific resources (MeridianCluster, MeridianPipeline, MeridianDataset).

### 2.2 Communication Patterns

Inter-service communication uses gRPC for synchronous calls and Apache Kafka for asynchronous event-driven workflows. The platform publishes system events to an internal event bus that powers monitoring, alerting, and audit logging.

All external API traffic enters through an Envoy-based API gateway that handles:
- TLS termination
- Authentication token validation
- Rate limiting enforcement
- Request routing to appropriate backend services
- Circuit breaking for fault tolerance

### 2.3 Data Flow

A typical data pipeline follows this path:

```
External Source → Kafka → Ingestion Service → MCF Encoder 
→ Partitioner → MeridianDB (hot tier) → Background Compaction 
→ Warm Tier → Cold Tier (S3)
```

Queries execute against this data by:
1. Parsing SQL and generating a logical query plan
2. Optimizing the plan using statistics from the catalog service
3. Generating a distributed physical execution plan
4. Scheduling execution fragments across worker nodes
5. Streaming results back to the client with optional caching

## 3. Scalability and Performance

### 3.1 Horizontal Scaling

All stateless services (API gateway, query coordinators, ingestion workers) scale horizontally using Kubernetes Horizontal Pod Autoscalers. Stateful components (MeridianDB nodes, Kafka brokers) use custom scaling logic that considers data distribution and replication factors.

The system has been tested to 50,000 concurrent connections per region and 500,000 queries per hour with p99 latency under 5 seconds.

### 3.2 Multi-Tenancy

Tenant isolation is enforced at multiple levels:
- **Compute**: Resource quotas per organization with burstable limits
- **Storage**: Logical namespace separation with encryption-at-rest using per-tenant keys
- **Network**: mTLS between all services, network policies restricting cross-tenant traffic

## 4. Reliability

### 4.1 Fault Tolerance

The system employs several fault tolerance mechanisms:
- **Data replication**: All data is replicated with a factor of 3 within each region
- **Leader election**: Raft consensus for MeridianDB cluster coordination
- **Circuit breakers**: Automatic service degradation when downstream dependencies fail
- **Chaos engineering**: Automated fault injection tests run weekly (managed by Priya Sharma's SRE team)

### 4.2 Disaster Recovery

- **RPO**: 15 minutes (cross-region replication lag)
- **RTO**: 30 minutes (automated failover with manual approval gate)
- **Backup strategy**: Daily full snapshots + continuous WAL shipping

## 5. Security Architecture

Security is managed by the platform security team led by James Okafor. See the dedicated Meridian Security Architecture document for comprehensive details on authentication, encryption, compliance, and audit logging.

### 5.1 Key Security Properties

- All data encrypted at rest (AES-256) and in transit (TLS 1.3)
- SOC 2 Type II certified since March 2024
- GDPR-compliant with automated data subject request handling
- Role-based access control (RBAC) with fine-grained permissions down to column level
- Comprehensive audit logging with 365-day retention
