// The menu bar icon: service health and quick actions, and a sign the app
// (and its servers) are still running when the window is closed.

const { Menu, Tray, nativeImage } = require('electron')
const path = require('node:path')

let tray = null
let last = ''

function icon() {
  // A template image: macOS tints it for light and dark menu bars.
  const image = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'))
  image.setTemplateImage(true)
  return image
}

const DOT = { ready: '●', starting: '◐', building: '◐', idle: '○', failed: '✕', stopped: '✕' }

function update(state) {
  if (!tray || !state) return
  // Rebuild only when what's shown changes.
  const key = JSON.stringify([state.summary, state.notes, state.services])
  if (key === last) return
  last = key
  tray.setToolTip(`Investec Sandbox — ${state.summary.text}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: state.summary.text, enabled: false },
      ...state.notes.map(label => ({ label, enabled: false })),
      { type: 'separator' },
      ...state.services.map(s => ({
        label: `${DOT[s.status] ?? '○'}  ${s.label}`,
        sublabel: s.status === 'ready' ? s.url : s.status,
        enabled: false,
      })),
      { type: 'separator' },
      { label: 'Open Investec Sandbox', click: state.open },
      { label: 'Copy API URL', click: state.copyApiUrl },
      { label: 'Restart All Services', click: state.restartAll },
      { label: 'Settings…', click: state.preferences },
      { type: 'separator' },
      { label: 'Quit Investec Sandbox', click: state.quit },
    ]),
  )
}

function setEnabled(on, state) {
  if (on && !tray) {
    tray = new Tray(icon())
    last = ''
    update(state)
  } else if (!on && tray) {
    tray.destroy()
    tray = null
  }
}

module.exports = { setEnabled, update }
