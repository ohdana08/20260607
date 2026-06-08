import type { NextConfig } from "next";

// The tool is embedded into the BCC homepage (static GitHub Pages site) at
// https://ohdana08.github.io/bcc-homepage/#tools via an <iframe> pointing at /embed.
// Only that origin may frame us; every other path forbids framing entirely.
const HOMEPAGE_ORIGIN = "https://ohdana08.github.io";
const EMBED_CSP = `frame-ancestors 'self' ${HOMEPAGE_ORIGIN};`;
const DEFAULT_CSP = "frame-ancestors 'none';";

const nextConfig: NextConfig = {
  // Native module: keep external so its prebuilt .node binary is traced into
  // the serverless function (otherwise SVG→PNG fails at runtime on Vercel).
  serverExternalPackages: ["@resvg/resvg-js"],
  async headers() {
    return [
      {
        // Embeddable entry point — allow framing from the homepage only.
        source: "/embed/:path*",
        headers: [{ key: "Content-Security-Policy", value: EMBED_CSP }],
      },
      {
        // Everything except /embed — never allow framing.
        source: "/((?!embed).*)",
        headers: [
          { key: "Content-Security-Policy", value: DEFAULT_CSP },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
