// The app's own preferences (Investec Sandbox → Preferences…), kept in
// preferences.json in the app's data folder. The sandbox's settings (auth,
// credentials) live in the sandbox itself, on its Settings page.

const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { PORTS } = require('./config.js')

const DEFAULTS = {
  // Ports each service tries first; the next free one is used if taken.
  ports: { ...PORTS },
  // Show the menu bar icon (and keep running there when the window closes).
  menuBar: true,
  // The welcome sheet has been shown.
  welcomed: false,
  // Quick start steps seen arriving from the developer's own code:
  // { [step]: { time, client } }.
  guide: {},
}

const file = () => path.join(app.getPath('userData'), 'preferences.json')
let prefs = null

function load() {
  if (prefs) return prefs
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(file(), 'utf8'))
  } catch {}
  prefs = { ...DEFAULTS, ...stored, ports: { ...DEFAULTS.ports, ...stored.ports } }
  return prefs
}

function save(patch) {
  prefs = { ...load(), ...patch }
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify(prefs, null, 2))
  } catch {}
  return prefs
}

module.exports = { getPrefs: load, setPrefs: save, DEFAULT_PORTS: PORTS }
