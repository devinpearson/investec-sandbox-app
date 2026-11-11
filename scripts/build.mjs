// Builds every package into build/, which the app runs and packaging ships:
//
//   build/node/bin/node    the pinned Node.js the services run on (stripped;
//                          build/node/node.exe on Windows)
//   build/sim/             the API: compiled JS, production node_modules,
//                          Prisma migrations and a seeded template.db
//   build/web/             the dashboard's static files
//   build/blockly/         the card code editors' static files
//   build/blockly-mcp/     the MCP server for card code (one script + jsdom)
//   build/card-server/     the card server: compiled JS, production node_modules
//   build/manifest.json    versions and when it was built
//
// The parts build side by side, and a part whose inputs haven't changed since
// the last build is skipped (build/.stamps). `npm run build -- --clean`
// rebuilds everything.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { setup, seedPath } from './setup.mjs'
import {
  API_URL, BLOCKLY, BUILD, CARD, CARD_URL, NODE, NODE_HOME, NODE_VERSION, PORTS, ROOT, SIM, WEB, WINDOWS, copy, nodeBin, npmAsync, remove, run, runAsync, step, toolAsync,
} from './lib.mjs'

const PRISMA = 'prisma/build/index.js'
const TSC = 'typescript/bin/tsc'
const CLEAN = process.argv.includes('--clean')
const STAMPS = path.join(BUILD, '.stamps')
// Bump to invalidate every stamp when this script changes what it produces.
const BUILD_FORMAT = 3

// ---------------------------------------------------------------------------
// Change detection: a part is rebuilt when any of its inputs changed.

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.next-build', '.next-export', '.next-e2e', 'test-results', 'playwright-report', 'coverage'])

function signature(root, inputs, extra) {
  const hash = createHash('sha256').update(JSON.stringify({ BUILD_FORMAT, NODE_VERSION, PORTS, extra }))
  const walk = target => {
    if (!fs.existsSync(target)) return
    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target).sort()) if (!SKIP_DIRS.has(name) && !name.endsWith('.db') && !name.endsWith('.db-journal')) walk(path.join(target, name))
    } else hash.update(`${path.relative(ROOT, target)}:${stat.size}:${stat.mtimeMs}\n`)
  }
  for (const input of inputs) walk(path.join(root, input))
  return hash.digest('hex')
}

async function part(name, outputs, root, inputs, build, extra) {
  const stampFile = path.join(STAMPS, `${name}.json`)
  const key = signature(root, inputs, extra)
  const started = Date.now()
  let stamp = null
  try {
    stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'))
  } catch {}
  if (!CLEAN && stamp?.key === key && outputs.every(o => fs.existsSync(path.join(BUILD, o)))) {
    console.log(`\u001b[2m[${name}]\u001b[0m unchanged, kept from the last build`)
    return { name, seconds: 0, skipped: true }
  }
  for (const o of outputs) remove(path.join(BUILD, o))
  await build()
  fs.mkdirSync(STAMPS, { recursive: true })
  fs.writeFileSync(stampFile, JSON.stringify({ key, built: new Date().toISOString() }))
  return { name, seconds: Math.round((Date.now() - started) / 100) / 10, skipped: false }
}

// ---------------------------------------------------------------------------
// Production dependencies

// Production dependencies only: no dev or peer dependencies (peers pull in
// e.g. the Prisma CLI) and no install scripts. Anything those would have
// built or generated (Prisma's client, native addons) is copied from the
// full development install, which was built with the same Node.
async function productionModules(label, pkgDir, stageDir, { copyFromDev = [] } = {}) {
  for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(pkgDir, file), path.join(stageDir, file))
  await npmAsync(label, ['ci', '--omit=dev', '--omit=peer', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: stageDir })
  for (const rel of copyFromDev) {
    const from = path.join(pkgDir, 'node_modules', rel)
    if (fs.existsSync(from)) copy(from, path.join(stageDir, 'node_modules', rel))
  }
  fs.rmSync(path.join(stageDir, 'package-lock.json'))
}

// What a production install carries but never runs: docs, type
// declarations, source maps, tests and examples. LICENSE files stay, and
// so does code that happens to share a name (jsdom's History.js).
const JUNK_FILES = /\.(md|markdown|map|d\.ts|d\.mts|d\.cts|tsbuildinfo|tgz)$|^(CHANGELOG|HISTORY|CHANGES|README)(\.(md|markdown|txt|rst))?$/i
const JUNK_DIRS = new Set(['test', 'tests', '__tests__', 'docs', 'doc', 'example', 'examples', '.github', 'benchmark', 'benchmarks', 'coverage'])

