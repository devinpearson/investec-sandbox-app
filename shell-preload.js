// Bridge between the shell UI (shell.html) and the main process.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sandbox', {
  init: () => ipcRenderer.invoke('shell:init'),
  onState: cb => ipcRenderer.on('state', (_e, state) => cb(state)),
  onLog: cb => ipcRenderer.on('log', (_e, entry) => cb(entry)),
  onAccent: cb => ipcRenderer.on('accent', (_e, hex) => cb(hex)),
  navigate: id => ipcRenderer.send('shell:navigate', id),
  page: command => ipcRenderer.send('shell:page', command),
  // A toolbar button: opens the page's form of that id as a sheet.
  pageAction: id => ipcRenderer.send('shell:page-action', id),
  restart: id => ipcRenderer.send('shell:restart', id),
  toggleSidebar: () => ipcRenderer.send('shell:toggle-sidebar'),
  setSidebarWidth: width => ipcRenderer.send('shell:sidebar-width', width),
  // The service status menu, shown at a point in the window.
  statusMenu: point => ipcRenderer.send('shell:status-menu', point),
  palette: () => ipcRenderer.send('shell:palette'),
  openResource: key => ipcRenderer.send('shell:resource', key),
  copy: text => ipcRenderer.send('shell:copy', text),
  // The Overview section: its details, copying one of them (secrets are
  // copied by name, never sent here), and running a command by palette id.
  overview: () => ipcRenderer.invoke('shell:overview'),
  overviewCopy: key => ipcRenderer.send('shell:overview-copy', key),
  run: id => ipcRenderer.send('shell:run', id),
  // Requests: the calls the API received (pushed as they finish).
  requests: () => ipcRenderer.invoke('shell:requests'),
  request: id => ipcRenderer.invoke('shell:request', id),
  clearRequests: () => ipcRenderer.send('shell:requests-clear'),
  replayRequest: id => ipcRenderer.invoke('shell:request-replay', id),
  onRequest: cb => ipcRenderer.on('request', (_e, summary) => cb(summary)),
  // Quick start: the steps and snippets, copying one with the real
  // credentials in, running a step, and hearing when one arrives.
  guide: () => ipcRenderer.invoke('shell:guide'),
  guideCopy: (language, step) => ipcRenderer.invoke('shell:guide-copy', { language, step }),
  guideRun: step => ipcRenderer.invoke('shell:guide-run', step),
  guideReset: () => ipcRenderer.send('shell:guide-reset'),
  onGuide: cb => ipcRenderer.on('guide', (_e, step) => cb(step)),
  saveLogs: text => ipcRenderer.invoke('shell:save-logs', text),
  // The API explorer.
  apiDoc: () => ipcRenderer.invoke('shell:api-doc'),
  apiUrl: () => ipcRenderer.invoke('shell:api-url'),
  apiRequest: request => ipcRenderer.invoke('shell:api-request', request),
})
