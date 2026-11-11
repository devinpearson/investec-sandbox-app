# UX implementation plan

From the native-app UX review. Numbers match the review's suggestions. **Status: all implemented** (November 2026); notes on what differs are marked *Done:*.

## 1. Foundations
- **Static dashboard (14).** Build `packages/sim/web` as a static export (`output: 'export'`) and serve it from the main process like the card editor. Drops the Next.js server process, its port wait and ~70 MB. `/` redirects on the client.
- **Runtime ports (13).** Each service prefers its usual port (3000/3001/3002/3010) and falls back to the next free one. The dashboard and editor read the API and card server addresses from `/sandbox-config.js`, served by the app; builds keep their old defaults for the browser and dev servers. Ports can be set in Preferences.
- **Page bridge.** A preload for section pages exposes `window.sandboxApp` (app mode, native confirm sheets, native save panels, notifications, toolbar actions). Pages use it when present and fall back to the browser otherwise, so the web versions are unchanged.

## 2. Dashboard in the app
- **Toolbar actions and sheets (1, 2).** The folded forms (Transfer, Swipe a card, Add a card, Pay a beneficiary, Add a recurring transaction, Register a webhook, Add a currency) become toolbar buttons that open the form as a sheet. In a browser they stay folded in the page.
- **No duplicate title (1).** The first panel's heading is hidden in the app; the toolbar names the page.
- **Native dialogs and save panels (2, 10).** Clear, Import and Delete webhook confirm in a native sheet with a destructive button; Export saves through a native Save panel. *Done:* the saved path is reported in the status message rather than revealed in Finder, which interrupts less; Electron can't colour a message box's button red, so destructive confirms are warnings whose default button is Cancel.
- **Toasts (2).** Compact, bottom-centred status; a system notification as well when the window isn't focused.
- **Remembered state (12).** The Transactions page keeps its account and filters; each section's scroll position is restored.
- **Look (6).** The system accent colour replaces the dashboard's blue and the editor's indigo; text and spacing are scaled to macOS sizes.

## 3. Card editor in the app
- Native confirm sheets (replace workspace, overwrite a saved one), a native Save panel for Export, the accent colour, and the card server address from the runtime config.

## 4. Shell
- **Toolbar (3).** No URL, reload or open-in-browser buttons (still in the menus). The subtitle describes the section. Page actions sit on the right.
- **Service status (8).** One toolbar indicator ("All services running" or what's wrong) that opens a native menu per service (restart, copy URL, open folder). The sidebar's service list goes.
- **Sidebar (7).** Arrow keys, Return and type-to-select; accent selection when the window is focused, grey when not; drag to resize (remembered); status shown with text, not only colour.
- **Menus (9).** File: Import Sandbox… (⌘O), Export Sandbox… (⇧⌘E), Load Scenario ▸, Reset Sandbox Data…, Clear Sandbox Data…. Card Code: Run (⌘↵), Save As…, Import…, Export…. A command palette (⌘K) for sections, scenarios and actions.
- **Swagger in dark mode (11).** A dark style for the API reference when the system is dark.

## 5. App features
- **Preferences (5).** ⌘, opens a native Preferences window: launch at login, keep running in the menu bar when the window is closed, preferred ports, data folder.
- **Menu bar and Dock (4).** A menu bar icon with service health and quick actions (Open, Restart All, Copy API URL, Quit). The Dock icon shows a badge while faults are on or the sandbox clock is moved.
- **Welcome (17).** A first-launch sheet: API base URL and credentials with copy buttons, the Postman collection, and a "try a card swipe" shortcut. Reopen from Help.
- **Logs (18).** Pause, Clear, Export…, and HTTP status highlighting for API requests.
- **API explorer (15).** A native API reference built from the OpenAPI document: endpoints by tag, parameters, and a request runner with the response. Swagger UI stays available from the Help menu.

## 6. Distribution (16)
- Build for the current Mac by default and for another architecture with `--arch` (Node, native modules and Prisma's engine per architecture). *Done:* builds are for the build machine's processor; an arm64 build needs an Apple silicon Mac (cross-compiling isolated-vm and Prisma's engine isn't set up).
- Hardened runtime and entitlements, with signing and notarisation turned on when the Apple credentials are set (`CSC_LINK`, `APPLE_ID`, …); unsigned local builds as now.
- Auto-update through GitHub Releases (electron-updater) for signed builds, with Check for Updates… in the app menu. *Done:* the repository is set with `SANDBOX_GITHUB_REPO`; none is assumed.

## 7. Verify
Dashboard typecheck, lint, unit and end-to-end tests; editor typecheck, lint and tests; dev mode, build mode and the packaged app.
