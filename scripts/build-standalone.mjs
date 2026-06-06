import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distDir = join(root, "dist");
const standalonePath = join(root, "index.html");

const readAsset = (name) => readFileSync(join(distDir, name), "utf8");

const escapeScript = (source) => source.replaceAll("</script", "<\\/script");
const escapeStyle = (source) => source.replaceAll("</style", "<\\/style");

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

try {
  await build({
    root,
    base: "./",
    logLevel: "info",
    build: {
      outDir: distDir,
      emptyOutDir: true,
      cssCodeSplit: false,
      rollupOptions: {
        input: join(root, "src/main.jsx"),
        output: {
          codeSplitting: false,
          entryFileNames: "assets/app.js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  });
} catch (err) {
  console.error("빌드 실패:", err.message ?? err);
  process.exit(1);
}

try {
  const assetFiles = readdirSync(join(distDir, "assets"));
  const styleBlocks = assetFiles
    .filter((name) => name.endsWith(".css"))
    .map((file) => `<style>\n${escapeStyle(readAsset(`assets/${file}`))}\n</style>`)
    .join("\n");
  const scriptBlocks = assetFiles
    .filter((name) => name.endsWith(".js"))
    .map((file) => `<script type="module">\n${escapeScript(readAsset(`assets/${file}`))}\n</script>`)
    .join("\n");

  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#060608" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="인텔리메모" />
    <meta name="mobile-web-app-capable" content="yes" />
    <title>인텔리메모</title>
    ${styleBlocks}
  </head>
  <body>
    <div id="root"></div>
    ${scriptBlocks}
  </body>
</html>
`;

  writeFileSync(standalonePath, html);
  rmSync(distDir, { recursive: true, force: true });
  console.log(`Standalone file created: ${standalonePath}`);
} catch (err) {
  console.error("파일 처리 실패:", err.message ?? err);
  process.exit(1);
}
