import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Blockly loads its sounds and cursors from /media at runtime.
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/blockly/media/*",
          dest: "media",
          // v4 keeps the source folders by default; serve the files flat.
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  build: {
    rolldownOptions: {
      // The Blockly editor, and the code editor (Monaco) at /code.html.
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        code: fileURLToPath(new URL("./code.html", import.meta.url)),
      },
      output: {
        // Vendor code in its own long-cached chunks; Blockly alone is ~700 kB.
        codeSplitting: {
          groups: [
            { name: "blockly", test: /node_modules[\\/]@?blockly/ },
            { name: "monaco", test: /node_modules[\\/]monaco-editor/ },
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
    // Blockly and Monaco can't be split further; keep the warning for
    // anything else.
    chunkSizeWarningLimit: 3400,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
