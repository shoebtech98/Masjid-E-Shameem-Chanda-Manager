<p align="center">
  <img src="mobile/assets/icon.png" alt="Chanda Manager app logo" width="112" height="112">
</p>

<h1 align="center">Masjid E Shameem · Chanda Manager</h1>

<p align="center">Record household contributions, issue payment receipts, and prepare monthly and annual collection reports.</p>

<p align="center">
  <a href="https://masjideshameem.pages.dev/">Website</a> ·
  <a href="https://masjideshameem.pages.dev/admin">Admin sign-in</a> ·
  <a href="https://github.com/shoebtech98/Masjid-E-Shameem---Chanda-Manager/releases">Android releases</a>
</p>

## How it works

1. **Sign in** with an account issued by the masjid administrator.
2. **Find a household** by house number or resident name.
3. **Record the contribution** for the selected month. Choose cash, UPI, or split payment.
4. **Issue a receipt** or open the household’s payment history and generate its account statement.
5. **Review collections** in the monthly or annual report. Print, save, or share the PDF from the app.

Administrators can also manage records and user accounts from the [website](https://masjideshameem.pages.dev/admin).

## Install on Android

Open [GitHub Releases](https://github.com/shoebtech98/Masjid-E-Shameem---Chanda-Manager/releases) on your Android phone. Once an APK is published, download it from the release’s **Assets**, open it, and follow Android’s installation prompts. Sign in with the account provided by your administrator.

An in-place update needs the same package ID and signing key as the installed app. For development on Android or iPhone, use Expo Go with the local preview.

## Run the Expo preview

From the repository root:

```powershell
cd mobile
npm ci
npx expo start --go --lan
```

Connect the phone and computer to the same Wi-Fi. Scan the QR code using the iPhone Camera or the Android Expo Go scanner. See the [mobile build guide](mobile/BUILDING.md) for Windows troubleshooting and installable builds.

## Project layout

| Folder | Purpose |
| --- | --- |
| [`mobile/`](mobile/) | Expo app, mobile screens, PDF templates, and tests |
| [`cloudflare/`](cloudflare/) | Cloudflare Worker API, D1 schema, and deployment configuration |
| [`sites/chanda-manager-mobile/`](sites/chanda-manager-mobile/) | Website, browser-based admin interface, and Cloudflare Pages build |
| `lib/`, `routes/`, `scripts/`, `test/` | Express and SQLite reference app, maintenance scripts, and regression checks |

## Deployment and maintenance

- **Mobile** uses the Expo `staging` profile for the current records backend. This profile creates an internal Android APK. [Mobile build guide](mobile/BUILDING.md)
- **API** uses the [active Cloudflare Worker](https://masjid-shameem-staging.kingshoaib.workers.dev) and its bound D1 database. Treat this environment as live despite the `staging` name. [Cloudflare guide](cloudflare/STAGING.md)
- **Website** is hosted separately on Cloudflare Pages at `masjideshameem.pages.dev`. The site build packages the admin interface and its API proxy. [Website source](sites/chanda-manager-mobile/)
- **API contracts** used by the app are listed in the [mobile API mapping](mobile/API-MAPPING.md).

Keep local databases, backups, signing files, and credentials outside GitHub. Use isolated fixture data for write tests.
