// Prints the jest test groups for CI as a GitHub Actions output line:
//   groups=[{"name":"Web","paths":"apps/web/ bitwarden_license/bit-web/",...}, ...]
//
// Each group keeps the name, artifact and junit file of the fixed matrix in test.yml, but its
// paths are only the roots of affected Nx projects that have a `test` target. Groups with no
// affected project are left out. With `--all`, every project with a test target counts as
// affected (used for pushes to main/rc).
//
// Expects NX_BASE and NX_HEAD in the environment (set by nrwl/nx-set-shas) unless `--all`.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GROUPS = [
  { name: "Browser", prefixes: ["apps/browser", "bitwarden_license/bit-browser"] },
  { name: "Web", prefixes: ["apps/web", "bitwarden_license/bit-web"] },
  { name: "Desktop", prefixes: ["apps/desktop", "bitwarden_license/bit-desktop"] },
  { name: "CLI", prefixes: ["apps/cli", "bitwarden_license/bit-cli"] },
  {
    name: "Libs",
    prefixes: [
      "libs",
      "bitwarden_license/bit-common",
      "bitwarden_license/bit-pam",
      "bitwarden_license/bit-pam-components",
    ],
  },
];

function nx(args) {
  return execFileSync("npx", ["nx", ...args], {
    encoding: "utf8",
    env: { ...process.env, NX_DAEMON: "false", NX_NO_CLOUD: "true" },
    stdio: ["ignore", "pipe", "inherit"],
  });
}

// Test targets that fail on upstream main as well and that today's CI never runs (they are not
// in the root jest.config.js project list): TS errors under ts-jest in state-internal and
// nx-plugin, and no spec files in libs/node.
const EXCLUDED = new Set(["state-internal", "nx-plugin", "@bitwarden/node"]);

const all = process.argv.includes("--all");
const projects = JSON.parse(
  nx(["show", "projects", "--withTarget", "test", "--json", ...(all ? [] : ["--affected"])]),
).filter((name) => !EXCLUDED.has(name));

const graphFile = join(mkdtempSync(join(tmpdir(), "nx-graph-")), "graph.json");
nx(["graph", `--file=${graphFile}`]);
const nodes = JSON.parse(readFileSync(graphFile, "utf8")).graph.nodes;
const roots = projects.map((name) => nodes[name].data.root);

const matches = (root, prefix) => root === prefix || root.startsWith(prefix + "/");

const groups = [];
for (const group of GROUPS) {
  // The most specific prefix wins, so bit-pam does not land in bit-pam-components and vice versa.
  const groupRoots = roots.filter((root) => {
    const best = GROUPS.flatMap((g) => g.prefixes.map((p) => ({ g, p })))
      .filter(({ p }) => matches(root, p))
      .sort((a, b) => b.p.length - a.p.length)[0];
    return best?.g === group;
  });
  if (groupRoots.length === 0) {
    continue;
  }
  const slug = group.name.toLowerCase();
  groups.push({
    name: group.name,
    // Trailing slash: jest path patterns are regexes, so "libs/state" would also match
    // "libs/state-internal".
    paths: groupRoots.map((root) => root + "/").join(" "),
    artifact: `jest-coverage-${slug}`,
    junit: `junit-${slug}.xml`,
  });
}

console.error(`Affected test projects (${projects.length}): ${projects.join(", ")}`);
console.log(`groups=${JSON.stringify(groups)}`);
