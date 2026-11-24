# Mobile development and builds

The Expo previews and the `staging` build profile use the [active Cloudflare API](https://masjid-shameem-staging.kingshoaib.workers.dev). The app displays the configured API address on the sign-in screen. The separate `production` profile targets a different environment.

## Expo Go on Windows

Run from the `mobile` folder:

```powershell
npm ci
npx expo start --go --lan --port 8082
```

Run `npm ci` on a fresh checkout or when the lockfile changes. Connect the phone and PC to the same Wi-Fi. Scan the project QR with iPhone Camera or the Android Expo Go scanner. Reload the existing preview to pick up JavaScript and template changes.

If the Windows `npx` launcher cannot find Node, use the installed Node executable directly:

```powershell
& 'C:\Program Files\nodejs\node.exe' node_modules/expo/bin/cli start --go --lan --port 8082
```

## Installable builds

```powershell
npx eas-cli@latest build --profile staging --platform android
npx eas-cli@latest build --profile staging --platform ios
```

The Android profile creates an internal APK. An in-place update requires the same package ID and signing key. The iPhone build requires Apple signing and a registered device.

Before distributing, verify sign-in, household search, payment collection, reports, and PDF printing, saving, and sharing on physical devices. Use isolated fixture data for write tests. Deploy API changes separately using the [Worker guide](../cloudflare/STAGING.md).
