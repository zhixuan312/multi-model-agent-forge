import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server output → a slim Docker runtime (server.js + NFT-traced deps),
  // matching the CapRover deploy pattern (see captain-definition).
  output: "standalone",

  // puppeteer is lazily imported in the PDF-export route (src/export/pdf/render.ts).
  // Force it into the standalone trace so headless-Chrome rendering works in prod.
  outputFileTracingIncludes: {
    "/api/projects/**": ["./node_modules/puppeteer/**"],
  },

  async headers() {
    const csp = [
      "default-src 'self'",
      // Next hydration uses inline scripts; mermaid/three may eval.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' https: data: blob:",
      // Same-origin API + SSE; the server proxies MMA, the client never reaches it directly.
      "connect-src 'self' https:",
      // 3d-force-graph / three.js spin up blob workers.
      "worker-src 'self' blob:",
      "frame-ancestors 'self'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // microphone=(self) — the exploration voice-transcription feature needs getUserMedia.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
