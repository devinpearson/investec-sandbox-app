// Running the five services: where their code is, how each one starts, and
// the database the API uses.
//
// Three modes:
//   packaged  the installed app: everything in Contents/Resources/services,
//             built by `npm run build` and shipped by electron-builder
//   build     `npm start`: the same build, from ./build
//   dev       `npm run dev`: straight from ./packages with live-reloading
//             dev servers (tsx watch, next dev, vite, tsc --watch)
//
// Every service runs on the pinned Node.js (config.js) bundled with the app,
// never on whatever Node is installed, and never reuses a server it didn't
// start. Each prefers its usual port (or the one set in Preferences) and
// moves to the next free one if that's taken; the dashboard and editor learn
// the addresses from /sandbox-config.js. In packaged and build modes the
// dashboard and editor are static files served from this process, and the
// sandbox's data lives in sandbox.db in the app's data folder; in dev mode,
// in packages/sim/prisma/dev.db.

const { app } = require('electron')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { PORTS } = require('./config.js')
const { createProxy } = require('./recorder.js')

const MODE = app.isPackaged ? 'packaged' : process.env.SANDBOX_MODE === 'dev' ? 'dev' : 'build'
const BUILD = app.isPackaged ? path.join(process.resourcesPath, 'services') : path.join(__dirname, 'build')
const PACKAGES = path.join(__dirname, 'packages')
const NODE = MODE === 'dev' ? path.join(__dirname, 'vendor', 'node', 'bin', 'node') : path.join(BUILD, 'node', 'bin', 'node')

// The ports in use, chosen by resolvePorts() before anything starts.
const ports = { ...PORTS }
const URLS = {}
function updateUrls() {
  URLS.api = `http://localhost:${ports.api}`
  URLS.web = `http://localhost:${ports.web}`
  URLS.editor = `http://127.0.0.1:${ports.editor}`
  URLS.card = `http://localhost:${ports.card}`
  URLS.mcp = `http://127.0.0.1:${ports.mcp}`
}
updateUrls()

// Can a server listen on this port at this address?
function canListen(port, host) {
  return new Promise(resolve => {
    const probe = net.createServer()
    // An address this machine doesn't have (no IPv6, say) isn't a port in use.
    probe.once('error', error => resolve(error.code !== 'EADDRINUSE' && error.code !== 'EACCES'))
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true)))
  })
}

// Is a TCP port free on this machine? Checked on every address the services
// listen on: macOS lets a server take all interfaces while another program
// has the same port on 127.0.0.1 alone, and the other way round.
async function portFree(port) {
  for (const host of [undefined, '127.0.0.1', '::1']) {
    if (!(await canListen(port, host))) return false
  }
  return true
}

// A free port for the API itself: its public address is the recording proxy
// (recorder.js), which passes requests on to it here.
function privatePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

// Start the API with `run(port)` on a private port, and serve its public
// address through the recorder once it answers.
async function startApi(run) {
  const port = await privatePort()
  const child = run(port)
  await waitFor(`http://127.0.0.1:${port}/api-docs.json`, isApi, child, 'The API')
  try {
    return { child, server: await createProxy(ports.api, port) }
  } catch (error) {
    await stopChild(child)
    throw error
  }
}

// Each service gets its preferred port, or the next free one after it.
async function resolvePorts(preferred = {}) {
  const taken = new Set()
  for (const id of Object.keys(PORTS)) {
    let port = Number(preferred[id]) || PORTS[id]
    while (taken.has(port) || !(await portFree(port))) port++
    taken.add(port)
    ports[id] = port
  }
  updateUrls()
  return { ...ports }
}

// What the dashboard and editor load from /sandbox-config.js.
const configScript = () =>
  `window.__SANDBOX_CONFIG__ = ${JSON.stringify({ apiUrl: URLS.api, cardServerUrl: URLS.card, libraryUrl: URLS.mcp })};\n`

// Source folders, for "Open Folder" (dev and build modes only).
const SOURCES = MODE === 'packaged'
  ? {}
  : {
      api: path.join(PACKAGES, 'sim'),
      web: path.join(PACKAGES, 'sim', 'web'),
      editor: path.join(PACKAGES, 'blockly'),
      card: path.join(PACKAGES, 'card-server'),
      mcp: path.join(PACKAGES, 'blockly', 'mcp'),
    }

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Processes

