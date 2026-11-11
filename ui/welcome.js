// The welcome sheet: where the API is and how to sign in to it.
const $ = id => document.getElementById(id)

function row(name, value, secret) {
  const el = document.createElement('div')
  el.className = 'row detail'
  const label = Object.assign(document.createElement('span'), { className: 'name', textContent: name })
  const text = Object.assign(document.createElement('span'), { className: 'value', textContent: secret ? '•'.repeat(Math.min(24, value.length)) : value, title: secret ? 'Hidden: Copy puts the real value on the clipboard' : value })
  const copy = Object.assign(document.createElement('button'), { className: 'btn', type: 'button', textContent: 'Copy' })
  copy.addEventListener('click', () => {
    window.aux.send('welcome:copy', value)
    copy.textContent = 'Copied'
    setTimeout(() => (copy.textContent = 'Copy'), 1200)
  })
  el.append(label, text, copy)
  return el
}

window.aux.invoke('welcome:data').then(data => {
  const details = $('details')
  details.append(row('API base URL', data.apiUrl))
  if (data.clientId) details.append(row('Client ID', data.clientId))
  if (data.clientSecret) details.append(row('Client secret', data.clientSecret, true))
  if (data.apiKey) details.append(row('API key', data.apiKey, true))
  $('auth-note').textContent = data.auth
    ? 'Authentication is on: get a token with these credentials (POST /identity/v2/oauth2/token).'
    : 'Authentication is off, so requests don’t need a token. Turn it on under Sandbox → Settings.'
})

$('swipe').addEventListener('click', () => window.aux.send('welcome:swipe'))
$('postman').addEventListener('click', () => window.aux.send('welcome:postman'))
$('close').addEventListener('click', () => window.aux.send('welcome:close'))
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') window.aux.send('welcome:close')
})
