/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework. Full security response headers (CSP, HSTS,
  // X-Frame-Options, etc.) are applied at the nginx layer in front of this
  // app (see the operatoros vhost); the app is bound to 127.0.0.1 so nginx is
  // the only ingress.
  poweredByHeader: false,
};

export default nextConfig;
