// Runs Nx with the local cache server (scripts/nx-cache-server.mjs) when it can be reached, and
// without it when it cannot. Usage: `pnpm run nx <nx arguments>`.
// pnpm passes a `--` after the script name on to the script, so a leading `--` is dropped and
// `pnpm run nx -- <nx arguments>` works too.
//
// Nx fails every run when NX_SELF_HOSTED_REMOTE_CACHE_SERVER is set and the server does not answer.
// So this wrapper sets that variable (and the token) only for its own Nx process, and only after a
// probe request succeeded:
//
// 1. Probe the server: GET of an unknown hash with the token, expecting 404 and the server's
//    X-Bitwarden-Nx-Cache header, 500 ms timeout.
// 2. If that fails, start the server in the background (detached, exits after 2 hours without
//    requests) and probe again for up to 3 seconds.
// 3. If the server still does not answer, run Nx without it and say so on stderr. The run is as
//    if no remote cache existed: slower, never failing because of the cache.
//
// What this does not cover: a server that stops while Nx is running. Nx then fails that run.
//
// Environment:
//   BW_NX_CACHE=off           never use or start the server
//   BW_NX_CACHE=no-start      use a running server, never start one
//   BW_NX_CACHE_PORT, BW_NX_CACHE_DIR   server port (3725) and directory (~/.cache/bitwarden-nx-cache)
// If NX_SELF_HOSTED_REMOTE_CACHE_SERVER is already set, the wrapper leaves the environment alone.

import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.env.BW_NX_CACHE ?? "auto";
const port = Number(process.env.BW_NX_CACHE_PORT ?? 3725);
const dir = process.env.BW_NX_CACHE_DIR ?? join(homedir(), ".cache", "bitwarden-nx-cache");

const env = { ...process.env };
if (mode !== "off" && !env.NX_SELF_HOSTED_REMOTE_CACHE_SERVER) {
  const token = await ensureServer();
  if (token) {
    env.NX_SELF_HOSTED_REMOTE_CACHE_SERVER = `http://127.0.0.1:${port}`;
    env.NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN = token;
  } else {
    console.error(`nx-cache: no cache server on 127.0.0.1:${port}, running Nx without it`);
  }
}

const nxBin = createRequire(join(repoRoot, "package.json")).resolve("nx/bin/nx.js");
const nxArgs = process.argv.slice(2);
if (nxArgs[0] === "--") {
  nxArgs.shift();
}
const child = spawn(process.execPath, [nxBin, ...nxArgs], { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});

// The token when a server answers (possibly after starting one), otherwise null.
async function ensureServer() {
  let token = readToken();
  if (token && (await probe(token))) {
    return token;
  }
  if (mode === "no-start") {
    return null;
  }
  startServer();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    // A first start creates the token file.
    token ??= readToken();
    if (token && (await probe(token))) {
      return token;
    }
  }
  return null;
}

function readToken() {
  try {
    return readFileSync(join(dir, "token"), "utf8").trim();
  } catch {
    return null;
  }
}

function probe(token) {
  return new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/v1/cache/0",
        headers: { Authorization: `Bearer ${token}` },
        timeout: 500,
      },
      (res) => {
        res.resume();
        // Another program on the port may also answer 404; only this server sets the header.
        resolve(res.statusCode === 404 && res.headers["x-bitwarden-nx-cache"] === "1");
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

function startServer() {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const logFd = openSync(join(dir, "server.log"), "a");
  const server = spawn(
    process.execPath,
    [
      join(repoRoot, "scripts", "nx-cache-server.mjs"),
      "--port",
      String(port),
      "--dir",
      dir,
      "--idle-exit-minutes",
      "120",
    ],
    { detached: true, stdio: ["ignore", logFd, logFd] },
  );
  server.unref();
  console.error(
    `nx-cache: started the cache server (pid ${server.pid}, log ${join(dir, "server.log")})`,
  );
}
