# The Meridian Story: From Research Project to Data Platform

## Origins (2021)

The Meridian Data Platform began as a research project at NovaTech Solutions in Austin, Texas during the summer of 2021. Dr. Sarah Chen, then a senior data engineer, was frustrated with the limitations of existing data pipeline tools. "We were spending 60% of our engineering time gluing together Airflow DAGs, Spark jobs, and Kafka consumers," she recalled in a 2024 conference talk at DataOps Summit. "I kept thinking: why can't the platform handle the orchestration intelligently?"

Dr. Chen teamed up with James Okafor, a security engineer at NovaTech who had previously worked on distributed systems at Google Cloud. Together, they drafted the first Meridian architecture document over a weekend hackathon in August 2021. The original vision was modest: a unified pipeline framework that could handle both streaming and batch workloads with a single configuration language.

Their initial prototype, built in Python with Apache Flink as the execution engine, demonstrated the concept to NovaTech's leadership team in October 2021. CEO David Park approved a formal R&D budget of $500,000, and Meridian became an official NovaTech project with a small team of four engineers.

## Building the Foundation: Meridian 1.0 (2022)

The first year was spent building core infrastructure. Lin Wei joined the team in January 2022 as the query engine lead, bringing expertise from her previous role at Databricks. Marcus Rivera, a TypeScript developer who had been working on NovaTech's frontend team, transferred to Meridian to build the API layer and developer experience.

Meridian 1.0 launched internally at NovaTech in September 2022. It supported Kafka and file-based data sources, basic SQL queries, and a rudimentary web console. The initial version used PostgreSQL for metadata storage and Apache Presto for query execution.

Early feedback was encouraging but highlighted significant gaps. The Presto-based query engine struggled with Meridian's event-driven data model, often producing p95 latencies exceeding 10 seconds. The configuration system required extensive YAML files that were error-prone and difficult to validate.

Despite these challenges, the platform processed NovaTech's internal analytics workload — approximately 50 million events per day — and reduced pipeline development time by 40% compared to the previous Airflow-based system.

## Growth and Challenges: Meridian 2.0 (2023)

In March 2023, NovaTech decided to offer Meridian as a commercial product. The team grew from 4 to 18 engineers. Dr. Chen was promoted to Chief Architect, and Priya Sharma was hired from Netflix to lead the Site Reliability Engineering (SRE) team.

Meridian 2.0, released in November 2023, was a significant overhaul:

- **New storage engine**: The team built MeridianDB, a custom LSM-tree based storage engine optimized for time-series and event data. This replaced the previous reliance on external PostgreSQL for data storage.
- **Multi-tenancy**: James Okafor led the design of the tenant isolation system, implementing resource quotas, per-tenant encryption, and namespace separation. This was essential for the commercial product.
- **Expanded connectors**: Support for PostgreSQL CDC, HTTP webhooks, and BigQuery as a sink, in addition to the existing Kafka and file connectors.
- **SDK launch**: Marcus Rivera's team released official SDKs for Python, TypeScript, Go, and Java.

The commercial launch attracted 47 paying customers in the first quarter. However, scaling to multi-tenant production exposed reliability issues. In December 2023, a cascading failure in the EU-West region caused a 4-hour outage affecting 12 customers. The root cause was an unhandled edge case in the MeridianDB compaction logic that caused disk space exhaustion.

Priya Sharma's post-mortem led to the establishment of weekly chaos engineering tests and an improved incident response process. The team also implemented automated disk space monitoring and compaction backpressure mechanisms.

## Maturity: Meridian 3.0 (2024–2025)

The third major version, released in October 2024, focused on performance and enterprise readiness:

- **Vectorized query engine**: Lin Wei's team replaced the Presto-based query engine with a custom vectorized execution engine built on Apache Arrow. This reduced p95 query latency from 8.2 seconds to 1.4 seconds — a 83% improvement.
- **SOC 2 Type II certification**: Achieved in March 2024 after a year-long effort led by James Okafor and an external auditor.
- **Cross-region replication**: Automated data replication across US-East, EU-West, and AP-Southeast regions with 15-minute RPO.
- **A2A protocol support**: In late 2024, the team added Agent-to-Agent protocol support, allowing AI agents to interact with Meridian pipelines programmatically.

By February 2025, Meridian serves 847 active organizations, processes 2.3 billion events daily, and manages 4.7 petabytes of data. The engineering team has grown to 52 people across three offices (Austin, London, and Singapore).

## Key People

- **Dr. Sarah Chen** — Co-founder, Chief Architect. PhD in Distributed Systems from MIT (2018). Led the overall platform design from day one.
- **James Okafor** — Co-founder, Head of Security. Previously at Google Cloud. Designed the security architecture and led SOC 2 certification.
- **Lin Wei** — Query Engine Lead. Previously at Databricks. Led the Meridian 3.0 vectorized engine rewrite.
- **Marcus Rivera** — API and SDK Lead. Built the TypeScript SDK and API gateway. Originally from NovaTech's frontend team.
- **Priya Sharma** — SRE Lead. Previously at Netflix. Established the chaos engineering and incident response programs.
- **David Park** — NovaTech CEO. Approved the initial R&D budget that made Meridian possible.

## Looking Ahead

The roadmap for 2025 includes AI-powered query optimization, natural language pipeline creation, and expanded support for unstructured data types. Dr. Chen has hinted at a potential "Meridian 4.0" that would incorporate knowledge graph capabilities, though no official timeline has been announced.
