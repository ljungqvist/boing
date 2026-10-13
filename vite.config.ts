import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vite";

const WASM_DIR = resolve(import.meta.dirname, "node_modules/@mediapipe/tasks-vision/wasm");
// FilesetResolver.forVisionTasks() without useModule loads only these (SIMD or not).
const wasmFiles = () => readdirSync(WASM_DIR).filter((f) => !f.includes("module"));

/** Serve and bundle MediaPipe's WASM files under /mediapipe/ (no CDN needed). */
function mediapipeWasm(): Plugin {
  return {
    name: "mediapipe-wasm",
    configureServer(server) {
      server.middlewares.use("/mediapipe", (req, res, next) => {
        const name = (req.url ?? "").replace(/^\//, "").split("?")[0];
        if (!wasmFiles().includes(name)) return next();
        res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        createReadStream(join(WASM_DIR, name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of wasmFiles()) {
        this.emitFile({ type: "asset", fileName: `mediapipe/${name}`, source: readFileSync(join(WASM_DIR, name)) });
      }
    },
  };
}

// HTTPS (self-signed) so phones on the same network may use the camera: `npm run dev -- --host`.
const mediapipeVersion: string = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "node_modules/@mediapipe/tasks-vision/package.json"), "utf8"),
).version;

export default defineConfig(({ mode }) => ({
  base: "./",
  // Cache-busts the downloaded engine when the MediaPipe version changes.
  define: { __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion) },
  plugins: [mediapipeWasm(), ...(mode === "e2e" ? [] : [basicSsl()])],
  server: { port: 5173 },
}));
