# Expo Mobile API Integration

Native client mapping to existing Worker contracts and remaining release
gaps. This does not change the Worker, D1 schema, or production records.

## Authentication and transport

The Worker supports two separate session transports:

- The browser PWA uses `POST /api/auth/login` and an HTTP-only session cookie.
- Native clients use `POST /api/auth/mobile-login`, receive a 256-bit bearer
  token, and send it as `Authorization: Bearer <token>`. The Worker middleware
  accepts bearer tokens as well as cookies, so native authentication does not
  depend on browser cookie behavior.

The Expo client stores native server/session values with `expo-secure-store`; its
web-only preview uses an in-memory map. The Worker invalidates deactivated
users and supports logout and password changes for bearer sessions. Expired
401 responses clear the local session and return the app to login.

`mobile/src/api.ts` centralizes requests, JSON/error parsing, URL validation,
bearer headers, login, restoration, logout, and Admin calls. App config and
local defaults target the staging Worker. EAS development, preview, and
staging profiles explicitly target staging; only the separately named
production profile targets production.

## Screen-to-API mapping

| Mobile screen / task | Existing Expo calls | Worker contract | Phase 1 status |
|---|---|---|---|
| Login and session restore | `GET /api/health`; `POST /api/auth/mobile-login`; `GET /api/auth/me` | Login body `{email,password}` returns `{user,token}`; `/me` returns `{user}`; health is public. | Connected. Expired authenticated sessions return to login. Defaults and development builds target staging. |
| Logout | `POST /api/auth/logout` | Accepts bearer token and returns `{ok:true}`. | Connected; client clears the secure token even if the request fails. |
| Dashboard | `GET /api/dashboard` | Returns month/year, totals in paise, paid/pending counts, active/total household counts, and recent payments. | Connected to live API; no demo fallback found. |
| Household list and search | `GET /api/households?status=&limit=&offset=&search=` | Returns `{total,items}`; statuses are `active`, `inactive`, or `all`. | Connected; Expo filters the returned list and supports refresh. |
| Household details and payment history | `GET /api/households/:id` | Returns `{household,payments,summary}` including payment history and current-period totals. | Connected inside a sheet. |
| Add/edit household | `POST /api/households`; `PUT /api/households/:id` | Body contains house number, name, phone, monthly amount, and status; returns `{household}`. | Connected. Worker has no household DELETE route. |
| Record payment | `GET /api/households?status=active&limit=500`; `GET /api/payments/check?household_id=&month=&year=`; `POST /api/payments` | Body uses rupee input values, ISO `YYYY-MM-DD` date, mode, and split portions when applicable. The check returns `{existing}` with amount, mode, and date where present. Success returns `{payment,duplicate_overridden}`. Duplicate returns 409; `force:true` is the explicit second-entry override. | Connected. The Expo form checks on household/month/year changes and immediately before submission; the Worker remains authoritative. |
| Payment history | Household details show that household’s payments; monthly/annual reports show filtered payment rows. | There is no `GET /api/payments` collection endpoint. Existing alternatives are `GET /api/households/:id`, `GET /api/reports`, and `GET /api/reports/data`. | Connected through household details and reports. Household payment entries can fetch the canonical record for its receipt. |
| Payment edit/delete | No Expo calls. | `GET /api/payments/:id`, `PUT /api/payments/:id`, and `DELETE /api/payments/:id` are available to authenticated users. Edit returns 409 on a duplicate period unless explicitly forced; delete returns `{ok:true}`. | Not exposed in the native UI. Existing Worker authorization and duplicate rules remain unchanged. |
| Payment receipt | `GET /api/payments/:id`, followed by local PDF rendering and native share sheet. | Returns the canonical payment with household number/name. | Receipt PDF generation, sharing, and print/save actions are implemented. |
| Monthly/annual reports | `GET /api/reports/data?type=monthly|annual&month=&year=&mode=all|cash|upi`, followed by local PDF rendering. | Returns real aggregates and rows in paise; monthly reports also include pending households. | Report screens and structured PDF builders are implemented. Annual PDFs fetch all 12 monthly reports and verify totals/modes against the annual response. |
| User management | `GET/POST /api/users`; `PUT/DELETE /api/users/:id`; `PUT /api/users/:id/password`. | Every route requires Admin. The Worker protects the last active Admin and prevents self-delete/deactivation/role-change cases. | Admin-only user list/search, create, role/status updates, password reset, and delete UI are connected. Worker authorization remains authoritative. |
| Settings | `PUT /api/settings/profile`; `PUT /api/settings/password`; logout; local server URL read. | `GET /api/settings` returns user and counts; profile returns `{user}`; password change returns `{ok:true}` and a replacement bearer token when authenticated with Bearer. | Profile/password/logout are connected. Settings stats and server reconfiguration are not. |
| Audit log | `GET /api/audit` and `/api/audit/stats` | Both require Admin. | Admin-only audit list, filters, pagination, and summary counts are connected. |

