// Shared by the app (main.js) and the build scripts (scripts/).

module.exports = {
  // The Node.js the services run on, bundled into the app. Native modules
  // (Prisma's engine, isolated-vm) are installed for this exact version.
  NODE_VERSION: '22.16.0',

  // The port each service uses unless another is set in Settings (or it's
  // taken). Builds of the dashboard and card editor fall back to these
  // addresses when they run outside the app.
  PORTS: {
    api: 3000,
    web: 3001,
    editor: 3002,
    card: 3010,
    // The MCP server: AI assistants manage card code through it, and the
    // editors read and save the card code library through it.
    mcp: 3020,
  },
}
