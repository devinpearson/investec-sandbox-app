// Packaging (npm run dist / npm run pack). Builds for this Mac's processor.
//
// Signing and notarisation turn on when their credentials are in the
// environment, so local builds stay unsigned:
//   CSC_LINK (+ CSC_KEY_PASSWORD) or CSC_NAME   a Developer ID Application certificate
//   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID   (or APPLE_API_KEY…) for notarisation
// Auto-updates: set SANDBOX_GITHUB_REPO=owner/repo and publish signed builds
// to that repository's GitHub Releases (electron-builder --publish always).

const signing = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)
const notarizing = signing && Boolean((process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) || process.env.APPLE_API_KEY)
const [owner, repo] = (process.env.SANDBOX_GITHUB_REPO || '').split('/')
const arch = [process.arch]
// The .zip is what auto-update downloads, so only releases need it.
const release = process.env.SANDBOX_RELEASE === '1'

module.exports = {
  appId: 'com.devinpearson.investec-sandbox',
  productName: 'Investec Sandbox',
  copyright: 'Copyright © 2026 Devin Pearson',
  directories: { output: 'release', buildResources: 'assets' },
  // No spaces, and the processor in every name, so the Intel and Apple
  // silicon builds can sit side by side on a GitHub release.
  artifactName: 'Investec-Sandbox-${version}-${arch}.${ext}',
  files: [
    'main.js',
    'services.js',
    'prefs.js',
    'windows.js',
    'tray.js',
    'config.js',
    'recorder.js',
    'guide.js',
    'shell.html',
    'shell.css',
    'shell.js',
    'shell-api.js',
    'shell-dev.js',
    'shell-preload.js',
    'page-preload.js',
    'aux-preload.js',
    'ui/**',
    'assets/icon.png',
    'assets/zebra.png',
    'assets/trayTemplate.png',
    'assets/trayTemplate@2x.png',
    'package.json',
  ],
  // Only English: Electron ships ~220 language packs for its own UI strings.
  electronLanguages: ['en'],
  // The built services (npm run build), outside the asar archive: they run
  // as separate Node processes.
  extraResources: [{ from: 'build', to: 'services', filter: ['**/*'] }],
  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'assets/icon.png',
    target: [{ target: 'dmg', arch }, ...(release ? [{ target: 'zip', arch }] : [])],
    identity: signing ? undefined : null,
    hardenedRuntime: signing,
    entitlements: 'assets/entitlements.mac.plist',
    entitlementsInherit: 'assets/entitlements.mac.plist',
    notarize: notarizing,
  },
  dmg: {
    title: 'Investec Sandbox',
    // LZFSE: quicker to make and open than the default zlib, and smaller
    // (needs macOS 10.11+). The block map is for differential updates only.
    format: 'ULFO',
    writeUpdateInfo: release,
  },
  publish: owner && repo ? [{ provider: 'github', owner, repo }] : null,
}
