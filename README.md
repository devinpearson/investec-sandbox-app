# Investec Sandbox

A desktop app for the Investec programmable banking sandbox. It brings five services together in one window:

| Service | Usual port | Source |
|---|---|---|
| API (Express + Prisma, SQLite) | 3000 | `packages/sim/` |
| Dashboard, OAuth tester and quick start (Next.js, served as static files) | 3001 | `packages/sim/web/` |
| Card code editors (Blockly, and Monaco at `/code.html`; Vite) | 3002 | `packages/blockly/` |
| Card server, which runs the editor's code (`isolated-vm`) | 3010 | `packages/card-server/` |
| MCP server: AI assistants create, edit, run and open card code; the editors' card code library | 3020 | `packages/blockly/mcp/` |

All the code lives here (see [packages/README.md](packages/README.md) for where each package came from). The built app is self-contained: it ships its own Node.js and every service, and doesn't need any other checkout, a system Node, or anything else running.

## Setup
You need Node.js 20 or newer to run npm and the build scripts, and Xcode's command line tools (`xcode-select --install`) to compile `isolated-vm`.

```bash
npm install
```

Besides Electron, this downloads Node.js 22.16.0 into `vendor/node` (the version the services run on, pinned in [config.js](config.js), checksum-verified), installs each package's dependencies with it, and creates the development database. Run it again after pulling changes to a package's lockfile.

## Develop
```bash
npm run dev
```

Runs the app straight from `packages/` with live reload: the API under `tsx watch`, the dashboard under `next dev`, the editor under Vite, and the card server under `tsc --watch` + `node --watch`. Edit a package and the change shows up in the app. The development data is in `packages/sim/prisma/dev.db`.

Each package still has its own scripts, e.g. `npm --prefix packages/sim test` or `npm --prefix packages/sim/web run test:unit`.

## Build
```bash
npm run build
```

Builds every package into `build/`. The parts build side by side, and a part whose files haven't changed since the last build is kept, so a rebuild with no changes takes a couple of seconds and a clean build about 35. `npm run build:clean` rebuilds everything.

| | |
|---|---|
| `build/node/` | Node.js 22.16.0, without its debug symbols |
| `build/sim/` | The compiled API, its production dependencies, the Prisma migrations and `template.db`, a database with the starter data |
| `build/web/` | The dashboard's static files (a Next.js static export), served by the app |
| `build/blockly/` | The editor's static files |
| `build/card-server/` | The compiled card server and its production dependencies |

Production dependencies are installed without dev or peer dependencies, then pruned of what never runs: TypeScript and type packages, docs, source maps, tests, Prisma's WebAssembly engines and isolated-vm's prebuilt binaries for other platforms.

```bash
npm start
```

Runs the app on `build/`, the way the installed app runs.

## Make the Mac app
```bash
npm run dist
```

Builds everything, then writes `release/Investec-Sandbox-<version>-<arch>.dmg` (about 180 MB, LZFSE-compressed) and `release/mac/Investec Sandbox.app` (about 440 MB, most of it Electron and Node). Packaging takes about 20 seconds. Open the `.dmg` and drag the app to Applications. `npm run pack` builds just the `.app`, and `npm run release` also makes the `.zip` and block map that auto-update uses. Electron's language packs are left out except English. The packaging settings are in [electron-builder.config.cjs](electron-builder.config.cjs).

It's built for the Mac's own processor: Node.js and the native modules are installed for it, so build on Apple silicon for an arm64 app.

**Signing, notarisation and updates** turn on when their credentials are in the environment; without them the build is unsigned (a copy you build yourself opens normally; on another Mac, right-click it and choose **Open** the first time).
- Signing: `CSC_LINK` and `CSC_KEY_PASSWORD` (or `CSC_NAME`) for a Developer ID Application certificate. The hardened runtime's exceptions are in `assets/entitlements.mac.plist`.
- Notarisation: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (or an App Store Connect API key).
- Updates: set `SANDBOX_GITHUB_REPO=owner/repo` and run `npm run release` to publish to that repository's GitHub Releases. Signed copies built that way check for updates on launch and from **Investec Sandbox → Check for Updates…**.

