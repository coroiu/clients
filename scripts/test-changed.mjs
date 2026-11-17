// Edit loop: runs test and lint for the Nx projects that own the changed files, and nothing else.
//
// `nx affected` also runs every project that depends on a changed project (for libs/common that is
// almost the whole repository). That is the right check before pushing, but too slow while editing.
// This script runs only the owners of the changed files, the way `npm test -- libs/foo` does
// without Nx, but through Nx (and scripts/nx.mjs, which uses the local cache server when it is
// available), so results come from and go to the Nx cache.
//
// Changed files: unstaged, staged and untracked files, plus the commits since the merge base with
// --base (default: nx.json `defaultBase`). `--base=HEAD` limits it to uncommitted changes.
// A file belongs to the project with the longest root that contains it. Files outside every project
// (root config such as package.json or tsconfig.base.json) are listed but not mapped; they can
// affect everything, so use `nx affected` for those. Projects without any of the targets are
// skipped (e.g. sdk-wasm, which only builds).
//
// Files under sdk/crates/<crate>/ or sdk/bitwarden_license/<crate>/ (when the SDK is in the
// repository) also select that Rust crate: `cargo test -p` and `cargo clippy -p` for it, from sdk/.
//
// Usage:
//   npm run test:changed [-- --base=<ref>] [--targets=test,lint] [--dry-run] [-- <extra nx args>]

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseArgs } from "node:util";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const nxJson = JSON.parse(readFileSync(join(root, "nx.json"), "utf8"));

const separator = process.argv.indexOf("--");
const ownArgs = separator === -1 ? process.argv.slice(2) : process.argv.slice(2, separator);
const nxArgs = separator === -1 ? [] : process.argv.slice(separator + 1);
const { values: args } = parseArgs({
  args: ownArgs,
  options: {
    base: { type: "string", default: nxJson.defaultBase ?? "main" },
    targets: { type: "string", default: "test,lint" },
    "dry-run": { type: "boolean", default: false },
  },
});

const files = changedFiles(args.base);
if (files.length === 0) {
  console.log(`No changes against ${args.base}.`);
  process.exit(0);
}

const require = createRequire(join(root, "package.json"));
const { createProjectGraphAsync } = require("@nx/devkit");
const graph = await createProjectGraphAsync({ exitOnError: true });
const targets = args.targets.split(",");
const roots = Object.values(graph.nodes)
  .map((node) => ({
    name: node.name,
    root: `${node.data.root}/`,
    runnable: targets.some((t) => t in (node.data.targets ?? {})),
  }))
  .sort((a, b) => b.root.length - a.root.length);

const projects = new Set();
const crates = new Set();
const unowned = [];
for (const file of files) {
  const crate = crateOf(file);
  if (crate) {
    crates.add(crate);
  }
  const owner = roots.find((p) => file.startsWith(p.root));
  if (owner) {
    if (owner.runnable) {
      projects.add(owner.name);
    }
  } else if (!crate) {
    unowned.push(file);
  }
}

console.log(`${files.length} changed file(s) against ${args.base}`);
if (unowned.length > 0) {
  console.log(`Not in any project (run \`nx affected\` if these matter): ${unowned.join(", ")}`);
}

let status = 0;
if (projects.size > 0) {
  const cmd = [
    join(root, "scripts", "nx.mjs"),
    "run-many",
    "-t",
    ...targets,
    "-p",
    [...projects].join(","),
    ...nxArgs,
  ];
  status = run(process.execPath, cmd, root) || status;
}
for (const crate of crates) {
  status = run("cargo", ["test", "-p", crate], join(root, "sdk")) || status;
  status =
    run(
      "cargo",
      ["clippy", "-p", crate, "--all-targets", "--", "-D", "warnings"],
      join(root, "sdk"),
    ) || status;
}
if (projects.size === 0 && crates.size === 0) {
  console.log("No project with these targets owns the changed files.");
}
process.exit(status);

function changedFiles(base) {
  const git = (...a) =>
    execFileSync("git", a, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const mergeBase = git("merge-base", base, "HEAD")[0];
  return [
    ...new Set([
      ...git("diff", "--name-only", mergeBase),
      ...git("diff", "--name-only", "--cached", mergeBase),
      ...git("ls-files", "--others", "--exclude-standard"),
    ]),
  ].sort();
}

// The cargo package name of the crate directory that contains FILE, if any.
function crateOf(file) {
  const match = /^sdk\/(crates|bitwarden_license)\/([^/]+)\//.exec(file);
  if (!match) {
    return null;
  }
  const manifest = join(root, "sdk", match[1], match[2], "Cargo.toml");
  if (!existsSync(manifest)) {
    return null;
  }
  const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(readFileSync(manifest, "utf8"));
  return name ? name[1] : null;
}

function run(command, commandArgs, cwd) {
  console.log(`> ${command} ${commandArgs.join(" ")}${cwd === root ? "" : `   (in ${cwd})`}`);
  if (args["dry-run"]) {
    return 0;
  }
  return spawnSync(command, commandArgs, { cwd, stdio: "inherit" }).status ?? 1;
}
