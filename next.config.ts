import type { NextConfig } from "next";

/**
 * Packages that stay as plain `require` calls in the server build: native modules and packages
 * that read files or spawn processes next to their own sources.
 */
const SERVER_EXTERNAL_PACKAGES = [
  "better-sqlite3",
  "@node-rs/argon2",
  "chokidar",
  "systeminformation",
  "simple-git",
  "trash",
  "archiver",
  "node-pty",
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  /* Dev only: `npm run dev` is opened at 127.0.0.1 as well as localhost (Next allows only localhost by default). */
  allowedDevOrigins: ["127.0.0.1"],
  images: { unoptimized: true },
  serverExternalPackages: SERVER_EXTERNAL_PACKAGES,
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
