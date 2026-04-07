# Case Study: GlobalRetail's Migration to Meridian

## Executive Summary

GlobalRetail, a Fortune 500 e-commerce company with $12 billion in annual revenue, migrated its data analytics infrastructure from a legacy Hadoop/Spark stack to the Meridian Data Platform between April and September 2024. The migration reduced query latency by 76%, cut infrastructure costs by 43%, and eliminated a three-person team previously dedicated to pipeline maintenance. This case study documents the challenges, approach, and outcomes of the migration.

## Background

GlobalRetail processes approximately 180 million customer events per day, including page views, product searches, cart operations, and purchases. Before adopting Meridian, the company relied on a complex stack:

- **Data ingestion**: Custom Kafka consumers written in Java (maintained since 2019)
- **Processing**: Apache Spark on Amazon EMR for batch ETL and real-time aggregations
- **Storage**: Amazon S3 for raw data, Amazon Redshift for analytical queries
- **Orchestration**: Apache Airflow managing 340+ DAGs

The primary pain points were:
1. **Pipeline fragility**: DAG failures occurred 3–5 times per week, requiring manual intervention
2. **Query performance**: Redshift queries for cross-sell recommendations took 15–20 seconds
3. **High costs**: The Spark/EMR cluster alone cost $280,000/month
4. **Schema evolution**: Adding new event fields required coordinated changes across 4 systems

## Decision to Adopt Meridian

CTO Michael Torres first encountered Meridian at the 2024 DataOps Summit in San Francisco, where Dr. Sarah Chen presented the Meridian 3.0 architecture. Torres was particularly interested in the unified pipeline model and the performance improvements from the vectorized query engine.

After a 30-day proof-of-concept with Meridian's Enterprise tier (conducted in April 2024), GlobalRetail's data engineering team — led by VP of Engineering Anita Patel — recommended full migration. The POC demonstrated:

- 5x faster query execution compared to Redshift for GlobalRetail's top 10 analytical queries
- 60% reduction in pipeline configuration complexity (measured by lines of configuration)
- Native handling of schema evolution that previously required custom code

## Migration Approach

The migration followed a phased approach over five months:

### Phase 1: Shadow Mode (April–May 2024)

GlobalRetail ran Meridian in parallel with the existing stack, ingesting the same Kafka topics into both systems. The data engineering team, led by senior engineer Raj Patel (no relation to VP Anita Patel), built comparison scripts that validated data consistency between Redshift and MeridianDB. After four weeks, data consistency was confirmed at 99.997%, with discrepancies traced to timezone handling differences that were resolved through configuration.

### Phase 2: Read Migration (June–July 2024)

Analytical dashboards and reporting queries were migrated to Meridian's query engine. The team converted 47 Redshift SQL queries and 12 dbt models to Meridian's SQL dialect. Most queries required only minor syntax changes, primarily around timestamp functions and window specifications.

During this phase, GlobalRetail discovered that Meridian's query cache reduced average response time for repeated dashboard queries from 4.2 seconds to 180 milliseconds. This eliminated the need for a pre-computation layer they had been running on a separate Spark cluster.

### Phase 3: Write Migration (August 2024)

Pipeline configurations were migrated from Airflow DAGs to Meridian pipeline definitions. The 340 Airflow DAGs were consolidated into 89 Meridian pipelines, primarily because Meridian's transform chaining eliminated the need for intermediate staging tables.

The most complex migration was the real-time recommendation pipeline, which required a streaming join between purchase events and product catalog updates with a 24-hour window. Raj Patel worked directly with Meridian's support team to optimize the join configuration, ultimately achieving sub-second latency for recommendation updates.

### Phase 4: Decommission (September 2024)

The legacy stack was decommissioned in stages:
- EMR cluster shutdown: September 5, 2024
- Airflow server shutdown: September 12, 2024
- Redshift cluster shutdown: September 20, 2024

Historical data (3 years) was migrated to Meridian's cold storage tier over a two-week period using the bulk import API.

## Results

### Performance Improvements

| Metric | Before (Redshift/Spark) | After (Meridian) | Improvement |
|--------|------------------------|-------------------|-------------|
| p95 query latency | 18.3 seconds | 4.4 seconds | 76% reduction |
| Pipeline failure rate | 3–5/week | 0.3/week | 92% reduction |
| Dashboard load time | 4.2 seconds | 0.6 seconds | 86% reduction |
| Schema change deployment | 2–3 days | 15 minutes | 99% reduction |

### Cost Savings

| Cost Center | Monthly Before | Monthly After | Savings |
|-------------|---------------|---------------|---------|
| Compute (EMR/Workers) | $280,000 | $142,000 | $138,000 (49%) |
| Storage (S3/Redshift) | $95,000 | $62,000 | $33,000 (35%) |
| Orchestration (Airflow) | $12,000 | $0 | $12,000 (100%) |
| Personnel (3 pipeline maintainers) | $45,000 | $0 | $45,000 (100%) |
| **Total** | **$432,000** | **$204,000** | **$228,000 (43%)** |

Note: Personnel costs reflect reassignment to higher-value projects, not layoffs. The three pipeline maintenance engineers were moved to GlobalRetail's machine learning team.

### Lessons Learned

1. **Shadow mode is essential**: Running both systems in parallel for a month built confidence and caught edge cases early.
2. **Query dialect differences matter**: Budget time for SQL migration, especially for complex window functions and timezone handling.
3. **Meridian's configuration hierarchy**: GlobalRetail initially struggled with the precedence rules for organization-level vs. pipeline-level settings. The documentation has since been improved based on their feedback.
4. **Support responsiveness**: GlobalRetail praised Meridian's enterprise support team, particularly during the streaming join optimization that required custom configuration.

## Conclusion

Michael Torres summarized the migration outcome: "Meridian replaced four separate systems with a single platform. Our data engineers now spend their time building features instead of debugging pipelines." GlobalRetail has since expanded its Meridian usage to include a new fraud detection pipeline and plans to adopt Meridian's A2A protocol integration for AI agent workflows in 2025.
