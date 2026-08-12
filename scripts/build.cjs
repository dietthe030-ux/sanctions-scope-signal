const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "frontend");
const output = path.join(root, "dist");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of ["index.html", "tokens.css", "styles.css"] ) {
  fs.copyFileSync(path.join(source, file), path.join(output, file));
}

const contractAddress = process.env.VITE_CONTRACT_ADDRESS || "";
fs.writeFileSync(
  path.join(output, "config.js"),
  `window.__SSS_CONFIG__=${JSON.stringify({
    contractAddress,
    network: "studionet",
    chainId: 61999,
    rpcUrl: "https://studio.genlayer.com/api",
    explorerUrl: "https://explorer-studio.genlayer.com",
  })};\n`,
  "utf8",
);

esbuild.buildSync({
  entryPoints: [path.join(source, "app.js")],
  bundle: true,
  minify: true,
  sourcemap: true,
  outfile: path.join(output, "app.js"),
  format: "esm",
  target: ["es2022"],
  legalComments: "none",
  nodePaths: (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
});