const children = new Set()
let log = () => {}

// Run a script on the bundled Node. Each child gets its own process group,
// so stopping it also stops anything it started (tsx, next and vite run the
// real server in a child process).
function runNode(name, args, { cwd, env = {} }) {
  const child = spawn(NODE, args, {
    cwd,
    env: {
      ...process.env,
      PATH: `${path.dirname(NODE)}${path.delimiter}${process.env.PATH || '/usr/bin:/bin'}`,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  child.stdout.on('data', d => log(name, d))
  child.stderr.on('data', d => log(name, d))
  child.on('error', error => log(name, `Couldn't start: ${error.message}`))
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

function exitCode(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise(resolve => child.once('exit', code => resolve(code)))
}

function signal(child, sig) {
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, sig)
    else child.kill(sig)
  } catch {
    try {
      child.kill(sig)
    } catch {}
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  const done = exitCode(child)
  signal(child, 'SIGTERM')
  if ((await Promise.race([done, sleep(5000).then(() => 'timeout')])) === 'timeout') {
    signal(child, 'SIGKILL')
    await done
  }
  // The group leader can exit before the server it started; finish them off.
  signal(child, 'SIGKILL')
}

// GET a URL: { status, body } or null when nothing answers.
function get(url) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', d => (body.length < 200_000 ? (body += d) : null))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', () => resolve(null))
    req.setTimeout(1500, () => {
      req.destroy()
      resolve(null)
    })
  })
}

const isApi = res => res?.status === 200 && res.body.includes('"openapi"')
const isHtml = res => res?.status === 200 && /<html/i.test(res.body)
// The dashboard's first page (its `/` only redirects there).
const webHome = () => `${URLS.web}/accounts`
const isCard = res => res?.status === 200 && res.body.includes('Card Code Execution Server')
const isMcp = res => res?.status === 200 && res.body.includes('MCP server')

// The app runs its own copy of every service, so its port must be free.
async function ensurePortFree(url, label) {
  if (await get(url)) {
    throw new Error(`Port ${new URL(url).port} is already in use by another program. Quit it, then restart the ${label}.`)
  }
}

async function waitFor(url, matches, child, label, timeoutMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (matches(await get(url))) return
    if (child && child.exitCode !== null) throw new Error(`${label} exited with code ${child.exitCode}. See Logs for details.`)
    await sleep(400)
  }
  throw new Error(`${label} did not start within ${timeoutMs / 1000}s`)
}

function need(file, hint) {
  if (!fs.existsSync(file)) throw new Error(`${path.relative(__dirname, file) || file} is missing. ${hint}`)
}

function checkReady() {
  if (MODE === 'dev') need(NODE, 'Run `npm install` first.')
  else need(path.join(BUILD, 'manifest.json'), MODE === 'build' ? 'Run `npm run build` first.' : 'This copy of the app is incomplete; reinstall it.')
}

// ---------------------------------------------------------------------------
// Database (packaged and build modes)

const dataDir = () => app.getPath('userData')
// The card code library: projects both editors and AI assistants (through
// the MCP server) share. The MCP server's default when run on its own.
const libraryDir = () => path.join(dataDir(), 'card-code')

// The MCP server's arguments: its port, the library, and the editors as the
// only web pages allowed to call it.
const mcpArgs = () => [
  '--http',
  String(ports.mcp),
  '--library',
  libraryDir(),
  '--editor-url',
  `${URLS.editor}/`,
  '--allow-origin',
  URLS.editor,
  '--allow-origin',
  `http://localhost:${ports.editor}`,
]
const databaseFile = () => path.join(dataDir(), 'sandbox.db')

// First run: start from the seeded template built with the app. After an
// update: apply any Prisma migrations the database hasn't had yet, the way
// `prisma migrate deploy` would, after backing it up.
function prepareDatabase() {
  const file = databaseFile()
  const sim = path.join(BUILD, 'sim')
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.copyFileSync(path.join(sim, 'template.db'), file)
    log('app', `Created the sandbox database with the starter data: ${file}`)
  }
  applyMigrations(file, path.join(sim, 'prisma', 'migrations'))
}

