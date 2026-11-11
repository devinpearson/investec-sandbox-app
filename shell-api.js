// The API reference: a native explorer built from the sandbox's OpenAPI
// document. Endpoints by tag on the left; on the right the selected one's
// parameters, a request body (pre-filled from its schema), Send (⌘↵), and the
// response. Requests go through the main process (shell:api-request).

window.ApiExplorer = (() => {
  let doc = null
  let selected = null // `${method} ${path}`
  let filter = ''
  const inputs = {} // per operation: { params: {name: value}, body, token }
  const responses = {}
  // Off: the sandbox's random faults (Faults section) skip these requests.
  let applyFaults = false
  const METHODS = ['get', 'post', 'put', 'patch', 'delete']

  const resolve = (schema, depth = 0) => {
    if (!schema || depth > 8) return schema || {}
    if (schema.$ref) {
      const name = schema.$ref.split('/').pop()
      return resolve(doc.components?.schemas?.[name], depth + 1)
    }
    return schema
  }

  // A sample value for a schema, for the request body.
  function sample(schema, depth = 0) {
    const s = resolve(schema)
    if (depth > 6) return null
    if (s.example !== undefined) return s.example
    if (s.default !== undefined) return s.default
    if (s.enum) return s.enum[0]
    if (s.allOf) return Object.assign({}, ...s.allOf.map(x => sample(x, depth + 1)))
    if (s.oneOf || s.anyOf) return sample((s.oneOf || s.anyOf)[0], depth + 1)
    const type = Array.isArray(s.type) ? s.type.find(t => t !== 'null') : s.type
    if (type === 'object' || s.properties) {
      return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, sample(v, depth + 1)]))
    }
    if (type === 'array') return [sample(s.items, depth + 1)]
    if (type === 'number' || type === 'integer') return s.minimum ?? 0
    if (type === 'boolean') return false
    if (s.format === 'date') return new Date().toISOString().slice(0, 10)
    if (s.format === 'date-time') return new Date().toISOString()
    return ''
  }

  function operations() {
    const list = []
    for (const [path, item] of Object.entries(doc.paths || {})) {
      for (const method of METHODS) {
        const op = item[method]
        if (!op) continue
        list.push({ key: `${method} ${path}`, method, path, op, params: [...(item.parameters || []), ...(op.parameters || [])].map(p => resolve(p)), tag: op.tags?.[0] || 'Other' })
      }
    }
    return list
  }

  function bodySchema(op) {
    const content = op.requestBody?.content || {}
    const json = content['application/json']
    if (json) return { type: 'json', schema: json.schema }
    const form = content['application/x-www-form-urlencoded']
    if (form) return { type: 'form', schema: form.schema }
    return null
  }

  function stateFor(o) {
    if (!inputs[o.key]) {
      const body = bodySchema(o.op)
      inputs[o.key] = {
        params: {},
        body: body?.type === 'json' ? JSON.stringify(sample(body.schema), null, 2) : '',
        token: '',
      }
    }
    return inputs[o.key]
  }

  function requestPath(o, values) {
    let path = o.path.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(values.params[name] ?? ''))
    const query = o.params.filter(p => p.in === 'query' && values.params[p.name] !== undefined && values.params[p.name] !== '')
    if (query.length) path += `?${new URLSearchParams(query.map(p => [p.name, values.params[p.name]]))}`
    return path
  }

  function build(api, { el, icon, esc }) {
    const root = el('div', { className: 'explorer' })
    const side = el('div', { className: 'explorer-list' })
    const detail = el('div', { className: 'explorer-detail' })
    root.append(side, detail)

    const search = el('input', { className: 'search', type: 'search', placeholder: 'Filter endpoints', value: filter, ariaLabel: 'Filter endpoints' })
    const list = el('div', { className: 'endpoints', role: 'listbox', ariaLabel: 'Endpoints' })
    side.append(search, list)

    if (!doc) {
      list.append(el('p', { className: 'muted pad', textContent: 'Loading the API description…' }))
      api
        .apiDoc()
        .then(d => {
          doc = d
          if (root.isConnected) root.replaceWith(build(api, { el, icon, esc }))
        })
        .catch(error => {
          list.innerHTML = ''
          list.append(el('p', { className: 'muted pad', textContent: `Couldn’t load the API description: ${error.message}` }))
        })
      return root
    }

    const ops = operations()
    if (!selected || !ops.some(o => o.key === selected)) selected = ops[0]?.key

    function renderList() {
      list.innerHTML = ''
      const q = filter.toLowerCase()
      const matches = ops.filter(o => !q || `${o.method} ${o.path} ${o.op.summary || ''} ${o.tag}`.toLowerCase().includes(q))
      let tag = null
      for (const o of matches) {
        if (o.tag !== tag) {
          tag = o.tag
          list.append(el('div', { className: 'tag', textContent: tag }))
        }
        const b = el(
          'button',
          { className: `endpoint${o.key === selected ? ' active' : ''}`, role: 'option', title: o.op.summary || o.path },
          `<span class="method m-${o.method}">${o.method.toUpperCase()}</span><span class="ep-text"><span class="ep-summary">${esc(o.op.summary || o.path)}</span><span class="ep-path">${esc(o.path)}</span></span>`,
        )
        b.setAttribute('aria-selected', String(o.key === selected))
        b.addEventListener('click', () => {
          selected = o.key
          renderList()
          renderDetail()
        })
        list.append(b)
      }
      if (!matches.length) list.append(el('p', { className: 'muted pad', textContent: 'No endpoints match.' }))
    }

    function renderDetail() {
      detail.innerHTML = ''
      const o = ops.find(x => x.key === selected)
      if (!o) return
      const values = stateFor(o)
      const head = el('div', { className: 'ep-head' })
      head.append(
        el('div', { className: 'ep-line' }, `<span class="method m-${o.method}">${o.method.toUpperCase()}</span><code>${esc(o.path)}</code>${o.op['x-sandbox-only'] ? '<span class="pill">Sandbox only</span>' : ''}`),
        el('h2', { textContent: o.op.summary || o.path }),
      )
      if (o.op.description) head.append(el('p', { className: 'muted', textContent: o.op.description }))
      detail.append(head)

      const form = el('div', { className: 'ep-form' })
      const shownParams = o.params.filter(p => p.in === 'path' || p.in === 'query')
      if (shownParams.length) {
        form.append(el('h3', { textContent: 'Parameters' }))
        const grid = el('div', { className: 'params' })
        for (const p of shownParams) {
          const schema = resolve(p.schema)
          const label = el('label', { className: 'param' })
          label.append(el('span', { className: 'param-name' }, `${esc(p.name)}${p.required ? ' <span class="req" title="Required">*</span>' : ''} <span class="muted">${esc(p.in)}</span>`))
          let input
          if (schema.enum) {
            input = el('select')
            input.append(el('option', { value: '', textContent: '—' }))
            for (const v of schema.enum) input.append(el('option', { value: v, textContent: v }))
          } else input = el('input', { type: 'text', placeholder: schema.example ?? schema.type ?? '' })
          input.value = values.params[p.name] ?? ''
          input.addEventListener('input', () => (values.params[p.name] = input.value))
          label.append(input)
          if (p.description) label.append(el('span', { className: 'muted small', textContent: p.description }))
          grid.append(label)
        }
        form.append(grid)
      }

      const body = bodySchema(o.op)
      if (body?.type === 'json') {
        form.append(el('h3', { textContent: 'Request body' }))
        const area = el('textarea', { className: 'body', spellcheck: false, value: values.body, ariaLabel: 'Request body (JSON)' })
        area.rows = Math.min(14, Math.max(4, values.body.split('\n').length))
        area.addEventListener('input', () => (values.body = area.value))
        form.append(area)
      } else if (body?.type === 'form') {
        form.append(el('p', { className: 'muted small', textContent: 'This endpoint takes a form (sign-in flows); try it from the OAuth tester instead.' }))
      }

      const needsToken = (o.op.security || doc.security || []).some(s => s.bearerAuth)
      if (needsToken) {
        const label = el('label', { className: 'param token' })
        label.append(el('span', { className: 'param-name', textContent: 'Bearer token' }), el('span', { className: 'muted small', textContent: 'Only needed when the sandbox has authentication on.' }))
        const input = el('input', { type: 'text', value: values.token, placeholder: 'Optional' })
        input.addEventListener('input', () => (values.token = input.value))
        label.append(input)
        form.append(label)
      }

      const row = el('div', { className: 'send-row' })
      const send = el('button', { className: 'btn primary', type: 'button' }, `${icon('send')} Send`)
      send.title = `Send (${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}↵)`
      const curl = el('button', { className: 'btn', type: 'button', textContent: 'Copy as curl' })
      const url = el('code', { className: 'muted small', textContent: requestPath(o, values) })
      form.addEventListener('input', () => (url.textContent = requestPath(o, values)))
      const faults = el('label', { className: 'faults-toggle small', title: 'See the random errors, timeouts and latency from the Faults section, as Postman or your own app would' })
      const faultsBox = el('input', { type: 'checkbox', checked: applyFaults })
      faultsBox.addEventListener('change', () => (applyFaults = faultsBox.checked))
      faults.append(faultsBox, document.createTextNode(' Apply sandbox faults'))
      row.append(send, curl, url, faults)
      form.append(row)
      detail.append(form)

      const result = el('div', { className: 'ep-response' })
      detail.append(result)
      const showResponse = r => {
        result.innerHTML = ''
        if (!r) return
        const ok = r.status >= 200 && r.status < 300
        result.append(
          el('div', { className: 'resp-head' }, `<span class="http-status s${String(r.status)[0] || 0}xx">${r.status || '—'}</span><span>${esc(r.statusText || '')}</span><span class="muted">${r.ms} ms</span>`),
        )
        let text = r.body
        try {
          text = JSON.stringify(JSON.parse(r.body), null, 2)
        } catch {}
        const pre = el('pre', { className: `resp-body${ok ? '' : ' bad'}`, textContent: text || '(empty)' })
        result.append(pre)
        const headers = el('details', { className: 'resp-headers' })
        headers.append(el('summary', { textContent: 'Headers' }), el('pre', { textContent: Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\n') }))
        result.append(headers)
      }
      showResponse(responses[o.key])

      async function run() {
        let payload
        if (body?.type === 'json' && values.body.trim()) {
          try {
            payload = JSON.stringify(JSON.parse(values.body))
          } catch (error) {
            showResponse({ status: 0, statusText: `The body isn’t valid JSON: ${error.message}`, ms: 0, headers: {}, body: '' })
            return
          }
        }
        send.disabled = true
        const r = await api.apiRequest({ method: o.method.toUpperCase(), path: requestPath(o, values), body: payload, token: values.token.trim() || undefined, applyFaults })
        send.disabled = false
        responses[o.key] = r
        showResponse(r)
      }
      send.addEventListener('click', run)
      detail.onkeydown = e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          run()
        }
      }
      curl.addEventListener('click', async () => {
        // The live address: the port may have moved from the spec's.
        const origin = (await api.apiUrl()).replace(/\/$/, '')
        const parts = [`curl -X ${o.method.toUpperCase()} '${origin}${requestPath(o, values)}'`]
        if (values.token.trim()) parts.push(`-H 'Authorization: Bearer ${values.token.trim()}'`)
        if (body?.type === 'json' && values.body.trim()) parts.push(`-H 'Content-Type: application/json'`, `-d '${values.body.replace(/'/g, "'\\''")}'`)
        api.copy(parts.join(' \\\n  '))
        curl.textContent = 'Copied'
        setTimeout(() => (curl.textContent = 'Copy as curl'), 1200)
      })
    }

    search.addEventListener('input', () => {
      filter = search.value
      renderList()
    })
    renderList()
    renderDetail()
    return root
  }

  return { build }
})()
