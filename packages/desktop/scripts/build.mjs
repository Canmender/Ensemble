import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverSrc = resolve(root, "../server/src/lib.ts");
const sharedSrc = resolve(root, "../shared/src/index.ts");

const common = {
  bundle: true,
  platform: "node",
  external: ["electron"],
  alias: {
    "@jungle/server": serverSrc,
    "@jungle/shared": sharedSrc,
  },
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [resolve(root, "src/main/index.ts")],
  format: "cjs",
  outfile: resolve(root, "dist/main/index.cjs"),
});

await build({
  ...common,
  entryPoints: [resolve(root, "src/preload/index.ts")],
  format: "cjs",
  outfile: resolve(root, "dist/preload/index.cjs"),
});

console.log("desktop build done");
