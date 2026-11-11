export default {
  plugins: {
    // Monaco's CSS uses nesting; flatten it before Tailwind sees it.
    "tailwindcss/nesting": {},
    tailwindcss: {},
    autoprefixer: {},
  },
};
