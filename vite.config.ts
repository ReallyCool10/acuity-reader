import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";

/**
 * The page's Content Security Policy: a second line of defence behind the EPUB
 * sanitiser (src/lib/epub.ts). Script can come only from the app's own files, so
 * book markup that slipped through cannot run with the preload bridge in reach,
 * and nothing loads from the web at all. pdf.js runs its worker from a blob:
 * wrapper, hence `worker-src blob:`.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' acuity: blob: data:",
  "media-src acuity: blob:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Added to the built page only: the dev server injects inline scripts for hot reload. */
function contentSecurityPolicy(): Plugin {
  return {
    name: "acuity-content-security-policy",
    apply: "build",
    transformIndexHtml: (html) => ({
      html,
      tags: [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
          injectTo: "head-prepend",
        },
      ],
    }),
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicy(),
    electron({
      main: {
        // kokoroWorker runs in its own utility process (the offline voice).
        entry: ["electron/main.ts", "electron/kokoroWorker.ts"],
        vite: {
          build: {
            rolldownOptions: {
              // Native ONNX runtime and its loaders must be required from node_modules, not bundled.
              external: ["kokoro-js", "@huggingface/transformers", "onnxruntime-node", "onnxruntime-common", "phonemizer", "sharp"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
      },
    }),
  ],
}));
