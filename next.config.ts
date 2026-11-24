import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone checkout: Next is installed here. Inside the saas-projects workspace it's hoisted to the parent folder.
  turbopack: { root: fs.existsSync(path.join(__dirname, "node_modules", "next")) ? __dirname : path.join(__dirname, "..") },
  // Bundle the demo snapshot with the server functions (copied to /tmp on Vercel; see lib/db.ts).
  outputFileTracingIncludes: { "/**": ["./seed/**/*"] },
  // Pin the data folder to this project, no matter which directory the server is started from.
  env: { APP_DIR: __dirname },
  // File uploads go through server actions; allow up to 25 MB.
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
};

export default nextConfig;
