// The launch splash: status and progress come from main.js (windows.js).
const status = document.getElementById('status')
const bar = document.getElementById('bar')

requestAnimationFrame(() => document.body.classList.add('shown'))

window.aux.on('splash:status', ({ text, progress, bad, version }) => {
  status.textContent = text
  status.classList.toggle('bad', Boolean(bad))
  bar.style.width = `${Math.max(8, Math.round(progress * 100))}%`
  if (version) document.getElementById('version').textContent = `Version ${version}`
})
window.aux.on('splash:close', () => document.body.classList.add('closing'))
