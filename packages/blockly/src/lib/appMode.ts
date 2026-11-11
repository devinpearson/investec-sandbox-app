/**
 * True when the editor runs inside the Investec Sandbox desktop app, which
 * loads it with `?app`. The app has its own title bar, help and card server,
 * so the editor drops its page header, footer and server setup help, and
 * keeps to a fixed, full-window layout.
 */
export const inApp =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("app");
