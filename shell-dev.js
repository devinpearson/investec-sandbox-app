// Two of the shell's own pages, drawn like the API reference:
//   Requests     every call the API received, with what was sent and what
//                came back, Replay and Copy as curl
//   Quick start  the first three calls, in a few languages, with this
//                sandbox's details filled in and a tick when each arrives

window.RequestsPage = (() => {
  let items = [] // summaries, oldest first
  let selected = null
  let filter = ''
  let showOwn = false
  let root = null
  let ui = null
  let apiUrl = ''
  let subscribed = false

  const time = t => new Date(t).toLocaleTimeString([], { hour12: false })
  const statusClass = r => `http-status s${r.status ? String(r.status)[0] : 0}xx`
  const size = n => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
  const visible = () => {
    const q = filter.trim().toLowerCase()
    return items.filter(r => (showOwn || !r.own) && (!q || `${r.method} ${r.path} ${r.status} ${r.client}`.toLowerCase().includes(q)))
  }

  function pretty(text, headers) {
    const type = (headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '').toLowerCase()
    if (type.includes('json') || /^\s*[[{]/.test(text)) {
      try {
        return JSON.stringify(JSON.parse(text), null, 2)
      } catch {}
    }
    return text
  }

  const quote = s => `'${String(s).replace(/'/g, `'\\''`)}'`
  function asCurl(r) {
    const dropped = new Set(['host', 'content-length', 'connection', 'accept-encoding'])
    const parts = [`curl -X ${r.method} ${quote(apiUrl + r.path)}`]
    for (const [name, value] of r.request.headers) if (!dropped.has(name.toLowerCase())) parts.push(`-H ${quote(`${name}: ${value}`)}`)
    if (r.request.text) parts.push(`--data-raw ${quote(r.request.text)}`)
    return parts.join(' \\\n  ')
  }

  function renderList() {
    if (!root?.isConnected) return
    const { el, esc } = ui
    const list = root.querySelector('.rq-rows')
    const shown = visible()
    const hidden = items.length - items.filter(r => showOwn || !r.own).length
    root.querySelector('.rq-count').textContent = `${shown.length} request${shown.length === 1 ? '' : 's'}${hidden ? ` · ${hidden} from the app hidden` : ''}`
    list.innerHTML = ''
    if (!shown.length) {
      list.append(
        el(
          'div',
          { className: 'rq-empty' },
          items.length
            ? 'Nothing matches.'
            : `<strong>No requests yet</strong><span>Call the API from your code, Postman or a terminal and it appears here, with everything that was sent and returned.</span><code>curl ${esc(apiUrl)}/za/pb/v1/accounts</code>`,
        ),
      )
      return
    }
    // Newest first.
    for (const r of shown.slice().reverse()) {
      const row = el(
        'button',
        { className: `rq-row${r.id === selected ? ' selected' : ''}`, type: 'button' },
        `<span class="${statusClass(r)}">${r.status || '✕'}</span>` +
          `<span class="method m-${r.method.toLowerCase()}">${esc(r.method)}</span>` +
          `<span class="rq-path" title="${esc(r.path)}">${esc(r.path)}</span>` +
          `<span class="rq-meta">${esc(r.client)}</span>` +
          `<span class="rq-meta rq-time">${time(r.time)}</span>`,
      )
      row.addEventListener('click', () => select(r.id))
      list.append(row)
    }
  }

  function headerTable(headers) {
    const { el } = ui
    const table = el('div', { className: 'rq-headers' })
    for (const [name, value] of headers) table.append(el('span', { className: 'rq-hname', textContent: name }), el('span', { className: 'rq-hvalue', textContent: value }))
    return table
  }

  function bodyBlock(part, headers) {
    const { el } = ui
    if (!part.size) return el('p', { className: 'muted small', textContent: 'No body.' })
    const wrap = el('div')
    wrap.append(el('pre', { className: 'resp-body', textContent: pretty(part.text, headers) }))
    if (part.truncated) wrap.append(el('p', { className: 'muted small', textContent: `Showing the first 256 kB of ${size(part.size)}.` }))
    return wrap
  }

  async function renderDetail() {
    if (!root?.isConnected) return
    const { el, esc } = ui
    const pane = root.querySelector('.rq-detail')
    if (selected === null) {
      pane.innerHTML = '<div class="rq-none">Select a request to see what was sent and what came back.</div>'
      return
    }
    const id = selected
    const r = await ui.api.request(id)
    if (selected !== id || !root?.isConnected) return
    pane.innerHTML = ''
    if (!r) {
      pane.innerHTML = '<div class="rq-none">That request is no longer in the list (only the last 300 are kept).</div>'
      return
    }
    const head = el('div', { className: 'rq-head' })
    head.append(
      el('div', { className: 'ep-line' }, `<span class="method m-${r.method.toLowerCase()}">${esc(r.method)}</span><code>${esc(r.path)}</code>`),
      el(
        'div',
        { className: 'resp-head' },
        `<span class="${statusClass(r)}">${r.status || 'No response'}</span><span>${esc(r.response?.statusText || '')}</span>` +
          `<span class="muted">${r.durationMs} ms</span><span class="muted">${time(r.time)}</span><span class="muted">from ${esc(r.client.name)}</span>` +
          (r.fault ? `<span class="pill warn">${esc(r.fault)} (fault injection)</span>` : ''),
      ),
    )
    if (r.error) head.append(el('p', { className: 'rq-error', textContent: `${r.error}.` }))

    const actions = el('div', { className: 'send-row' })
    const replay = el('button', { className: 'btn primary', type: 'button', textContent: 'Send Again' })
    const curl = el('button', { className: 'btn', type: 'button', textContent: 'Copy as curl' })
    const note = el('span', { className: 'muted small', role: 'status' })
    replay.addEventListener('click', async () => {
      replay.disabled = true
      note.textContent = ''
      const before = items.at(-1)?.id ?? 0
      const result = await ui.api.replayRequest(r.id)
      replay.disabled = false
      if (!result?.ok) {
        note.textContent = result?.error || 'It couldn’t be sent.'
        return
      }
      // Show the new one (it has arrived by now, or will in a moment).
      setTimeout(() => {
        const sent = items.filter(i => i.id > before && i.client === 'Replay').at(-1)
        if (sent) select(sent.id)
      }, 120)
    })
    curl.addEventListener('click', () => {
      ui.api.copy(asCurl(r))
      curl.textContent = 'Copied'
      setTimeout(() => (curl.textContent = 'Copy as curl'), 1200)
    })
    actions.append(replay, curl, note)
    head.append(actions)
    pane.append(head)

    const section = (title, ...children) => {
      const box = el('section', { className: 'rq-section' })
      box.append(el('h3', { textContent: title }), ...children)
      return box
    }
    pane.append(section('Request headers', headerTable(r.request.headers)), section('Request body', bodyBlock(r.request, r.request.headers)))
    if (r.response) pane.append(section('Response headers', headerTable(r.response.headers)), section('Response body', bodyBlock(r.response, r.response.headers)))
  }

  function select(id) {
    selected = id
    renderList()
    void renderDetail()
  }

  function build(api, helpers) {
    ui = { api, ...helpers }
    const { el } = ui
    if (!subscribed) {
      subscribed = true
      api.onRequest(summary => {
        items.push(summary)
        if (items.length > 300) items.shift()
        renderList()
      })
    }
    root = el('div', { className: 'requests' })
    root.innerHTML = `
      <div class="rq-list">
        <div class="logs-bar">
          <span class="rq-count muted small"></span>
          <input class="search" type="search" placeholder="Filter" aria-label="Filter requests" />
        </div>
        <div class="rq-rows" role="list"></div>
        <div class="rq-foot">
          <label class="faults-toggle"><input type="checkbox" class="rq-own" /> Show the app’s own requests</label>
          <button class="btn small rq-clear" type="button">Clear</button>
        </div>
      </div>
      <div class="rq-detail"></div>`
    const search = root.querySelector('.search')
    search.value = filter
    search.addEventListener('input', () => {
      filter = search.value
      renderList()
    })
    const own = root.querySelector('.rq-own')
    own.checked = showOwn
    own.addEventListener('change', () => {
      showOwn = own.checked
      renderList()
    })
    root.querySelector('.rq-clear').addEventListener('click', () => {
      api.clearRequests()
      items = []
      selected = null
      renderList()
      void renderDetail()
    })
    Promise.all([api.requests(), api.apiUrl()]).then(([list, url]) => {
      items = list
      apiUrl = url
      renderList()
      void renderDetail()
    })
    return root
  }

  return { build }
})()

window.GuidePage = (() => {
  const LANGUAGE_KEY = 'sandbox.guideLanguage'
  let data = null
  let language = 'curl'
  try {
    language = localStorage.getItem(LANGUAGE_KEY) || 'curl'
  } catch {}
  const results = {} // step id → the last Run here
  let root = null
  let ui = null
  let subscribed = false

  const time = t => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

  function flash(button, text) {
    const label = button.textContent
    button.textContent = text
    setTimeout(() => (button.textContent = label), 1200)
  }

  function render() {
    if (!root?.isConnected || !data) return
    const { el, esc, icon, api } = ui
    if (!data.languages.some(l => l.id === language)) language = data.languages[0].id
    const lang = data.languages.find(l => l.id === language)
    const inner = root.querySelector('.ov-inner')
    inner.innerHTML = ''

    const done = data.steps.filter(s => s.seen).length
    const intro = el('header', { className: 'gd-intro' })
    intro.append(
      el('h1', { textContent: 'Your first three calls' }),
      el(
        'p',
        {},
        `Get a token, list the accounts and read an account’s transactions. The code below has this sandbox’s address and credentials in it and is ready to run. Each step is ticked when the sandbox sees that call arrive from your own code.`,
      ),
    )
    inner.append(intro)

    if (!data.up) inner.append(el('div', { className: 'ov-note' }, `${icon('alert')}<span>The API isn’t running yet, so the credentials are placeholders. They are filled in once it starts.</span>`))
    else if (!data.auth)
      inner.append(
        el(
          'div',
          { className: 'gd-note' },
          `<span><strong>Authentication is off in this sandbox</strong>, so calls work without a token here. The bank always asks for one, so the code gets and sends it anyway. Turn it on under Settings to have the sandbox insist too.</span>`,
        ),
      )

    const bar = el('div', { className: 'gd-bar' })
    const tabs = el('div', { className: 'gd-tabs', role: 'tablist', ariaLabel: 'Language' })
    for (const l of data.languages) {
      const tab = el('button', { className: `chip${l.id === language ? ' on' : ''}`, type: 'button', textContent: l.label, role: 'tab' })
      tab.setAttribute('aria-selected', String(l.id === language))
      tab.addEventListener('click', () => {
        language = l.id
        try {
          localStorage.setItem(LANGUAGE_KEY, language)
        } catch {}
        render()
      })
      tabs.append(tab)
    }
    const all = el('button', { className: 'btn small', type: 'button', textContent: language === 'curl' ? 'Copy All Three' : `Copy ${lang.file}` })
    all.addEventListener('click', async () => (await api.guideCopy(language, 'all')) && flash(all, 'Copied'))
    bar.append(tabs, el('span', { className: 'muted small gd-run', textContent: lang.run }), all)
    inner.append(bar)

    data.steps.forEach((step, i) => {
      const card = el('section', { className: `ov-card gd-step${step.seen ? ' done' : ''}` })
      const [method, path] = step.request.split(' ')
      card.append(
        el(
          'div',
          { className: 'gd-step-head' },
          `<span class="gd-num" aria-hidden="true">${step.seen ? icon('check') : i + 1}</span>` +
            `<div><h2>${esc(step.title)}</h2><p>${esc(step.text)}</p></div>` +
            `<div class="ep-line gd-request"><span class="method m-${method.toLowerCase()}">${method}</span><code>${esc(path)}</code></div>`,
        ),
      )
      card.append(el('pre', { className: 'resp-body gd-code', textContent: step.snippets[language] }))

      const row = el('div', { className: 'send-row' })
      const copy = el('button', { className: 'btn primary', type: 'button', textContent: 'Copy' })
      copy.title = 'Copies the code with the real credentials in place of the dots'
      copy.addEventListener('click', async () => (await api.guideCopy(language, step.id)) && flash(copy, 'Copied'))
      const run = el('button', { className: 'btn', type: 'button', textContent: 'Run Here' })
      run.title = 'Makes this call from the app and shows the answer'
      run.addEventListener('click', async () => {
        run.disabled = true
        results[step.id] = await api.guideRun(step.id)
        render()
      })
      const seen = el('span', { className: `gd-seen${step.seen ? ' ok' : ''}`, role: 'status' })
      seen.textContent = step.seen ? `Seen from ${step.seen.client}, ${time(step.seen.time)}` : 'Waiting for this call from your code…'
      row.append(copy, run, seen)
      card.append(row)

      const r = results[step.id]
      if (r) {
        let body = r.body
        try {
          body = JSON.stringify(JSON.parse(r.body), null, 2)
        } catch {}
        const out = el('div', { className: 'ep-response' })
        out.append(
          el('div', { className: 'resp-head' }, `<span class="http-status s${r.status ? String(r.status)[0] : 0}xx">${r.status || '—'}</span><span>${esc(r.statusText || '')}</span><span class="muted">${r.ms} ms</span>`),
        )
        if (body) out.append(el('pre', { className: `resp-body${r.status >= 400 || !r.status ? ' bad' : ''}`, textContent: body }))
        card.append(out)
      }
      inner.append(card)
    })

    const next = el('section', { className: 'ov-card gd-next' })
    next.append(el('h2', { textContent: done === data.steps.length ? 'All three calls have arrived. What next?' : 'Along the way' }))
    const links = el('div', { className: 'gd-links' })
    const link = (label, text, run) => {
      const b = el('button', { className: 'gd-link', type: 'button' }, `<strong>${esc(label)}</strong><small>${esc(text)}</small>`)
      b.addEventListener('click', run)
      links.append(b)
    }
    link('Requests', 'See exactly what your code sent and what came back', () => api.navigate('requests'))
    link('API reference', 'Every other endpoint, with a way to try it', () => api.navigate('api'))
    link('Postman collection', 'Prefer Postman? Open Investec’s collection', () => api.openResource('postman'))
    link('Investec API docs', 'What changes when you point this code at the bank', () => api.openResource('docs'))
    next.append(links)
    if (done) {
      const reset = el('button', { className: 'btn small', type: 'button', textContent: 'Clear the Ticks' })
      reset.addEventListener('click', () => api.guideReset())
      next.append(reset)
    }
    inner.append(next)
  }

  async function load() {
    data = await ui.api.guide()
    render()
  }

  function build(api, helpers) {
    ui = { api, ...helpers }
    if (!subscribed) {
      subscribed = true
      api.onGuide(() => void load())
    }
    root = ui.el('div', { className: 'overview guide' }, '<div class="ov-inner"></div>')
    void load()
    return root
  }

  // The API came up or went down: the credentials may be known now.
  return { build, refresh: () => root?.isConnected && void load() }
})()
