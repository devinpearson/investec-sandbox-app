// Preload for the app's own small windows (ui/*.html): the launch splash,
// Preferences, the welcome sheet and the command palette. Each can only use its own channels.
const { contextBridge, ipcRenderer } = require('electron')

const allowed = channel => /^(prefs|welcome|palette|splash):[a-z-]+$/.test(channel)

contextBridge.exposeInMainWorld('aux', {
  invoke: (channel, ...args) => (allowed(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error('Not allowed'))),
  send: (channel, ...args) => {
    if (allowed(channel)) ipcRenderer.send(channel, ...args)
  },
  on: (channel, callback) => {
    if (allowed(channel)) ipcRenderer.on(channel, (_e, ...args) => callback(...args))
  },
})