function prune(nodeModules, extra = []) {
  let bytes = 0
  const size = p => {
    let total = 0
    const walk = t => {
      const s = fs.lstatSync(t)
      if (s.isDirectory()) for (const n of fs.readdirSync(t)) walk(path.join(t, n))
      else total += s.size
    }
    walk(p)
    return total
  }
  const drop = p => {
    if (!fs.existsSync(p)) return
    bytes += size(p)
    remove(p)
  }
  for (const rel of extra) {
    // A trailing /*.ext removes those files in that folder.
    const match = rel.match(/^(.*)\/\*(\.[\w.]+)$/)
    if (match) {
      const dir = path.join(nodeModules, match[1])
      if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) if (n.endsWith(match[2])) drop(path.join(dir, n))
    } else drop(path.join(nodeModules, rel))
  }
  const walk = (dir, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      // A link to something pruned (node_modules/.bin/tsc once typescript
      // goes) breaks code signing, which reads every file in the app.
      if (entry.isSymbolicLink() && !fs.existsSync(full)) remove(full)
      else if (entry.isDirectory()) {
        // Test/doc folders only at a package's top level, where they're never runtime code.
        if (depth === 0 && JUNK_DIRS.has(entry.name)) drop(full)
        else walk(full, entry.name === 'node_modules' || entry.name.startsWith('@') ? -1 : depth + 1)
      } else if (JUNK_FILES.test(entry.name)) drop(full)
    }
  }
  // depth -1: a folder of packages; 0: a package's own folder.
  walk(nodeModules, -1)
  return Math.round(bytes / 1e6)
}

// ---------------------------------------------------------------------------
// The parts

const buildApi = () =>
  part(
    'api',
    ['sim'],
    SIM,
    ['src', 'prisma', 'package.json', 'package-lock.json', 'tsconfig.json'],
    async () => {
      const out = path.join(BUILD, 'sim')
      remove(path.join(SIM, 'dist'))
      await toolAsync('api', SIM, PRISMA, ['generate'])
      await toolAsync('api', SIM, TSC, ['-p', 'tsconfig.json'])
      fs.mkdirSync(out, { recursive: true })
      copy(path.join(SIM, 'dist'), path.join(out, 'dist'))
      copy(path.join(SIM, 'prisma', 'migrations'), path.join(out, 'prisma', 'migrations'))
      fs.copyFileSync(path.join(SIM, 'prisma', 'schema.prisma'), path.join(out, 'prisma', 'schema.prisma'))
      await productionModules('api', SIM, out, { copyFromDev: ['.prisma'] })
      // TypeScript and type packages are listed as dependencies but only used
      // to compile; Prisma's WebAssembly engines are for driver adapters.
      const saved = prune(path.join(out, 'node_modules'), ['typescript', '@types', '@prisma/client/runtime/*.wasm', '.prisma/client/deno'])
      console.log(`[api] pruned ${saved} MB`)
      // A seeded starter database, for a sandbox's first run.
      // Forward slashes: Prisma reads the URL the same way on Windows.
      const env = { DATABASE_URL: `file:${path.join(out, 'template.db').replaceAll('\\', '/')}`, PATH: seedPath(), REFERENCE_RATES: 'off' }
      await toolAsync('api', SIM, PRISMA, ['migrate', 'deploy'], { env })
      await toolAsync('api', SIM, PRISMA, ['db', 'seed'], { env })
    },
  )

