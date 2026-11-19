# Monorepo experiment

This branch is an experiment for ADR 0047: what changes when `sdk-internal` lives inside `clients`.
It is not meant to be merged upstream. Some changes exist only to make the experiment work, for
example the commits that break Nx project cycles in a quick and throwaway way.

## What is on the branch

- `sdk/`: the `sdk-internal` repository, merged with its history.
- Nx without project cycles, and an `sdk-wasm` Nx project that builds the SDK WASM packages
  (targets `build` for OSS and `build-commercial`). Projects that use the SDK depend on it, so Nx
  builds the WASM package first and caches it.
- pnpm workspaces in place of npm. `sdk/` and the two SDK npm folders are workspace members.
- A local Nx remote cache server (`scripts/nx-cache-server.mjs`) and a wrapper that uses it
  (`scripts/nx.mjs`). Worktrees on one machine share task results through it.
- `pnpm run test:changed`: runs test and lint only for the projects that own the changed files,
  plus `cargo test` and `cargo clippy` for changed SDK crates.

The GitHub workflows are only partly converted. CI is not expected to work on this branch.

## Using it locally

Requirements: Node 24.22.0 or newer (older Node 24 versions have a V8 bug that crashes jest
workers), pnpm through corepack, and Rust through rustup (`sdk/rust-toolchain.toml` picks the
version).

```bash
corepack enable                # or run every pnpm command as `corepack pnpm`
pnpm install --frozen-lockfile

# Build the SDK WASM package (Nx also does this before any task that needs it)
pnpm run nx run sdk-wasm:build

# Any Nx command, through the wrapper that starts and uses the local cache server
pnpm run nx run-many -t test lint
pnpm run nx run web:build:oss

# Test and lint only what you changed
pnpm run test:changed
pnpm run test:changed --base=HEAD   # only uncommitted changes
```

Nx needs `pnpm` on `PATH`, because it runs package scripts with `pnpm run`.

The cache server listens on `127.0.0.1:3725` and keeps its data in `~/.cache/bitwarden-nx-cache`.
The wrapper starts it when it is not running, and the server exits after two hours without
requests. Set `BW_NX_CACHE=off` to run Nx without it. `pnpm run nx -- <args>` also works; the
wrapper drops the extra `--` that pnpm passes on.

Put worktrees outside the main checkout (not in `clients/.worktrees/`). Inside it, Node resolves
packages that are missing in the worktree from the main checkout's `node_modules`, which hides
broken dependencies.

## Results

The results write-up (setup time, disk use, CI and local edit loop numbers) is available from
Andreas Coroiu.
