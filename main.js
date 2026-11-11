// Investec Sandbox: a desktop app for the Investec programmable banking
// sandbox (packages/sim), its card code editor (packages/blockly) and the
// card server that runs the editor's code (packages/card-server).
//
// One window: a native sidebar and toolbar (shell.html) around a content
// area. The dashboard's pages share one WebContentsView; the card editor
// has its own. Logs and the API explorer are drawn by the shell itself.
// Section pages get `window.sandboxApp` (page-preload.js) for native sheets,
// Save panels, notifications and the toolbar's page actions.
//
// The four services (API, dashboard, card editor, card server) start in
// parallel; services.js has how and where they run. windows.js has the
// Preferences, welcome, command palette and Swagger windows; tray.js the
// menu bar icon and Dock badge.

const {
  app,
  BaseWindow,
  WebContentsView,
  Menu,
  Notification,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  session,
  shell,
  systemPreferences,
} = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.setName('Investec Sandbox')

const {
  MODE,
  URLS,
  SOURCES,
  STARTERS,
  children,
  stopChild,
  signal,
  sleep,
  dataLocation,
  setLogger,
  resolvePorts,
  ports,
  libraryDir,
  NODE,
  BUILD,
} = require('./services.js')
const { getPrefs, setPrefs, DEFAULT_PORTS } = require('./prefs.js')
const windows = require('./windows.js')
const recorder = require('./recorder.js')
const guide = require('./guide.js')
const tray = require('./tray.js')

const isMac = process.platform === 'darwin'
const TOOLBAR_HEIGHT = 52
const SIDEBAR_MIN = 190
const SIDEBAR_MAX = 360

// ---------------------------------------------------------------------------
// Sections and links

const BASE_CSS = 'html { overscroll-behavior: none; }'

// The sidebar, in order (built once the ports are known). Sections with the
// same `view` share one page view, so switching between them loads the
// section's page in it. `actions` are the toolbar's buttons for the page:
// each opens the page's form of that id as a sheet (see Disclosure.tsx).
let SECTIONS = []
function makeSections() {
  const web = (id, label, icon, group, path, description, actions = []) => ({
    id,
    label,
    icon,
    group,
    description,
    actions,
    service: 'web',
    // The pages fetch everything from the API, so they wait for it as well.
    requires: 'api',
    view: 'web',
    url: `${URLS.web}${path}`,
  })
  return [
    // Drawn by the shell, and what the app opens on. It needs no service to
    // show, but the window waits for the API so it appears with its details.
    { id: 'overview', label: 'Overview', icon: 'home', group: '', native: true, revealAfter: 'api', description: 'The sandbox at a glance', actions: [] },
    web('accounts', 'Accounts', 'wallet', 'Banking', '/accounts', 'Balances, top-ups and transfers', [{ id: 'transfer', label: 'Transfer', icon: 'transactions' }]),
    web('transactions', 'Transactions', 'transactions', 'Banking', '/transactions', 'Each account’s history, newest first'),
    web('cards', 'Cards', 'card', 'Banking', '/cards', 'Swipe cards, settle holds, stop and reactivate cards', [
      { id: 'swipe-card', label: 'Swipe', icon: 'card' },
      { id: 'add-card', label: 'Add Card', icon: 'plus' },
    ]),
    web('beneficiaries', 'Beneficiaries', 'users', 'Banking', '/beneficiaries', 'Pay the profile’s beneficiaries', [{ id: 'pay-beneficiary', label: 'Pay', icon: 'send' }]),
    web('clock', 'Clock & schedules', 'clock', 'Simulate', '/simulate/clock', 'Move the sandbox date and run recurring transactions', [
      { id: 'add-schedule', label: 'Add Recurring', icon: 'plus' },
    ]),
    web('faults', 'Faults', 'zap', 'Simulate', '/simulate/faults', 'Make the API fail on purpose, to test error handling'),
    { id: 'guide', label: 'Quick start', icon: 'book', group: 'Develop', native: true, description: 'Your first calls, in your language', actions: [] },
    // ?app puts the editor in app mode: toolbar, full-window layout, no web chrome.
    { id: 'editor', label: 'Card blocks', icon: 'blocks', group: 'Develop', service: 'editor', url: `${URLS.editor}/?app`, description: 'Build card code from blocks and run it on test purchases', actions: [] },
    // The same service's Monaco editor: main.js and env.json, run on the card server.
    { id: 'code', label: 'Card code', icon: 'code', group: 'Develop', service: 'editor', url: `${URLS.editor}/code.html?app`, description: 'Write card code in JavaScript, with its env.json, and run it on test purchases', actions: [] },
    { id: 'api', label: 'API reference', icon: 'braces', group: 'Develop', service: 'api', native: true, description: 'Every endpoint, and a way to call it', actions: [] },
    // Every call the API received, as it went over the wire (recorder.js).
    { id: 'requests', label: 'Requests', icon: 'activity', group: 'Develop', native: true, description: 'Each call to the API: what was sent and what came back', actions: [] },
    web('oauth', 'OAuth tester', 'key', 'Develop', '/oauth', 'Try the three-legged sign-in flow'),
    web('data', 'Data & scenarios', 'database', 'Sandbox', '/sandbox', 'Load a scenario, or reset, clear, export or import the data'),
    web('settings', 'Settings', 'settings', 'Sandbox', '/settings', 'Authentication and credentials'),
    // The API's requests are in here too (the dashboard's request log is web-only).
    { id: 'logs', label: 'Logs', icon: 'terminal', group: 'Sandbox', native: true, description: 'Output from every service', actions: [] },
  ]
}
const viewKey = s => s.view || s.id
const pathOf = url => new URL(url).pathname.replace(/\/$/, '') || '/'
const POSTMAN_URL = 'https://www.postman.com/investec-open-api/workspace/hack-days/collection/26868804-62ce3cf6-3d98-4f62-ad82-b912b9826d51'

// Opened in the default browser. The shell asks for these by key only.
const RESOURCES = [
  { key: 'docs', label: 'Investec API docs', url: 'https://developer.investec.com/za/api-products' },
  { key: 'wiki', label: 'Community wiki', url: 'https://investec.gitbook.io/programmable-banking-community-wiki' },
  { key: 'postman', label: 'Postman collection', url: POSTMAN_URL },
  { key: 'github', label: 'Sandbox on GitHub', url: 'https://github.com/devinpearson/programmable-banking-sim' },
]

// ---------------------------------------------------------------------------
// Logging

const logLines = []
let logSeq = 0
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

function log(source, text) {
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(ANSI, '')
    if (!line.trim() || line.includes(QUIET_AGENT)) continue
    const entry = { id: ++logSeq, source, text: line, time: Date.now() }
    logLines.push(entry)
    if (logLines.length > 3000) logLines.shift()
    process.stdout.write(`[${source}] ${line}\n`)
    sendToShell('log', entry)
  }
}

// ---------------------------------------------------------------------------
// Services

let quitting = false
setLogger(log)

const services = {
  api: { label: 'API', logs: ['api'] },
  web: { label: 'Dashboard', logs: ['web'] },
  editor: { label: 'Card editor', logs: ['editor'] },
  card: { label: 'Card server', logs: ['card', 'card-build'] },
  mcp: { label: 'MCP server', logs: ['mcp', 'mcp-build'] },
}
for (const [id, svc] of Object.entries(services)) {
  Object.assign(svc, { dir: SOURCES[id] || null, status: 'idle', detail: '' })
}

// A service's name mid-sentence: lower case, but acronyms (API) stay as they are.
const inSentence = label => label.split(' ').map(w => (w === w.toUpperCase() ? w : w.toLowerCase())).join(' ')
const busy = s => s === 'starting' || s === 'building'

function setService(id, patch) {
  const svc = services[id]
  const was = svc.status
  Object.assign(svc, patch)
  pushState()
  if ((svc.status === 'ready') !== (was === 'ready')) {
    refreshSections(id)
    if (id === 'api' && svc.status === 'ready') onApiReady()
    if (id === 'mcp' && svc.status === 'ready') watchLibraryOpens()
  }
}