### Releases on GitHub
Publishing a release on GitHub runs [.github/workflows/release.yml](.github/workflows/release.yml). It builds the app on an Apple silicon and an Intel runner and attaches both `.dmg` files (plus the `.zip` files, block maps and a combined `latest-mac.yml` for auto-update) to the release. The release's tag sets the version: `v1.2.0` makes 1.2.0. To build without a release, run the workflow from the Actions tab; the files are kept as workflow artifacts for 14 days.

Builds are signed and notarised when the repository has the secrets `CSC_LINK` (the certificate as base64), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Without them they're unsigned and don't update themselves.

### The app's data
The installed app (and `npm start`) keeps the sandbox's data in `~/Library/Application Support/Investec Sandbox/sandbox.db`, created from the starter data on first launch. When a new version adds Prisma migrations, the app applies them on launch, after copying the database to `sandbox.db.backup`. **Services → Show Sandbox Data in Finder** opens the folder. To move data between the app and another copy of the sandbox, use **Export** and **Import** on the dashboard.

Card code projects live in the `card-code/` folder beside it: one folder per project with `main.js`, `env.json`, `card-code.json` and, for blocks projects, `workspace.json`. Deleted projects move to `card-code/.trash/`. **Services → Show Card Code Library in Finder** opens it.

The same folder holds `preferences.json` (Settings) and `window-state.json` (window size, sidebar width, last section and scroll positions).

