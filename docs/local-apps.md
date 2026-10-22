# Local Mac and iOS apps

Build the clients from this checkout against an existing Docker backend. Local
clients use the name **Rakazo Local**, their
own application identifiers and settings, and no upstream automatic updates.
They connect to the same server as the release: conversations and actions are
real server data, not a separate development database. Use an isolated backend
before changing API behavior or running migrations.

## Setup

Install the repository's supported Node version, pnpm 9, and dependencies:

```sh
pnpm install --frozen-lockfile
cp local-app.env.example .env.local
```

Set `RAKAZO_SERVER_URL` in `.env.local` to the server URL you already use.
Keep tailnet names, addresses, signing teams and credentials out of tracked files.
This configuration contains no account password or API key. Sign in separately
in each local app.

The iOS simulator can use `http://127.0.0.1:45173` for the standard Mac-managed
stack. A physical iPhone must use the Mac's reachable tailnet server URL instead.
Tailnet HTTP works with a `100.64.0.0/10` IP address; a MagicDNS hostname needs
HTTPS. Existing HTTPS tailnet URLs work without changing the server.

## Mac

```sh
pnpm local:mac
```

This builds the web UI and Electron shell, then opens the local app against
`RAKAZO_SERVER_URL`. It needs no Vite server. Run it again after source edits.
It uses a separate `Rakazo Local` settings directory even when the release is
open. Its bundled UI comes from the checkout, and API, auth and computer traffic
go to the selected backend.

To create a standalone application:

```sh
pnpm build:mac
```

The application is written under `apps/desktop/out/local/mac-*/Rakazo Local.app`.
Open it there or copy it to Applications alongside Rakazo. On its first launch,
choose **Existing instance** and enter your current server URL. The packaged
app saves this selection; it does not read the checkout's `.env.local` at launch.
Choose **Existing instance**, rather than starting a second managed stack.

### Owning an existing Mac stack

Rakazo Local can also own a previously installed app's managed stack. Back up the
database, stack configuration and host-computer files before handing it over.
With both apps closed, copy `setup.json`, `stack`, `host-computer.json`,
`host-computer-consent` (when present), and `computers` from the original app's
application-support directory to Rakazo Local's directory. Preserve private file
permissions and the original files for rollback. Do not copy over browser sessions.

Keep the existing Compose project and Docker volumes. A managed setup uses
`mode: "new"` in `setup.json`; it opens the origin saved in `stack/.desktop-web-url`.
Keep the original host-computer port and credential together with its files so
the running workers can reconnect without changing the backend or its address.

Write the existing stable backend tag (for example, `v0.2.0`) to
`stack/.desktop-image-tag` in Rakazo Local's application-support directory. Local
builds honor this pin so client iterations do not upgrade the adopted backend.
An explicit `RAKAZO_IMAGE_TAG` launch override takes precedence. Release builds
continue to use their own version. Invalid pins fail closed instead of silently
selecting a different backend version.

After handover, run Rakazo Local alone. Its native host-computer service replaces
the original app's service. Existing phone clients keep using the same server
address. Do not launch both apps as owners of the same stack.

The local package uses an ad hoc signature and is unnotarized, intended for this Mac. It does
not publish a release or replace the installed release. Rebuilding produces a
new application at the same output path; quit the previous local app before
replacing a copy in Applications.

## iOS

### Push notifications

The local iPhone app uses the existing backend's Expo push adapter. It needs its
own Expo project and Apple push credentials for its separate bundle identifier.
Push delivery does not require a development server or public access to your
Rakazo backend. Tailscale is still needed to load the thread after opening a push.

Before building for your phone:

1. Sign into your paid Apple account in Xcode → Settings → Accounts.
2. Install the EAS CLI if needed (`npm install -g eas-cli`) and run `eas login`
   with your own Expo account.
3. Set your own `RAKAZO_IOS_BUNDLE_IDENTIFIER` and `RAKAZO_APPLE_TEAM_ID` in
   `.env.local`, then run `pnpm setup:ios:push`. Choose your own Expo account
   when project initialization asks where to create or link the project.
4. Choose the **local** build profile in the credentials menu and configure its
   Apple Push Notifications service key. Sign into the same paid Apple team
   used by Xcode. EAS stores the key for this app's Expo project so its push
   service can deliver notifications through APNs.

The setup command creates or links `rakazo-local` under your authenticated Expo
account and saves `RAKAZO_EXPO_PROJECT_ID` in ignored `.env.local`. It performs
project initialization in an ignored temporary directory so the release's
tracked configuration is not rewritten. If you already have an Expo project for
this app, set its UUID in `.env.local` before running the command.

