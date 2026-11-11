// The command palette (⌘K). Items come from main.js (paletteItems); typing
// filters them, arrows move, Return runs, Escape closes.
const query = document.getElementById('query')
const results = document.getElementById('results')
const empty = document.getElementById('empty')
let items = []
let shown = []
let selected = 0

// Every typed character must appear in order; earlier and word-start
// matches rank higher.
function score(text, q) {
  if (!q) return 1
  const t = text.toLowerCase()
  if (t.includes(q)) return 100 - t.indexOf(q) + (t.startsWith(q) || t.includes(` ${q}`) ? 50 : 0)
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length ? 10 : 0
}

function render() {
  const q = query.value.trim().toLowerCase()
  shown = items
    .map(item => ({ item, s: Math.max(score(item.title, q), score(`${item.subtitle || ''}`, q) / 4) }))
    .filter(x => x.s > 0)
    .sort((a, b) => (q ? b.s - a.s : 0))
    .map(x => x.item)
  selected = Math.min(selected, Math.max(0, shown.length - 1))
  results.innerHTML = ''
  empty.hidden = shown.length > 0
  let group = null
  shown.forEach((item, i) => {
    // Without a query, keep the groups; with one, best matches first.
    if (!q && item.group !== group) {
      group = item.group
      results.append(Object.assign(document.createElement('li'), { className: 'group-label', textContent: group, role: 'presentation' }))
    }
    const li = document.createElement('li')
    li.className = 'item'
    li.role = 'option'
    li.id = `item-${i}`
    li.setAttribute('aria-selected', String(i === selected))
    li.append(Object.assign(document.createElement('span'), { className: 'title', textContent: item.title }))
    if (item.subtitle) li.append(Object.assign(document.createElement('span'), { className: 'subtitle', textContent: item.subtitle }))
    li.addEventListener('mousemove', () => select(i))
    li.addEventListener('click', () => run(i))
    results.append(li)
  })
  query.setAttribute('aria-activedescendant', shown.length ? `item-${selected}` : '')
}

function select(i) {
  if (i === selected) return
  selected = i
  for (const el of results.querySelectorAll('.item')) el.setAttribute('aria-selected', String(el.id === `item-${i}`))
  document.getElementById(`item-${i}`)?.scrollIntoView({ block: 'nearest' })
  query.setAttribute('aria-activedescendant', `item-${i}`)
}

function run(i) {
  const item = shown[i]
  if (item) window.aux.send('palette:run', item.id)
}

query.addEventListener('input', () => {
  selected = 0
  render()
})
query.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') select(Math.min(shown.length - 1, selected + 1))
  else if (e.key === 'ArrowUp') select(Math.max(0, selected - 1))
  else if (e.key === 'Enter') run(selected)
  else if (e.key === 'Escape') window.aux.send('palette:close')
  else return
  e.preventDefault()
})

async function load() {
  items = await window.aux.invoke('palette:items')
  render()
  query.focus()
}
window.aux.on('palette:refresh', () => {
  query.value = ''
  load()
})
load()