async function startService(id) {
  const svc = services[id]
  svc.url = URLS[id]
  setService(id, { status: 'starting', detail: 'Starting…', child: null, extra: [], server: null })
  try {
    const result = await STARTERS[id]((detail, phase = 'starting') => setService(id, { status: phase, detail }))
    if (result.child) watchChild(id, result.child)
    setService(id, { ...result, status: 'ready', detail: `Running on ${svc.url}` })
    log('app', `${svc.label}: ${svc.detail}`)
  } catch (error) {
    setService(id, { status: 'failed', detail: error.message })
    log('app', `${svc.label} failed: ${error.message}`)
  }
}

function watchChild(id, child) {
  child.once('exit', code => {
    const svc = services[id]
    if (quitting || svc.child !== child) return
    setService(id, { status: 'stopped', detail: `Stopped unexpectedly (exit code ${code}).`, child: null })
    log('app', `${svc.label} stopped unexpectedly (exit code ${code})`)
    notify(`${svc.label} stopped`, 'Open Investec Sandbox to restart it.')
  })
}

async function stopService(id) {
  const svc = services[id]
  const { child, extra = [], server } = svc
  Object.assign(svc, { child: null, extra: [], server: null })
  await Promise.all([child, ...extra].map(stopChild))
  if (server) {
    server.closeAllConnections()
    await new Promise(r => server.close(() => r()))
  }
}

async function restartService(id) {
  const svc = services[id]
  if (!svc || busy(svc.status)) return
  log('app', `Restarting ${svc.label}…`)
  await stopService(id)
  await startService(id)
  const keys = new Set(SECTIONS.filter(s => usesService(s, id) && !s.native).map(viewKey))
  for (const key of keys) views.get(key)?.webContents.reload()
}

const restartAll = () => Object.keys(services).forEach(restartService)

// ---------------------------------------------------------------------------
// Card code library: an AI assistant's open_card_code shows the project in
// its editor. The MCP server reports those requests on /api/events.

let libraryEvents = null
function watchLibraryOpens() {
  libraryEvents?.destroy()
  const req = require('node:http').get(`${URLS.mcp}/api/events`, res => {
    let buffer = ''
    res.setEncoding('utf8')
    res.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const message = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const event = /^event: (.+)$/m.exec(message)?.[1]
        const data = /^data: (.+)$/m.exec(message)?.[1]
        if (event === 'open' && data) {
          try {
            const { id, kind, at } = JSON.parse(data)
            // Only fresh requests: not one replayed after a restart.
            if (id && Date.now() - at < 30_000) {
              log('app', `Opening card code project "${id}" (requested through the MCP server)`)
              void runPageAction(kind === 'blocks' ? 'editor' : 'code', `open-project:${id}`)
            }
          } catch {}
        }
      }
    })
    res.on('end', () => retryLibraryEvents(req))
  })
  req.on('error', () => retryLibraryEvents(req))
  libraryEvents = req
}
function retryLibraryEvents(req) {
  if (libraryEvents !== req || quitting) return
  libraryEvents = null
  setTimeout(() => {
    if (!libraryEvents && services.mcp.status === 'ready') watchLibraryOpens()
  }, 2000)
}

// How to connect Claude (or another MCP client) to the card code tools.
async function connectAssistant() {
  const url = `${URLS.mcp}/mcp`
  const script = path.join(BUILD, 'blockly-mcp', 'investec-blockly-mcp.cjs')
  const desktopConfig = JSON.stringify(
    { mcpServers: { 'investec-card-code': { command: NODE, args: [script, '--library', libraryDir()], env: { SIMULATOR_URL: URLS.card } } } },
    null,
    2,
  )
  const claudeCode = `claude mcp add --transport http investec-card-code ${url}`
  const { response } = await dialog.showMessageBox(pageWindow(), {
    type: 'info',
    message: 'Connect an AI assistant',
    detail:
      `Assistants can create, edit, run and open card code — blocks or JavaScript — through the app's MCP server while it's running:\n\n${url}\n\n` +
      `Claude Code: ${claudeCode}\n\n` +
      `Claude Desktop and other apps that start their own server: copy the configuration, add it to the app's MCP settings, and restart that app.\n\n` +
      `Projects are saved in ${libraryDir()}.`,
    buttons: ['Copy Claude Code Command', 'Copy Desktop Configuration', 'Copy URL', 'Close'],
    defaultId: 0,
    cancelId: 3,
  })
  const copy = [claudeCode, desktopConfig, url][response]
  if (copy) clipboard.writeText(copy)
}

// One line for the toolbar, the menu bar icon and the status menu.
function statusSummary() {
  const list = Object.values(services)
  const down = list.filter(s => s.status === 'failed' || s.status === 'stopped')
  if (down.length) return { level: 'bad', text: down.length === 1 ? `${down[0].label} ${down[0].status === 'failed' ? 'failed' : 'stopped'}` : `${down.length} services down` }
  if (list.some(s => busy(s.status) || s.status === 'idle')) return { level: 'busy', text: 'Starting…' }
  return { level: 'ok', text: 'All services running' }
}

function notify(title, body) {
  if (!Notification.isSupported()) return
  const note = new Notification({ title, body, silent: true })
  note.on('click', () => showWindow())
  note.show()
}

// ---------------------------------------------------------------------------
// The sandbox API, for the native menus, the welcome sheet and the badge

// The app's own background checks say so, and Logs leaves them out.
const QUIET_AGENT = 'InvestecSandbox-StatusCheck'
// The app's other requests (menus, the Overview); Requests files them as its own.
const APP_AGENT = 'InvestecSandbox-App'

async function api(pathname, options = {}) {
  const res = await fetch(`${URLS.api}${pathname}`, {
    ...options,
    // The app's own requests are exempt from random fault injection.
    headers: { 'Content-Type': 'application/json', 'X-Sandbox-Client': 'desktop-app', 'User-Agent': APP_AGENT, ...options.headers },
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {}
  if (!res.ok) throw new Error(body?.errorMessage || `The API answered ${res.status}`)
  return body?.data ?? body
}

let scenarios = []
let sandboxState = { faults: false, offsetDays: 0 }

async function onApiReady() {
  try {
    scenarios = await api('/scenarios')
    buildMenu()
  } catch {}
  if (!getPrefs().welcomed) {
    setPrefs({ welcomed: true })
    showWelcome()
  }
}

// Faults on or the clock moved: a badge on the Dock icon and a line in the
// menu bar menu, so it isn't forgotten.
async function pollSandboxState() {
  if (services.api.status !== 'ready') return
  try {
    const quiet = { headers: { 'User-Agent': QUIET_AGENT } }
    const [faults, clock] = await Promise.all([api('/faults', quiet), api('/clock', quiet)])
    const next = { faults: Boolean(faults?.active), offsetDays: clock?.offsetDays ?? 0 }
    if (next.faults !== sandboxState.faults || next.offsetDays !== sandboxState.offsetDays) {
      sandboxState = next
      updateBadge()
      // The toolbar's status pill and the menu bar icon say so too.
      pushState()
    }
  } catch {}
}

// What the Overview section shows besides the services: where the API is,
// how to sign in to it, and what's in the sandbox. Secrets stay here; the
// page copies them by name (shell:overview-copy).
let overviewCopies = {}
async function overviewData() {
  const data = {
    version: app.getVersion(),
    mode: MODE,
    apiUrl: URLS.api,
    mcpUrl: `${URLS.mcp}/mcp`,
    dataLocation: dataLocation(),
    notes: sandboxNotes(),
    api: false,
  }
  overviewCopies = { apiUrl: data.apiUrl, mcpUrl: data.mcpUrl }
  if (!serviceUp('api')) return data
  const quiet = { headers: { 'User-Agent': QUIET_AGENT } }
  const [envs, counts, clock, faults] = await Promise.all(['/envs', '/database-summary', '/clock', '/faults'].map(p => api(p, quiet).catch(() => null)))
  if (!envs && !counts) return data
  Object.assign(overviewCopies, { clientId: envs?.client_id, clientSecret: envs?.client_secret, apiKey: envs?.api_key })
  return {
    ...data,
    api: true,
    auth: Boolean(envs?.auth),
    clientId: envs?.client_id ?? '',
    hasClientSecret: Boolean(envs?.client_secret),
    hasApiKey: Boolean(envs?.api_key),
    counts: counts ?? null,
    today: clock?.today ?? null,
    offsetDays: clock?.offsetDays ?? 0,
    faults: Boolean(faults?.active),
  }
}

function updateBadge() {
  if (!isMac || !app.dock) return
  app.dock.setBadge(sandboxState.faults || sandboxState.offsetDays ? '!' : '')
}

function sandboxNotes() {
  const notes = []
  if (sandboxState.faults) notes.push('Fault injection is on')
  if (sandboxState.offsetDays) {
    const days = Math.abs(sandboxState.offsetDays)
    notes.push(`Sandbox date is ${days} day${days === 1 ? '' : 's'} ${sandboxState.offsetDays > 0 ? 'ahead' : 'behind'}`)
  }
  return notes
}

// ---------------------------------------------------------------------------
// Window state

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json')
let saved = {}
try {
  saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
} catch {}

let saveTimer = null
function saveState() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return
    const data = { bounds: win.getNormalBounds(), maximized: win.isMaximized(), active, sidebarVisible, sidebarWidth, scroll: scrollPositions }
    try {
      fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
      fs.writeFileSync(stateFile(), JSON.stringify(data))
    } catch {}
  }, 400)
}

