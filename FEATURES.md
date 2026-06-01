# PhantomMailer Features

This document describes the current feature set of the unified PhantomMailer desktop application in this repository.

## Overview

PhantomMailer is an Electron desktop app with a local SQLite data layer and a secure preload-to-IPC bridge.

The current architecture intentionally replaces the older startup model that depended on:
- a local HTTPS backend server
- self-signed certificate bootstrapping
- updater initialization during startup

Instead, PhantomMailer uses:
- Electron main process runtime services
- a preload bridge with allowlisted IPC channels
- local SQLite persistence
- packaged desktop builds for Windows

## Architecture

### Desktop Shell

- Electron main process entrypoint
- Single-window desktop application
- Secure `preload` bridge for renderer-to-main communication
- External URL handling through the system browser
- packaged and development startup paths
- GPU-safe launch handling for constrained environments

### Local Runtime

- local runtime initialization inside `src/core/appRuntime.js`
- local data directory management
- runtime service registration through IPC
- packaged/runtime bootstrap metadata exposed to the UI

### Persistence

- SQLite-backed local database
- automatic schema creation on startup
- lightweight schema evolution through additive column checks
- separate tables for:
  - accounts
  - campaigns
  - recipients
  - segments
  - proxy profiles
  - email events
  - webhook endpoints
  - reputation metrics
  - email validation cache

### Local Secret Handling

- local encryption key generation and reuse
- encrypted storage for account passwords
- AES-256-GCM based credential encryption at rest

## UI Workspaces

### Dashboard

- application bootstrap status
- local data path display
- counts for:
  - accounts
  - campaigns
  - recipients
  - segments
- recent campaigns list

### Accounts

- create sending accounts
- store:
  - provider
  - primary protocol
  - email
  - display name
  - username
  - password
  - host
  - port
  - secure flag
  - notes
- list saved accounts
- remove accounts
- test draft account connection before saving
- test saved account connection after saving
- assign saved SMTP proxy profiles per sender account
- provider templates for Gmail, Outlook, SendGrid, Amazon SES, Mailgun, Postmark, and custom SMTP

### Campaigns

- create campaigns
- store:
  - name
  - subject
  - preview text
  - main content
  - segment selection
  - scheduled time
- pipeline status tracking
- status transitions:
  - draft
  - scheduled
  - active
- A/B campaign support:
  - variant B subject
  - variant B content
  - A/B enabled flag
  - split ratio

### Audience

- add recipients manually
- store recipient:
  - email
  - name
  - tags
  - status
- list recipients
- create audience segments
- segment filters:
  - tag includes
  - status
- segment preview matching
- recipient CSV import
- recipient CSV export

### Content Studio

- local template library
- local draft generation
- generated output includes:
  - subject
  - preview text
  - HTML content

### Deliverability

- local deliverability scoring
- live DNS inspection for:
  - MX
  - SPF
  - DMARC
  - DKIM selector lookup
- account diagnostics summary in deliverability view
- recommendations and findings output
- pre-send checks for physical address, unsubscribe language, suppression counts, spam score, DNS authentication, and SMTP account availability

### Infrastructure

- domain profile management
- IP pool management
- multiple saved proxy profiles for controlled SMTP egress
- proxy profile TCP reachability tests
- sender accounts can switch between direct delivery and a selected proxy profile
- webhook endpoint management for delivery events
- local reputation snapshots for bounces, complaints, sender score, and blacklist status
- list hygiene validation with automatic suppression of invalid recipients

## Runtime Services

### Account Services

- account creation
- account listing
- account deletion
- encrypted credential storage

### Account Diagnostics

- SMTP test connections with `nodemailer`
- SMTP proxy support through account-selected proxy profiles
- IMAP test connections with `imap-simple`
- POP3 test connections through direct socket negotiation
- saved-account testing using stored encrypted credentials

### Campaign Services

- create and list campaigns
- campaign status updates
- scheduled campaign activation
- A/B campaign field persistence
- event logging for sent and failed send outcomes
- webhook dispatch for recorded send events
- reputation-aware account rotation mode
- warmup caps that can ramp toward high-volume sending over account history

### Campaign Scheduler

- runtime timer synchronization for scheduled campaigns
- auto-promotion of due campaigns from `scheduled` to `active`
- resync after campaign create/update operations

### Recipient Services

- recipient listing
- recipient creation
- CSV import with upsert behavior by email
- CSV export

### Segment Services

- segment creation
- segment listing
- recipient preview matching based on filters

### Content Services

- local content template catalog
- local campaign content generation logic

### Deliverability Services

- domain DNS lookups
- SPF record discovery
- DMARC record discovery
- DKIM selector record discovery
- MX lookup
- deliverability scoring and recommendation output

## IPC Surface

The renderer can call these IPC channels through the preload bridge:

- `app:bootstrap`
- `dashboard:get`
- `accounts:list`
- `accounts:create`
- `accounts:test`
- `accounts:delete`
- `campaigns:list`
- `campaigns:create`
- `campaigns:update-status`
- `recipients:list`
- `recipients:create`
- `recipients:import-csv`
- `recipients:export-csv`
- `segments:list`
- `segments:create`
- `segments:preview`
- `content:templates`
- `content:generate`
- `deliverability:analyze`
- `ops:domains:list`
- `ops:domains:add`
- `ops:domains:inspect`
- `ops:ip-pools:list`
- `ops:ip-pools:add`
- `ops:analytics:snapshot`
- `ops:compliance:list`
- `ops:compliance:record`
- `ops:deliverability:preflight`
- `ops:proxies:list`
- `ops:proxies:add`
- `ops:proxies:test`
- `ops:proxies:delete`
- `events:list`
- `webhooks:list`
- `webhooks:add`
- `webhooks:delete`
- `hygiene:validate`
- `hygiene:suppressions`
- `reputation:snapshot`
- `reputation:record`

## Packaging And Build

- webpack-based renderer bundling
- Electron-based desktop packaging
- Windows packaged app output
- root project build now targets `src`

## Current Strengths

- cleaner startup path than the legacy app
- no dependency on local HTTPS bootstrapping
- no certificate-generation requirement for app startup
- no updater dependency during launch
- local encrypted credential storage
- real protocol-aware diagnostics for accounts
- real DNS-backed deliverability inspection
- A/B campaign persistence
- CSV audience workflows

## Not Yet Rebuilt

These features are still missing or only partially restored compared with the full app vision:

- OpenAI-backed content generation
- OCR/image text extraction
- IMAP/POP3 connection pooling
- external reputation provider integrations
- external email validation provider integrations
- inbox placement seed testing
- public REST API server with OAuth and rate limits
- Redis/BullMQ or RabbitMQ queue backend
- PostgreSQL deployment profile
- plugin system
- updater flow
- Docker deployment path
- legacy anti-analysis/integrity system
- installer polish and broader QA automation

## Main Source Areas

- [src/main.js](/abs/path/C:/Users/ade/phantom/src/main.js)
- [src/preload.js](/abs/path/C:/Users/ade/phantom/src/preload.js)
- [src/core/appRuntime.js](/abs/path/C:/Users/ade/phantom/src/core/appRuntime.js)
- [src/core/database.js](/abs/path/C:/Users/ade/phantom/src/core/database.js)
- [src/core/services](/abs/path/C:/Users/ade/phantom/src/core/services)
- [src/core/infrastructure](/abs/path/C:/Users/ade/phantom/src/core/infrastructure)
- [src/renderer](/abs/path/C:/Users/ade/phantom/src/renderer)