## Using the app
- **Launch:** a splash with the zebra shows each service starting, for at least 5 seconds, and the window appears once the section it opens on is ready, including the API for the dashboard's pages (or can say what went wrong).
- **Overview:** the page the app opens on. The API's address and credentials (with Copy buttons), how many profiles, accounts, cards and transactions the sandbox holds, each service's status and address, the sandbox date and fault injection, and shortcuts to common first steps.
- **Sidebar**, in groups you can fold away (click a group's name):
  - **Banking:** Accounts (top-ups, transfers), Transactions, Cards (swipes, pending holds), Beneficiaries (payments)
  - **Simulate:** Clock & schedules, Faults
  - **Develop:** Quick start, Card blocks (the Blockly editor), Card code (a Monaco editor for `main.js` and `env.json`), API reference, Requests, OAuth tester
  - **Sandbox:** Data & scenarios (load a scenario, reset, clear, export, import), Settings, Logs
  - **Resources:** links that open in your browser (folded by default)

  ⌘1–⌘9 go to the first nine; the **Go** menu lists them all. Arrow keys move through the sidebar, Left and Right fold groups, and typing jumps to a section. Drag its edge to resize it (double-click to reset); ⌃⌘S hides it.
- **Toolbar:** the section's name and what it's for, its actions (e.g. **Swipe** and **Add Card** on Cards, **Transfer** on Accounts), the services indicator and the command palette.
- **Sheets:** a toolbar action opens its form as a sheet, which closes once the action succeeds. Clearing data, importing and deleting confirm in a native sheet; exports save through a native Save panel.
- **Command palette (⌘K):** go to any section, run any page action, load a scenario, reset, import or export the sandbox, restart services.
- **Services indicator:** "All services running", or what's wrong (and whether faults are on or the clock is moved). Click it for each service's restart, address, source folder and logs. The **Services** menu has the same, plus Restart All (⇧⌘R). While a service starts, its sections show progress and its latest log lines; if one fails or stops, they say why and offer a restart, and you get a notification.
- **File menu:** Import Sandbox… (⌘O), Export Sandbox… (⇧⌘E), Load Scenario, Reset and Clear Sandbox Data.
- **Card Code menu:** acts on the editor in front (or the last one used): Run (⌘↵), Save As… (⇧⌘S), Import…, Export…, Blocks (⌘B, blocks only) and Panel (⌘J). In Card code, Export saves the open file and Import takes a `.js` (main.js) or `.json` (env.json) file.
- **Card code library:** Save As… in either editor saves a project to the library, and the Open menu lists the projects (Card code can also copy a blocks project's generated code). A project open in an editor saves as you edit, and changes made to it elsewhere, by an AI assistant or in the files, appear in the editor.
- **AI assistants (MCP):** **Services → Connect an AI Assistant…** gives the Claude Code command, a configuration for Claude Desktop and other apps, and the server's address (`http://127.0.0.1:3020/mcp`). Assistants get tools to list, read, create (from scratch, an example or another project), update, edit, rename, delete, run and open card code, as blocks or JavaScript, plus the block reference and snippet tools. `open_card_code` switches the app to the project; if the editor has unsaved blocks or code, it asks before replacing them. The server only answers on this Mac, and only the app's editors can call it from a web page.
- **API reference:** every endpoint by tag, with its parameters, a request body filled in from the schema, Send (⌘↵), the response, and Copy as curl. Its requests skip the sandbox's random faults unless you tick **Apply sandbox faults**. **Help → Swagger UI** opens Swagger in its own window (dark when the Mac is).
- **Faults** (Simulate) are for testing outside clients, such as your own app or Postman: they get the random errors, timeouts and latency, while the app's own screens are exempt and keep working. The toolbar, menu bar icon and Dock badge show while faults are on.
- **Quick start:** the first three calls (a token, the accounts, an account's transactions) in curl, Node.js, Python and C#, with the sandbox's address and credentials filled in. Secrets show as dots; **Copy** puts the real values in (and, for curl, a fresh token). **Run Here** makes the call from the app, and each step is ticked once that call arrives from your own code.
- **Requests:** every call the API received, newest first, with both sets of headers, both bodies, the status and the time taken. **Send Again** replays one and **Copy as curl** reproduces it in a terminal. The app's own requests are hidden unless you ask for them. The API's address is served by a pass-through recorder in the app ([recorder.js](recorder.js)) that hands each request to the API unchanged on a private port, so the API itself is not modified. The last 300 requests are kept, in memory only.
- **Logs:** every service's output, including each API request with its status coloured; filter by service or text, Pause, Clear, Copy and Export….
- **Settings (⌘,):** open at login, the menu bar icon, the port of each service (type the ports, then **Restart Services**; **Use Defaults** puts the usual ones back), and the data folder.
- **Menu bar icon:** service status and quick actions, also while the window is closed. The Dock icon shows a badge while faults are on or the sandbox clock is moved.
- **Welcome sheet** on first launch: the API address and credentials with Copy buttons, the Postman collection, and a first card swipe. **Help → Welcome to Investec Sandbox** shows it again.
- Foreign card swipes are charged at the European Central Bank's reference rates, fetched from [Frankfurter](https://frankfurter.dev) when the app starts and every six hours (offline, the last ones fetched are used). Only the currencies Frankfurter publishes can be swiped in.
- The pages use the Mac's accent colour and text sizes, follow light and dark mode, and remember the Transactions page's account and filters and each section's scroll position.
- On macOS, closing the window keeps the app and its services running; ⌘Q quits and stops them all.

Each service uses its preferred port, or the next free one if another program has it (the log says so). The dashboard and editor learn the addresses at runtime from `/sandbox-config.js`, which the app serves; Postman and your own apps should use the API address shown in the welcome sheet or **Services → Copy API URL**.

## Files
| | |
|---|---|
| `main.js` | Window, section views, service state, menus, sandbox commands |
| `services.js` | How and where each service runs, ports, the database, the static file server |
| `prefs.js` | The app's Settings |
| `windows.js`, `ui/`, `aux-preload.js` | The launch splash, Settings, the welcome sheet, the command palette and Swagger UI |
| `tray.js` | The menu bar icon |
| `recorder.js` | The pass-through proxy in front of the API that records requests for the Requests section |
| `guide.js` | Quick start's steps and code samples |
| `shell-dev.js` | The Requests and Quick start pages |
| `config.js` | The pinned Node.js version and the default ports |
| `shell.html`, `shell.css`, `shell.js`, `shell-preload.js` | The sidebar, toolbar, status screens, Overview and Logs |
| `shell-api.js` | The API reference (explorer) |
| `page-preload.js` | `window.sandboxApp` for the pages: native sheets, Save panels, notifications, toolbar actions |
| `electron-builder.config.cjs`, `assets/entitlements.mac.plist` | Packaging, signing and updates |
| `docs/ux-plan.md` | The UX plan these features came from |
| `scripts/setup.mjs`, `scripts/build.mjs` | `npm install`'s setup and `npm run build` |
| `packages/` | The sandbox, the card code editor and the card server |
| `assets/` | App icon |

For screenshots while developing, `SANDBOX_SNAPSHOT=<folder>` saves the shell and the active page as PNGs every few seconds, and `SANDBOX_SPLASH_MS=<ms>` changes how long the launch splash stays up at least (`0` to skip it).

Run with `npm run dev` or `npm start`, macOS shows the app as "Electron" in the menu bar and Dock; the built app shows "Investec Sandbox".