function initialBounds() {
  const b = saved.bounds
  const visible =
    b &&
    screen.getAllDisplays().some(d => {
      const a = d.workArea
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
    })
  return visible ? b : { width: 1440, height: 920 }
}

// ---------------------------------------------------------------------------
// Window, shell and section views

let win = null
let shellView = null
const views = new Map()
const loadErrors = new Map()
// The app always opens on the overview.
let active = 'overview'
// The two card code editors (blocks, and Monaco); the menu follows the last one used.
const EDITORS = ['editor', 'code']
let lastEditor = EDITORS.includes(saved.active) ? saved.active : 'editor'
let sidebarVisible = saved.sidebarVisible !== false
let sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Number(saved.sidebarWidth) || 236))
let windowFocused = true
// Each dashboard section's scroll position, restored when it's shown again.
const scrollPositions = saved.scroll && typeof saved.scroll === 'object' ? saved.scroll : {}

const section = id => SECTIONS.find(s => s.id === id)
const activeKey = () => viewKey(section(active))
const serviceUp = id => services[id]?.status === 'ready'
// The services a section needs: its own, and the one its pages call.
const needs = s => [s?.service, s?.requires].filter(Boolean)
// The first of those that isn't up yet (null when all are).
const blocker = s => needs(s).find(id => !serviceUp(id)) ?? null
const usesService = (s, id) => needs(s).includes(id)

function sendToShell(channel, payload) {
  if (shellView && !shellView.webContents.isDestroyed()) shellView.webContents.send(channel, payload)
}

function snapshot() {
  const view = views.get(activeKey())
  const wc = view?.webContents
  return {
    platform: process.platform,
    sidebarVisible,
    sidebarWidth,
    focused: windowFocused,
    accent: accentHex(),
    active,
    summary: statusSummary(),
    notes: sandboxNotes(),
    sections: SECTIONS.map(({ id, label, icon, group, service, requires, native, description, actions }) => ({
      id,
      label,
      icon,
      group,
      service,
      requires,
      native: !!native,
      description,
      actions,
    })),
    resources: RESOURCES.map(({ key, label }) => ({ key, label })),
    services: Object.fromEntries(
      Object.entries(services).map(([id, s]) => [id, { label: s.label, url: s.url, status: s.status, detail: s.detail, logs: s.logs }]),
    ),
    page: wc
      ? {
          title: wc.getTitle(),
          url: wc.getURL(),
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          loading: wc.isLoading(),
          error: loadErrors.get(activeKey()) || null,
        }
      : null,
  }
}

let pushQueued = false
function pushState() {
  if (pushQueued) return
  pushQueued = true
  setImmediate(() => {
    pushQueued = false
    sendToShell('state', snapshot())
    updateMenuState()
    tray.update(trayState())
    updateSplash()
    maybeReveal()
  })
}

// ---- Launch splash ---------------------------------------------------------
// The zebra splash (windows.js) shows while the services start; the window
// appears once the section it opens on is ready (or can say why it isn't).

let shellLoaded = false
let revealed = false
let pendingWelcome = false

function updateSplash() {
  if (revealed) return
  const list = Object.values(services)
  const done = list.filter(s => ['ready', 'failed', 'stopped'].includes(s.status)).length
  const failed = list.find(s => s.status === 'failed')
  const working = list.find(s => busy(s.status))
  const s = section(active)
  windows.updateSplash(
    failed
      ? { text: `The ${inSentence(failed.label)} couldn’t start`, progress: done / list.length, bad: true }
      : working
        ? { text: working.detail || `Starting the ${inSentence(working.label)}…`, progress: (done + 0.4) / list.length }
        : { text: s ? `Opening ${s.label}…` : 'Opening…', progress: 1 },
  )
}

function maybeReveal() {
  if (revealed || !shellLoaded || !win) return
  const s = section(active)
  // Every service the section needs has started (or failed, so the window
  // can say why).
  if ([...needs(s), s?.revealAfter].filter(Boolean).some(id => !['ready', 'failed', 'stopped'].includes(services[id].status))) return
  // Wait for the section's page to finish its first load, so it appears whole.
  const view = s && !s.native ? views.get(viewKey(s)) : null
  if (!blocker(s) && view?.webContents.isLoading()) return
  reveal()
}

// The splash stays up for at least 5 seconds; SANDBOX_SPLASH_MS changes
// that (e.g. 0 to skip straight to the window while developing).
const SPLASH_MIN_MS = process.env.SANDBOX_SPLASH_MS !== undefined ? Number(process.env.SANDBOX_SPLASH_MS) || 0 : 5000
const launchedAt = Date.now()
let revealTimer = null

function reveal() {
  if (revealed || !win) return
  const wait = SPLASH_MIN_MS - (Date.now() - launchedAt)
  if (wait > 0) {
    revealTimer ??= setTimeout(() => {
      revealTimer = null
      reveal()
    }, wait)
    return
  }
  revealed = true
  win.show()
  windows.closeSplash()
  if (pendingWelcome) {
    pendingWelcome = false
    void showWelcome()
  }
}

