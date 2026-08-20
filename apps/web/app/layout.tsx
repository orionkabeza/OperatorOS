import "@fontsource-variable/archivo";
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "OperatorOS",
  description: "The record of everything that happens in your business.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading a dynamic API here (headers()) opts this layout out of static
  // rendering, which is what makes the per-request CSP nonce from
  // middleware.ts actually per-request instead of baked in at build time.
  const nonce = headers().get("x-nonce") ?? undefined;

  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        {/* Next reads this nonce off the response CSP header itself for its
            own inline bootstrap scripts; this meta tag is the documented
            way to also make it available to any script we render ourselves. */}
        {nonce ? <meta name="x-nonce" content={nonce} /> : null}
      </body>
    </html>
  );
}
