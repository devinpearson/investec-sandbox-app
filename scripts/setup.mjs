// Gets the packages ready to build and run (runs after `npm install`):
//   1. downloads the pinned Node.js into vendor/node (checksum verified)
//   2. installs each package's dependencies with it
//   3. creates the sim's development database (packages/sim/prisma/dev.db)

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BLOCKLY, CARD, NODE, NODE_HOME, NODE_VERSION, ROOT, SIM, WEB, npm, remove, run, step, tool } from './lib.mjs'

const PLATFORMS = { darwin: 'darwin', linux: 'linux' }

export async function ensureNode() {
  if (fs.existsSync(NODE)) {
    const installed = fs.readFileSync(path.join(NODE_HOME, '.version'), 'utf8').trim()
    if (installed === NODE_VERSION) return
  }
  const platform = PLATFORMS[process.platform]
  if (!platform) throw new Error(`Building on ${process.platform} isn't supported yet (macOS and Linux are).`)
  const name = `node-v${NODE_VERSION}-${platform}-${process.arch}`
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`
  step(`Downloading Node.js ${NODE_VERSION} (${process.arch})`)

  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text()
  const expected = sums.split('\n').find(line => line.endsWith(`  ${name}.tar.gz`))?.split(' ')[0]
  if (!expected) throw new Error(`No checksum for ${name}.tar.gz`)
  const response = await fetch(`${base}/${name}.tar.gz`)
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  const archive = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== expected) throw new Error(`Checksum mismatch for ${name}.tar.gz`)

  // Unpack into a fresh folder, then move it into place.
  const vendor = path.dirname(NODE_HOME)
  const tmp = path.join(vendor, `.download-${process.pid}`)
  remove(tmp)
  fs.mkdirSync(tmp, { recursive: true })
  const tarball = path.join(tmp, `${name}.tar.gz`)
  fs.writeFileSync(tarball, archive)
  run('tar', ['-xzf', tarball, '-C', tmp])
  remove(NODE_HOME)
  fs.renameSync(path.join(tmp, name), NODE_HOME)
  fs.writeFileSync(path.join(NODE_HOME, '.version'), NODE_VERSION)
  remove(tmp)
}

// npm ci when node_modules is missing or older than the lockfile.
function install(dir) {
  const lock = path.join(dir, 'package-lock.json')
  const marker = path.join(dir, 'node_modules', '.package-lock.json')
  const current = fs.existsSync(marker) && fs.statSync(marker).mtimeMs >= fs.statSync(lock).mtimeMs
  if (current && !process.env.SANDBOX_REINSTALL) return
  step(`Installing ${path.relative(ROOT, dir)}`)
  npm(['ci', '--no-audit', '--no-fund'], { cwd: dir })
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