function isLocal(url) {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function openExternal(url) {
  if (/^https?:\/\//.test(url)) shell.openExternal(url)
}

// ---- Look: the system accent colour and macOS sizes for the pages ---------

function accentHex() {
  try {
    if (isMac) return `#${systemPreferences.getAccentColor().slice(0, 6)}`
  } catch {}
  return '#2563eb'
}

// Tailwind-style shades of the accent: tints towards white, shades to black.
function accentShades() {
  const hex = accentHex().replace('#', '')
  const base = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
  const mix = (target, amount) => base.map(c => Math.round(c + (target - c) * amount))
  const steps = { 50: [255, 0.92], 100: [255, 0.84], 200: [255, 0.68], 300: [255, 0.5], 400: [255, 0.28], 500: [255, 0.12], 600: [0, 0], 700: [0, 0.16], 800: [0, 0.32], 900: [0, 0.46], 950: [0, 0.64] }
  return Object.fromEntries(Object.entries(steps).map(([shade, [target, amount]]) => [shade, mix(target, amount)]))
}

function pageCss(s) {
  const shades = Object.entries(accentShades())
  if (s.service === 'web') {
    return `
      [data-web-only], [data-refresh] { display: none !important; }
      /* The toolbar names the page, so its first panel needs no heading. */
      [data-dashboard-content] > section[data-panel]:first-of-type > [data-panel-header] > [data-panel-heading] { display: none; }
      [data-dashboard-content] > section[data-panel]:first-of-type > [data-panel-header]:not(:has([data-panel-actions] > :not([data-refresh]))) { display: none; }
      section[data-panel] { box-shadow: 0 1px 2px rgb(0 0 0 / 0.05) !important; border-radius: 10px !important; }
      /* macOS sizes: 13px body text. */
      html { font-size: 15px; }
      html:root { ${shades.map(([n, [r, g, b]]) => `--color-blue-${n}: rgb(${r} ${g} ${b});`).join(' ')} }`
  }
  // html:root outranks the editor's own :root defaults.
  if (s.service === 'editor') return `html:root { ${shades.map(([n, [r, g, b]]) => `--accent-${n}: ${r} ${g} ${b};`).join(' ')} }`
  return ''
}

const cssKeys = new Map()
async function applyPageCss(key, s, wc) {
  const css = BASE_CSS + pageCss(s)
  const previous = cssKeys.get(key)
  try {
    if (previous) await wc.removeInsertedCSS(previous)
    cssKeys.set(key, await wc.insertCSS(css))
  } catch {
    // The frame can go away mid-navigation (e.g. a redirect); that's fine.
  }
}

// ---- Section views -------------------------------------------------------

// When the page in a shared view moves to another section's page (a link,
// back/forward), select that section in the sidebar.
function followNavigation(key, url) {
  if (key !== activeKey()) return
  let path
  try {
    path = pathOf(url)
  } catch {
    return
  }
  const match = SECTIONS.find(s => viewKey(s) === key && pathOf(s.url) === path)
  if (match && match.id !== active) {
    active = match.id
    saveState()
  }
}

function sectionForUrl(key, url) {
  try {
    const path = pathOf(url)
    return SECTIONS.find(s => viewKey(s) === key && !s.native && pathOf(s.url) === path)
  } catch {
    return null
  }
}

async function rememberScroll(key) {
  const view = views.get(key)
  if (!view) return
  const s = sectionForUrl(key, view.webContents.getURL())
  if (!s) return
  try {
    scrollPositions[s.id] = Math.round(await view.webContents.executeJavaScript('window.scrollY'))
    saveState()
  } catch {}
}

// Data loads after the page, so try for a moment until it's tall enough.
function restoreScroll(key, wc) {
  // A page arriving with a query (e.g. the OAuth tester back from the bank
  // with a code) is a new visit that scrolls itself.
  try {
    if (new URL(wc.getURL()).search) return
  } catch {}
  const s = sectionForUrl(key, wc.getURL())
  const y = s && scrollPositions[s.id]
  if (!y) return
  wc.executeJavaScript(
    `(() => { let tries = 0; const go = () => { if (document.documentElement.scrollHeight - innerHeight >= ${y} || ++tries > 30) scrollTo(0, ${y}); else setTimeout(go, 50) }; go() })()`,
  ).catch(() => {})
}

function createSectionView(s) {
  const key = viewKey(s)
  const view = new WebContentsView({
    webPreferences: { spellcheck: true, preload: path.join(__dirname, 'page-preload.js') },
  })
  const wc = view.webContents
  view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#111827' : '#f9fafb')
  // No pinch-zoom; ⌘+ / ⌘- zoom instead. Needs a loaded frame.
  wc.on('did-finish-load', () => {
    wc.setVisualZoomLevelLimits(1, 1).catch(() => {})
    restoreScroll(key, wc)
  })

  // Local pages stay in the app; anything else opens in the default browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isLocal(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 760, autoHideMenuBar: true } }
    openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => {
    if (!isLocal(url)) {
      event.preventDefault()
      openExternal(url)
    }
  })
  wc.on('dom-ready', () => applyPageCss(key, s, wc))
  wc.on('did-start-loading', () => {
    loadErrors.delete(key)
    pushState()
  })
  for (const event of ['did-navigate', 'did-navigate-in-page']) {
    wc.on(event, (_e, url, ...rest) => {
      // did-navigate-in-page passes isMainFrame next; only follow the page itself.
      if (event === 'did-navigate' || rest[0]) followNavigation(key, url)
      pushState()
    })
  }
  for (const event of ['did-stop-loading', 'page-title-updated']) wc.on(event, pushState)
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3: aborted by a newer navigation
    loadErrors.set(key, { description, url })
    applyVisibility()
  })
  wc.on('render-process-gone', (_e, details) => {
    loadErrors.set(key, { description: `The page crashed (${details.reason}).`, url: s.url })
    applyVisibility()
  })
  wc.on('context-menu', (_e, params) => showContextMenu(wc, params))
  wc.on('focus', updateMenuState)

  win.contentView.addChildView(view)
  view.setVisible(false)
  views.set(key, view)
  wc.loadURL(s.url)
  return view
}

// Show the active section's view only when its service is up and the page
// loaded; otherwise the shell draws a status screen (or its own page).
function applyVisibility() {
  const s = section(active)
  if (!s) return
  const key = viewKey(s)
  const canShow = !s.native && !blocker(s)
  if (canShow && !views.has(key)) createSectionView(s)
  for (const [k, view] of views) view.setVisible(canShow && k === key && !loadErrors.has(k))
  layout()
  pushState()
}

// A service came up or went down.
function refreshSections(serviceId) {
  if (!win) return
  for (const key of new Set(SECTIONS.filter(s => usesService(s, serviceId) && !s.native).map(viewKey))) {
    const view = views.get(key)
    if (view && serviceUp(serviceId) && loadErrors.has(key)) {
      loadErrors.delete(key)
      view.webContents.reload()
    }
  }
  applyVisibility()
}

function activate(id) {
  const s = section(id)
  if (!s) return
  // A shared view may be showing another section's page.
  const existing = views.get(viewKey(s))
  if (existing && s.view) {
    let current = ''
    try {
      current = pathOf(existing.webContents.getURL())
    } catch {}
    if (current !== pathOf(s.url)) {
      void rememberScroll(viewKey(s))
      existing.webContents.loadURL(s.url)
    }
  }
  active = id
  if (EDITORS.includes(id)) lastEditor = id
  applyVisibility()
  const view = views.get(viewKey(s))
  if (view?.getVisible()) view.webContents.focus()
  else shellView.webContents.focus()
  saveState()
}

// Go to a section and open one of its forms (palette, welcome sheet).
async function runPageAction(sectionId, actionId) {
  showWindow()
  activate(sectionId)
  const view = views.get(viewKey(section(sectionId)))
  if (!view) return
  const wc = view.webContents
  if (wc.isLoading()) await new Promise(r => wc.once('did-stop-loading', r))
  await sleep(400) // let the page hydrate and register its sheets
  wc.send('page:action', actionId)
}

function layout() {
  if (!win) return
  const { width, height } = win.getContentBounds()
  shellView.setBounds({ x: 0, y: 0, width, height })
  const left = sidebarVisible ? sidebarWidth : 0
  for (const view of views.values()) {
    view.setBounds({ x: left, y: TOOLBAR_HEIGHT, width: Math.max(0, width - left), height: Math.max(0, height - TOOLBAR_HEIGHT) })
  }
}

function toggleSidebar() {
  sidebarVisible = !sidebarVisible
  layout()
  pushState()
  saveState()
}

function activeWebContents() {
  const view = views.get(activeKey())
  return view?.getVisible() ? view.webContents : null
}

function pageCommand(name) {
  const wc = views.get(activeKey())?.webContents
  if (name === 'reload') {
    if (loadErrors.has(activeKey()) && wc) {
      loadErrors.delete(activeKey())
      applyVisibility()
    }
    return wc?.reload()
  }
  if (!wc) return
  if (name === 'back') wc.navigationHistory.goBack()
  if (name === 'forward') wc.navigationHistory.goForward()
  if (name === 'home') wc.loadURL(section(active).url)
  if (name === 'browser') openExternal(wc.getURL())
  if (name === 'devtools') wc.toggleDevTools()
  if (name === 'zoom-in') wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4))
  if (name === 'zoom-out') wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3))
  if (name === 'zoom-reset') wc.setZoomLevel(0)
}

function showContextMenu(wc, params) {
  const template = []
  if (params.linkURL) {
    template.push(
      { label: 'Open Link in Browser', click: () => openExternal(params.linkURL) },
      { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' },
    )
  }
  if (params.isEditable) {
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 4)) {
        template.push({ label: word, click: () => wc.replaceMisspelling(word) })
      }
      if (params.dictionarySuggestions.length) template.push({ type: 'separator' })
    }
    template.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' })
  } else if (params.selectionText.trim()) {
    template.push({ role: 'copy' })
  } else {
    template.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
    )
  }
  template.push({ type: 'separator' }, { label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) })
  Menu.buildFromTemplate(template).popup()
}

