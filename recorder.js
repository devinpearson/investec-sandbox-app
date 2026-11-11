// The request inspector's recorder. The API's address is served by a small
// pass-through proxy in this process, which hands every request to the real
// API (on a private port) unchanged and keeps a copy of what went over the
// wire: both sets of headers, both bodies, the status and the time taken.
// The API itself is untouched, so what's recorded is exactly what a client
// sent and received, including injected faults and dropped connections.

const http = require('node:http')
const net = require('node:net')

const MAX_RECORDS = 300
// Bodies are kept up to this size; the rest is passed on but not recorded.
const MAX_BODY = 256 * 1024

const records = []
let seq = 0
const listeners = new Set()

// Not worth recording: the app's own status checks, and the dashboard's
// live-update socket.
const skipped = req => (req.headers['user-agent'] || '').includes('InvestecSandbox-StatusCheck') || req.url.startsWith('/socket.io/')

// Who sent it: the app's own pages and menus, or anything else (your code).
// The API reference and Quick start send requests you asked for, so they
// count as yours.
function clientOf(headers) {
  const agent = String(headers['user-agent'] || '')
  if (agent.includes('InvestecSandbox-ApiReference')) return { name: 'API reference', own: false, external: false }
  if (agent.includes('InvestecSandbox-Guide')) return { name: 'Quick start', own: false, external: false }
  if (agent.includes('InvestecSandbox-Replay')) return { name: 'Replay', own: false, external: false }
  if (agent.includes('InvestecSandbox')) return { name: 'Investec Sandbox', own: true, external: false }
  // "curl/8.7.1" → curl, "python-requests/2.32" → python-requests.
  const name = agent.startsWith('Mozilla/') ? 'Browser' : agent.split(/[\s/]/)[0] || 'Unknown client'
  return { name, own: false, external: true }
}

// Collects a stream's bytes up to MAX_BODY.
function collector() {
  const chunks = []
  let kept = 0
  let size = 0
  return {
    add(chunk) {
      size += chunk.length
      if (kept < MAX_BODY) {
        const part = chunk.subarray(0, MAX_BODY - kept)
        chunks.push(part)
        kept += part.length
      }
    },
    result: () => ({ text: Buffer.concat(chunks).toString('utf8'), size, truncated: size > kept }),
  }
}

// Header pairs in the order and spelling they were sent.
const pairs = raw => {
  const list = []
  for (let i = 0; i < raw.length; i += 2) list.push([raw[i], raw[i + 1]])
  return list
}

function finish(record) {
  record.durationMs = Date.now() - record.time
  records.push(record)
  if (records.length > MAX_RECORDS) records.shift()
  for (const listener of listeners) {
    try {
      listener(record)
    } catch {}
  }
}

const summary = r => ({
  id: r.id,
  time: r.time,
  method: r.method,
  path: r.path,
  status: r.status,
  error: r.error,
  durationMs: r.durationMs,
  size: r.response?.size ?? 0,
  client: r.client.name,
  own: r.client.own,
  fault: r.fault,
})

// A server on `port` that forwards everything to the API on `targetPort`.
function createProxy(port, targetPort) {
  const agent = new http.Agent({ keepAlive: true })
  const server = http.createServer((req, res) => {
    const record = skipped(req)
      ? null
      : {
          id: ++seq,
          time: Date.now(),
          method: req.method,
          path: req.url,
          client: clientOf(req.headers),
          request: { headers: pairs(req.rawHeaders) },
          status: 0,
          error: null,
          fault: null,
          response: null,
        }
    const sent = collector()
    const received = collector()
    let done = false
    const end = error => {
      if (done) return
      done = true
      if (!record) return
      Object.assign(record.request, sent.result())
      if (error) record.error = error
      if (record.response) Object.assign(record.response, received.result())
      finish(record)
    }

    const upstream = http.request({ host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers: req.headers, agent }, upstreamRes => {
      if (record) {
        record.status = upstreamRes.statusCode
        record.response = { statusText: upstreamRes.statusMessage, headers: pairs(upstreamRes.rawHeaders) }
        record.fault = upstreamRes.headers['x-sandbox-fault-injected'] ? `Injected ${upstreamRes.headers['x-sandbox-fault-injected']}` : null
      }
      res.writeHead(upstreamRes.statusCode, upstreamRes.statusMessage, upstreamRes.rawHeaders)
      upstreamRes.on('data', chunk => {
        received.add(chunk)
        res.write(chunk)
      })
      upstreamRes.on('end', () => {
        res.end()
        end(null)
      })
      // The API dropped the connection part-way through its answer.
      upstreamRes.on('error', () => {
        res.destroy()
        end('The connection was dropped while the response was being sent')
      })
    })
    upstream.on('error', error => {
      // No answer at all: a timeout or reset fault drops the connection, and
      // so does the API being down. The client sees the same thing.
      if (error.code === 'ECONNREFUSED') {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ errorMessage: 'The sandbox API is not running' }))
        if (record) record.status = 502
        end('The API is not running')
      } else {
        req.socket.destroy()
        end('The connection was dropped without a response')
      }
    })
    req.on('data', chunk => {
      sent.add(chunk)
      upstream.write(chunk)
    })
    req.on('end', () => upstream.end())
    // The client gave up first.
    res.on('close', () => {
      if (!res.writableEnded) {
        upstream.destroy()
        end('The client closed the connection before the response')
      }
    })
  })

  // WebSockets (the dashboard's live updates): joined straight through.
  server.on('upgrade', (req, socket, head) => {
    const target = net.connect(targetPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
      target.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head?.length) target.write(head)
      socket.pipe(target)
      target.pipe(socket)
    })
    target.on('error', () => socket.destroy())
    socket.on('error', () => target.destroy())
  })

  return new Promise((resolve, reject) => {
    server.once('error', error =>
      reject(error.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use by another program. Quit it, then restart the API.`) : error),
    )
    server.listen(port, () => {
      server.on('close', () => agent.destroy())
      resolve(server)
    })
  })
}

module.exports = {
  createProxy,
  listRequests: () => records.map(summary),
  getRequest: id => records.find(r => r.id === Number(id)) ?? null,
  clearRequests: () => void (records.length = 0),
  onRequest: listener => listeners.add(listener),
  summary,
}
