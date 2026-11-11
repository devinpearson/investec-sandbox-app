# Releasing

How to package Investec Sandbox and publish a release. For setting up a checkout and building the services, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Releases on GitHub
Publishing a release on GitHub runs [.github/workflows/release.yml](.github/workflows/release.yml):

1. Create a release with a tag such as `v1.2.0`. The tag sets the app's version: `v1.2.0` makes 1.2.0.
2. Publish it. The workflow builds three apps, each on its own runner, since the services' native modules are built for the machine that builds them:
   - the Mac app for Apple silicon (`macos-15`)
   - the Mac app for Intel (`macos-15-intel`)
   - the Windows installer for x64 (`windows-2022`)
3. Each build runs a smoke check: the bundled Node.js, the MCP server and the card server's `isolated-vm` must all load.
4. Once all three pass, these files are attached to the release:

| File | What it is |
|---|---|
| `Investec-Sandbox-<version>-arm64.dmg` | Mac, Apple silicon |
| `Investec-Sandbox-<version>-x64.dmg` | Mac, Intel |
| `Investec-Sandbox-Setup-<version>-x64.exe` | Windows installer |
| `*.zip`, `*.blockmap`, `latest-mac.yml`, `latest.yml` | What the apps' auto-update downloads and reads |

`latest-mac.yml` is merged from the two Mac builds by [scripts/merge-update-info.mjs](scripts/merge-update-info.mjs), so either processor finds its own download.

To build without a release, run the workflow from **Actions → Release → Run workflow**. The files are then kept as workflow artifacts for 14 days.

### Signing
Each platform is signed when the repository has its secrets (**Settings → Secrets and variables → Actions**):

| Secret | For |
|---|---|
| `CSC_LINK` | Mac: a Developer ID Application certificate (`.p12`, base64) |
| `CSC_KEY_PASSWORD` | Its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Mac: notarisation |
| `WIN_CSC_LINK` | Windows: a code signing certificate (`.pfx`, base64) |
| `WIN_CSC_KEY_PASSWORD` | Its password |

Without them, the builds are unsigned:
- macOS blocks the app the first time it's opened, and it can't update itself.
- Windows SmartScreen warns before installing. Updates still work.

## Packaging locally
```bash
npm run dist
```

This builds everything, then packages the Mac app for this Mac's processor. Node.js and the native modules are installed for the machine that builds them, so build on Apple silicon for an arm64 app. It writes:
- `release/Investec-Sandbox-<version>-<arch>.dmg`, about 180 MB, LZFSE-compressed. Open it and drag the app to Applications.
- `release/mac/Investec Sandbox.app`, about 440 MB, most of it Electron and Node.

Packaging takes about 20 seconds. Other scripts:
- `npm run pack` builds just the `.app`.
- `npm run release` also makes the `.zip` and block map that auto-update uses, and publishes them.

On Windows, run `npm run build`, then `npx electron-builder --win --config electron-builder.config.cjs` to write the installer to `release/`.

Electron's language packs are left out except English. The packaging settings are in [electron-builder.config.cjs](electron-builder.config.cjs).

### Signing, notarisation and updates
These turn on when their credentials are in the environment; without them the build is unsigned.

A copy you build yourself opens normally. On another Mac, right-click it and choose **Open** the first time.
- **Signing:** `CSC_LINK` and `CSC_KEY_PASSWORD` (or `CSC_NAME`) for a Developer ID Application certificate. The hardened runtime's exceptions are in `assets/entitlements.mac.plist`.
- **Notarisation:** `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, or an App Store Connect API key.
- **Updates:** set `SANDBOX_GITHUB_REPO=owner/repo` and run `npm run release` to publish to that repository's GitHub Releases. Copies built that way check for updates 10 seconds after launch, and from **Check for Updates…** in the app menu. A build without that setting says updates aren't set up for it.