function createWindow() {
  const bounds = initialBounds()
  win = new BaseWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    title: 'Investec Sandbox',
    show: false,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 }, vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000' }
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f2937' : '#f3f4f6', autoHideMenuBar: false }),
  })
  if (saved.maximized) win.maximize()

  shellView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'shell-preload.js') } })
  shellView.setBackgroundColor('#00000000')
  shellView.webContents.on('did-finish-load', () => shellView.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {}))
  shellView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  shellView.webContents.on('will-navigate', e => e.preventDefault())
  win.contentView.addChildView(shellView)
  shellView.webContents.loadFile(path.join(__dirname, 'shell.html'))
  shellView.webContents.once('did-finish-load', () => {
    layout()
    applyVisibility()
    shellLoaded = true
    maybeReveal()
    // Never stay behind the splash for long, whatever is still starting.
    setTimeout(reveal, 30_000)
  })

  win.on('resize', () => {
    layout()
    saveState()
  })
  win.on('move', saveState)
  win.on('focus', () => {
    windowFocused = true
    pushState()
    ;(activeWebContents() || shellView.webContents).focus()
  })
  win.on('blur', () => {
    windowFocused = false
    pushState()
  })
  // On macOS, closing the window hides it and keeps everything running, like
  // other Mac apps (the menu bar icon shows it's still there); ⌘Q quits.
  win.on('close', event => {
    if (isMac && !quitting) {
      event.preventDefault()
      void rememberScroll(activeKey())
      win.hide()
    }
  })
  win.on('closed', () => {
    win = null
    app.quit()
  })
  nativeTheme.on('updated', () => {
    for (const view of views.values()) view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#111827' : '#f9fafb')
  })
}

