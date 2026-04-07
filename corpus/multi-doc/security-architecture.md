# Meridian Security Architecture

## Document Scope

This document describes the security architecture of the Meridian Data Platform. It should be read alongside the System Architecture Specification (authored by Dr. Sarah Chen) for full context on the platform's overall design, and the Configuration Guide for specific security-related settings.

## Security Team

The Meridian security architecture is owned and maintained by James Okafor, co-founder and Head of Security. The security team consists of 8 engineers distributed across the Austin and London offices. Key responsibilities include:

- Authentication and authorization infrastructure
- Data encryption (at rest and in transit)
- Compliance and audit (SOC 2, GDPR, HIPAA)
- Vulnerability management and penetration testing
- Security incident response

## Authentication Architecture

### OAuth 2.0 Implementation

Meridian uses OAuth 2.0 for all API authentication, as described in the API Reference document. The identity service supports two grant types:

1. **Client Credentials**: For machine-to-machine communication (service accounts, CI/CD pipelines)
2. **Authorization Code with PKCE**: For interactive user authentication (web console, CLI tool)

Token lifetime is configured via `security.auth.token_ttl_seconds` (default: 3600 seconds). Note that the API Reference documentation states "tokens expire after 3600 seconds (1 hour) by default," which is consistent with this configuration. However, enterprise customers can request custom token lifetimes — GlobalRetail, for example, uses a 7200-second (2-hour) token lifetime to reduce re-authentication frequency for their long-running dashboard sessions.

### Multi-Factor Authentication

MFA is required for all user accounts accessing the web console. Supported MFA methods:
- TOTP (Time-based One-Time Password) via authenticator apps
- WebAuthn/FIDO2 hardware security keys
- SMS-based OTP (available but not recommended; will be deprecated in Q3 2025)

**Important discrepancy**: The Configuration Guide lists `security.auth.mfa_required` as a configurable parameter with a default of `true`. However, as of Meridian 3.2, MFA enforcement is mandatory for all organizations and cannot be disabled. This configuration parameter is retained for backward compatibility but is effectively ignored. James Okafor has approved the removal of this parameter in version 4.0.

## Authorization Model

### Role-Based Access Control (RBAC)

Meridian implements a hierarchical RBAC model with the following predefined roles:

| Role | Scope | Capabilities |
|------|-------|-------------|
| **Organization Admin** | Organization | Full control over all resources, user management, billing |
| **Data Engineer** | Organization | Create/modify pipelines, datasets; execute queries |
| **Data Analyst** | Organization | Read-only access to datasets; execute queries |
| **Pipeline Operator** | Pipeline | Trigger runs, view logs, pause/resume specific pipelines |
| **Viewer** | Dataset | Read-only access to specific datasets |

Custom roles can be created by combining fine-grained permissions. There are 47 distinct permissions covering pipelines, datasets, queries, users, and system configuration.

### Column-Level Security

Introduced in Meridian 2.0, column-level security allows restricting access to specific columns within a dataset. This is primarily used for PII protection. For example, GlobalRetail uses column-level security to prevent their marketing analytics team from accessing raw customer email addresses and phone numbers while still allowing access to aggregated demographic data.

The System Architecture Specification mentions that RBAC operates "with fine-grained permissions down to column level" — this column-level security is the implementation of that capability.

## Encryption

### Data at Rest

All data stored in MeridianDB (hot and warm tiers) and cold storage (S3) is encrypted using AES-256-GCM. Encryption is performed at the storage layer before data is written to disk, ensuring that even raw storage access cannot expose plaintext data.

Encryption keys are managed through a two-tier system:
- **Master key**: Stored in HashiCorp Vault (or AWS KMS for cloud deployments)
- **Data keys**: Generated per-tenant, rotated every 90 days (configurable via `security.encryption.key_rotation_days`)

Key rotation is automatic and zero-downtime. During rotation, existing data is not re-encrypted; instead, a new data key is used for new writes, and old keys are retained in the key management system until all data encrypted with them has been either re-encrypted during compaction or aged out of the retention window.

### Data in Transit

All inter-service communication uses mutual TLS (mTLS) with certificates issued by Meridian's internal CA. External API traffic is encrypted with TLS 1.3 (TLS 1.2 is supported for backward compatibility but generates a security warning in audit logs).

The Configuration Guide correctly documents the `network.tls.min_version` parameter. However, the security team strongly recommends TLS 1.3 exclusively and plans to remove TLS 1.2 support in Meridian 4.0.

## Compliance

### SOC 2 Type II

Meridian achieved SOC 2 Type II certification in March 2024. The certification covers:
- Security (CC6): Access control, encryption, vulnerability management
- Availability (A1): SLA compliance, disaster recovery procedures
- Confidentiality (C1): Data classification, encryption, access restrictions

The audit was conducted by PricewaterhouseCoopers. Re-certification is scheduled for March 2025.

### GDPR Compliance

Meridian provides built-in support for GDPR requirements:
- **Data subject access requests (DSAR)**: Automated data export for specific data subjects
- **Right to erasure**: Automated deletion with audit trail
- **Data residency**: Configuration to restrict data storage to specific geographic regions (EU-West for EU customer data)
- **Consent management**: Integration with customer consent management platforms via webhook connectors

Priya Sharma's SRE team maintains the automated GDPR compliance testing suite that runs as part of the weekly chaos engineering tests, validating that data deletion requests are propagated to all storage tiers within the required 30-day window.

## Audit Logging

All API calls, authentication events, configuration changes, and data access operations are logged to an immutable audit log. Audit logs are:
- Retained for 365 days (configurable via `security.audit.retention_days`)
- Stored separately from operational data in a dedicated, append-only storage partition
- Accessible via the `/audit/events` API endpoint (requires `audit:read` scope)
- Exported to customer SIEM systems via syslog or webhook integration

The audit log captures approximately 450 million events per day across all tenants.
