// Preload for the section pages (dashboard, card editor): gives them
// `window.sandboxApp`, so they can use native confirm sheets, Save panels and
// notifications, and open the forms the toolbar's buttons ask for. Pages
// check for it and fall back to the web way in a browser.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sandboxApp', {
  // { message, detail?, confirmLabel, destructive? } → true if confirmed.
  confirm: options => ipcRenderer.invoke('page:confirm', options),
  // Resolves to the saved file's path, or null if cancelled.
  saveFile: (fileName, text) => ipcRenderer.invoke('page:save', { fileName, text }),
  notify: (message, options) => ipcRenderer.send('page:notify', { message: String(message), error: Boolean(options?.error) }),
  // The toolbar's page actions, by id (e.g. 'swipe-card'). Returns an unsubscribe.
  onAction: callback => {
    const listener = (_event, id) => callback(id)
    ipcRenderer.on('page:action', listener)
    return () => ipcRenderer.removeListener('page:action', listener)
  },
})