function showWindow() {
  if (!win) return
  if (!revealed) return reveal()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// ---------------------------------------------------------------------------
// Native sheets and Save panels for the pages (page-preload.js)

const pageWindow = () => (win && !win.isDestroyed() ? win : undefined)

async function confirmSheet({ message, detail, confirmLabel = 'OK', destructive = false }) {
  const { response } = await dialog.showMessageBox(pageWindow(), {
    type: destructive ? 'warning' : 'question',
    message: String(message),
    detail: detail ? String(detail) : undefined,
    buttons: [String(confirmLabel), 'Cancel'],
    // A destructive action isn't the default: Return cancels.
    defaultId: destructive ? 1 : 0,
    cancelId: 1,
  })
  return response === 0
}

async function saveFile(fileName, text, title = 'Save') {
  const { canceled, filePath } = await dialog.showSaveDialog(pageWindow(), {
    title,
    defaultPath: path.join(app.getPath('downloads'), path.basename(String(fileName))),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePath) return null
  await fs.promises.writeFile(filePath, String(text))
  return filePath
}

ipcMain.handle('page:confirm', (_e, options) => confirmSheet(options || {}))
ipcMain.handle('page:save', (_e, { fileName, text }) => saveFile(fileName, text))
ipcMain.on('page:notify', (_e, { message, error }) => notify(error ? 'Something went wrong' : 'Investec Sandbox', message))

// ---------------------------------------------------------------------------
// Sandbox commands (File menu, palette, menu bar)

async function guarded(action) {
  try {
    await action()
  } catch (error) {
    await dialog.showMessageBox(pageWindow(), { type: 'error', message: 'That didn’t work', detail: error.message })
  }
}

const commands = {
  importSandbox: () =>
    guarded(async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(pageWindow(), {
        title: 'Import Sandbox',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      })
      if (canceled || !filePaths[0]) return
      const state = JSON.parse(await fs.promises.readFile(filePaths[0], 'utf8'))
      const confirmed = await confirmSheet({
        message: `Replace the sandbox’s data with ${path.basename(filePaths[0])}?`,
        detail: 'All accounts, transactions, beneficiaries and cards are replaced.',
        confirmLabel: 'Replace',
        destructive: true,
      })
      if (!confirmed) return
      const counts = await api('/import', { method: 'POST', body: JSON.stringify(state) })
      notify('Sandbox imported', `${counts.accounts} accounts, ${counts.transactions} transactions, ${counts.cards} cards`)
    }),
  exportSandbox: () =>
    guarded(async () => {
      const state = await api('/export')
      const date = String(state?.exportedAt || new Date().toISOString()).slice(0, 10)
      await saveFile(`sandbox-${date}.json`, JSON.stringify(state, null, 2), 'Export Sandbox')
    }),
  resetSandbox: () =>
    guarded(async () => {
      if (!(await confirmSheet({ message: 'Reset the sandbox to the seed data?', detail: 'Your changes to accounts, transactions, beneficiaries and cards are lost.', confirmLabel: 'Reset', destructive: true }))) return
      await api('/restore')
    }),
  clearSandbox: () =>
    guarded(async () => {
      if (!(await confirmSheet({ message: 'Clear the sandbox data?', detail: 'Every profile, account, transaction, beneficiary and card is removed. Reset brings back the seed data.', confirmLabel: 'Clear Data', destructive: true }))) return
      await api('/clear', { method: 'DELETE' })
    }),
  loadScenario: id =>
    guarded(async () => {
      const scenario = scenarios.find(s => s.id === id)
      if (!(await confirmSheet({ message: `Load the ${scenario?.name ?? id} scenario?`, detail: `${scenario?.description ?? ''} It replaces the sandbox’s data.`.trim(), confirmLabel: 'Load Scenario', destructive: true }))) return
      await api(`/scenarios/${encodeURIComponent(id)}`, { method: 'POST' })
    }),
  copyApiUrl: () => clipboard.writeText(URLS.api),
  connectAssistant: () => connectAssistant(),
  showLibrary: () => {
    fs.mkdirSync(libraryDir(), { recursive: true })
    return shell.openPath(libraryDir())
  },
}

// Everything the command palette (⌘K) can do.
function paletteItems() {
  const items = []
  for (const s of SECTIONS) items.push({ id: `go:${s.id}`, title: s.label, subtitle: s.description, group: 'Go to', icon: s.icon })
  for (const s of SECTIONS) for (const a of s.actions || []) items.push({ id: `action:${s.id}:${a.id}`, title: `${a.label}…`, subtitle: s.label, group: 'Actions', icon: a.icon })
  for (const sc of scenarios) items.push({ id: `scenario:${sc.id}`, title: `Load scenario: ${sc.name}`, subtitle: sc.description, group: 'Sandbox', icon: 'database' })
  items.push(
    { id: 'cmd:resetSandbox', title: 'Reset sandbox data…', group: 'Sandbox', icon: 'reload' },
    { id: 'cmd:clearSandbox', title: 'Clear sandbox data…', group: 'Sandbox', icon: 'database' },
    { id: 'cmd:importSandbox', title: 'Import sandbox…', group: 'Sandbox', icon: 'upload' },
    { id: 'cmd:exportSandbox', title: 'Export sandbox…', group: 'Sandbox', icon: 'download' },
    { id: 'cmd:copyApiUrl', title: 'Copy API URL', subtitle: URLS.api, group: 'Sandbox', icon: 'copy' },
    { id: 'cmd:connectAssistant', title: 'Connect an AI assistant…', subtitle: 'MCP server for card code', group: 'App', icon: 'plug' },
    { id: 'cmd:showLibrary', title: 'Show card code library in Finder', group: 'App', icon: 'code' },
    { id: 'app:restartAll', title: 'Restart all services', group: 'App', icon: 'reload' },
    { id: 'app:preferences', title: 'Preferences…', group: 'App', icon: 'settings' },
    { id: 'app:welcome', title: 'Show the welcome sheet', group: 'App', icon: 'book' },
    { id: 'app:swagger', title: 'Open Swagger UI', group: 'App', icon: 'braces' },
  )
  return items
}

function runPaletteItem(id) {
  const [kind, a, b] = id.split(':')
  if (kind === 'go') activate(a)
  else if (kind === 'action') void runPageAction(a, b)
  else if (kind === 'scenario') void commands.loadScenario(a)
  else if (kind === 'cmd') void commands[a]?.()
  else if (kind === 'app') {
    if (a === 'restartAll') restartAll()
    if (a === 'preferences') showPreferences()
    if (a === 'welcome') showWelcome()
    if (a === 'swagger') windows.openSwagger({ url: `${URLS.api}/swagger-ui`, dark: nativeTheme.shouldUseDarkColors })
  }
}

// ---------------------------------------------------------------------------
// Preferences, welcome sheet, menu bar icon

// Say which services aren't on the port set for them in Settings.
function logMovedPorts(chosen) {
  for (const [id, port] of Object.entries(chosen)) {
    const wanted = Number(getPrefs().ports[id])
    if (port !== wanted) log('app', `${services[id].label}: port ${wanted} is taken, using ${port}`)
  }
}

function showPreferences() {
  windows.openPreferences({
    get: () => ({
      ...getPrefs(),
      openAtLogin: app.getLoginItemSettings().openAtLogin,
      dataLocation: dataLocation(),
      defaultPorts: DEFAULT_PORTS,
      // The port each service is on now (it moves if its own is taken).
      current: { ...ports },
      labels: Object.fromEntries(Object.entries(services).map(([id, s]) => [id, s.label])),
    }),
    set: patch => {
      if ('openAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: Boolean(patch.openAtLogin) })
      const { openAtLogin: _, ...rest } = patch
      if ('ports' in rest) {
        // Whole numbers a program may listen on, one per service.
        const wanted = Object.fromEntries(Object.keys(DEFAULT_PORTS).map(id => [id, Number(rest.ports?.[id] ?? getPrefs().ports[id])]))
        const list = Object.values(wanted)
        if (list.some(p => !Number.isInteger(p) || p < 1024 || p > 65535) || new Set(list).size !== list.length) return false
        rest.ports = wanted
      }
      const next = setPrefs(rest)
      if ('menuBar' in rest) tray.setEnabled(next.menuBar, trayState())
      return true
    },
    showData: () => shell.showItemInFolder(dataLocation()),
    showWelcome: () => showWelcome(),
    restartServices: async () => {
      // New ports take effect when the services start again.
      await Promise.all(Object.keys(services).map(stopService))
      const chosen = await resolvePorts(getPrefs().ports)
      logMovedPorts(chosen)
      SECTIONS = makeSections()
      // The pages were loaded from the old addresses: start them afresh.
      for (const view of views.values()) {
        win?.contentView.removeChildView(view)
        view.webContents.close()
      }
      views.clear()
      cssKeys.clear()
      loadErrors.clear()
      buildMenu()
      Object.keys(services).forEach(startService)
    },
  })
}

async function showWelcome() {
  // On first launch it waits for the window to appear.
  if (!revealed) {
    pendingWelcome = true
    return
  }
  let envs = {}
  try {
    envs = await api('/envs')
  } catch {}
  windows.openWelcome(win, {
    apiUrl: URLS.api,
    clientId: envs?.client_id ?? '',
    clientSecret: envs?.client_secret ?? '',
    apiKey: envs?.api_key ?? '',
    auth: Boolean(envs?.auth),
    openPostman: () => openExternal(POSTMAN_URL),
    trySwipe: () => runPageAction('cards', 'swipe-card'),
  })
}

function trayState() {
  return {
    summary: statusSummary(),
    notes: sandboxNotes(),
    services: Object.entries(services).map(([id, s]) => ({ id, label: s.label, status: s.status, url: s.url })),
    open: showWindow,
    restartAll,
    copyApiUrl: commands.copyApiUrl,
    preferences: showPreferences,
    quit: () => app.quit(),
  }
}

// ---------------------------------------------------------------------------
// Menus

let appMenu = null
function buildMenu() {
  const page = name => () => pageCommand(name)
  // The Card Code menu acts on the editor in front, else the last one used.
  const editor = action => () => {
    const target = EDITORS.includes(active) ? active : lastEditor
    activate(target)
    views.get(target)?.webContents.send('page:action', action)
  }
  // Grouped like the sidebar; the first nine get ⌘1–⌘9.
  const sectionItems = SECTIONS.flatMap((s, i) => [
    ...(i > 0 && SECTIONS[i - 1].group !== s.group ? [{ type: 'separator' }] : []),
    { id: `section-${s.id}`, label: s.label, type: 'radio', checked: s.id === active, accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : undefined, click: () => activate(s.id) },
  ])
  const serviceItems = Object.entries(services).map(([id, s]) => ({ id: `restart-${id}`, label: `Restart ${s.label}`, click: () => restartService(id) }))
  const preferences = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: showPreferences }
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about', label: 'About Investec Sandbox' },
            { id: 'check-updates', label: 'Check for Updates…', click: () => checkForUpdates(true) },
            { type: 'separator' },
            preferences,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide', label: 'Hide Investec Sandbox' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit', label: 'Quit Investec Sandbox' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Import Sandbox…', accelerator: 'CmdOrCtrl+O', click: commands.importSandbox },
        { label: 'Export Sandbox…', accelerator: 'CmdOrCtrl+Shift+E', click: commands.exportSandbox },
        { type: 'separator' },
        {
          label: 'Load Scenario',
          enabled: scenarios.length > 0,
          submenu: scenarios.length ? scenarios.map(sc => ({ label: sc.name, toolTip: sc.description, click: () => commands.loadScenario(sc.id) })) : [{ label: 'Starting…', enabled: false }],
        },
        { label: 'Reset Sandbox Data…', click: commands.resetSandbox },
        { label: 'Clear Sandbox Data…', click: commands.clearSandbox },
        ...(isMac ? [{ type: 'separator' }, { role: 'close' }] : [{ type: 'separator' }, preferences, { type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+K', click: () => windows.openPalette(win, paletteItems(), runPaletteItem) },
        { type: 'separator' },
        { id: 'reload', label: 'Reload Page', accelerator: 'CmdOrCtrl+R', click: page('reload') },
        { id: 'home', label: 'Back to Section Start', accelerator: 'CmdOrCtrl+Shift+H', click: page('home') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: isMac ? 'Ctrl+Cmd+S' : 'Ctrl+Shift+S', click: toggleSidebar },
        { type: 'separator' },
        { id: 'zoom-reset', label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: page('zoom-reset') },
        { id: 'zoom-in', label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: page('zoom-in') },
        { id: 'zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: page('zoom-out') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { id: 'back', label: 'Back', accelerator: 'CmdOrCtrl+[', click: page('back') },
        { id: 'forward', label: 'Forward', accelerator: 'CmdOrCtrl+]', click: page('forward') },
        { type: 'separator' },
        ...sectionItems,
      ],
    },
    {
      label: 'Card Code',
      submenu: [
        { id: 'editor-run', label: 'Run', accelerator: 'CmdOrCtrl+Enter', click: editor('run') },
        { type: 'separator' },
        { id: 'editor-save', label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: editor('save-as') },
        { id: 'editor-import', label: 'Import…', click: editor('import') },
        { id: 'editor-export', label: 'Export…', click: editor('export') },
        { type: 'separator' },
        { id: 'editor-blocks', label: 'Show Blocks', accelerator: 'CmdOrCtrl+B', click: editor('toggle-blocks') },
        { id: 'editor-panel', label: 'Show Panel', accelerator: 'CmdOrCtrl+J', click: editor('toggle-panel') },
      ],
    },
    {
      label: 'Services',
      submenu: [
        ...serviceItems,
        { label: 'Restart All', accelerator: 'CmdOrCtrl+Shift+R', click: restartAll },
        { type: 'separator' },
        { label: 'Copy API URL', click: commands.copyApiUrl },
        { label: 'Connect an AI Assistant…', click: commands.connectAssistant },
        { label: 'Show Card Code Library in Finder', click: commands.showLibrary },
        { id: 'browser', label: 'Open Page in Browser', accelerator: 'CmdOrCtrl+Shift+O', click: page('browser') },
        { label: 'Show Sandbox Data in Finder', click: () => shell.showItemInFolder(dataLocation()) },
        ...(MODE === 'packaged' ? [] : [{ label: 'Open Source Folder', submenu: Object.values(services).map(s => ({ label: s.label, click: () => shell.openPath(s.dir) })) }]),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Welcome to Investec Sandbox', click: showWelcome },
        { label: 'Swagger UI', click: () => windows.openSwagger({ url: `${URLS.api}/swagger-ui`, dark: nativeTheme.shouldUseDarkColors }) },
        { type: 'separator' },
        ...RESOURCES.map(r => ({ label: r.label, click: () => openExternal(r.url) })),
        { type: 'separator' },
        { id: 'devtools', label: 'Developer Tools for Page', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: page('devtools') },
        { label: 'Developer Tools for App', click: () => shellView?.webContents.toggleDevTools() },
      ],
    },
  ]
  appMenu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(appMenu)
  updateMenuState()
}

function updateMenuState() {
  const menu = appMenu
  if (!menu) return
  const wc = views.get(activeKey())?.webContents
  const shown = !!activeWebContents()
  const set = (id, enabled) => {
    const item = menu.getMenuItemById(id)
    if (item) item.enabled = enabled
  }
  set('back', shown && wc.navigationHistory.canGoBack())
  set('forward', shown && wc.navigationHistory.canGoForward())
  for (const id of ['reload', 'home', 'zoom-reset', 'zoom-in', 'zoom-out', 'browser', 'devtools']) set(id, !!wc)
  const editorUp = serviceUp('editor')
  // Run (⌘↵), ⌘B and ⌘J only while the editor is in front.
  const editorShown = editorUp && EDITORS.includes(active)
  for (const id of ['editor-run', 'editor-panel']) set(id, editorShown)
  // Blocks and Save As (a named workspace) are the blocks editor's own.
  set('editor-blocks', editorUp && active === 'editor')
  set('editor-save', editorUp && active !== 'code')
  for (const id of ['editor-import', 'editor-export']) set(id, editorUp)
  const radio = menu.getMenuItemById(`section-${active}`)
  if (radio) radio.checked = true
  for (const [id, s] of Object.entries(services)) set(`restart-${id}`, !busy(s.status))
}

// The toolbar's status indicator opens this, as a native menu.
function showStatusMenu({ x, y }) {
  const items = Object.entries(services).map(([id, s]) => ({
    label: `${s.label} — ${s.status === 'ready' ? 'running' : s.status}`,
    sublabel: s.detail,
    submenu: [
      { label: busy(s.status) ? 'Starting…' : `Restart ${s.label}`, enabled: !busy(s.status), click: () => restartService(id) },
      { label: `Copy ${s.url}`, click: () => clipboard.writeText(s.url) },
      ...(s.dir ? [{ label: 'Open Source Folder', click: () => shell.openPath(s.dir) }] : []),
      { type: 'separator' },
      { label: 'Show Logs', click: () => activate('logs') },
    ],
  }))
  const notes = sandboxNotes().map(label => ({ label, enabled: false }))
  Menu.buildFromTemplate([
    ...items,
    ...(notes.length ? [{ type: 'separator' }, ...notes] : []),
    { type: 'separator' },
    { label: 'Restart All', click: restartAll },
    { label: 'Show Logs', click: () => activate('logs') },
  ]).popup({ window: win, x: Math.round(x), y: Math.round(y) })
}

// ---------------------------------------------------------------------------
// Updates: signed builds with a publish config check GitHub Releases.

let updater = null
function checkForUpdates(manual = false) {
  if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    if (manual) dialog.showMessageBox(pageWindow(), { message: 'Updates aren’t set up for this build', detail: 'Signed builds published to GitHub Releases update themselves. This one was built locally.' })
    return
  }
  try {
    updater ??= require('electron-updater').autoUpdater
    updater.logger = { info: m => log('app', m), warn: m => log('app', m), error: m => log('app', m) }
    if (manual) {
      updater.once('update-not-available', () => dialog.showMessageBox(pageWindow(), { message: 'You’re up to date', detail: `Investec Sandbox ${app.getVersion()} is the newest version.` }))
    }
    updater.checkForUpdatesAndNotify()
  } catch (error) {
    if (manual) dialog.showMessageBox(pageWindow(), { type: 'error', message: 'Couldn’t check for updates', detail: error.message })
  }
}

// ---------------------------------------------------------------------------
// Shell IPC

ipcMain.handle('shell:init', () => ({ state: snapshot(), logs: logLines }))
ipcMain.on('shell:navigate', (_e, id) => activate(id))
ipcMain.on('shell:page', (_e, name) => pageCommand(name))
ipcMain.on('shell:page-action', (_e, id) => activeWebContents()?.send('page:action', String(id)))
ipcMain.on('shell:restart', (_e, id) => restartService(id))
ipcMain.on('shell:toggle-sidebar', () => toggleSidebar())
ipcMain.on('shell:sidebar-width', (_e, width) => {
  sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(Number(width) || 236)))
  layout()
  pushState()
  saveState()
})
ipcMain.on('shell:status-menu', (_e, point) => showStatusMenu(point || {}))
ipcMain.on('shell:palette', () => windows.openPalette(win, paletteItems(), runPaletteItem))
ipcMain.on('shell:resource', (_e, key) => {
  const resource = RESOURCES.find(r => r.key === key)
  if (resource) openExternal(resource.url)
})
ipcMain.on('shell:copy', (_e, text) => clipboard.writeText(String(text)))
ipcMain.handle('shell:overview', () => overviewData())
ipcMain.on('shell:overview-copy', (_e, key) => {
  const value = Object.hasOwn(overviewCopies, key) ? overviewCopies[key] : null
  if (value) clipboard.writeText(String(value))
})
// The Overview's shortcuts: anything the command palette can do, by its id.
ipcMain.on('shell:run', (_e, id) => {
  if (id === 'app:showData') shell.showItemInFolder(dataLocation())
  else if (paletteItems().some(item => item.id === id)) runPaletteItem(String(id))
})

