// The app's other windows: Preferences (⌘,), the welcome sheet, the command
// palette (⌘K) and Swagger UI. Each page lives in ui/ and talks to this file
// through aux-preload.js; main.js passes in what each one shows and does.

const { BrowserWindow, clipboard, ipcMain, nativeTheme, screen } = require('electron')
const path = require('node:path')

const isMac = process.platform === 'darwin'
const preload = path.join(__dirname, 'aux-preload.js')
const ui = name => path.join(__dirname, 'ui', `${name}.html`)
const background = () => (nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ececec')

// The system accent colour, set by main.js; each window's pages use it.
let accent = '#007aff'
function setAccent(hex) {
  accent = hex
  for (const w of [splashWindow, prefsWindow, welcomeWindow, paletteWindow]) if (w && !w.isDestroyed()) styleAccent(w)
}
function styleAccent(w) {
  w.webContents.executeJavaScript(`document.documentElement.style.setProperty('--accent', ${JSON.stringify(accent)})`).catch(() => {})
}
function track(w) {
  w.webContents.on('dom-ready', () => styleAccent(w))
  return w
}

// ---------------------------------------------------------------------------
// Launch splash: the zebra while the services start. Frameless and centred;
// it fades out once the main window is ready to show.

let splashWindow = null
let splashState = null

function openSplash(state) {
  splashState = state
  splashWindow = new BrowserWindow({
    width: 440,
    height: 360,
    center: true,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload },
  })
  track(splashWindow)
  splashWindow.loadFile(ui('splash'))
  splashWindow.once('ready-to-show', () => {
    splashWindow?.show()
    if (splashState) splashWindow.webContents.send('splash:status', splashState)
  })
  splashWindow.on('closed', () => (splashWindow = null))
}

// { text, progress (0–1), bad?, version? }
function updateSplash(state) {
  splashState = { ...splashState, ...state }
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.webContents.send('splash:status', splashState)
}

function closeSplash() {
  const w = splashWindow
  if (!w || w.isDestroyed()) return
  splashWindow = null
  w.webContents.send('splash:close')
  setTimeout(() => !w.isDestroyed() && w.close(), 260)
}

// ---------------------------------------------------------------------------
// Preferences

let prefsWindow = null
let prefs = null

function openPreferences(handlers) {
  prefs = handlers
  if (prefsWindow) return prefsWindow.focus()
  prefsWindow = new BrowserWindow({
    width: 560,
    height: 560,
    title: 'Settings',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: background(),
    webPreferences: { preload },
  })
  track(prefsWindow)
  prefsWindow.loadFile(ui('preferences'))
  prefsWindow.once('ready-to-show', () => prefsWindow.show())
  prefsWindow.on('closed', () => (prefsWindow = null))
}

ipcMain.handle('prefs:get', () => prefs?.get())
ipcMain.handle('prefs:set', (_e, patch) => prefs?.set(patch || {}))
ipcMain.on('prefs:show-data', () => prefs?.showData())
ipcMain.on('prefs:welcome', () => prefs?.showWelcome())
ipcMain.handle('prefs:restart', () => prefs?.restartServices())

// ---------------------------------------------------------------------------
// Welcome sheet (attached to the main window on macOS)

let welcomeWindow = null
let welcome = null

function openWelcome(parent, data) {
  welcome = data
  if (welcomeWindow) return welcomeWindow.focus()
  welcomeWindow = new BrowserWindow({
    parent: parent || undefined,
    modal: Boolean(parent),
    width: 580,
    height: 600,
    resizable: false,
    show: false,
    backgroundColor: background(),
    webPreferences: { preload },
  })
  track(welcomeWindow)
  welcomeWindow.loadFile(ui('welcome'))
  welcomeWindow.once('ready-to-show', () => welcomeWindow.show())
  welcomeWindow.on('closed', () => (welcomeWindow = null))
}

const closeWelcome = () => welcomeWindow?.close()
ipcMain.handle('welcome:data', () => {
  if (!welcome) return {}
  const { openPostman, trySwipe, ...data } = welcome
  return data
})
ipcMain.on('welcome:copy', (_e, text) => clipboard.writeText(String(text)))
ipcMain.on('welcome:postman', () => welcome?.openPostman())
ipcMain.on('welcome:swipe', () => {
  closeWelcome()
  welcome?.trySwipe()
})
ipcMain.on('welcome:close', closeWelcome)

// ---------------------------------------------------------------------------
// Command palette: a floating panel near the top of the main window.

let paletteWindow = null
let palette = { items: [], run: () => {} }

function openPalette(parent, items, run) {
  palette = { items, run }
  if (paletteWindow) {
    paletteWindow.webContents.send('palette:refresh')
    return paletteWindow.focus()
  }
  const width = 620
  const height = 420
  const area = parent && !parent.isDestroyed() ? parent.getBounds() : screen.getPrimaryDisplay().workArea
  paletteWindow = new BrowserWindow({
    parent: parent || undefined,
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + Math.min(120, area.height / 6)),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    transparent: true,
    hasShadow: true,
    ...(isMac ? { vibrancy: 'popover', visualEffectState: 'active' } : { backgroundColor: background() }),
    webPreferences: { preload },
  })
  track(paletteWindow)
  paletteWindow.loadFile(ui('palette'))
  paletteWindow.once('ready-to-show', () => paletteWindow.show())
  // Like Spotlight: clicking elsewhere dismisses it.
  paletteWindow.on('blur', () => paletteWindow?.close())
  paletteWindow.on('closed', () => (paletteWindow = null))
}

ipcMain.handle('palette:items', () => palette.items)
ipcMain.on('palette:run', (_e, id) => {
  paletteWindow?.close()
  palette.run(String(id))
})
ipcMain.on('palette:close', () => paletteWindow?.close())

// ---------------------------------------------------------------------------
// Swagger UI, in a window of its own (the sidebar's API reference is native).

let swaggerWindow = null
const SWAGGER_CSS = '.swagger-ui .topbar { display: none !important; }'
// Swagger UI has no dark theme: invert it, then put images back.
const SWAGGER_DARK = `
  html { background: #1b1b1b; }
  .swagger-ui { filter: invert(0.88) hue-rotate(180deg); }
  .swagger-ui img, .swagger-ui .microlight { filter: invert(1) hue-rotate(180deg); }`

function openSwagger({ url }) {
  if (swaggerWindow) return swaggerWindow.focus()
  swaggerWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    title: 'Swagger UI',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1b' : '#ffffff',
  })
  const wc = swaggerWindow.webContents
  let darkKey = null
  const style = async () => {
    try {
      await wc.insertCSS(SWAGGER_CSS)
      if (darkKey) await wc.removeInsertedCSS(darkKey)
      darkKey = nativeTheme.shouldUseDarkColors ? await wc.insertCSS(SWAGGER_DARK) : null
    } catch {}
  }
  wc.on('dom-ready', style)
  const onTheme = () => void style()
  nativeTheme.on('updated', onTheme)
  swaggerWindow.on('closed', () => {
    nativeTheme.off('updated', onTheme)
    swaggerWindow = null
  })
  swaggerWindow.loadURL(url)
}

module.exports = { openSplash, updateSplash, closeSplash, openPreferences, openWelcome, openPalette, openSwagger, setAccent }
