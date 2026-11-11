/** @type {import('tailwindcss').Config} */
import forms from "@tailwindcss/forms";

export default {
  content: ["./index.html", "./code.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Indigo reads CSS variables (defaults in style.css) so the desktop app
      // can swap in the system accent colour.
      colors: {
        indigo: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map(
            (shade) => [shade, `rgb(var(--accent-${shade}) / <alpha-value>)`],
          ),
        ),
      },
    },
  },
  plugins: [forms],
};
