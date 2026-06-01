# PhantomMailer

PhantomMailer is a Windows-first Electron desktop application for managing accounts, campaigns, audience data, content drafting, and deliverability operations from a local encrypted workspace.

## Current Architecture

- Electron main process in [src/main.js](/abs/path/C:/Users/ade/phantom/src/main.js)
- secure preload bridge in [src/preload.js](/abs/path/C:/Users/ade/phantom/src/preload.js)
- local SQLite persistence in [src/core/database.js](/abs/path/C:/Users/ade/phantom/src/core/database.js)
- runtime services in [src/core/services](/abs/path/C:/Users/ade/phantom/src/core/services)
- infrastructure and deliverability operations in [src/core/infrastructure](/abs/path/C:/Users/ade/phantom/src/core/infrastructure)
- React renderer in [src/renderer](/abs/path/C:/Users/ade/phantom/src/renderer)

## Current Feature Areas

- dashboard with local app status and campaign snapshot
- account storage with encrypted credentials
- SMTP, IMAP, and POP3 connection diagnostics
- campaign management with scheduling and A/B fields
- recipients, segments, and CSV import/export
- local content templates and draft generation
- DNS-based deliverability inspection for SPF, DKIM, DMARC, MX, BIMI, and MTA-STS readiness
- domain, IP pool, compliance, and preflight operations
- multiple saved proxy profiles for account-selectable SMTP egress
- reputation-aware sender rotation, local list hygiene, event webhooks, and delivery event analytics

## Development

```bash
npm install
npm run build:renderer
npm run dev
```

## Windows Packaging

```bash
npm run build:electron:win
npm run build:win-installer
```

Packaged output is generated in `dist/`.

## Documentation

- Current feature inventory: [FEATURES.md](/abs/path/C:/Users/ade/phantom/FEATURES.md)

## Notes

- The application now lives under a single `src` tree.
- Legacy startup code, old backend files, and obsolete scratch files were removed during the rebuild.
- Legacy Docker and backend-server packaging files were removed because the app now runs as a local desktop runtime.
