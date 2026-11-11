# Packages

The three projects the app is built from, brought in from their own repositories:

| Folder | From | Commit |
|---|---|---|
| `sim/` | [programmable-banking-sim](https://github.com/devinpearson/programmable-banking-sim) — the API (`src/`) and the dashboard (`web/`) | `4138006` |
| `blockly/` | [investec-blockly](https://github.com/devinpearson/investec-blockly) — the card code editor | `6df84aa` |
| `card-server/` | [investec-card-server](https://github.com/devinpearson/investec-card-server) — runs the editor's card code | `4ae96f9` |

Each keeps its own `package.json`, lockfile and scripts, so you can still work in one on its own (`npm --prefix packages/sim run test`, and so on). From the app's root, `npm install` installs all of them, `npm run dev` runs them with live reload, and `npm run build` builds them into `build/`.
