# Masjid E Shameem · Chanda Manager

Chanda Manager records household contributions and generates reports, receipts, and account statements. The Expo app runs on Android and iPhone. The website provides laptop access for administrators.

- [Live website](https://masjideshameem.pages.dev/)
- [Admin sign-in](https://masjideshameem.pages.dev/admin)
- [Active Cloudflare API](https://masjid-shameem-staging.kingshoaib.workers.dev)

The active Worker has **staging** in its name and is the backend used for the current records. Use the Expo `staging` profile and `cloudflare/wrangler.staging.toml` for this environment. The separate `production` profile and Worker configuration target a different database.

## Project folders

| Folder | Purpose |
| --- | --- |
| `mobile/` | Expo app, native assets, PDF templates, and mobile tests |
| `cloudflare/` | Worker API, D1 schema, and deployment configuration |
| `sites/chanda-manager-mobile/` | Website assets, admin interface, and Cloudflare Pages packaging |
| `lib/`, `routes/`, `scripts/`, `test/` | Express and SQLite reference app, maintenance scripts, and regression checks |

## Develop and deploy

- [Mobile development and builds](mobile/BUILDING.md)
- [Mobile API mapping](mobile/API-MAPPING.md)
- [Active Cloudflare environment](cloudflare/STAGING.md)
- [Website design reference](sites/chanda-manager-mobile/brand-spec.md)

The website source assets are kept in `sites/chanda-manager-mobile/dist/`. Its build script embeds those assets in `dist/server/index.js`. That output can be packaged as `_worker.js` for the Pages project `masjideshameem` with a `_routes.json` that includes `/*`. Upload only the prepared Pages bundle.

The Docker and alternate hosting guides describe the separate Express reference app. Keep local databases and backups outside deployment bundles.