Phone builds and TestFlight archives refuse to proceed without the local Expo
project ID. The push entitlement remains enabled, while upstream OTA updates and
the release's passkey domain associations stay disabled. EAS Build is not needed;
compilation and installation still run locally.

After installing, allow notifications, sign in and verify delivery with the app
in the background and the phone locked. Open the notification and confirm it
lands in the correct thread over Tailscale. Configuration checks do not prove
that APNs delivered a notification; this physical-device check is required.

The current backend stores one push token per user. Registering the local app
replaces the release app's token for that account, so the most recently registered
app receives pushes. Logging out of either app also clears the account's token;
reopen the app you want to use for notifications to register it again. Supporting
both apps simultaneously needs a backend change.

If the Expo project requires an access token for enhanced push security, its
credential must also be configured on the backend through `EXPO_ACCESS_TOKEN`.
Do not replace an existing backend credential without checking its other clients.

### Build and install

Install Xcode, CocoaPods, and an iOS simulator runtime in Xcode Settings →
Components. Then:

```sh
pnpm local:ios
```

This syncs the ignored native project, builds a Debug app and starts Metro for
Fast Refresh. For a physical device, add `--device`. The phone must be able to
reach both the backend and Metro on the Mac, normally port 8081. Use a
Tailscale IP if Metro chooses an address the phone cannot reach: set
`REACT_NATIVE_PACKAGER_HOSTNAME` in `.env.local` to the Mac's tailnet IP.

For a standalone app with bundled JavaScript and no Metro server:

```sh
pnpm build:ios
```

This builds and installs a Release app on a simulator. For an artifact without
opening a simulator:

```sh
pnpm build:ios --device generic --output ./build/local
```

For your iPhone, enable Developer Mode, configure your Apple account in Xcode,
set `RAKAZO_IOS_BUNDLE_IDENTIFIER` and `RAKAZO_APPLE_TEAM_ID` in `.env.local`,
connect the device, and run:

```sh
pnpm build:ios --device
```

Device installation requires your signing identity and provisioning profile.
Development provisioning expires and must be renewed according to the Apple
account used. No Expo account, EAS build or App Store submission is required.

Local builds disable EAS updates and native passkey domain associations,
since the release's domain association does not authorize
a separately signed app.
Use email and password with an unchanged release backend. Browser SSO uses the
separate `rakazo-local://` callback scheme; an unchanged backend does not trust
that scheme, so SSO needs server support before it can work. Push notifications
use the paid Apple membership and Expo project configured above.

Native modules, permissions and native configuration changes require rebuilding.
JavaScript-only edits refresh in a Debug build; Release builds keep their bundled
code until rebuilt. Avoid switching to upstream Expo commands without
`RAKAZO_LOCAL_BUILD=1`, which selects the local identity.

## Remote iPhone installation with TestFlight

With a paid Apple Developer Program membership, TestFlight can install and update
the standalone local app while your phone is away from the Mac. It uses the same
separate app identity and tailnet backend. Neither USB nor Metro is needed.

First add your paid Apple account under Xcode → Settings → Accounts. Set its team
and your own application identifier in `.env.local`. A development certificate
alone is not an authenticated Apple account; Xcode needs account access to create
provisioning profiles and manage distribution signing.

Create the signed archive without a connected phone:

```sh
pnpm archive:ios
```

The archive is written to
`apps/mobile/build/local-testflight/RakazoLocal.xcarchive`. The command preserves
the native project and reuses the physical-device compilation cache.

In [App Store Connect](https://appstoreconnect.apple.com/apps), create your own iOS
app record using exactly the bundle identifier in `.env.local`. Choose an available
name such as Rakazo Local, English as the primary language, and your own SKU.
This creates a record for your build; it does not publish an App Store release.

Then upload the existing archive:

```sh
pnpm upload:ios
```

The export uses automatic Apple signing, lets Xcode manage upload build numbers,
and marks the build for **internal TestFlight testing only**. It cannot be
distributed to external testers or released on the App Store. No Expo cloud
account or EAS project is used.

After Apple finishes processing, create an internal testing group on the app's
TestFlight tab, add your App Store Connect user, and assign the build. Open
TestFlight on your iPhone to install it. Later updates use the same archive and
upload commands. TestFlight builds expire after 90 days. This workflow also uses
the local app's push credentials configured above.

## What can keep running

Standalone Mac and iOS builds need neither Vite nor Metro. Your existing Rakazo
backend and Tailscale still need to run. These client commands do not start,
stop, update or migrate that backend. Changes to API, worker or provider code
need a source backend using the README's development setup; rebuilding a client
does not update the Docker images.
