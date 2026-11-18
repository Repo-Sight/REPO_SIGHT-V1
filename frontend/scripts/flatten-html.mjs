// vite-react-ssg's "flat" style names a route "/x.html" as "x.html.html".
// Rename those to "x.html" so live URLs are unchanged. Runs after the build.
import { readdirSync, renameSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? "dist";
let renamed = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (name.endsWith(".html.html")) {
      const target = p.slice(0, -".html".length);
      if (existsSync(target)) throw new Error(`refusing to overwrite ${target}`);
      renameSync(p, target);
      renamed++;
    }
  }
}

walk(dist);
console.log(`flatten-html: renamed ${renamed} file(s)`);