## Shared financial rules

The Worker remains the source of truth:

- Monetary values in D1 and Worker responses are integer paise. Payment
  creation parses rupee input into paise, and reports expose paise aggregates;
  the Expo client formats those values as INR exactly once.
- Payment input is validated in `cloudflare/src/validate.js`; positive amounts,
  valid calendar dates, and the Asia/Kolkata no-future-date rule are enforced
  server-side.
- For split payments, cash plus UPI must equal the total exactly. The D1 schema
  also checks `cash_amount + upi_amount = amount`.
- Duplicate payment checks return 409 unless the caller explicitly confirms
  `force:true`. The Worker applies the duplicate condition in the write
  statement, so mobile must not replace this with client-only logic. The
  collection form also uses `/api/payments/check` to warn about an existing
  payment before submission and refreshes that warning when the selection or
  collection period changes.
- The collection form uses the native date picker on Android/iOS and a browser
  date input on Expo Web. Both cap selection at the current Asia/Kolkata date;
  the Worker future-date validation remains unchanged.
- The Worker writes audit entries for payment and household changes.
- No payment offline queue or sync mechanism exists; none should be added.
- Household and payment routes require authentication. User-management and
  audit routes additionally require the Admin role. Current payment and
  household mutation permissions are the same for Admin and Treasurer.

## PDF/report behavior

The Expo client uses the canonical Worker report/payment data and generates
A4 HTML documents locally. It supports monthly and annual collection reports,
household account statements, and individual receipts. Android can save via
the system folder picker, share, and print; iOS uses the system share sheet
(including Save to Files) and print; Web opens the browser print/save-as-PDF
dialog. Outstanding balances are omitted because the API does not provide an
authoritative balance field. PDF pagination and native save/print behavior
still require real-device verification.

## Test and release gaps

- `mobile/package.json` has typecheck/lint and focused document/date/money
  regression tests, but no authenticated mobile integration test runner.
- Cloudflare has a time test and a D1 test shim, but no configured mobile
  integration environment or safe test account. The production D1 ID is in
  `cloudflare/wrangler.toml`; tests must use local D1 or a separate test
  environment and must not use that production binding remotely.
- EAS development, preview, staging, and production profiles are defined.
  Android package and iOS bundle identifiers are set in `app.json`; both
  currently use version `1.0.0`. An EAS project, signing credentials, and
  internal/store builds have not been created.
- No Android/iOS device or simulator is available in this environment.
  Bundle compilation can be checked here, but on-device verification must be
  reported separately.

## Remaining work before release

1. Complete authenticated financial integration checks using dedicated
   synthetic staging accounts. Do not write to production or alter the three
   existing staging test payments.
2. Verify cash, UPI, split, duplicate, historical/future-date, network failure,
   and concurrent submission cases against staging.
3. Verify report/receipt PDF pagination, opening, saving, sharing, and printing
   on real Android and iOS devices.
4. Create/configure the EAS project and signing credentials, build the staging
   Android APK and iOS device build, install them, and complete device QA.
5. Payment edit/delete and Settings statistics/server reconfiguration are not
   currently exposed in the native UI.
