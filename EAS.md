# Building Trackside for a device

Everything below runs from Windows. No Mac is needed for either platform.

## What each profile is for

| Profile | Purpose | Lasts | Developer Mode |
|---|---|---|---|
| `development` | Day-to-day work. Embeds the Expo dev client, so JS changes hot-reload from your PC and you only rebuild when a **native** dependency changes. | 1 year (iOS) | iOS: yes |
| `preview` | A plain installable build to carry at an event. Ad hoc on iOS, APK on Android. | 1 year (iOS) | iOS: no |
| `production` | Store submission. | — | no |

`developmentClient: true` is the difference that matters. Without it every
TypeScript edit means a fresh cloud build; with it, the app connects to Metro
over Wi-Fi and refreshes in seconds.

`buildType: apk` on Android rather than an app bundle, because an APK installs
directly from a link. App bundles only go through Play.

## Android first (free, ~10 minutes)

Do this before paying Apple. It proves MapLibre native actually works — none of
the map has ever run on a device, only in the browser.

```
npx eas-cli login          # free Expo account
npx eas-cli build --platform android --profile development
```

EAS returns a QR code and a link. Open it on the phone, install the APK, allow
installs from unknown sources when prompted.

## iOS (needs Apple Developer Program, $99/yr)

```
npx eas-cli login
npx eas-cli device:create     # registers your iPhone's UDID
npx eas-cli build --platform ios --profile development
```

`device:create` gives you a link/QR. Open it **on the iPhone** in Safari — it
installs a provisioning profile that registers the device against your account.
Without this the build installs but refuses to launch.

Then on the phone, once:

1. Settings → Privacy & Security → **Developer Mode** → on → restart.
2. Settings → General → VPN & Device Management → trust your developer cert.

EAS prompts for Apple credentials during the build and manages the certificates
and provisioning profiles itself. Enter those yourself — they are not something
to hand to anyone or anything else.

## Running it

The development build is a shell; the JavaScript comes from your machine.

```
npm start
```

Phone and PC on the same Wi-Fi. Open the app, scan the QR from the terminal.
After that, edits reload live.

Rebuild natively only when native dependencies change — adding a package with
native code, changing `app.json` plugins, or bumping the Expo SDK. Editing
TypeScript never needs one.
