// The API reference, laid out like Stripe's: one long page built from the
// sandbox's OpenAPI document. Each endpoint has its docs on the left
// (parameters, body, what it returns) and, pinned on the right, a request in
// cURL, Node.js or Python and an example response. "Try it" fills in the
// request and sends it (⌘↵), and the live response replaces the example.
// Requests go through the main process (shell:api-request).

window.ApiExplorer = (() => {
  let doc = null
  let origin = 'http://localhost:3000'
  let filter = ''
  let current = 'intro' // the section in view, kept across rebuilds
  let lang = 'curl'
  const inputs = {} // per operation: { params: {name: value}, body, token }
  const responses = {}
  const trying = new Set()
  const showExample = new Set()
  // Off: the sandbox's random faults (Faults section) skip these requests.
  let applyFaults = false
  const METHODS = ['get', 'post', 'put', 'patch', 'delete']
  const LANGS = { curl: 'cURL', node: 'Node.js', python: 'Python' }
  const isMac = navigator.platform.startsWith('Mac')

  const resolve = (schema, depth = 0) => {
    if (!schema || depth > 8) return schema || {}
    if (schema.$ref) {
      const name = schema.$ref.split('/').pop()
      return resolve(doc.components?.schemas?.[name] || doc.components?.parameters?.[name], depth + 1)
    }
    return schema
  }

  // allOf parts merged into one object schema.
  function flatten(schema) {
    const s = resolve(schema)
    if (!s.allOf) return s
    const parts = s.allOf.map(flatten)
    return {
      ...s,
      type: 'object',
      properties: Object.assign({}, ...parts.map(p => p.properties || {}), s.properties || {}),
      required: [...parts.flatMap(p => p.required || []), ...(s.required || [])],
    }
  }

  // A sample value for a schema. `doc` mode (example responses) shows a type
  // name for strings with no example; request bodies leave them empty.
  function sample(schema, depth = 0, forDoc = false) {
    const s = flatten(schema)
    if (depth > 6) return null
    if (s.example !== undefined) return s.example
    if (s.default !== undefined) return s.default
    if (s.enum) return s.enum[0]
    if (s.oneOf || s.anyOf) return sample((s.oneOf || s.anyOf)[0], depth + 1, forDoc)
    const type = Array.isArray(s.type) ? s.type.find(t => t !== 'null') : s.type
    if (type === 'object' || s.properties) {
      return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, sample(v, depth + 1, forDoc)]))
    }
    if (type === 'array') return s.items ? [sample(s.items, depth + 1, forDoc)] : []
    if (type === 'number' || type === 'integer') return s.minimum ?? 0
    if (type === 'boolean') return false
    if (s.format === 'date' || s.pattern === '^\\d{4}-\\d{2}-\\d{2}$') return new Date().toISOString().slice(0, 10)
    if (s.format === 'date-time') return new Date().toISOString()
    return forDoc ? 'string' : ''
  }

  const anchor = key => `ar-${key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`

  function operations() {
    const list = []
    for (const [path, item] of Object.entries(doc.paths || {})) {
      for (const method of METHODS) {
        const op = item[method]
        if (!op) continue
        const key = `${method} ${path}`
        list.push({ key, id: anchor(key), method, path, op, params: [...(item.parameters || []), ...(op.parameters || [])].map(p => resolve(p)), tag: op.tags?.[0] || 'Other' })
      }
    }
    return list
  }

  function groups(ops) {
    const out = new Map()
    for (const o of ops) {
      if (!out.has(o.tag)) out.set(o.tag, { tag: o.tag, id: anchor(`tag ${o.tag}`), ops: [], description: doc.tags?.find(t => t.name === o.tag)?.description })
      out.get(o.tag).ops.push(o)
    }
    return [...out.values()]
  }

  function bodySchema(op) {
    const content = op.requestBody?.content || {}
    const json = content['application/json']
    if (json) return { type: 'json', schema: json.schema }
    const form = content['application/x-www-form-urlencoded']
    if (form) return { type: 'form', schema: form.schema }
    return null
  }

  const security = o => (o.op.security || doc.security || []).flatMap(s => Object.keys(s))

  function stateFor(o) {
    if (!inputs[o.key]) {
      const body = bodySchema(o.op)
      inputs[o.key] = {
        params: {},
        body: body ? JSON.stringify(sample(body.schema), null, 2) : '',
        token: '',
      }
    }
    return inputs[o.key]
  }

  function requestPath(o, values, placeholders = false) {
    let path = o.path.replace(/\{([^}]+)\}/g, (whole, name) => {
      const v = values.params[name]
      return v ? encodeURIComponent(v) : placeholders ? whole : ''
    })
    const query = o.params.filter(p => p.in === 'query' && values.params[p.name] !== undefined && values.params[p.name] !== '')
    if (query.length) path += `?${new URLSearchParams(query.map(p => [p.name, values.params[p.name]]))}`
    return path
  }

  // ---------------------------------------------------------------------------
  // Code samples

  function parsedBody(o, values) {
    const body = bodySchema(o.op)
    if (!body || !values.body.trim()) return null
    try {
      return { type: body.type, value: JSON.parse(values.body) }
    } catch {
      return { type: body.type, raw: values.body }
    }
  }

  const indent = (text, pad) => text.replace(/\n/g, `\n${pad}`)
  const pyLiteral = json => json.replace(/("(?:[^"\\]|\\.)*")|\b(true|false|null)\b/g, (m, str, word) => str || { true: 'True', false: 'False', null: 'None' }[word])

  function samples(o, values) {
    const url = `${origin}${requestPath(o, values, true)}`
    const method = o.method.toUpperCase()
    const auth = security(o)
    const token = values.token.trim()
    const body = parsedBody(o, values)
    const json = body && (body.raw ?? JSON.stringify(body.value, null, 2))
    const form = body?.value && typeof body.value === 'object' ? Object.entries(body.value).filter(([, v]) => v !== '' && v !== null) : []

    const curl = [`curl${method === 'GET' ? '' : ` -X ${method}`} '${url}'`]
    if (auth.includes('bearerAuth')) curl.push(`-H "Authorization: Bearer ${token || '$TOKEN'}"`)
    if (auth.includes('clientCredentials')) curl.push(`-u "$CLIENT_ID:$CLIENT_SECRET"`)
    if (body?.type === 'json') curl.push(`-H 'Content-Type: application/json'`, `-d '${indent(json, '  ').replace(/'/g, "'\\''")}'`)
    if (body?.type === 'form') for (const [k, v] of form) curl.push(`-d ${k}=${encodeURIComponent(v)}`)

    const headers = []
    if (auth.includes('bearerAuth')) headers.push(token ? `Authorization: "Bearer ${token}"` : 'Authorization: `Bearer ${process.env.TOKEN}`')
    if (auth.includes('clientCredentials')) headers.push('Authorization: `Basic ${btoa(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`)}`')
    if (body?.type === 'json') headers.push('"Content-Type": "application/json"')
    const opts = []
    if (method !== 'GET') opts.push(`method: "${method}"`)
    if (headers.length) opts.push(`headers: {\n    ${headers.join(',\n    ')},\n  }`)
    if (body?.type === 'json') opts.push(body.raw ? `body: ${JSON.stringify(body.raw)}` : `body: JSON.stringify(${indent(json, '  ')})`)
    if (body?.type === 'form') opts.push(`body: new URLSearchParams(${indent(JSON.stringify(Object.fromEntries(form), null, 2), '  ')})`)
    const node =
      `const response = await fetch("${url}"${opts.length ? `, {\n  ${opts.join(',\n  ')},\n}` : ''});\n` + `const data = await response.json();\nconsole.log(data);`

    const pyArgs = [`"${url}"`]
    const env = auth.length && !(auth.includes('bearerAuth') && token)
    if (auth.includes('bearerAuth')) pyArgs.push(`headers={"Authorization": ${token ? `"Bearer ${token}"` : `f"Bearer {os.environ['TOKEN']}"`}}`)
    if (auth.includes('clientCredentials')) pyArgs.push(`auth=(os.environ["CLIENT_ID"], os.environ["CLIENT_SECRET"])`)
    if (body?.type === 'json') pyArgs.push(body.raw ? `data=${JSON.stringify(body.raw)}` : `json=${indent(pyLiteral(json), '    ')}`)
    if (body?.type === 'form') pyArgs.push(`data=${indent(pyLiteral(JSON.stringify(Object.fromEntries(form), null, 2)), '    ')}`)
    const python =
      `${env ? 'import os\n' : ''}import requests\n\n` +
      `response = requests.${o.method}(\n    ${pyArgs.join(',\n    ')},\n)\nprint(response.json())`

    return { curl: curl.join(' \\\n  '), node, python }
  }

  // A little syntax colouring for the dark panels.
  function highlight(text, kind, esc) {
    const re =
      kind === 'json'
        ? /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)/gi
        : /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)()|\b(const|await|import|print|True|False|None|true|false|null|new)\b|(\s-[A-Za-z]\b|\$[A-Z_]+)/g
    let out = ''
    let last = 0
    for (const m of text.matchAll(re)) {
      out += esc(text.slice(last, m.index))
      const [whole, str, colon, word, num] = m
      if (str !== undefined) out += `<span class="${colon ? 'tk-key' : 'tk-str'}">${esc(str)}</span>${colon ? esc(colon) : ''}`
      else if (word !== undefined) out += `<span class="tk-word">${esc(word)}</span>`
      else out += `<span class="tk-num">${esc(num ?? whole)}</span>`
      last = m.index + whole.length
    }
    return out + esc(text.slice(last))
  }

  // ---------------------------------------------------------------------------
  // Docs: attributes (parameters, body fields, returned fields)

  function typeLabel(schema) {
    const s = flatten(schema)
    if (s.oneOf || s.anyOf) return [...new Set((s.oneOf || s.anyOf).map(typeLabel))].join(' or ')
    const type = Array.isArray(s.type) ? s.type.filter(t => t !== 'null').join(' or ') : s.type
    if (type === 'array') {
      const item = flatten(s.items)
      const inner = item.properties ? 'objects' : `${typeLabel(s.items)}s`
      return `array of ${inner}`
    }
    if (s.enum) return 'enum'
    if (!type && s.properties) return 'object'
    const fmt = s.format || (s.pattern === '^\\d{4}-\\d{2}-\\d{2}$' ? 'date' : '')
    return `${type || 'any'}${fmt ? ` (${fmt})` : ''}`
  }

  function children(schema) {
    const s = flatten(schema)
    if (s.properties) return s
    if (s.type === 'array' && s.items) {
      const item = flatten(s.items)
      if (item.properties) return item
    }
    for (const alt of s.oneOf || s.anyOf || []) {
      const c = children(alt)
      if (c) return c
    }
    return null
  }

  function attrList(entries, { el, esc }, depth = 0) {
    const list = el('div', { className: 'ar-attrs' })
    for (const { name, schema, required, where, description } of entries) {
      const s = flatten(schema)
      const row = el('div', { className: 'ar-attr' })
      row.append(
        el(
          'div',
          { className: 'ar-attr-head' },
          `<code class="ar-attr-name">${esc(name)}</code><span class="ar-attr-type">${esc(typeLabel(s))}</span>${where ? `<span class="ar-attr-in">${esc(where)}</span>` : ''}${required ? '<span class="ar-req">Required</span>' : ''}`,
        ),
      )
      const text = description || s.description
      if (text) row.append(el('p', { className: 'ar-attr-desc', textContent: text }))
      const values = s.enum || (s.items && flatten(s.items).enum)
      if (values) row.append(el('p', { className: 'ar-attr-desc' }, `Possible values: ${values.map(v => `<code>${esc(v)}</code>`).join(' ')}`))
      else if (s.example !== undefined && typeof s.example !== 'object') row.append(el('p', { className: 'ar-attr-desc' }, `Example: <code>${esc(s.example)}</code>`))
      const nested = depth < 5 && children(s)
      if (nested && Object.keys(nested.properties).length) {
        const box = el('details', { className: 'ar-children' })
        const count = Object.keys(nested.properties).length
        box.append(el('summary', { textContent: `Show child attributes (${count})` }))
        box.addEventListener('toggle', () => {
          box.querySelector('summary').textContent = `${box.open ? 'Hide' : 'Show'} child attributes (${count})`
          if (box.open && box.childElementCount === 1) box.append(attrList(propsOf(nested), { el, esc }, depth + 1))
        })
        row.append(box)
      }
      list.append(row)
    }
    return list
  }

  const propsOf = s => Object.entries(s.properties || {}).map(([name, schema]) => ({ name, schema, required: (s.required || []).includes(name) }))

  // What a response carries, past Investec's { data, links, meta } envelope
  // and single-key wrappers like { accounts: [...] }, as Stripe shows it.
  function payload(schema) {
    let fields = schema && children(schema)
    if (!fields) return { fields: null, path: '' }
    let path = ''
    const step = name => {
      const prop = flatten(fields.properties[name])
      const inner = children(prop)
      if (!inner || !Object.keys(inner.properties).length) return false
      path += `${path ? '.' : ''}${name}${prop.type === 'array' ? '[]' : ''}`
      fields = inner
      return true
    }
    if (fields.properties.data && fields.properties.links) step('data')
    while (!path.endsWith('[]') && Object.keys(fields.properties).length === 1 && step(Object.keys(fields.properties)[0]));
    return { fields, path }
  }

  function success(o) {
    const entries = Object.entries(o.op.responses || {})
    return entries.find(([code]) => code.startsWith('2')) || entries.find(([code]) => code.startsWith('3')) || null
  }

  // ---------------------------------------------------------------------------
  // The page

  function build(api, helpers) {
    const { el, icon, esc } = helpers
    const root = el('div', { className: 'ar' })
    const nav = el('nav', { className: 'ar-nav', ariaLabel: 'API reference' })
    const main = el('div', { className: 'ar-main' })
    root.append(nav, main)

    const search = el('input', { className: 'ar-search', type: 'search', placeholder: 'Filter endpoints', value: filter, ariaLabel: 'Filter endpoints' })
    const navList = el('div', { className: 'ar-nav-list' })
    nav.append(search, navList)

    if (!doc) {
      main.append(el('p', { className: 'muted pad', textContent: 'Loading the API description…' }))
      Promise.all([api.apiDoc(), api.apiUrl().catch(() => origin)])
        .then(([d, url]) => {
          doc = d
          origin = String(url).replace(/\/$/, '')
          if (root.isConnected) root.replaceWith(build(api, helpers))
        })
        .catch(error => {
          main.innerHTML = ''
          main.append(el('p', { className: 'muted pad', textContent: `Couldn’t load the API description: ${error.message}` }))
        })
      return root
    }

    const ops = operations()
    const tagGroups = groups(ops)
    const sections = [] // { id, groupId, node }
    const navLinks = new Map()
    const groupOf = new Map()
    for (const g of tagGroups) {
      groupOf.set(g.id, g.id)
      for (const o of g.ops) groupOf.set(o.id, g.id)
    }

    let jumping = false
    const goTo = (id, smooth = true) => {
      const target = main.querySelector(`#${id}`)
      if (!target) return
      const top = Math.min(target.offsetTop - 8, main.scrollHeight - main.clientHeight)
      // Hold the nav on the target while a smooth scroll passes other sections.
      jumping = smooth && Math.abs(main.scrollTop - top) > 2
      main.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
      setCurrent(id)
    }

    // --- Nav ---
    function renderNav() {
      navList.innerHTML = ''
      navLinks.clear()
      const q = filter.trim().toLowerCase()
      const link = (id, html, cls) => {
        const a = el('a', { className: cls, href: `#${id}` }, html)
        a.addEventListener('click', e => {
          e.preventDefault()
          goTo(id)
        })
        navLinks.set(id, a)
        return a
      }
      if (!q) navList.append(link('intro', 'Introduction', 'ar-nav-top'))
      let any = false
      for (const g of tagGroups) {
        const matches = g.ops.filter(o => !q || `${o.method} ${o.path} ${o.op.summary || ''} ${o.tag}`.toLowerCase().includes(q))
        if (!matches.length) continue
        any = true
        const open = q || groupOf.get(current) === g.id
        const group = el('div', { className: `ar-nav-group${open ? ' open' : ''}` })
        const head = link(g.id, `<span>${esc(g.tag)}</span><svg class="ar-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`, 'ar-nav-tag')
        const items = el('div', { className: 'ar-nav-items' })
        for (const o of matches) {
          items.append(link(o.id, `<span class="ar-nav-name">${esc(o.op.summary || o.path)}</span><span class="ar-verb v-${o.method}">${o.method === 'delete' ? 'DEL' : o.method.toUpperCase()}</span>`, 'ar-nav-op'))
        }
        group.append(head, items)
        navList.append(group)
      }
      if (!any) navList.append(el('p', { className: 'muted pad', textContent: 'No endpoints match.' }))
      markNav()
    }

    function markNav() {
      for (const [id, a] of navLinks) a.classList.toggle('active', id === current)
      const active = navLinks.get(current)
      if (active) {
        const box = navList.getBoundingClientRect()
        const r = active.getBoundingClientRect()
        if (r.top < box.top || r.bottom > box.bottom) active.scrollIntoView({ block: 'nearest' })
      }
    }

    function setCurrent(id) {
      if (id === current) return
      const before = groupOf.get(current)
      current = id
      if (groupOf.get(id) !== before && !filter.trim()) renderNav()
      else markNav()
    }

    // --- Sections ---
    const panel = (label, extra = '') => {
      const box = el('div', { className: 'ar-panel' })
      const head = el('div', { className: 'ar-panel-head' }, `<span class="ar-panel-title">${label}</span>${extra}`)
      box.append(head)
      return { box, head }
    }

    const copyButton = getText => {
      const b = el('button', { className: 'ar-icon-btn', type: 'button', title: 'Copy', ariaLabel: 'Copy' }, icon('copy'))
      b.addEventListener('click', () => {
        api.copy(getText())
        b.classList.add('done')
        b.title = 'Copied'
        setTimeout(() => {
          b.classList.remove('done')
          b.title = 'Copy'
        }, 1200)
      })
      return b
    }

    function introSection() {
      const s = el('section', { className: 'ar-section ar-intro', id: 'intro' })
      const text = el('div', { className: 'ar-text' })
      text.append(
        el('h1', { textContent: 'API reference' }),
        el('p', { className: 'ar-lead', textContent: doc.info?.description || '' }),
        el('h4', { textContent: 'Authentication' }),
        el('p', {
          textContent:
            'Investec’s APIs take an OAuth access token. Get one from POST /identity/v2/oauth2/token with your client ID and secret (and, on Investec, your API key), then send it as a Bearer token. The sandbox only checks tokens when authentication is on in its settings.',
        }),
        el('h4', { textContent: 'Sandbox-only endpoints' }),
        el('p', {}, 'Endpoints marked <span class="pill">Sandbox only</span> have no Investec equivalent: they are there to set the sandbox up (create transactions, move the clock, inject faults). Don’t call them from code you mean to run against the bank.'),
        el('p', { className: 'muted small', textContent: `${doc.info?.title || 'API'} · version ${doc.info?.version || '—'}` }),
      )
      const code = el('div', { className: 'ar-code' })
      const base = panel('Base URL')
      base.head.append(copyButton(() => origin))
      base.box.append(el('pre', { className: 'ar-pre' }, highlight(origin, 'code', esc)))
      const tokenSample = `curl -X POST '${origin}/identity/v2/oauth2/token' \\\n  -u "$CLIENT_ID:$CLIENT_SECRET" \\\n  -d grant_type=client_credentials`
      const auth = panel('Get a token')
      auth.head.append(copyButton(() => tokenSample))
      auth.box.append(el('pre', { className: 'ar-pre' }, highlight(tokenSample, 'code', esc)))
      code.append(base.box, auth.box)
      s.append(text, code)
      return s
    }

    function tagSection(g) {
      const s = el('section', { className: 'ar-section ar-tag', id: g.id })
      const text = el('div', { className: 'ar-text' })
      text.append(el('h2', { textContent: g.tag }))
      if (g.description) text.append(el('p', { className: 'ar-lead', textContent: g.description }))
      const sandboxOnly = g.ops.filter(o => o.op['x-sandbox-only']).length
      text.append(
        el('p', {
          className: 'muted',
          textContent: `${g.ops.length} endpoint${g.ops.length === 1 ? '' : 's'}${sandboxOnly ? `, ${sandboxOnly === g.ops.length ? 'all' : sandboxOnly} sandbox only` : ''}.`,
        }),
      )
      const code = el('div', { className: 'ar-code' })
      const list = panel('Endpoints')
      const rows = el('div', { className: 'ar-endpoint-list' })
      for (const o of g.ops) {
        const a = el('a', { href: `#${o.id}`, className: 'ar-endpoint-row', title: o.op.summary || '' }, `<span class="ar-verb v-${o.method}">${o.method.toUpperCase()}</span><span>${esc(o.path)}</span>`)
        a.addEventListener('click', e => {
          e.preventDefault()
          goTo(o.id)
        })
        rows.append(a)
      }
      list.box.append(rows)
      code.append(list.box)
      s.append(text, code)
      return s
    }

    function opSection(o) {
      const values = stateFor(o)
      const body = bodySchema(o.op)
      const s = el('section', { className: 'ar-section ar-op', id: o.id })

      // Left: the docs.
      const text = el('div', { className: 'ar-text' })
      text.append(
        el('h3', {}, `${esc(o.op.summary || o.path)}${o.op['x-sandbox-only'] ? ' <span class="pill">Sandbox only</span>' : ''}`),
        el('div', { className: 'ar-route' }, `<span class="ar-verb v-${o.method}">${o.method.toUpperCase()}</span><code>${esc(o.path)}</code>`),
      )
      if (o.op.description) text.append(el('p', { className: 'ar-lead', textContent: o.op.description }))

      const shownParams = o.params.filter(p => p.in === 'path' || p.in === 'query' || p.in === 'header')
      if (shownParams.length) {
        text.append(el('h4', { textContent: 'Parameters' }))
        text.append(attrList(shownParams.map(p => ({ name: p.name, schema: p.schema, required: p.required, where: p.in, description: p.description })), helpers))
      }
      if (body) {
        const schema = flatten(body.schema)
        text.append(el('h4', { textContent: body.type === 'form' ? 'Form body' : 'Body' }))
        if (schema.description) text.append(el('p', { className: 'muted small', textContent: schema.description }))
        if (schema.properties) text.append(attrList(propsOf(schema), helpers))
        else text.append(el('p', { className: 'muted small', textContent: `A ${typeLabel(schema)}.` }))
      }

      const ok = success(o)
      if (ok) {
        const [code, res] = ok
        text.append(el('h4', { textContent: 'Returns' }))
        const schema = res.content?.['application/json']?.schema
        text.append(el('p', { className: 'ar-returns' }, `<span class="ar-status s${code[0]}xx">${esc(code)}</span> ${esc(res.description || '')}${code.startsWith('3') ? ' (a redirect)' : ''}`))
        const { fields, path } = payload(schema)
        if (fields) {
          if (path) text.append(el('p', { className: 'muted small' }, `${path.endsWith('[]') ? 'Each item in' : 'In'} <code>${esc(path.replace(/\[\]$/, ''))}</code>:`))
          const box = el('details', { className: 'ar-children ar-returned' })
          const count = Object.keys(fields.properties).length
          box.append(el('summary', { textContent: `Show returned attributes (${count})` }))
          box.addEventListener('toggle', () => {
            box.querySelector('summary').textContent = `${box.open ? 'Hide' : 'Show'} returned attributes (${count})`
            if (box.open && box.childElementCount === 1) box.append(attrList(propsOf(fields), helpers))
          })
          text.append(box)
        }
      }
      const errors = Object.entries(o.op.responses || {}).filter(([code]) => code !== ok?.[0])
      if (errors.length) {
        text.append(el('h4', { textContent: 'Errors' }))
        const list = el('div', { className: 'ar-errors' })
        for (const [code, res] of errors) list.append(el('div', { className: 'ar-error' }, `<span class="ar-status s${code[0]}xx">${esc(code)}</span><span>${esc(res.description || '')}</span>`))
        text.append(list)
      }

      // Right: the request, Try it, and the response.
      const code = el('div', { className: 'ar-code' })
      const tabs = Object.entries(LANGS)
        .map(([k, label]) => `<button type="button" class="ar-tab${k === lang ? ' active' : ''}" data-lang="${k}">${label}</button>`)
        .join('')
      const req = panel(`<span class="ar-verb v-${o.method}">${o.method.toUpperCase()}</span> ${esc(o.path)}`, `<span class="ar-tabs">${tabs}</span>`)
      const reqPre = el('pre', { className: 'ar-pre' })
      const tryBtn = el('button', { className: `ar-try-btn${trying.has(o.key) ? ' on' : ''}`, type: 'button' }, 'Try it')
      req.head.append(copyButton(() => samples(o, values)[lang]), tryBtn)
      req.box.append(reqPre)
      const drawRequest = () => {
        reqPre.innerHTML = highlight(samples(o, values)[lang], 'code', esc)
        for (const b of req.head.querySelectorAll('.ar-tab')) b.classList.toggle('active', b.dataset.lang === lang)
      }
      req.head.querySelector('.ar-tabs').addEventListener('click', e => {
        const b = e.target.closest('.ar-tab')
        if (!b) return
        lang = b.dataset.lang
        // Every endpoint shows the same language, as on Stripe.
        for (const fn of redraws) fn()
      })
      redraws.push(drawRequest)

      const form = el('div', { className: 'ar-try' })
      const send = el('button', { className: 'btn primary', type: 'button' }, `${icon('send')} Send`)
      send.title = `Send (${isMac ? '⌘' : 'Ctrl+'}↵)`
      const buildForm = () => {
        form.innerHTML = ''
        form.hidden = !trying.has(o.key)
        if (form.hidden) return
        const editable = o.params.filter(p => p.in === 'path' || p.in === 'query')
        if (editable.length) {
          const grid = el('div', { className: 'ar-fields' })
          for (const p of editable) {
            const schema = resolve(p.schema)
            const label = el('label', { className: 'ar-field' })
            label.append(el('span', {}, `${esc(p.name)}${p.required ? ' <span class="ar-req-dot" title="Required">*</span>' : ''}`))
            let input
            if (schema.enum) {
              input = el('select')
              input.append(el('option', { value: '', textContent: '—' }))
              for (const v of schema.enum) input.append(el('option', { value: v, textContent: v }))
            } else input = el('input', { type: 'text', placeholder: String(schema.example ?? schema.type ?? ''), spellcheck: false })
            input.value = values.params[p.name] ?? ''
            input.addEventListener('input', () => {
              values.params[p.name] = input.value
              drawRequest()
            })
            label.append(input)
            grid.append(label)
          }
          form.append(grid)
        }
        if (body?.type === 'json') {
          const label = el('label', { className: 'ar-field' })
          label.append(el('span', { textContent: 'Body (JSON)' }))
          const area = el('textarea', { spellcheck: false, value: values.body })
          area.rows = Math.min(12, Math.max(3, values.body.split('\n').length))
          area.addEventListener('input', () => {
            values.body = area.value
            drawRequest()
          })
          label.append(area)
          form.append(label)
        } else if (body?.type === 'form') {
          form.append(el('p', { className: 'ar-note', textContent: 'This endpoint takes a form (the sign-in flows). Try it from the OAuth tester instead.' }))
        }
        if (security(o).includes('bearerAuth')) {
          const label = el('label', { className: 'ar-field' })
          label.append(el('span', {}, 'Bearer token <em>only needed when the sandbox has authentication on</em>'))
          const input = el('input', { type: 'text', value: values.token, placeholder: 'Optional', spellcheck: false })
          input.addEventListener('input', () => {
            values.token = input.value
            drawRequest()
          })
          label.append(input)
          form.append(label)
        }
        const row = el('div', { className: 'ar-try-row' })
        const faults = el('label', { className: 'ar-faults', title: 'See the random errors, timeouts and latency from the Faults section, as Postman or your own app would' })
        const faultsBox = el('input', { type: 'checkbox', checked: applyFaults })
        faultsBox.addEventListener('change', () => (applyFaults = faultsBox.checked))
        faults.append(faultsBox, document.createTextNode(' Apply sandbox faults'))
        send.disabled = body?.type === 'form'
        row.append(faults, send)
        form.append(row)
      }
      buildForm()
      tryBtn.addEventListener('click', () => {
        if (trying.has(o.key)) trying.delete(o.key)
        else trying.add(o.key)
        tryBtn.classList.toggle('on', trying.has(o.key))
        buildForm()
        form.querySelector('input, textarea')?.focus()
      })

      const res = panel('Response')
      const resPre = el('pre', { className: 'ar-pre ar-res' })
      const resFoot = el('div', { className: 'ar-panel-foot' })
      res.box.append(resPre, resFoot)
      const okSchema = ok?.[1].content?.['application/json']?.schema
      const example = okSchema ? JSON.stringify(sample(okSchema, 0, true), null, 2) : ''
      const drawResponse = () => {
        const live = responses[o.key]
        const title = res.head.querySelector('.ar-panel-title')
        for (const b of res.head.querySelectorAll('button')) b.remove()
        resFoot.innerHTML = ''
        if (live && !showExample.has(o.key)) {
          title.innerHTML = `<span class="ar-status s${String(live.status)[0] || 0}xx">${live.status || '—'}</span> ${esc(live.statusText || '')} <span class="ar-ms">${live.ms} ms</span>`
          let textOut = live.body
          let isJson = false
          try {
            textOut = JSON.stringify(JSON.parse(live.body), null, 2)
            isJson = true
          } catch {}
          resPre.innerHTML = textOut ? (isJson ? highlight(textOut, 'json', esc) : esc(textOut)) : '<span class="ar-dim">(empty)</span>'
          const exampleBtn = el('button', { className: 'ar-link-btn', type: 'button', textContent: 'Example' })
          exampleBtn.addEventListener('click', () => {
            showExample.add(o.key)
            drawResponse()
          })
          res.head.append(exampleBtn, copyButton(() => textOut))
          const headers = el('details', { className: 'ar-headers' })
          headers.append(el('summary', { textContent: `Headers (${Object.keys(live.headers || {}).length})` }), el('pre', { textContent: Object.entries(live.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n') }))
          resFoot.append(headers)
        } else {
          title.innerHTML = ok ? `Response <span class="ar-ms">example · ${esc(ok[0])}</span>` : 'Response'
          resPre.innerHTML = example ? highlight(example, 'json', esc) : `<span class="ar-dim">${ok?.[0].startsWith('3') ? 'A redirect, with no body.' : 'No body.'}</span>`
          if (live) {
            const liveBtn = el('button', { className: 'ar-link-btn', type: 'button', textContent: 'Last response' })
            liveBtn.addEventListener('click', () => {
              showExample.delete(o.key)
              drawResponse()
            })
            res.head.append(liveBtn)
          }
          if (example) res.head.append(copyButton(() => example))
        }
      }

      async function run() {
        if (body?.type === 'form') return
        let payload
        if (body?.type === 'json' && values.body.trim()) {
          try {
            payload = JSON.stringify(JSON.parse(values.body))
          } catch (error) {
            responses[o.key] = { status: 0, statusText: `The body isn’t valid JSON: ${error.message}`, ms: 0, headers: {}, body: '' }
            showExample.delete(o.key)
            drawResponse()
            return
          }
        }
        send.disabled = true
        send.classList.add('busy')
        const r = await api.apiRequest({ method: o.method.toUpperCase(), path: requestPath(o, values), body: payload, token: values.token.trim() || undefined, applyFaults })
        send.disabled = false
        send.classList.remove('busy')
        responses[o.key] = r
        showExample.delete(o.key)
        drawResponse()
      }
      send.addEventListener('click', run)
      s.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          if (!trying.has(o.key)) tryBtn.click()
          else run()
        }
      })

      drawRequest()
      drawResponse()
      code.append(req.box, form, res.box)
      s.append(text, code)
      return s
    }

    const redraws = []
    main.append(introSection())
    sections.push({ id: 'intro' })
    for (const g of tagGroups) {
      main.append(tagSection(g))
      sections.push({ id: g.id })
      for (const o of g.ops) {
        main.append(opSection(o))
        sections.push({ id: o.id })
      }
    }
    main.append(el('div', { className: 'ar-end' }))

    // The section in view drives the nav (scroll spy).
    let ticking = false
    main.addEventListener('scrollend', () => (jumping = false))
    main.addEventListener('scroll', () => {
      if (ticking || jumping) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const y = main.scrollTop + 80
        let id = 'intro'
        for (const { id: sid } of sections) {
          const node = main.querySelector(`#${sid}`)
          if (node && node.offsetTop <= y) id = sid
          else break
        }
        setCurrent(id)
      })
    })

    search.addEventListener('input', () => {
      filter = search.value
      renderNav()
    })
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const first = navList.querySelector('.ar-nav-op')
        if (first) first.click()
      }
    })
    renderNav()
    // Back where it was when the section is opened again.
    requestAnimationFrame(() => goTo(current, false))
    return root
  }

  return { build }
})()
