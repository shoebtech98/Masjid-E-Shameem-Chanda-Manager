# Active Cloudflare Worker and D1

The current website and Expo builds use the [active Worker](https://masjid-shameem-staging.kingshoaib.workers.dev). It is named `masjid-shameem-staging` and has its own D1 binding in `wrangler.staging.toml`. Treat its records as live. Use isolated fixtures for destructive tests.

The Worker serves the JSON API. The [website](https://masjideshameem.pages.dev/) is deployed separately on Cloudflare Pages.

## Deploy API changes

From this directory, with Wrangler authenticated:

```powershell
npx wrangler deploy --config wrangler.staging.toml
```

After deployment, check the health endpoint and verify sign-in and a read-only report with an authorized account. Keep `NODE_ENV=production` and demo seeding disabled. Keep any bootstrap secrets in Cloudflare, and remove them from the Worker after initial account setup.
