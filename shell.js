// The app shell: sidebar, toolbar, status screens and the Logs section.
// Dashboard and editor pages are separate views the main process places over
// #stage; the API explorer (shell-api.js) is drawn here too.

const api = window.sandbox

// Icons (Lucide, ISC licence), drawn with currentColor.
const ICONS = {
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  blocks: '<rect width="7" height="7" x="14" y="3" rx="1"/><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  docs: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  wiki: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  postman: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  reload: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  sidebar: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  bottom: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  transactions: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  webhook: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
}
const RESOURCE_ICONS = { docs: 'docs', wiki: 'wiki', postman: 'postman', github: 'github' }

const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`
const el = (tag, props = {}, html = '') => Object.assign(document.createElement(tag), props, html ? { innerHTML: html } : {})
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const isMac = navigator.platform.startsWith('Mac')
const mod = isMac ? '⌘' : 'Ctrl+'

let state = null
const logs = []
const MAX_LOGS = 3000

// A service's name mid-sentence: lower case, but acronyms (API) stay as they are.
const inSentence = label => label.split(' ').map(w => (w === w.toUpperCase() ? w : w.toLowerCase())).join(' ')
const currentSection = () => state.sections.find(s => s.id === state.active)
// The service a section is waiting on: the first of its own and the one its
// pages call (dashboard pages need the API) that isn't running, else its own.
function sectionService(s) {
  const ids = [s.service, s.requires].filter(Boolean)
  const id = ids.find(i => state.services[i]?.status !== 'ready') ?? s.service
  return id ? { id, ...state.services[id] } : null
}

// ------------------------------------------------------------ Sidebar

// Collapsed groups, remembered between launches. Resources starts folded.
const COLLAPSED_KEY = 'sandbox.collapsedGroups'
let collapsed
try {
  collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY)) ?? ['Resources'])
} catch {
  collapsed = new Set(['Resources'])
}
function toggleGroup(name) {
  if (collapsed.has(name)) collapsed.delete(name)
  else collapsed.add(name)
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
  } catch {}
  renderSidebar()
  document.querySelector(`button.group-label[data-group="${CSS.escape(name)}"]`)?.focus()
}

function groupHeader(name) {
  const open = !collapsed.has(name)
  const header = el(
    'button',
    { className: `group-label${open ? ' open' : ''}`, title: open ? `Collapse ${name}` : `Expand ${name}`, tabIndex: -1 },
    `<span>${esc(name)}</span>${icon('chevron')}`,
  )
  header.dataset.group = name
  header.setAttribute('aria-expanded', String(open))
  header.addEventListener('click', () => toggleGroup(name))
  return header
}

function navItem({ label, iconName, active, hint, trouble, onClick, title }) {
  const item = el(
    'button',
    { className: `nav-item${active ? ' active' : ''}`, title: title || label, tabIndex: active ? 0 : -1 },
    `${icon(iconName)}<span class="label">${esc(label)}</span>` +
      (trouble
        ? `<span class="badge" role="img" aria-label="${esc(trouble)}" title="${esc(trouble)}">!</span>`
        : hint
          ? `<span class="hint">${hint}</span>`
          : ''),
  )
  if (active) item.setAttribute('aria-current', 'page')
  item.addEventListener('click', onClick)
  return item
}

function renderSidebar() {
  const nav = document.getElementById('sections')
  const hadFocus = nav.contains(document.activeElement)
  nav.innerHTML = ''
  const groups = []
  state.sections.forEach((s, i) => {
    if (groups.at(-1)?.name !== s.group) groups.push({ name: s.group, items: [] })
    groups.at(-1).items.push({ s, i })
  })

  for (const { name, items } of groups) {
    // The overview stands alone, above the groups.
    if (name) nav.append(groupHeader(name))
    // A folded group still shows the section you're in.
    const shown = collapsed.has(name) ? items.filter(({ s }) => s.id === state.active) : items
    for (const { s, i } of shown) {
      const svc = sectionService(s)
      const down = svc && (svc.status === 'failed' || svc.status === 'stopped')
      const item = navItem({
        label: s.label,
        iconName: s.icon,
        active: s.id === state.active,
        hint: i < 9 ? `${mod}${i + 1}` : '',
        trouble: down ? `The ${inSentence(svc.label)} ${svc.status === 'failed' ? 'failed to start' : 'stopped'}` : '',
        onClick: () => api.navigate(s.id),
      })
      item.dataset.section = s.id
      nav.append(item)
    }
  }

  nav.append(groupHeader('Resources'))
  if (!collapsed.has('Resources')) {
    for (const r of state.resources) {
      const item = navItem({ label: r.label, iconName: RESOURCE_ICONS[r.key], title: `${r.label} (opens in your browser)`, onClick: () => api.openResource(r.key) })
      item.insertAdjacentHTML('beforeend', `<svg class="icon ext" viewBox="0 0 24 24" aria-hidden="true">${ICONS.external}</svg>`)
      nav.append(item)
    }
  }
  if (hadFocus) nav.querySelector('.nav-item.active')?.focus()
}

// Keyboard: arrows move (and select, like a Mac sidebar), Return activates,
// Left/Right fold and unfold groups, typing jumps to a section by name.
let typed = ''
let typedTimer = null
let selectTimer = null
document.getElementById('sections').addEventListener('keydown', event => {
  const nav = event.currentTarget
  const focusable = [...nav.querySelectorAll('button')]
  const index = focusable.indexOf(document.activeElement)
  const focus = target => {
    if (!target) return
    for (const b of focusable) b.tabIndex = -1
    target.tabIndex = 0
    target.focus()
    // Selecting follows focus, after a moment so quick arrowing doesn't load every page.
    clearTimeout(selectTimer)
    if (target.dataset.section) selectTimer = setTimeout(() => api.navigate(target.dataset.section), 160)
  }
  const current = document.activeElement
  if (event.key === 'ArrowDown') focus(focusable[Math.min(focusable.length - 1, index + 1)])
  else if (event.key === 'ArrowUp') focus(focusable[Math.max(0, index - 1)])
  else if (event.key === 'Home') focus(focusable[0])
  else if (event.key === 'End') focus(focusable.at(-1))
  else if (event.key === 'ArrowLeft' && current?.classList.contains('group-label') && current.classList.contains('open')) toggleGroup(current.dataset.group)
  else if (event.key === 'ArrowRight' && current?.classList.contains('group-label') && !current.classList.contains('open')) toggleGroup(current.dataset.group)
  else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && /\S/.test(event.key)) {
    typed += event.key.toLowerCase()
    clearTimeout(typedTimer)
    typedTimer = setTimeout(() => (typed = ''), 700)
    const items = focusable.filter(b => b.classList.contains('nav-item'))
    focus(items.find(b => b.querySelector('.label').textContent.toLowerCase().startsWith(typed)))
  } else return
  event.preventDefault()
})

// Drag the sidebar's edge to resize it.
const resizer = document.getElementById('sidebar-resize')
resizer.addEventListener('pointerdown', event => {
  resizer.setPointerCapture(event.pointerId)
  document.body.classList.add('resizing')
  let frame = 0
  const move = e => {
    const width = Math.min(360, Math.max(190, e.clientX))
    document.documentElement.style.setProperty('--sidebar-w', `${width}px`)
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => api.setSidebarWidth(width))
  }
  const up = () => {
    document.body.classList.remove('resizing')
    resizer.removeEventListener('pointermove', move)
    resizer.removeEventListener('pointerup', up)
  }
  resizer.addEventListener('pointermove', move)
  resizer.addEventListener('pointerup', up)
})
resizer.addEventListener('dblclick', () => {
  document.documentElement.style.setProperty('--sidebar-w', '236px')
  api.setSidebarWidth(236)
})

// ------------------------------------------------------------ Toolbar

function renderToolbar() {
  const section = currentSection()
  const page = state.page
  const svc = sectionService(section)
  const ready = !svc || svc.status === 'ready'
  const shown = !section.native && page && ready && !page.error

  document.getElementById('title').textContent = section.label
  document.getElementById('subtitle').textContent = ready ? section.description || '' : svc.detail
  document.getElementById('back').disabled = !(shown && page.canGoBack)
  document.getElementById('forward').disabled = !(shown && page.canGoForward)

  // The page's own actions, e.g. Swipe on Cards: each opens a sheet.
  const actions = document.getElementById('actions')
  actions.innerHTML = ''
  if (shown && page.loading) actions.append(el('div', { className: 'spinner', title: 'Loading…', role: 'status', ariaLabel: 'Loading' }))
  for (const action of section.actions || []) {
    const b = el('button', { className: 'tool-btn', disabled: !shown, title: `${action.label}…` }, `${icon(action.icon)}<span>${esc(action.label)}</span>`)
    b.addEventListener('click', () => api.pageAction(action.id))
    actions.append(b)
  }

  const status = document.getElementById('status')
  const note = state.notes[0]
  const level = state.summary.level === 'ok' && note ? 'note' : state.summary.level
  status.className = `status-pill ${level}`
  status.innerHTML = `<span class="dot" aria-hidden="true"></span><span>${esc(level === 'note' ? note : state.summary.text)}</span>`
  status.title = [state.summary.text, ...state.notes].join(' · ')
  status.setAttribute('aria-label', `Services: ${status.title}`)
}

document.getElementById('status').addEventListener('click', event => {
  const rect = event.currentTarget.getBoundingClientRect()
  api.statusMenu({ x: rect.left, y: rect.bottom + 6 })
})
document.getElementById('palette').addEventListener('click', () => api.palette())

// ------------------------------------------------------------ Stage

let renderedStage = null
let guideApiStatus = null

function renderStage() {
  const stage = document.getElementById('stage')
  const section = currentSection()
  const svc = sectionService(section)

  // Native sections draw themselves once their service (if any) is up.
  if (section.native && (!svc || svc.status === 'ready')) {
    if (renderedStage !== `native:${section.id}`) {
      stage.innerHTML = ''
      const helpers = { el, icon, esc }
      const builders = {
        logs: buildLogs,
        overview: buildOverview,
        requests: () => window.RequestsPage.build(api, helpers),
        guide: () => window.GuidePage.build(api, helpers),
      }
      stage.append((builders[section.id] || (() => window.ApiExplorer.build(api, helpers)))())
      renderedStage = `native:${section.id}`
      guideApiStatus = state.services.api?.status
    }
    if (section.id === 'overview') updateOverview()
    // Quick start shows the credentials once the API is up.
    if (section.id === 'guide' && guideApiStatus !== state.services.api?.status) {
      guideApiStatus = state.services.api?.status
      window.GuidePage.refresh()
    }
    return
  }

  const page = state.page
  let key
  let screen
  if (svc.status === 'ready') {
    if (!page?.error) {
      // The section's page covers the stage; keep it empty underneath.
      key = `page:${section.id}`
      screen = null
    } else {
      key = `error:${section.id}:${page.error.description}`
      screen = statusScreen({
        tone: 'bad',
        iconName: 'plug',
        title: `${section.label} didn’t load`,
        text: `${page.error.description}${page.error.url ? ` (${page.error.url})` : ''}`,
        actions: [['Try Again', 'primary', () => api.page('reload')], ['Show Logs', '', () => api.navigate('logs')]],
      })
    }
  } else if (svc.status === 'failed' || svc.status === 'stopped') {
    key = `down:${section.id}:${svc.status}:${svc.detail}`
    screen = statusScreen({
      tone: 'bad',
      iconName: 'alert',
      title: svc.status === 'failed' ? `The ${inSentence(svc.label)} couldn’t start` : `The ${inSentence(svc.label)} stopped`,
      text: svc.detail,
      actions: [
        [`Restart ${svc.label}`, 'primary', () => api.restart(svc.id)],
        ['Show Logs', '', () => api.navigate('logs')],
      ],
      tail: svc.id,
    })
  } else {
    key = `wait:${section.id}`
    screen = statusScreen({
      spinner: true,
      title: svc.status === 'building' ? `Building the ${inSentence(svc.label)}` : `Starting the ${inSentence(svc.label)}`,
      text: svc.detail,
      tail: svc.id,
    })
  }

  if (key === renderedStage) {
    // Same screen: just refresh the live parts.
    const text = stage.querySelector('[data-detail]')
    if (text && svc.detail) text.textContent = svc.detail
    updateTail()
    return
  }
  stage.innerHTML = ''
  if (screen) stage.append(screen)
  renderedStage = key
  updateTail()
}

function statusScreen({ tone, iconName, spinner, title, text, actions = [], tail }) {
  const box = el('div', { className: 'status-screen', role: 'status' })
  box.append(spinner ? el('div', { className: 'status-icon' }, '<div class="spinner large"></div>') : el('div', { className: `status-icon ${tone || ''}` }, icon(iconName)))
  box.append(el('h2', { textContent: title }))
  if (text) {
    const p = el('p', { textContent: text })
    p.dataset.detail = ''
    box.append(p)
  }
  if (actions.length) {
    const row = el('div', { className: 'status-actions' })
    for (const [label, kind, fn] of actions) {
      const b = el('button', { className: `btn ${kind}`, textContent: label })
      b.addEventListener('click', fn)
      row.append(b)
    }
    box.append(row)
  }
  if (tail) {
    const pre = el('pre', { className: 'tail' })
    pre.dataset.service = tail
    box.append(pre)
  }
  return box
}

// Last few log lines of the service a status screen is about.
function updateTail() {
  const pre = document.querySelector('.tail[data-service]')
  if (!pre) return
  const sources = state.services[pre.dataset.service].logs
  pre.textContent = logs
    .filter(l => sources.includes(l.source))
    .slice(-8)
    .map(l => l.text)
    .join('\n')
}

// ------------------------------------------------------------ Overview

// The page the app opens on: where the API is and how to sign in to it,
// what's in the sandbox, and whether everything is running. The services come
// from the app's state; the rest is asked for (api.overview()) when the page
// is shown, every few seconds while it is, and when the API starts or stops.
let overview = null
let overviewApiStatus = null
let overviewLoading = false

const STATUS_WORDS = { ready: 'Running', starting: 'Starting…', building: 'Building…', idle: 'Waiting…', failed: 'Failed', stopped: 'Stopped' }
const COUNTS = [
  ['profiles', 'Profile', 'Profiles', 'users', 'data'],
  ['accounts', 'Account', 'Accounts', 'wallet', 'accounts'],
  ['cards', 'Card', 'Cards', 'card', 'cards'],
  ['transactions', 'Transaction', 'Transactions', 'transactions', 'transactions'],
]
const SHORTCUTS = [
  ['card', 'Swipe a card', 'Make a test purchase and watch the balance change', () => api.run('action:cards:swipe-card')],
  ['code', 'Write card code', 'JavaScript that approves or declines each purchase', () => api.navigate('code')],
  ['activity', 'Inspect your requests', 'What your code sent and what came back', () => api.navigate('requests')],
  ['book', 'Make your first calls', 'A token, accounts and transactions, in your language', () => api.navigate('guide')],
  ['plug', 'Connect an AI assistant', 'Let Claude build and run card code here', () => api.run('cmd:connectAssistant')],
  ['database', 'Load a scenario', 'Swap in ready-made accounts and history', () => api.navigate('data')],
]

function copyButton(key, label) {
  const b = el('button', { className: 'btn small', type: 'button', textContent: 'Copy', ariaLabel: `Copy ${label}` })
  b.addEventListener('click', () => {
    api.overviewCopy(key)
    b.textContent = 'Copied'
    setTimeout(() => (b.textContent = 'Copy'), 1200)
  })
  return b
}

function buildOverview() {
  const page = el('div', { className: 'overview' })
  page.innerHTML = `
    <div class="ov-inner">
      <header class="ov-hero">
        <img src="assets/icon.png" alt="" width="56" height="56" />
        <div class="ov-hero-text">
          <h1>Investec Sandbox</h1>
          <p>A local copy of Investec’s programmable banking APIs, with accounts, cards and card code to try things on. Nothing here touches a real bank account.</p>
        </div>
        <div class="ov-version" id="ov-version"></div>
      </header>
      <div class="ov-notes" id="ov-notes" role="status"></div>
      <section class="ov-counts" id="ov-counts" aria-label="What’s in the sandbox"></section>
      <div class="ov-columns">
        <section class="ov-card" aria-labelledby="ov-connect-title">
          <h2 id="ov-connect-title">Connect to the API</h2>
          <div class="ov-rows" id="ov-connect"></div>
          <p class="ov-hint" id="ov-auth"></p>
        </section>
        <section class="ov-card" aria-labelledby="ov-services-title">
          <h2 id="ov-services-title">Services</h2>
          <div class="ov-rows" id="ov-services"></div>
        </section>
      </div>
      <section aria-labelledby="ov-start-title">
        <h2 id="ov-start-title" class="ov-heading">Things to try</h2>
        <div class="ov-shortcuts" id="ov-shortcuts"></div>
      </section>
      <section class="ov-card" aria-labelledby="ov-sandbox-title">
        <h2 id="ov-sandbox-title">This sandbox</h2>
        <div class="ov-rows" id="ov-sandbox"></div>
      </section>
    </div>`
  const shortcuts = page.querySelector('#ov-shortcuts')
  for (const [iconName, title, text, run] of SHORTCUTS) {
    const b = el('button', { className: 'ov-shortcut', type: 'button' }, `${icon(iconName)}<span><strong>${esc(title)}</strong><small>${esc(text)}</small></span>`)
    b.addEventListener('click', run)
    shortcuts.append(b)
  }
  overviewApiStatus = null
  // Filled in once it's in the page (renderStage calls updateOverview next).
  return page
}

function overviewRow(name, value, { mono = true, button, title } = {}) {
  const row = el('div', { className: 'ov-row' })
  row.append(el('span', { className: 'ov-name', textContent: name }), el('span', { className: `ov-value${mono ? ' mono' : ''}`, textContent: value, title: title ?? value }))
  if (button) row.append(button)
  return row
}

function linkButton(label, run) {
  const b = el('button', { className: 'btn small', type: 'button', textContent: label })
  b.addEventListener('click', run)
  return b
}

function drawOverviewServices() {
  const list = document.getElementById('ov-services')
  if (!list) return
  list.innerHTML = ''
  for (const [id, svc] of Object.entries(state.services)) {
    const down = svc.status === 'failed' || svc.status === 'stopped'
    const row = el('div', { className: 'ov-row' })
    row.append(
      el('span', { className: `dot ${svc.status}`, ariaHidden: 'true' }),
      el('span', { className: 'ov-name', textContent: svc.label }),
      el('span', { className: `ov-value${down ? ' bad' : svc.status === 'ready' ? ' mono' : ''}`, textContent: svc.status === 'ready' ? svc.url.replace(/^https?:\/\//, '') : down ? svc.detail || STATUS_WORDS[svc.status] : STATUS_WORDS[svc.status] || svc.status, title: svc.detail || '' }),
    )
    if (down) row.append(linkButton('Restart', () => api.restart(id)))
    list.append(row)
  }
}

function drawOverviewData() {
  const d = overview
  if (!d || !document.getElementById('ov-connect')) return
  document.getElementById('ov-version').textContent = `Version ${d.version}${d.mode === 'dev' ? ' · development' : d.mode === 'build' ? ' · local build' : ''}`

  const notes = document.getElementById('ov-notes')
  notes.innerHTML = ''
  if (d.faults) notes.append(noteBar('Fault injection is on, so some API calls fail on purpose.', 'Open Faults', 'faults'))
  if (d.offsetDays) {
    const days = Math.abs(d.offsetDays)
    notes.append(noteBar(`The sandbox date is ${days} day${days === 1 ? '' : 's'} ${d.offsetDays > 0 ? 'ahead of' : 'behind'} today.`, 'Open Clock', 'clock'))
  }

  const counts = document.getElementById('ov-counts')
  counts.innerHTML = ''
  for (const [key, one, many, iconName, target] of COUNTS) {
    const n = d.counts?.[key]
    const tile = el('button', { className: 'ov-count', type: 'button', title: `Open ${many}` }, `${icon(iconName)}<span class="ov-number">${n === undefined ? '–' : esc(Number(n).toLocaleString())}</span><span class="ov-label">${n === 1 ? one : many}</span>`)
    tile.addEventListener('click', () => api.navigate(target))
    counts.append(tile)
  }

  const connect = document.getElementById('ov-connect')
  connect.innerHTML = ''
  connect.append(overviewRow('Base URL', d.apiUrl, { button: copyButton('apiUrl', 'the API base URL') }))
  if (d.api) {
    if (d.clientId) connect.append(overviewRow('Client ID', d.clientId, { button: copyButton('clientId', 'the client ID') }))
    if (d.hasClientSecret) connect.append(overviewRow('Client secret', '••••••••••••••••', { button: copyButton('clientSecret', 'the client secret'), title: 'Hidden: Copy puts the real value on the clipboard' }))
    if (d.hasApiKey) connect.append(overviewRow('API key', '••••••••••••••••', { button: copyButton('apiKey', 'the API key'), title: 'Hidden: Copy puts the real value on the clipboard' }))
  }
  document.getElementById('ov-auth').textContent = !d.api
    ? 'The credentials appear here once the API is running.'
    : d.auth
      ? 'Authentication is on: get a token with these credentials (POST /identity/v2/oauth2/token). Change them under Settings.'
      : 'Authentication is off, so requests don’t need a token. Turn it on under Settings.'

  const sandbox = document.getElementById('ov-sandbox')
  sandbox.innerHTML = ''
  if (d.today) sandbox.append(overviewRow('Sandbox date', new Date(`${d.today}T12:00:00`).toLocaleDateString([], { dateStyle: 'long' }), { mono: false, button: linkButton('Clock', () => api.navigate('clock')) }))
  if (d.api) sandbox.append(overviewRow('Fault injection', d.faults ? 'On' : 'Off', { mono: false, button: linkButton('Faults', () => api.navigate('faults')) }))
  sandbox.append(overviewRow('Card code MCP server', d.mcpUrl, { button: copyButton('mcpUrl', 'the MCP server address') }))
  sandbox.append(overviewRow('Data', d.dataLocation, { button: linkButton('Show in Finder', () => api.run('app:showData')) }))
  sandbox.append(overviewRow('Ports and startup', 'Change the ports, the menu bar icon and opening at login', { mono: false, button: linkButton('Settings…', () => api.run('app:preferences')) }))
}

function noteBar(text, label, target) {
  const bar = el('div', { className: 'ov-note' }, `${icon('alert')}<span>${esc(text)}</span>`)
  bar.append(linkButton(label, () => api.navigate(target)))
  return bar
}

async function loadOverview() {
  if (overviewLoading) return
  overviewLoading = true
  try {
    const next = await api.overview()
    // Redraw only on a change: it would take the focus from a button.
    const changed = JSON.stringify(next) !== JSON.stringify(overview)
    overview = next
    if (changed || !document.getElementById('ov-connect')?.firstChild) drawOverviewData()
  } catch {
  } finally {
    overviewLoading = false
  }
}

// Called on every state change while the overview is showing.
function updateOverview() {
  drawOverviewServices()
  const status = state.services.api?.status
  if (status !== overviewApiStatus) {
    overviewApiStatus = status
    // What's known already shows at once (when coming back to the page).
    if (overview && !document.getElementById('ov-connect')?.firstChild) drawOverviewData()
    void loadOverview()
  }
}

// Counts and the sandbox date change as the sandbox is used.
setInterval(() => {
  if (state?.active === 'overview' && !document.hidden) void loadOverview()
}, 5000)

// ------------------------------------------------------------ Logs

let logFilter = 'all'
let logSearch = ''
let follow = true
let paused = false
let pendingWhilePaused = 0
let clearedThrough = 0
const LOG_GROUPS = [
  ['all', 'All', null],
  ['app', 'App', ['app']],
  ['api', 'API', ['api']],
  ['web', 'Dashboard', ['web']],
  ['editor', 'Card editor', ['editor']],
  ['card', 'Card server', ['card', 'card-build']],
  ['mcp', 'MCP server', ['mcp', 'mcp-build']],
]
const SOURCE_NAMES = { app: 'app', api: 'api', web: 'dashboard', editor: 'editor', card: 'card', 'card-build': 'card build', mcp: 'mcp', 'mcp-build': 'mcp build' }

function matchesFilter(l) {
  const group = LOG_GROUPS.find(g => g[0] === logFilter)[2]
  return l.id > clearedThrough && (!group || group.includes(l.source)) && (!logSearch || l.text.toLowerCase().includes(logSearch))
}

function buildLogs() {
  const wrap = el('div', { className: 'logs' })
  const bar = el('div', { className: 'logs-bar' })
  const chips = el('div', { className: 'chips', role: 'radiogroup', ariaLabel: 'Show lines from' })
  for (const [id, label] of LOG_GROUPS) {
    const chip = el('button', { className: `chip${logFilter === id ? ' on' : ''}`, textContent: label, role: 'radio' })
    chip.setAttribute('aria-checked', String(logFilter === id))
    chip.addEventListener('click', () => {
      logFilter = id
      chips.querySelectorAll('.chip').forEach(c => {
        c.classList.toggle('on', c === chip)
        c.setAttribute('aria-checked', String(c === chip))
      })
      renderLogList()
    })
    chips.append(chip)
  }
  const search = el('input', { className: 'search', type: 'search', placeholder: 'Filter', value: logSearch, ariaLabel: 'Filter lines' })
  search.addEventListener('input', () => {
    logSearch = search.value.toLowerCase()
    renderLogList()
  })
  const tool = (name, title, fn) => {
    const b = el('button', { className: 'icon-btn', title, ariaLabel: title }, icon(name))
    b.addEventListener('click', () => fn(b))
    return b
  }
  const pause = tool(paused ? 'play' : 'pause', paused ? 'Resume' : 'Pause', b => {
    paused = !paused
    b.innerHTML = icon(paused ? 'play' : 'pause')
    b.title = b.ariaLabel = paused ? 'Resume' : 'Pause'
    wrap.classList.toggle('paused', paused)
    if (!paused) {
      pendingWhilePaused = 0
      renderLogList()
    }
    updatePausedNote()
  })
  const clear = tool('trash', 'Clear', () => {
    clearedThrough = logs.at(-1)?.id ?? 0
    renderLogList()
  })
  const save = tool('download', 'Export…', () => api.saveLogs(visibleLogs().map(formatLine).join('\n')))
  const copy = tool('copy', 'Copy visible lines', () => api.copy(visibleLogs().map(formatLine).join('\n')))
  const bottom = tool('bottom', 'Scroll to latest', () => {
    follow = true
    const list = wrap.querySelector('.log-list')
    list.scrollTop = list.scrollHeight
  })
  bar.append(chips, search, pause, clear, copy, save, bottom)

  const note = el('div', { className: 'paused-note', role: 'status' })
  const list = el('div', { className: 'log-list', role: 'log', ariaLabel: 'Log lines' })
  list.addEventListener('scroll', () => {
    follow = list.scrollTop + list.clientHeight >= list.scrollHeight - 24
  })
  wrap.classList.toggle('paused', paused)
  wrap.append(bar, note, list)
  requestAnimationFrame(() => {
    renderLogList()
    updatePausedNote()
  })
  return wrap
}

function updatePausedNote() {
  const note = document.querySelector('.paused-note')
  if (note) note.textContent = paused ? `Paused${pendingWhilePaused ? ` · ${pendingWhilePaused} new line${pendingWhilePaused === 1 ? '' : 's'}` : ''}` : ''
}

const visibleLogs = () => logs.filter(matchesFilter)
const time = t => new Date(t).toLocaleTimeString([], { hour12: false })
const formatLine = l => `${time(l.time)} [${SOURCE_NAMES[l.source] || l.source}] ${l.text}`
const isErrorLine = text => /\b(error|failed|exception|ERR_)\b/i.test(text)
// An HTTP request line (morgan): "GET /path HTTP/1.1" 200 …
const HTTP_LINE = /"([A-Z]+) ([^ "]+) HTTP\/[\d.]+" (\d{3}) /

function lineEl(l) {
  const http = HTTP_LINE.exec(l.text)
  const status = http ? Number(http[3]) : 0
  const row = el('div', { className: `log-line${status >= 500 || (!http && isErrorLine(l.text)) ? ' error' : status >= 400 ? ' warn' : ''}` })
  const msg = el('span', { className: 'msg' })
  if (http) {
    // Method, path and status first; the rest (client, agent) muted.
    msg.append(
      el('span', { className: 'method', textContent: http[1] }),
      document.createTextNode(` ${http[2]} `),
      el('span', { className: `http-status s${String(status)[0]}xx`, textContent: String(status) }),
      el('span', { className: 'rest', textContent: ` ${l.text.slice(http.index + http[0].length)}` }),
    )
  } else msg.textContent = l.text
  row.append(el('span', { className: 'time', textContent: time(l.time) }), el('span', { className: `src src-${l.source}`, textContent: SOURCE_NAMES[l.source] || l.source }), msg)
  return row
}

function renderLogList() {
  const list = document.querySelector('.log-list')
  if (!list) return
  const lines = visibleLogs()
  list.innerHTML = ''
  if (!lines.length) {
    list.append(el('div', { className: 'logs-empty', textContent: logs.length ? (clearedThrough ? 'Cleared. New lines appear here.' : 'No lines match.') : 'Nothing logged yet.' }))
    return
  }
  const frag = document.createDocumentFragment()
  for (const l of lines) frag.append(lineEl(l))
  list.append(frag)
  if (follow) list.scrollTop = list.scrollHeight
}

function appendLog(entry) {
  // A line logged while the shell loads can arrive in its history and live.
  if (logs.length && entry.id <= logs.at(-1).id) return
  logs.push(entry)
  if (logs.length > MAX_LOGS) logs.shift()
  const list = document.querySelector('.log-list')
  if (list && matchesFilter(entry)) {
    if (paused) {
      pendingWhilePaused++
      updatePausedNote()
    } else {
      list.querySelector('.logs-empty')?.remove()
      list.append(lineEl(entry))
      while (list.childElementCount > MAX_LOGS) list.firstElementChild.remove()
      if (follow) list.scrollTop = list.scrollHeight
    }
  }
  updateTail()
}

// ------------------------------------------------------------ Wiring

function render() {
  document.body.classList.toggle('sidebar-hidden', !state.sidebarVisible)
  // Mac selection colours: accent while the window is in front, grey when not.
  document.body.classList.toggle('window-inactive', !state.focused)
  document.documentElement.style.setProperty('--sidebar-w', `${state.sidebarWidth}px`)
  if (state.accent) document.documentElement.style.setProperty('--accent', state.accent)
  renderSidebar()
  renderToolbar()
  renderStage()
}

document.getElementById('sidebar-toggle').innerHTML = icon('sidebar')
document.getElementById('back').innerHTML = icon('back')
document.getElementById('forward').innerHTML = icon('forward')
document.getElementById('palette').innerHTML = icon('search')
document.getElementById('sidebar-toggle').addEventListener('click', () => api.toggleSidebar())
document.getElementById('back').addEventListener('click', () => api.page('back'))
document.getElementById('forward').addEventListener('click', () => api.page('forward'))

api.onAccent(hex => document.documentElement.style.setProperty('--accent', hex))
api.init().then(({ state: initial, logs: history }) => {
  document.body.classList.add(`platform-${initial.platform}`)
  logs.push(...history)
  state = initial
  render()
})
api.onState(next => {
  state = next
  render()
})
api.onLog(appendLog)
