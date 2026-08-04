import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server output → a slim Docker runtime (server.js + NFT-traced deps).
  // Consumed by the one build definition, `Dockerfile`, whose runner stage copies
  // `.next/standalone`. (This pointed at a `captain-definition` CapRover build that was
  // deleted: it was a second, divergent Dockerfile that copied `src/mock/data`, a
  // directory removed with the mock backend, so it could no longer build — and it ran
  // `node server.js` directly, with no DB migration and no MMA engine.)
  output: "standalone",


  // puppeteer is lazily imported in the PDF-export route (src/export/pdf/render.ts).
  // Force it into the standalone trace so headless-Chrome rendering works in prod.
  outputFileTracingIncludes: {
    "/api/projects/**": ["./node_modules/puppeteer/**"],
  },

  // pdf-parse reads back the pass-1 PDF so the exported Contents page can carry real
  // page numbers (src/export/pdf/render.ts). It wraps pdfjs-dist, which imports its
  // worker as a path RELATIVE to its own module at runtime. Bundled into the server
  // chunks, that path no longer exists, and every measure failed with
  //   Setting up fake worker failed: "Cannot find module .next/…/pdf.worker.mjs"
  // on every export — so the Contents page shipped with every page-number cell blank
  // while the test suite, which loads pdf-parse straight from node_modules, measured
  // it correctly and passed. Keeping it external lets it resolve its own files.
  serverExternalPackages: ["pdf-parse"],

  async headers() {
    const csp = [
      "default-src 'self'",
      // Next hydration uses inline scripts; mermaid/three may eval.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' https: data: blob:",
      // Same-origin API + SSE; the server proxies MMA, and the only outbound calls
      // (api.github.com, the MMA engine) are made from Node, never the browser.
      //
      // This read `'self' https:`, which permits an XHR to ANY https origin — the one
      // directive that decides whether injected script can post a team's spec somewhere.
      // Its own comment said "same-origin", so the value contradicted the intent beside it.
      // Verified before narrowing: no client component opens a fetch, EventSource or
      // WebSocket to an absolute URL.
      "connect-src 'self'",
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