// Apply the migrations in `dir` that the database at `file` hasn't had,
// recording them in Prisma's own table. Returns the names applied.
function applyMigrations(file, dir) {
  const { DatabaseSync } = require('node:sqlite')
  const names = fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, 'migration.sql'))).sort()
  let db = new DatabaseSync(file)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp, "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)`)
    const applied = new Set(
      db.prepare('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').all().map(r => r.migration_name),
    )
    const pending = names.filter(n => !applied.has(n))
    if (!pending.length) return []

    // Back up first: a migration that fails halfway can't be undone.
    db.close()
    fs.copyFileSync(file, `${file}.backup`)
    log('app', `Updating the sandbox database (${pending.length} migration${pending.length > 1 ? 's' : ''}); backup at ${file}.backup`)
    db = new DatabaseSync(file)
    const record = db.prepare(
      'INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)',
    )
    for (const name of pending) {
      const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8')
      const started = Date.now()
      try {
        db.exec(sql)
      } catch (error) {
        throw new Error(`Database migration ${name} failed: ${error.message}. The database before the update is at ${file}.backup.`)
      }
      record.run(crypto.randomUUID(), crypto.createHash('sha256').update(sql).digest('hex'), Date.now(), name, started)
      log('app', `Applied migration ${name}`)
    }
    return pending
  } finally {
    if (db.isOpen) db.close()
  }
}

// ---------------------------------------------------------------------------
// Static files (the built dashboard and card code editor)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.cur': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

const isFile = file => fs.existsSync(file) && fs.statSync(file).isFile()

