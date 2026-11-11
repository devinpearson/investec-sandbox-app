// Settings (⌘,): the app's own preferences. See prefs.js and windows.js.
const $ = id => document.getElementById(id)
const PORT_IDS = ['api', 'web', 'editor', 'card', 'mcp']
let saved = {}

async function load() {
  saved = await window.aux.invoke('prefs:get')
  $('openAtLogin').checked = Boolean(saved.openAtLogin)
  $('menuBar').checked = saved.menuBar !== false
  for (const id of PORT_IDS) $(`port-${id}`).value = saved.ports[id]
  $('dataLocation').textContent = saved.dataLocation
  $('dataLocation').title = saved.dataLocation
  check()
}

for (const id of ['openAtLogin', 'menuBar']) {
  $(id).addEventListener('change', () => window.aux.invoke('prefs:set', { [id]: $(id).checked }))
}

const entered = () => Object.fromEntries(PORT_IDS.map(id => [id, Number($(`port-${id}`).value)]))

// What's wrong with the ports as typed, by service ({} when they can be used).
function problems(ports) {
  const found = {}
  for (const id of PORT_IDS) {
    const port = ports[id]
    if (!Number.isInteger(port) || port < 1024 || port > 65535) found[id] = 'Ports are whole numbers from 1024 to 65535.'
    else if (PORT_IDS.some(other => other !== id && ports[other] === port)) found[id] = `Each service needs its own port: ${port} is used twice.`
  }
  return found
}

// Shows what's wrong, or which services had to move, and whether there's
// anything to apply.
function check() {
  const ports = entered()
  const found = problems(ports)
  for (const id of PORT_IDS) $(`port-${id}`).classList.toggle('invalid', id in found)
  const changed = PORT_IDS.some(id => ports[id] !== Number(saved.ports[id]))
  const error = Object.values(found)[0]
  const moved = PORT_IDS.filter(id => saved.current[id] !== Number(saved.ports[id]))
  const note = $('ports-note')
  note.classList.toggle('error', Boolean(error))
  note.textContent =
    error ||
    (changed
      ? 'Restart the services to use these ports. Apps that call the sandbox need the new addresses.'
      : moved.length
        ? `In use now: ${moved.map(id => `${saved.labels[id]} is on ${saved.current[id]} (${saved.ports[id]} is taken)`).join(', ')}.`
        : 'Each service uses its port, or the next free one if another program has it.')
  $('apply').disabled = busy || Boolean(error) || !changed
  $('reset').disabled = busy || PORT_IDS.every(id => ports[id] === saved.defaultPorts[id])
}

let busy = false
for (const id of PORT_IDS) $(`port-${id}`).addEventListener('input', check)

$('reset').addEventListener('click', () => {
  for (const id of PORT_IDS) $(`port-${id}`).value = saved.defaultPorts[id]
  check()
})

async function apply() {
  const ports = entered()
  if ($('apply').disabled) return
  busy = true
  check()
  $('apply').textContent = 'Restarting…'
  try {
    if (await window.aux.invoke('prefs:set', { ports })) await window.aux.invoke('prefs:restart')
  } finally {
    busy = false
    $('apply').textContent = 'Restart Services'
    await load()
  }
}
$('apply').addEventListener('click', apply)
// Return in a port field applies.
$('ports').addEventListener('submit', event => event.preventDefault())
$('ports').addEventListener('keydown', event => {
  if (event.key === 'Enter') apply()
})

$('showData').addEventListener('click', () => window.aux.send('prefs:show-data'))
$('welcome').addEventListener('click', () => window.aux.send('prefs:welcome'))

load()
