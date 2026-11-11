// Merges the latest-mac.yml files the Intel and Apple silicon release builds
// each write into one, so electron-updater finds the right download for
// either processor. Each lists its own files; the merged one lists both.
//
//   node scripts/merge-update-info.mjs out.yml a/latest-mac.yml b/latest-mac.yml
//
// The files are electron-builder's own simple YAML: a `files:` list of
// `- url / sha512 / size` entries, then top-level keys.

import fs from 'node:fs'

const [out, ...inputs] = process.argv.slice(2)
if (!out || inputs.length < 1) {
  console.error('Usage: merge-update-info.mjs <out.yml> <latest-mac.yml>...')
  process.exit(1)
}

function parse(text) {
  const top = []
  const files = []
  let inFiles = false
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    if (line === 'files:') inFiles = true
    else if (inFiles && line.startsWith('  ')) {
      if (line.startsWith('  - ')) files.push([line])
      else files.at(-1).push(line)
    } else {
      inFiles = false
      top.push(line)
    }
  }
  return { top, files }
}

const parsed = inputs.map(file => parse(fs.readFileSync(file, 'utf8')))
const versions = new Set(parsed.map(p => p.top.find(l => l.startsWith('version:'))))
if (versions.size !== 1) throw new Error(`The builds have different versions: ${[...versions].join(', ')}`)

// Every file once; the first build's top-level keys (path, sha512, date).
const seen = new Set()
const files = parsed.flatMap(p => p.files).filter(entry => !seen.has(entry[0]) && seen.add(entry[0]))
const [first] = parsed
const version = first.top.find(l => l.startsWith('version:'))
const rest = first.top.filter(l => l !== version)
fs.writeFileSync(out, [version, 'files:', ...files.flat(), ...rest, ''].join('\n'))
console.log(`Merged ${files.length} files from ${inputs.length} builds into ${out}`)