// Serves a folder on 127.0.0.1. A single-page app (`spa`) gets index.html for
// unknown paths; a static export gets /page.html or /page/index.html, else
// its 404.html. /sandbox-config.js is the live config, not a file.
function serveStatic(root, port, { spa, label }) {
  const server = http.createServer((req, res) => {
    let pathname
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch {
      res.writeHead(400).end()
      return
    }
    if (pathname === '/sandbox-config.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' })
      res.end(configScript())
      return
    }
    const base = path.join(root, path.normalize(pathname))
    if (!base.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    let file = [base, `${base}.html`, path.join(base, 'index.html')].find(isFile)
    let status = 200
    if (!file) {
      file = spa ? path.join(root, 'index.html') : path.join(root, '404.html')
      status = spa ? 200 : 404
    }
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve, reject) => {
    server.once('error', error =>
      reject(error.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use by another program. Quit it, then restart the ${label}.`) : error),
    )
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

// ---------------------------------------------------------------------------
// Starters: each reports progress through status(detail, phase) and resolves
// to { child, extra? } or { server }.

const BUILT = {
  async api(status) {
    checkReady()
    await ensurePortFree(URLS.api, 'API')
    status('Preparing the database…')
    prepareDatabase()
    status('Starting the API…')
    return startApi(port =>
      runNode('api', ['dist/src/index.js'], {
        cwd: path.join(BUILD, 'sim'),
        env: { NODE_ENV: 'production', PORT: String(port), WEB_URL: URLS.web, DATABASE_URL: `file:${databaseFile()}` },
      }),
    )
  },

  async web(status) {
    checkReady()
    status('Starting the dashboard…')
    return { server: await serveStatic(path.join(BUILD, 'web'), ports.web, { spa: false, label: 'dashboard' }) }
  },

  async editor(status) {
    checkReady()
    status('Starting the card code editor…')
    return { server: await serveStatic(path.join(BUILD, 'blockly'), ports.editor, { spa: true, label: 'card editor' }) }
  },

  async card(status) {
    checkReady()
    await ensurePortFree(URLS.card, 'card server')
    status('Starting the card server…')
    const child = runNode('card', ['dist/index.js'], {
      cwd: path.join(BUILD, 'card-server'),
      env: { NODE_ENV: 'production', PORT: String(ports.card) },
    })
    await waitFor(URLS.card, isCard, child, 'The card server', 30_000)
    return { child }
  },

  async mcp(status) {
    checkReady()
    await ensurePortFree(URLS.mcp, 'MCP server')
    status('Starting the MCP server…')
    const child = runNode('mcp', ['investec-blockly-mcp.cjs', ...mcpArgs()], {
      cwd: path.join(BUILD, 'blockly-mcp'),
      env: { NODE_ENV: 'production', SIMULATOR_URL: URLS.card },
    })
    await waitFor(`${URLS.mcp}/`, isMcp, child, 'The MCP server', 30_000)
    return { child }
  },
}

const DEV = {
  async api(status) {
    checkReady()
    await ensurePortFree(URLS.api, 'API')
    status('Starting the API (tsx watch)…')
    const sim = path.join(PACKAGES, 'sim')
    return startApi(port =>
      runNode('api', ['node_modules/tsx/dist/cli.mjs', 'watch', '--clear-screen=false', './src/index.ts', '--tsconfig', './tsconfig.json'], {
        cwd: sim,
        env: { PORT: String(port), WEB_URL: URLS.web, DATABASE_URL: 'file:./dev.db' },
      }),
    )
  },

  async web(status) {
    checkReady()
    await ensurePortFree(URLS.web, 'dashboard')
    status('Starting the dashboard (next dev)…')
    const child = runNode('web', ['node_modules/next/dist/bin/next', 'dev', '--turbopack', '--port', String(ports.web)], {
      cwd: path.join(PACKAGES, 'sim', 'web'),
      env: { NEXT_PUBLIC_API_BASE_URL: URLS.api },
    })
    await waitFor(webHome(), isHtml, child, 'The dashboard')
    return { child }
  },

  async editor(status) {
    checkReady()
    await ensurePortFree(URLS.editor, 'card editor')
    status('Starting the card code editor (vite)…')
    const child = runNode('editor', ['node_modules/vite/bin/vite.js', '--port', String(ports.editor), '--strictPort', '--host', '127.0.0.1'], {
      cwd: path.join(PACKAGES, 'blockly'),
      env: { VITE_SIMULATOR_URL: URLS.card, VITE_LIBRARY_URL: URLS.mcp },
    })
    await waitFor(URLS.editor, isHtml, child, 'The card editor')
    return { child }
  },

  async card(status) {
    checkReady()
    await ensurePortFree(URLS.card, 'card server')
    const dir = path.join(PACKAGES, 'card-server')
    status('Compiling the card server…', 'building')
    const code = await exitCode(runNode('card-build', ['node_modules/typescript/bin/tsc'], { cwd: dir }))
    if (code !== 0) throw new Error(`The card server didn't compile (exit code ${code}). See Logs for details.`)
    status('Starting the card server (tsc --watch)…')
    // Recompile on change, and restart the server when its output changes.
    const watch = runNode('card-build', ['node_modules/typescript/bin/tsc', '--watch', '--preserveWatchOutput'], { cwd: dir })
    const child = runNode('card', ['--watch', '--enable-source-maps', 'dist/index.js'], { cwd: dir, env: { PORT: String(ports.card) } })
    try {
      await waitFor(URLS.card, isCard, child, 'The card server', 30_000)
    } catch (error) {
      await stopChild(watch)
      throw error
    }
    return { child, extra: [watch] }
  },

  async mcp(status) {
    checkReady()
    await ensurePortFree(URLS.mcp, 'MCP server')
    const dir = path.join(PACKAGES, 'blockly')
    const vite = ['node_modules/vite/bin/vite.js', 'build', '--config', 'mcp/vite.config.ts']
    status('Building the MCP server…', 'building')
    const code = await exitCode(runNode('mcp-build', vite, { cwd: dir }))
    if (code !== 0) throw new Error(`The MCP server didn't build (exit code ${code}). See Logs for details.`)
    status('Starting the MCP server (vite build --watch)…')
    // Rebuild on change, and restart the server when the bundle changes.
    const watch = runNode('mcp-build', [...vite, '--watch'], { cwd: dir })
    const child = runNode('mcp', ['--watch', 'mcp/dist/investec-blockly-mcp.cjs', ...mcpArgs()], { cwd: dir, env: { SIMULATOR_URL: URLS.card } })
    try {
      await waitFor(`${URLS.mcp}/`, isMcp, child, 'The MCP server', 30_000)
    } catch (error) {
      await stopChild(watch)
      throw error
    }
    return { child, extra: [watch] }
  },
}

// Where the sandbox's data is, for the log and the Services menu.
const dataLocation = () => (MODE === 'dev' ? path.join(PACKAGES, 'sim', 'prisma', 'dev.db') : databaseFile())

module.exports = {
  MODE,
  resolvePorts,
  ports,
  dataLocation,
  applyMigrations,
  URLS,
  SOURCES,
  STARTERS: MODE === 'dev' ? DEV : BUILT,
  children,
  stopChild,
  signal,
  sleep,
  dataDir,
  libraryDir,
  NODE,
  BUILD,
  setLogger: fn => (log = fn),
}
