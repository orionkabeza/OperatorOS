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
};

export default nextConfig;
