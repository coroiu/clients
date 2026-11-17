// Local Nx remote cache for sharing task results between worktrees on one machine.
//
// Nx's local cache lives in each worktree (`.nx/cache` plus a SQLite index in
// `.nx/workspace-data`), so a fresh worktree starts cold even when another worktree already ran the
// same tasks. Nx also talks to any HTTP server that implements its self-hosted remote cache API
// (`NX_SELF_HOSTED_REMOTE_CACHE_SERVER`). This is a minimal implementation of that API:
//
//   GET /v1/cache/<hash>  200 + the tarball Nx stored, 404 if unknown
//   PUT /v1/cache/<hash>  200 when stored, 409 if the hash already exists (entries are immutable)
//   Both need `Authorization: Bearer <token>`: 401 without it, 403 with the wrong one.
//
// The server binds to 127.0.0.1 only. There is no option to change that: anything that can write
// to the cache decides what Nx restores into a worktree (test results, build outputs), so it must
// not be reachable from the network. The token keeps out other local processes that do not have
// the user's token file (and requests from web pages, which also fail the Host check below).
//
// Usage:
//   node scripts/nx-cache-server.mjs [--port 3725] [--dir ~/.cache/bitwarden-nx-cache]
//     [--max-size-gib 20] [--idle-exit-minutes 0]
// The token is read from <dir>/token (created with mode 0600 on first start). `scripts/nx.mjs`
// (`npm run nx -- ...`) finds or starts this server and passes the address and token to Nx. To use
// it with a plain `nx` instead, set in the shell:
//   export NX_SELF_HOSTED_REMOTE_CACHE_SERVER=http://127.0.0.1:3725
//   export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN="$(cat ~/.cache/bitwarden-nx-cache/token)"
// Nx fails every run while those are set and the server is not running; the wrapper avoids that.
//
// With --idle-exit-minutes N (N > 0) the server exits after N minutes without a request.
//
// When the stored entries exceed --max-size-gib, the least recently used ones (by mtime, which a
// GET refreshes) are deleted until the total is below 90% of the limit.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";

const HOST = "127.0.0.1";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: "3725" },
    dir: { type: "string", default: join(homedir(), ".cache", "bitwarden-nx-cache") },
    "max-size-gib": { type: "string", default: "20" },
    "idle-exit-minutes": { type: "string", default: "0" },
  },
});
const port = Number(args.port);
const root = args.dir;
const entriesDir = join(root, "entries");
const maxBytes = Number(args["max-size-gib"]) * 1024 ** 3;
const idleExitMs = Number(args["idle-exit-minutes"]) * 60_000;
let lastRequest = Date.now();

// Nx task hashes are decimal strings; the stricter check also rules out path traversal.
const HASH = /^\/v1\/cache\/([0-9A-Za-z]{1,128})$/;

await mkdir(entriesDir, { recursive: true, mode: 0o700 });
await chmod(root, 0o700);
const token = await loadToken(join(root, "token"));

// Size bookkeeping: hash -> bytes. Built once at startup, updated on every PUT and eviction.
const sizes = new Map();
let totalBytes = 0;
for (const name of await readdir(entriesDir)) {
  if (name.endsWith(".tmp")) {
    await unlink(join(entriesDir, name)).catch(() => {});
    continue;
  }
  const { size } = await stat(join(entriesDir, name));
  sizes.set(name, size);
  totalBytes += size;
}

const server = createServer(async (req, res) => {
  lastRequest = Date.now();
  // scripts/nx.mjs checks this header to tell this server from another program on the port.
  res.setHeader("X-Bitwarden-Nx-Cache", "1");
  try {
    await handle(req, res);
  } catch (e) {
    log(`${req.method} ${req.url}: ${e.message}`);
    if (!res.headersSent) {
      reply(res, 500, "internal error");
    } else {
      res.destroy();
    }
  }
});
server.listen(port, HOST, () => {
  log(
    `listening on http://${HOST}:${port}, ${sizes.size} entries, ${gib(totalBytes)} GiB in ${entriesDir}`,
  );
});
server.on("error", (e) => {
  // EADDRINUSE: another instance (or another program) has the port. scripts/nx.mjs relies on this
  // exit when two worktrees start the server at the same time.
  log(`cannot listen on ${HOST}:${port}: ${e.message}`);
  process.exit(1);
});
if (idleExitMs > 0) {
  setInterval(() => {
    if (Date.now() - lastRequest > idleExitMs) {
      log(`idle for ${args["idle-exit-minutes"]} minutes, exiting`);
      process.exit(0);
    }
  }, 30_000).unref();
}

async function handle(req, res) {
  // A web page can make the browser send requests to 127.0.0.1 (directly or through DNS
  // rebinding); only accept the host names a local Nx process uses.
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (host !== HOST && host !== "localhost") {
    return reply(res, 403, "bad host");
  }
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) {
    return reply(res, 401, "missing token");
  }
  if (!sameSecret(auth.slice("Bearer ".length), token)) {
    return reply(res, 403, "wrong token");
  }
  const match = HASH.exec(req.url ?? "");
  if (!match) {
    return reply(res, 404, "not found");
  }
  const hash = match[1];
  const file = join(entriesDir, hash);

  if (req.method === "GET") {
    if (!sizes.has(hash)) {
      // Hash "0" is the availability probe of scripts/nx.mjs, not an Nx lookup.
      if (hash !== "0") {
        log(`miss ${hash}`);
      }
      return reply(res, 404, "not found");
    }
    const now = new Date();
    await utimes(file, now, now);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": sizes.get(hash),
    });
    await pipeline(createReadStream(file), res);
    log(`hit  ${hash} (${sizes.get(hash)} bytes)`);
    return;
  }

  if (req.method === "PUT") {
    if (sizes.has(hash)) {
      req.resume();
      return reply(res, 409, "exists");
    }
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await pipeline(req, createWriteStream(tmp, { mode: 0o600 }));
      const { size } = await stat(tmp);
      await rename(tmp, file);
      sizes.set(hash, size);
      totalBytes += size;
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    log(`put  ${hash} (${sizes.get(hash)} bytes, total ${gib(totalBytes)} GiB)`);
    reply(res, 200, "stored");
    await evict();
    return;
  }

  reply(res, 405, "method not allowed");
}

let evicting = false;
async function evict() {
  if (evicting || totalBytes <= maxBytes) {
    return;
  }
  evicting = true;
  try {
    const entries = [];
    for (const hash of sizes.keys()) {
      const { mtimeMs } = await stat(join(entriesDir, hash));
      entries.push({ hash, mtimeMs });
    }
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const { hash } of entries) {
      if (totalBytes <= maxBytes * 0.9) {
        break;
      }
      await unlink(join(entriesDir, hash)).catch(() => {});
      totalBytes -= sizes.get(hash);
      sizes.delete(hash);
      log(`evict ${hash}`);
    }
  } finally {
    evicting = false;
  }
}

async function loadToken(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (e) {
    if (e.code !== "ENOENT") {
      throw e;
    }
    const fresh = randomBytes(32).toString("hex");
    await writeFile(path, `${fresh}\n`, { mode: 0o600 });
    log(`created token file ${path}`);
    return fresh;
  }
}

function sameSecret(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function reply(res, code, text) {
  res.writeHead(code, { "Content-Type": "text/plain" });
  res.end(text);
}

function gib(bytes) {
  return (bytes / 1024 ** 3).toFixed(2);
}

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}
