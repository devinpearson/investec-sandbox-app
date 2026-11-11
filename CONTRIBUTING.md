# Contributing

This is the guide to working on Investec Sandbox itself. To download and use the app, see the [README](README.md). To package it or cut a release, see [RELEASING.md](RELEASING.md).

## How it fits together
The app is an Electron shell around five services, each a separate Node.js process:

| Service | Usual port | Source |
|---|---|---|
| API (Express + Prisma, SQLite) | 3000 | `packages/sim/` |
| Dashboard, OAuth tester and quick start (Next.js, served as static files) | 3001 | `packages/sim/web/` |
| Card code editors (Blockly, and Monaco at `/code.html`; Vite) | 3002 | `packages/blockly/` |
| Card server, which runs the editor's code (`isolated-vm`) | 3010 | `packages/card-server/` |
| MCP server: AI assistants create, edit, run and open card code; the editors' card code library | 3020 | `packages/blockly/mcp/` |

All the code lives in this repository. [packages/README.md](packages/README.md) says where each package came from. The built app is self-contained: it ships its own Node.js and every service, and doesn't need any other checkout, a system Node, or anything else running.

Each service uses its preferred port, or the next free one if another program has it (the log says so). The dashboard and editor learn the addresses at runtime from `/sandbox-config.js`, which the app serves.

The API's address is served by a pass-through recorder ([recorder.js](recorder.js)). It hands each request to the API unchanged on a private port and keeps the last 300 in memory for the Requests section, so the API itself isn't modified. Emulated responses should stay faithful to Investec's: developer help goes around the API (the app, the docs, the tools), not into it.

## Setup
You need:
- Node.js 20 or newer, to run npm and the build scripts.
- A C++ toolchain to compile `isolated-vm` where it has no prebuilt binary. On a Mac, that's Xcode's command line tools (`xcode-select --install`). On Windows, it's Visual Studio Build Tools with the C++ workload.

```bash
npm install
```

Besides Electron, this sets up the packages:
- It downloads Node.js 22.16.0 into `vendor/node`, checksum-verified. That's the version the services run on, pinned in [config.js](config.js).
- It installs each package's dependencies with that Node.
- It creates the development database.

Run it again after pulling changes to a package's lockfile.

## Develop
```bash
npm run dev
```

This runs the app straight from `packages/` with live reload:
- the API under `tsx watch`
- the dashboard under `next dev`
- the editor under Vite
- the card server under `tsc --watch` + `node --watch`

Edit a package and the change shows up in the app. The development data is in `packages/sim/prisma/dev.db`.

`npm run dev` is POSIX-only. On Windows, set `SANDBOX_MODE=dev` yourself and run `npx electron .`.

Each package still has its own scripts, e.g. `npm --prefix packages/sim test`, `npm --prefix packages/sim/web run test:unit` or `npm --prefix packages/blockly run test:mcp`.

When run with `npm run dev` or `npm start`, macOS shows the app as "Electron" in the menu bar and Dock; the built app shows "Investec Sandbox".

### Development switches
- `SANDBOX_SNAPSHOT=<folder>` saves the shell and the active page as PNGs every few seconds, for screenshots.
- `SANDBOX_SPLASH_MS=<ms>` sets the shortest time the launch splash stays up (`0` skips it).

## Build
```bash
npm run build
```

This builds every package into `build/`. The parts build side by side. A part whose files haven't changed since the last build is kept, so a rebuild with no changes takes a couple of seconds and a clean build about 35. `npm run build:clean` rebuilds everything.

| | |
|---|---|
| `build/node/` | Node.js 22.16.0, without its debug symbols (`node.exe` on Windows) |
| `build/sim/` | The compiled API, its production dependencies, the Prisma migrations and `template.db`, a database with the starter data |
| `build/web/` | The dashboard's static files (a Next.js static export), served by the app |
| `build/blockly/` | The editors' static files |
| `build/blockly-mcp/` | The MCP server: one bundled script, plus jsdom |
| `build/card-server/` | The compiled card server and its production dependencies |

Production dependencies are installed without dev or peer dependencies. They're then pruned of what never runs: TypeScript and type packages, docs, source maps and tests. Prisma's WebAssembly engines and isolated-vm's prebuilt binaries for other platforms go too.

```bash
npm start
```

This runs the app on `build/`, the way the installed app runs.

## The app's data
The app keeps its data in its own folder:
- macOS: `~/Library/Application Support/Investec Sandbox/`
- Windows: `%APPDATA%\Investec Sandbox\`

| | |
|---|---|
| `sandbox.db` | The sandbox's data, created from `template.db` on first launch. When a new version adds Prisma migrations, the app copies it to `sandbox.db.backup`, then applies them on launch. |
| `card-code/` | The card code library: one folder per project with `main.js`, `env.json`, `card-code.json` and, for blocks projects, `workspace.json`. Deleted projects move to `card-code/.trash/`. `.open.json` is how the MCP server asks the app to show a project. |
| `preferences.json` | Settings |
| `window-state.json` | Window size, sidebar width, last section and scroll positions |

## Files
| | |
|---|---|
| `main.js` | Window, section views, service state, menus, sandbox commands, updates |
| `services.js` | How and where each service runs, ports, the database, the static file server |
| `prefs.js` | The app's Settings |
| `windows.js`, `ui/`, `aux-preload.js` | The launch splash, Settings, the welcome sheet, the command palette and Swagger UI |
| `tray.js` | The menu bar icon |
| `recorder.js` | The pass-through proxy in front of the API that records requests for the Requests section |
| `guide.js` | Quick start's steps and code samples |
| `shell-dev.js` | The Requests and Quick start pages |
| `config.js` | The pinned Node.js version and the default ports |
| `shell.html`, `shell.css`, `shell.js`, `shell-preload.js` | The sidebar, toolbar, status screens, Overview and Logs |
| `shell-api.js` | The API reference |
| `page-preload.js` | `window.sandboxApp` for the pages: native sheets, Save panels, notifications, toolbar actions |
| `electron-builder.config.cjs`, `assets/entitlements.mac.plist` | Packaging, signing and updates (see [RELEASING.md](RELEASING.md)) |
| `scripts/setup.mjs`, `scripts/build.mjs`, `scripts/lib.mjs` | `npm install`'s setup and `npm run build` |
| `scripts/merge-update-info.mjs` | Merges the Mac builds' update info on release |
| `.github/workflows/release.yml` | Builds and attaches the apps when a GitHub release is published |
| `docs/ux-plan.md` | The UX plan the app's features came from |
| `packages/` | The sandbox, the card code editors and MCP server, and the card server |
| `assets/` | App and menu bar icons |