// Requests: what the recorder has, one in full, and sending one again.
ipcMain.handle('shell:requests', () => recorder.listRequests())
ipcMain.handle('shell:request', (_e, id) => recorder.getRequest(id))
ipcMain.on('shell:requests-clear', () => recorder.clearRequests())
ipcMain.handle('shell:request-replay', async (_e, id) => {
  const record = recorder.getRequest(id)
  if (!record) return { ok: false, error: 'That request is no longer in the list.' }
  // The same request, less what belongs to the connection it came on.
  const dropped = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'expect', 'upgrade', 'user-agent'])
  const headers = new Headers()
  for (const [name, value] of record.request.headers) if (!dropped.has(name.toLowerCase())) headers.append(name, value)
  headers.set('User-Agent', 'InvestecSandbox-Replay')
  const hasBody = !['GET', 'HEAD'].includes(record.method) && record.request.size > 0
  if (hasBody && record.request.truncated) return { ok: false, error: 'Its body was too large to keep, so it can’t be sent again.' }
  try {
    await (await fetch(`${URLS.api}${record.path}`, { method: record.method, headers, body: hasBody ? record.request.text : undefined, redirect: 'manual' })).arrayBuffer()
  } catch {
    // A dropped connection is recorded like any other outcome.
  }
  return { ok: true }
})
recorder.onRequest(record => {
  sendToShell('request', recorder.summary(record))
  noteGuideProgress(record)
})

// Quick start: the snippets with this sandbox's details, which steps have
// been seen arriving from the developer's own code, and running a step here.
const MASK = '••••••••'
const guideDone = () => getPrefs().guide || {}

async function guideValues() {
  let envs = null
  let accountId = null
  if (serviceUp('api')) {
    const quiet = { headers: { 'User-Agent': QUIET_AGENT } }
    envs = await api('/envs', quiet).catch(() => null)
    const accounts = await api('/za/pb/v1/accounts', { headers: { 'User-Agent': QUIET_AGENT, ...(await guideAuth(envs)) } }).catch(() => null)
    accountId = accounts?.accounts?.[0]?.accountId ?? null
  }
  return {
    api: URLS.api,
    id: envs?.client_id || 'your-client-id',
    secret: envs?.client_secret || 'your-client-secret',
    key: envs?.api_key || 'your-api-key',
    accountId: accountId || '<accountId>',
    auth: Boolean(envs?.auth),
    up: Boolean(envs),
  }
}

