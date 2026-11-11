import type { NextConfig } from "next";
import path from "path";

// web/ is its own app: pin its root so Next doesn't guess from lockfiles in
// parent folders (the API's, or a stray one in the home directory).
const root = path.resolve(process.cwd());

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // NEXT_OUTPUT=export builds static files, which the desktop app serves
  // itself (no Next.js server); standalone builds a self-contained server.
  output:
    process.env.NEXT_OUTPUT === "export"
      ? "export"
      : process.env.NEXT_OUTPUT === "standalone"
        ? "standalone"
        : undefined,
  // Static files have no server to optimise images.
  images: { unoptimized: process.env.NEXT_OUTPUT === "export" },
  outputFileTracingRoot: root,
  turbopack: {
    root,
  },
};

export default nextConfig;