// Static files (a Next.js static export), served by the app itself. The API's
// address is only a fallback: the app serves the real one at runtime.
const buildWeb = () =>
  part(
    'web',
    ['web'],
    WEB,
    ['app', 'components', 'hooks', 'lib', 'public', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json', 'package.json', 'package-lock.json'],
    async () => {
      // With a custom distDir, the export is written there (not to out/).
      const dist = path.join(WEB, '.next-export')
      remove(dist)
      await toolAsync('web', WEB, 'next/dist/bin/next', ['build', '--turbopack'], {
        env: { NEXT_OUTPUT: 'export', NEXT_DIST_DIR: '.next-export', NEXT_PUBLIC_API_BASE_URL: API_URL },
      })
      if (!fs.existsSync(path.join(dist, 'accounts.html'))) throw new Error('The dashboard export has no accounts.html')
      copy(dist, path.join(BUILD, 'web'), src => !src.includes(`${path.sep}cache${path.sep}`) && !src.endsWith(`${path.sep}cache`))
    },
  )

const buildBlockly = () =>
  part(
    'editor',
    ['blockly', 'blockly-mcp'],
    BLOCKLY,
    ['src', 'mcp/src', 'mcp/vite.config.ts', 'public', 'index.html', 'code.html', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'tsconfig.json', 'package.json', 'package-lock.json'],
    async () => {
      remove(path.join(BLOCKLY, 'dist'))
      await npmAsync('editor', ['run', 'build'], { cwd: BLOCKLY, env: { VITE_SIMULATOR_URL: CARD_URL } })
      copy(path.join(BLOCKLY, 'dist'), path.join(BUILD, 'blockly'))
      // The MCP server: one bundled script, plus jsdom, which Blockly's Node
      // build loads for its XML helpers.
      await npmAsync('editor', ['run', 'build:mcp'], { cwd: BLOCKLY })
      const mcp = path.join(BUILD, 'blockly-mcp')
      fs.mkdirSync(mcp, { recursive: true })
      fs.copyFileSync(path.join(BLOCKLY, 'mcp', 'dist', 'investec-blockly-mcp.cjs'), path.join(mcp, 'investec-blockly-mcp.cjs'))
      const jsdom = JSON.parse(fs.readFileSync(path.join(BLOCKLY, 'node_modules', 'jsdom', 'package.json'), 'utf8')).version
      fs.writeFileSync(path.join(mcp, 'package.json'), JSON.stringify({ private: true, dependencies: { jsdom } }, null, 2))
      await npmAsync('editor', ['install', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'], { cwd: mcp })
      console.log(`[editor] pruned ${prune(path.join(mcp, 'node_modules'))} MB from the MCP server's modules`)
    },
  )

const buildCardServer = () =>
  part(
    'card',
    ['card-server'],
    CARD,
    ['src', 'tsconfig.json', 'package.json', 'package-lock.json'],
    async () => {
      await npmAsync('card', ['run', 'build'], { cwd: CARD })
      const out = path.join(BUILD, 'card-server')
      fs.mkdirSync(out, { recursive: true })
      copy(path.join(CARD, 'dist'), path.join(out, 'dist'), src => !/\.test\.js(\.map)?$/.test(src))
      // isolated-vm is a native addon: compiled during the development
      // install, or, where the package ships one (Windows x64, Apple
      // silicon), its prebuilt addon is used instead.
      const ivm = 'isolated-vm'
      const compiled = fs.existsSync(path.join(CARD, 'node_modules', ivm, 'build', 'Release', 'isolated_vm.node'))
      await productionModules('card', CARD, out, { copyFromDev: ['isolated-vm/build/Release/isolated_vm.node'] })
      // Its loader prefers a compiled addon. Prebuilt ones for other
      // platforms, its sources and the copy of its own package aren't needed.
      const prebuilds = path.join(out, 'node_modules', ivm, 'prebuilds')
      const keep = compiled ? null : `${process.platform}-${process.arch}`
      if (!compiled && !fs.existsSync(path.join(prebuilds, keep))) throw new Error(`isolated-vm has neither a compiled addon nor a prebuilt one for ${keep}`)
      const otherPrebuilds = fs.existsSync(prebuilds) ? fs.readdirSync(prebuilds).filter(name => name !== keep).map(name => `${ivm}/prebuilds/${name}`) : []
      const saved = prune(path.join(out, 'node_modules'), [
        ...otherPrebuilds,
        ...['src', 'vendor', 'native-example', 'scripts', 'Dockerfile.alpine', 'Dockerfile.debian', 'inspector-example.js', 'binding.gyp'].map(f => `${ivm}/${f}`),
        `${ivm}/*.tgz`,
      ])
      console.log(`[card] pruned ${saved} MB`)
    },
  )

// Node without its debug symbols (about 20 MB smaller). Stripping breaks
// its signature, so it's re-signed ad hoc, which Apple silicon requires; a
// signed release build signs it properly.
const bundleNode = () =>
  part('node', ['node'], ROOT, ['config.js'], async () => {
    const out = path.join(BUILD, 'node')
    const bin = nodeBin(out)
    fs.mkdirSync(path.dirname(bin), { recursive: true })
    fs.copyFileSync(NODE, bin)
    fs.chmodSync(bin, 0o755)
    fs.copyFileSync(path.join(NODE_HOME, 'LICENSE'), path.join(out, 'LICENSE'))
    if (process.platform === 'darwin') {
      await runAsync('node', 'strip', ['-x', bin]).catch(error => console.log(`[node] not stripped: ${error.message}`))
      await runAsync('node', 'codesign', ['--force', '--sign', '-', bin])
    }
    await runAsync('node', bin, ['-e', 'process.exit(0)'])
  }, NODE_VERSION)

async function main() {
  const started = Date.now()
  await setup()
  if (CLEAN) remove(BUILD)
  fs.mkdirSync(BUILD, { recursive: true })

  step(`Building${CLEAN ? ' everything' : ''} (parts that haven't changed are kept)`)
  // Side by side; the packages don't depend on each other.
  const results = await Promise.all([buildApi(), buildWeb(), buildBlockly(), buildCardServer(), bundleNode()])

  const version = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', name, 'package.json'), 'utf8')).version
  fs.writeFileSync(
    path.join(BUILD, 'manifest.json'),
    JSON.stringify(
      {
        built: new Date().toISOString(),
        node: NODE_VERSION,
        packages: { sim: version('sim'), blockly: version('blockly'), 'card-server': version('card-server') },
      },
      null,
      2,
    ),
  )
  step('Summary')
  for (const r of results) console.log(`  ${r.name.padEnd(8)} ${r.skipped ? 'unchanged' : `${r.seconds}s`}`)
  if (!WINDOWS) run('du', ['-sh', ...['node', 'sim', 'web', 'blockly', 'blockly-mcp', 'card-server'].map(d => path.join(BUILD, d))])
  console.log(`\nBuilt into build/ in ${Math.round((Date.now() - started) / 1000)}s.`)
}

main().catch(error => {
  console.error(`\nBuild failed: ${error.message}`)
  process.exit(1)
})
