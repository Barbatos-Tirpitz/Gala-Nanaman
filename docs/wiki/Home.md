# Gala-Nanaman Technical Wiki

This source-controlled wiki documents the current implementation for developers.
The [README](../../README.md) is the high-level product and implementation
overview; these pages describe code boundaries, data flow, and operational
behavior. Update the relevant page when changing the behavior it documents.

## Pages

- [Architecture](Architecture.md) — app startup, repository selection, and module boundaries.
- [Data Model and Validation](Data-Model-and-Validation.md) — trip records, Firestore layout, and validation layers.
- [Authentication and Security](Authentication-and-Security.md) — identity, authorization, secrets, and trust boundaries.
- [Offline and Local Storage](Offline-and-Local-Storage.md) — PWA shell, trip snapshots, map cache, and device-local data.
- [Maps and External Integrations](Maps-and-External-Integrations.md) — provider calls, map lookup caching, limits, and outbound links.
- [Photos, Expenses, and Currency](Photos-Expenses-and-Currency.md) — local image lifecycle, integer money representation, splits, and conversion.
- [Development, Tests, and Deployment](Development-Tests-and-Deployment.md) — local checks, emulator tests, and deployment configuration.

## Scope and implementation status

These pages describe code present in the repository, not a future architecture.
In particular, collaboration roles and suggestion approval remain design-only;
Firestore access is currently owner-only. Offline trip copies are optional,
read-only, and not a substitute for server data or backups. Consult
[Release Gates](../RELEASE_GATES.md) for known validation and production-readiness
gaps.
