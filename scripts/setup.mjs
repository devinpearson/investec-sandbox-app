// Gets the packages ready to build and run (runs after `npm install`):
//   1. downloads the pinned Node.js into vendor/node (checksum verified)
//   2. installs each package's dependencies with it
//   3. creates the sim's development database (packages/sim/prisma/dev.db)

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BLOCKLY, CARD, NODE, NODE_HOME, NODE_VERSION, ROOT, SIM, WEB, WINDOWS, npm, remove, run, step, tool } from './lib.mjs'

const PLATFORMS = { darwin: 'darwin', linux: 'linux', win32: 'win' }

export async function ensureNode() {
  if (fs.existsSync(NODE)) {
    const installed = fs.readFileSync(path.join(NODE_HOME, '.version'), 'utf8').trim()
    if (installed === NODE_VERSION) return
  }
  const platform = PLATFORMS[process.platform]
  if (!platform) throw new Error(`Building on ${process.platform} isn't supported yet (macOS, Linux and Windows are).`)
  const name = `node-v${NODE_VERSION}-${platform}-${process.arch}`
  // Windows builds come as a .zip.
  const file = `${name}${WINDOWS ? '.zip' : '.tar.gz'}`
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`
  step(`Downloading Node.js ${NODE_VERSION} (${process.arch})`)

  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text()
  const expected = sums.split('\n').find(line => line.endsWith(`  ${file}`))?.split(' ')[0]
  if (!expected) throw new Error(`No checksum for ${file}`)
  const response = await fetch(`${base}/${file}`)
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  const archive = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== expected) throw new Error(`Checksum mismatch for ${file}`)

  // Unpack into a fresh folder, then move it into place.
  const vendor = path.dirname(NODE_HOME)
  const tmp = path.join(vendor, `.download-${process.pid}`)
  remove(tmp)
  fs.mkdirSync(tmp, { recursive: true })
  const download = path.join(tmp, file)
  fs.writeFileSync(download, archive)
  // Windows' own tar (bsdtar) reads .zip files; Git's GNU tar, often first on PATH, doesn't.
  const tar = WINDOWS ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  run(tar, ['-xf', download, '-C', tmp])
  remove(NODE_HOME)
  fs.renameSync(path.join(tmp, name), NODE_HOME)
  fs.writeFileSync(path.join(NODE_HOME, '.version'), NODE_VERSION)
  remove(tmp)
}

// npm ci when node_modules wasn't installed from this lockfile with this
// Node.js. It's the lockfile's content that counts, not its date: a fresh
// checkout or a restored CI cache gives the files new dates.
const INSTALLED = '.sandbox-installed'
function install(dir) {
  const lock = path.join(dir, 'package-lock.json')
  const marker = path.join(dir, 'node_modules', INSTALLED)
  const wanted = createHash('sha256').update(NODE_VERSION).update(fs.readFileSync(lock)).digest('hex')
  let current = fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === wanted
  // Installs from before the marker: trust them if they're newer than the lockfile.
  const npmMarker = path.join(dir, 'node_modules', '.package-lock.json')
  if (!fs.existsSync(marker) && fs.existsSync(npmMarker) && fs.statSync(npmMarker).mtimeMs >= fs.statSync(lock).mtimeMs) current = true
  if (!current || process.env.SANDBOX_REINSTALL) {
    step(`Installing ${path.relative(ROOT, dir)}`)
    npm(['ci', '--no-audit', '--no-fund'], { cwd: dir })
  }
  fs.writeFileSync(marker, `${wanted}\n`)
}

// `prisma db seed` runs the sim's seed command (tsx) through a shell.
export const seedPath = () =>
  [path.join(SIM, 'node_modules', '.bin'), path.dirname(NODE), process.env.PATH].join(path.delimiter)

export async function setup() {
  await ensureNode()
  for (const dir of [SIM, WEB, BLOCKLY, CARD]) install(dir)

  tool(SIM, 'prisma/build/index.js', ['generate'])
  if (!fs.existsSync(path.join(SIM, 'prisma', 'dev.db'))) {
    step('Creating the development database')
    const env = { DATABASE_URL: 'file:./dev.db', PATH: seedPath() }
    tool(SIM, 'prisma/build/index.js', ['migrate', 'deploy'], { env })
    tool(SIM, 'prisma/build/index.js', ['db', 'seed'], { env })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  setup().then(
    () => console.log('\nReady. `npm run dev` runs everything from source; `npm run build` builds it.'),
    error => {
      console.error(`\nSetup failed: ${error.message}`)
      process.exit(1)
    },
  )
}
