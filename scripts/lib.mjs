// Helpers shared by setup.mjs and build.mjs.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const { NODE_VERSION, PORTS } = require('../config.js')

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const PACKAGES = path.join(ROOT, 'packages')
export const SIM = path.join(PACKAGES, 'sim')
export const WEB = path.join(SIM, 'web')
export const BLOCKLY = path.join(PACKAGES, 'blockly')
export const CARD = path.join(PACKAGES, 'card-server')
export const BUILD = path.join(ROOT, 'build')

export const WINDOWS = process.platform === 'win32'

// Where a Node.js folder keeps its executable: bin/node, or node.exe at the
// top on Windows (as nodejs.org ships them).
export const nodeBin = home => (WINDOWS ? path.join(home, 'node.exe') : path.join(home, 'bin', 'node'))

// The pinned Node.js, downloaded by setup.mjs.
export const NODE_HOME = path.join(ROOT, 'vendor', 'node')
export const NODE = nodeBin(NODE_HOME)
const NPM_CLI = path.join(NODE_HOME, ...(WINDOWS ? [] : ['lib']), 'node_modules', 'npm', 'bin', 'npm-cli.js')

export const API_URL = `http://localhost:${PORTS.api}`
export const CARD_URL = `http://localhost:${PORTS.card}`

// Put the pinned Node first on PATH, so package scripts and native builds
// (node-gyp) use it rather than whatever Node is installed.
export function env(extra = {}) {
  // Windows spells it Path; a second PATH key would leave which one wins to chance.
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'))
  return {
    ...base,
    PATH: `${path.dirname(NODE)}${path.delimiter}${process.env.PATH}`,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    NEXT_TELEMETRY_DISABLED: '1',
    ...extra,
  }
}

export function step(text) {
  console.log(`\n\u001b[1m▸ ${text}\u001b[0m`)
}

export function run(command, args, { cwd = ROOT, env: extra } = {}) {
  const result = spawnSync(command, args, { cwd, env: env(extra), stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(' ')} failed in ${path.relative(ROOT, cwd) || '.'} (exit code ${result.status})`)
  }
}

// Run a package's own tool from its node_modules with the pinned Node.
export function tool(pkgDir, script, args, opts = {}) {
  run(NODE, [path.join(pkgDir, 'node_modules', script), ...args], { cwd: pkgDir, ...opts })
}

export function npm(args, opts) {
  run(NODE, [NPM_CLI, ...args], opts)
}

export function copy(from, to, filter) {
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true, filter })
}

export function remove(target) {
  fs.rmSync(target, { recursive: true, force: true })
}

// Async versions, for building packages side by side: output lines are
// prefixed with a label so the interleaved logs stay readable.
export function runAsync(label, command, args, { cwd = ROOT, env: extra } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] })
    const tail = []
    const prefix = stream => {
      let buffer = ''
      stream.on('data', chunk => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          tail.push(line)
          if (tail.length > 40) tail.shift()
          process.stdout.write(`\u001b[2m[${label}]\u001b[0m ${line}\n`)
        }
      })
    }
    prefix(child.stdout)
    prefix(child.stderr)
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`${label}: ${path.basename(command)} ${args.join(' ')} failed (exit code ${code})`))
    })
  })
}

export function toolAsync(label, pkgDir, script, args, opts = {}) {
  return runAsync(label, NODE, [path.join(pkgDir, 'node_modules', script), ...args], { cwd: pkgDir, ...opts })
}

export function npmAsync(label, args, opts) {
  return runAsync(label, NODE, [NPM_CLI, ...args], opts)
}
