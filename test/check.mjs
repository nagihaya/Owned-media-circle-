import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ejs from "ejs";
import { ESLint } from "eslint";
const root = path.resolve(".");
let failed = false;
for (const folder of ["server", "migrations", "public", "test"])
  for (const file of fs.readdirSync(folder)) {
    if (/\.(js|mjs)$/.test(file)) {
      const r = spawnSync(
        process.execPath,
        ["--check", path.join(folder, file)],
        { encoding: "utf8" },
      );
      if (r.status !== 0) {
        console.error(r.stderr);
        failed = true;
      }
    }
  }
for (const f of fs.readdirSync("views").filter((x) => x.endsWith(".ejs")))
  try {
    ejs.compile(fs.readFileSync("views/" + f, "utf8"), {
      filename: path.join(root, "views", f),
    });
  } catch (e) {
    console.error("Template:", f, e.message);
    failed = true;
  }
const eslint = new ESLint();
const results = await eslint.lintFiles([
  "server",
  "migrations",
  "public",
  "test",
]);
const formatter = await eslint.loadFormatter("stylish");
console.log(formatter.format(results));
if (results.some((r) => r.errorCount)) failed = true;
for (const folder of ["public", "views"])
  for (const f of fs.readdirSync(folder)) {
    const p = path.join(folder, f);
    if (fs.statSync(p).isFile() && /\.(js|ejs|css|json)$/.test(p)) {
      const text = fs.readFileSync(p, "utf8");
      if (
        text.includes("localStorage") ||
        /[a-zA-Z0-9._%+-]+@(?:gmail\.com|outlook\.com)/.test(text)
      ) {
        console.error("Public persistence/recipient leak:", p);
        failed = true;
      }
    }
  }
console.log(
  failed
    ? "CHECK FAILED"
    : "Syntax, templates, undefined variables, and public secret checks passed.",
);
process.exitCode = failed ? 1 : 0;