// A token for the app's own guide calls, when the sandbox asks for one.
async function guideToken(envs, agent = QUIET_AGENT) {
  const res = await fetch(`${URLS.api}/identity/v2/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${envs?.client_id ?? ''}:${envs?.client_secret ?? ''}`).toString('base64')}`,
      'x-api-key': envs?.api_key ?? '',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Sandbox-Client': 'desktop-app',
      'User-Agent': agent,
    },
    body: 'grant_type=client_credentials',
  })
  return (await res.json().catch(() => null))?.access_token ?? null
}
const guideAuth = async envs => (envs?.auth ? { Authorization: `Bearer ${await guideToken(envs)}` } : {})

async function guideData() {
  const values = await guideValues()
  // Shown with the secrets hidden; Copy puts the real ones in (guide-copy).
  const shown = { ...values, secret: values.up ? MASK : values.secret, key: values.up ? MASK : values.key, token: '<access_token>' }
  const done = guideDone()
  return {
    apiUrl: values.api,
    auth: values.auth,
    up: values.up,
    languages: guide.LANGUAGES,
    steps: guide.STEPS.map(step => ({
      id: step.id,
      title: step.title,
      text: step.text,
      request: step.request,
      seen: done[step.id] || null,
      snippets: Object.fromEntries(guide.LANGUAGES.map(l => [l.id, guide.snippet(l.id, step.id, shown)])),
    })),
  }
}

ipcMain.handle('shell:guide', () => guideData())
// Copy a step (or `all`) with the real credentials and, for curl, a fresh token.
ipcMain.handle('shell:guide-copy', async (_e, { language, step }) => {
  if (!guide.LANGUAGES.some(l => l.id === language)) return false
  const values = await guideValues()
  if (language === 'curl' && step !== 'token' && values.up) {
    const envs = await api('/envs', { headers: { 'User-Agent': QUIET_AGENT } }).catch(() => null)
    values.token = (await guideToken(envs).catch(() => null)) || '<access_token>'
  } else values.token = '<access_token>'
  const text = step === 'all' ? guide.script(language, values) : guide.snippet(language, step, values)
  if (!text) return false
  clipboard.writeText(text)
  return true
})
// Run a step from the app, to see what it answers.
ipcMain.handle('shell:guide-run', async (_e, stepId) => {
  const started = Date.now()
  const agent = 'InvestecSandbox-Guide'
  try {
    const envs = await api('/envs', { headers: { 'User-Agent': QUIET_AGENT } })
    const base = { 'X-Sandbox-Client': 'desktop-app', 'User-Agent': agent }
    let res
    if (stepId === 'token') {
      res = await fetch(`${URLS.api}/identity/v2/oauth2/token`, {
        method: 'POST',
        headers: {
          ...base,
          Authorization: `Basic ${Buffer.from(`${envs.client_id}:${envs.client_secret}`).toString('base64')}`,
          'x-api-key': envs.api_key,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })
    } else {
      const headers = { ...base, Authorization: `Bearer ${await guideToken(envs, agent)}` }
      let target = '/za/pb/v1/accounts'
      if (stepId === 'transactions') {
        const accounts = await (await fetch(`${URLS.api}${target}`, { headers: { ...headers, 'User-Agent': QUIET_AGENT } })).json()
        const accountId = accounts?.data?.accounts?.[0]?.accountId
        if (!accountId) return { status: 0, statusText: 'The sandbox has no accounts. Load a scenario under Data & scenarios.', ms: Date.now() - started, body: '' }
        target = `/za/pb/v1/accounts/${accountId}/transactions`
      } else if (stepId !== 'accounts') return null
      res = await fetch(`${URLS.api}${target}`, { headers })
    }
    return { status: res.status, statusText: res.statusText, ms: Date.now() - started, body: await res.text() }
  } catch (error) {
    return { status: 0, statusText: serviceUp('api') ? error.message : 'The API isn’t running.', ms: Date.now() - started, body: '' }
  }
})
ipcMain.on('shell:guide-reset', () => {
  setPrefs({ guide: {} })
  sendToShell('guide', null)
})

// A step is done once a successful call for it arrives from outside the app.
function noteGuideProgress(record) {
  if (!record.client.external || record.status < 200 || record.status >= 300) return
  const step = guide.STEPS.find(s => s.matches(record))
  if (!step || guideDone()[step.id]) return
  setPrefs({ guide: { ...guideDone(), [step.id]: { time: record.time, client: record.client.name } } })
  sendToShell('guide', step.id)
}

ipcMain.handle('shell:save-logs', (_e, text) => saveFile(`investec-sandbox-${new Date().toISOString().slice(0, 10)}.log`, text, 'Export Logs'))
// The API explorer: the OpenAPI document, and requests made for it here (no CORS, no CSP).
ipcMain.handle('shell:api-doc', async () => {
  const res = await fetch(`${URLS.api}/api-docs.json`)
  return res.json()
})
ipcMain.handle('shell:api-request', async (_e, { method, path: requestPath, body, token, applyFaults }) => {
  const started = Date.now()
  // Exempt from the sandbox's random faults unless asked to see them, the way
  // Postman or your own app would.
  const headers = { Accept: 'application/json', 'User-Agent': 'InvestecSandbox-ApiReference', ...(applyFaults ? {} : { 'X-Sandbox-Client': 'desktop-app' }) }
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(`${URLS.api}${requestPath}`, { method, headers, body: body || undefined, redirect: 'manual' })
    const text = await res.text()
    return { status: res.status, statusText: res.statusText, ms: Date.now() - started, headers: Object.fromEntries(res.headers), body: text }
  } catch (error) {
    return { status: 0, statusText: error.message, ms: Date.now() - started, headers: {}, body: '' }
  }
})
ipcMain.handle('shell:api-url', () => URLS.api)

// ---------------------------------------------------------------------------
// App lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.setAboutPanelOptions({
    applicationName: 'Investec Sandbox',
    applicationVersion: require('./package.json').version,
    credits:
      'A desktop home for programmable-banking-sim, investec-blockly and investec-card-server.\n' +
      'A community project. It is not made, endorsed or supported by Investec.',
  })

  app.whenReady().then(async () => {
    windows.openSplash({ text: 'Starting…', progress: 0.04, version: app.getVersion() })
    if (isMac && app.dock) app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'))
    // Pages here only need the clipboard (e.g. Blockly's Copy link).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen'].includes(permission)),
    )
    const chosen = await resolvePorts(getPrefs().ports)
    SECTIONS = makeSections()
    if (!section(active)) active = SECTIONS[0].id
    buildMenu()
    createWindow()
    tray.setEnabled(getPrefs().menuBar, trayState())
    log('app', `Investec Sandbox ${app.getVersion()} (${MODE === 'dev' ? 'development: running from packages/' : MODE === 'build' ? 'running ./build' : 'installed'})`)
    log('app', `Data: ${dataLocation()}`)
    logMovedPorts(chosen)
    for (const id of Object.keys(services)) startService(id)
    setInterval(pollSandboxState, 5000).unref()
    // Accent colour changes (System Settings → Appearance) restyle the pages.
    if (isMac) {
      systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', () => {
        for (const [key, view] of views) {
          const s = SECTIONS.find(x => viewKey(x) === key)
          if (s) void applyPageCss(key, s, view.webContents)
        }
        sendToShell('accent', accentHex())
    windows.setAccent(accentHex())
      })
    }
    sendToShell('accent', accentHex())
    windows.setAccent(accentHex())
    setTimeout(() => checkForUpdates(false), 10_000)
  })

  app.on('activate', showWindow)
  app.on('window-all-closed', () => app.quit())
  // Stop every service this app started before quitting, so nothing is left
  // holding a port for the next launch.
  let stopped = false
  app.on('before-quit', event => {
    quitting = true
    if (stopped) return
    event.preventDefault()
    void rememberScroll(activeKey())
    const all = Promise.all([...children].map(stopChild))
    Promise.race([all, sleep(7000)]).finally(() => {
      stopped = true
      app.quit()
    })
  })
  process.on('exit', () => {
    for (const child of children) signal(child, 'SIGKILL')
  })
}

// Development aid: SANDBOX_SNAPSHOT=<dir> writes the shell and the active
// page as PNGs (with the page's position) every few seconds, e.g. to check
// the layout without screen-recording permission.
if (process.env.SANDBOX_SNAPSHOT) {
  let n = 0
  const snap = async () => {
    if (!win) return
    const dir = process.env.SANDBOX_SNAPSHOT
    const tag = `${String(++n).padStart(2, '0')}-${active}`
    fs.writeFileSync(path.join(dir, `${tag}-shell.png`), (await shellView.webContents.capturePage()).toPNG())
    const view = views.get(activeKey())
    if (view?.getVisible()) {
      fs.writeFileSync(path.join(dir, `${tag}-page.png`), (await view.webContents.capturePage()).toPNG())
      fs.writeFileSync(path.join(dir, `${tag}-page.json`), JSON.stringify(view.getBounds()))
    }
  }
  app.whenReady().then(() => setInterval(() => snap().catch(() => {}), 4000))
}

// Surface anything unexpected instead of failing silently.
process.on('unhandledRejection', error => log('app', `Unexpected error: ${error?.stack || error}`))
process.on('uncaughtException', error => {
  log('app', `Unexpected error: ${error.stack || error.message}`)
  if (!app.isReady()) dialog.showErrorBox('Investec Sandbox', error.message)
})
