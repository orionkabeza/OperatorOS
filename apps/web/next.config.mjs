import { execSync } from "node:child_process";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@operatoros/shared"],
  // web-01/web-02 are ~1GB boxes with no swap, already running two other
  // live apps -- shipping the full node_modules tree and running `next
  // start` there risks memory pressure on infra this app doesn't own.
  // Standalone output traces only the modules actually used at runtime
  // into .next/standalone, built off-box and deployed as a lean bundle
  // instead (see docs/RUNBOOK.md).
  output: "standalone",
  // deploy-operatoros.sh runs `next build` independently on EACH box
  // (web-01 and web-02), not once and shipped -- Next.js's default
  // build id is a random string per invocation, so two boxes building
  // the identical commit still got different ids, and HAProxy
  // round-robining a browser between them mid-session meant the HTML
  // from one box referenced chunk hashes the OTHER box never built,
  // 404ing and crashing hydration. Deriving the build id from the git
  // commit makes both boxes produce the SAME id for the same commit,
  // closing that gap without needing to build once and transfer the
  // artifact between boxes (see docs/DECISIONS.md).
  generateBuildId: () => execSync("git rev-parse HEAD").toString().trim(),
};

export default nextConfig;
