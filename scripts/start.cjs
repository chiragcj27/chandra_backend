/**
 * Finds compiled output whether `npm start` runs from repo root or a subfolder
 * (e.g. Render "Root Directory" set to `src`).
 */
const fs = require("fs");
const path = require("path");

function findDistServer() {
  const candidates = new Set();

  // From this file: .../scripts/start.cjs -> repo root is parent
  const fromScript = path.join(__dirname, "..", "dist", "server.js");
  candidates.add(fromScript);

  // Walk up from cwd (covers Root Directory = src, etc.)
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.add(path.join(dir, "dist", "server.js"));
    candidates.add(path.join(dir, "src", "dist", "server.js"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

const entry = findDistServer();
if (!entry) {
  console.error(
    "Could not find compiled server (dist/server.js). Run `npm run build` from the folder that contains package.json."
  );
  console.error("Also check Render: Root Directory should be empty (repo root), or set Build Command to run `npm run build` there.");
  process.exit(1);
}

require(entry);
