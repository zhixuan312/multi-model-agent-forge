# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2] - 2026-07-27

Deployment-hardening release driven by a full external-operator test of the `0.1.1` image on a
clean Ubuntu 24.04 / 1 vCPU / 2 GB box. Every item below is a packaging, configuration, or
documentation defect found by deploying the published artifact exactly as `DEPLOYMENT.md`
instructs — the application runtime itself came up correctly. This is the first **multi-arch**
image (`0.1.1` shipped arm64-only and would not `docker pull` on any x86_64 server) and the
first to bundle the `codex` CLI so codex-protocol tiers run.

> **Release note:** built and pushed **multi-arch** (`linux/amd64` + `linux/arm64`, see
> `DEPLOYMENT.md` §8). Image: `ghcr.io/zhixuan312/forge:0.1.2` (alias `:latest`).
> Digest (immutable, multi-arch index): `ghcr.io/zhixuan312/forge@sha256:__PENDING_PHASE_5__`.

> **Bundled MMA engine bumped `5.13.0` → `5.15.4`.** 5.13.x gated its Claude OAuth loader on
> `platform === 'darwin'`, so in the (Linux) container it never read
> `~/.claude/.credentials.json`: every Claude-OAuth tier reported "not verified" in
> Settings → Models with valid credentials mounted, and any task on a Claude tier completed
> with empty output. MMA 5.14.0 rewrote that loader to read and refresh on Linux. **5.15.4**
> additionally makes the refresh work in a minimal container — the refresh-on-expiry exchange
> used to shell out to `curl` (absent from slim Node images), so an always-on container went
> dark ~8h after the last manual refresh; it now runs in a Node subprocess and logs the
> outcome. 5.15.4 also fails `/configure-provider` for a codex tier when the `codex` binary is
> absent (paired with the codex-bundling fix below), so a codex tier can't verify green while
> being unable to run.

### Fixed
- **The image no longer downloads pnpm at container start.** First boot runs
  `pnpm db:migrate` + `pnpm db:seed-templates`, and corepack was fetching the pinned pnpm
  tarball from the npm registry right then — slow, a moving dependency on every fresh
  container, and a hard failure on an air-gapped or egress-restricted host. pnpm is now
  prepared at build time from `package.json#packageManager` into a shared `COREPACK_HOME`
  (the default cache is per-user, and the build runs as root while the container runs as
  `node`), with a build step that resolves it as the runtime user with the network disabled.
- **`WARNING 25P01: there is no transaction in progress` on every boot.**
  `0005_multi_tenancy.sql` wrapped itself in `begin`/`commit`, but the drizzle migrator
  already runs the whole folder inside one transaction — the script's `commit` closed the
  migrator's own transaction early (so a later failure could no longer roll this migration
  back) and the migrator's real `COMMIT` then had nothing to commit. The script now lets the
  migrator own the transaction; net schema effect unchanged.
- **`pdf_engine_unavailable` from a Chromium launch timeout.** Browser cold start borrowed
  puppeteer's 30 s default, which a 1-vCPU host (the documented minimum) can exceed — the
  boot probe then declared the PDF engine broken on a healthy install. Launch now has its own
  budget, `FORGE_PDF_LAUNCH_TIMEOUT_MS`, defaulting to 60 s and applied to both the in-process
  renderer and the standalone worker.
- **Skill-manifest drift warning on every boot.** `mma sync-skills` now runs at build time
  against the codex client dir under the runtime user's home, so `mma serve` starts clean.
- **codex-protocol tiers couldn't run — `codex_not_installed`.** The image bundled MMA but not
  the `codex` CLI that MMA's codex provider spawns, so a codex tier *verified* (creds present)
  yet every task died on the first subprocess. The `codex` CLI is now bundled at build time,
  pinned at `package.json#matchedCodexVersion` (same discipline as the MMA pin — never `@latest`).
  claude-protocol tiers were unaffected (they use the Agent SDK, no CLI).

### Changed
- **`team.workspace_root_path` is stored relative to `FORGE_WORKSPACE_BASE`** (the team's
  leaf directory) instead of as an absolute host path, making a database backup portable
  between hosts: restoring a dump into a container whose base is `/workspace` used to leave
  every team pointing at a nonexistent path that also failed the "direct child of the base"
  validation, and needed a manual `UPDATE`. Validation still runs on the resolved absolute
  path, and the runtime resolver **still accepts an already-absolute stored value**, so
  pre-existing and hand-edited rows keep working. Migration `0019` rewrites existing absolute
  rows to their leaf.

### Added
- **Multi-arch build instructions** (`DEPLOYMENT.md` §8, plus a header note in the
  `Dockerfile`). `0.1.1` was published **arm64-only** — built with a plain `docker build` on
  an Apple-Silicon Mac — so `docker pull` failed outright on every x86_64 server with
  `no matching manifest for linux/amd64`. Releases now go out through
  `docker buildx build --platform linux/amd64,linux/arm64 … --push`, with amd64 as the
  priority target, followed by a `docker manifest inspect` check and a CHANGELOG digest update.
  Nothing in the `Dockerfile` pins an architecture; the defect was purely in how it was pushed.
- **OAuth credential-mount guidance** (`DEPLOYMENT.md` §5a). The container runs as `node`
  (uid 1000) while `claude`/`codex login` write credentials `600 root`, so the documented
  `-v $HOME/.claude:…:ro` mount silently produced no credentials. The guide now covers staging
  a `chown 1000:1000` copy and mounting the credential **file**, the `--user` alternative, and
  the fact that a `:ro` mount cannot persist an OAuth refresh — API keys are recommended for
  an always-on server.
- **Silent-login-loop diagnosis for plain-HTTP deploys.** In production the session cookie is
  `Secure`, which a browser on `http://` discards: login succeeds server-side, the session
  never sticks, and the user bounces back to `/login` with no error shown and no
  `login.failure` logged. Forge now emits a `login.insecure_cookie` warning naming the cause
  and the two fixes, and `DEPLOYMENT.md` §2 documents `FORGE_COOKIE_SECURE=false` next to the
  TLS-proxy guidance. The check is deliberately conservative — it stays silent on HTTPS, on
  `localhost`, and when no header reveals the scheme.

## 0.1.1 - 2026-07-25

All-in-one image: Forge now carries and supervises its matched MMA engine as a
loopback co-process, so a single container is the entire deployment — the artifact
maintainers stand up for cross-team collaboration. (MMA-only users continue to take
the npm package and run `mma serve` themselves; this image is Forge.)

Image: `ghcr.io/zhixuan312/forge:0.1.1` (alias `:latest`)
Digest (immutable release identity): `ghcr.io/zhixuan312/forge@sha256:fd42c893d14033e6f2fc76e96273c35c9ce99eab4ebfe4107b52b14956f5c633`

### Added
- **Bundled MMA engine**, pinned to `package.json#matchedMmaVersion` (`5.13.0`) and
  installed at build time — never `@latest`. The image ships as "Forge 0.1.1
  containing MMA 5.13.0"; the pin advances only when a Forge release deliberately
  adopts and re-tests a newer engine. Forge pins MMA, it does not chase it.
- **Container supervisor** (`scripts/container-supervisor.mjs`) under `tini` (PID 1):
  writes `~/.mma/config.json` from the per-tier env → starts `mma serve` on
  `127.0.0.1:7337` → health-gates `GET /health` → runs the idempotent Forge DB
  bootstrap → starts Forge. If either child process dies, the whole container comes
  down so an orchestrator restarts a known-good whole, never a half-alive stack.

### Changed
- `docker-compose.yml`, the README run section, and the deployment guide now describe
  the **single all-in-one topology** — one Forge container (Forge + bundled MMA) +
  external Postgres + a bind-mounted workspace. The phantom separate `mma` service
  (which referenced a container image that never existed) is removed; MMA reachability,
  the shared auth token, and workspace file identity are now internal to the one
  container and require no operator wiring.

## 0.1.0 - 2026-07-24

First tagged, container-distributed Forge release.

Image: `ghcr.io/zhixuan312/forge:0.1.0` (alias `:latest`)
Digest (immutable release identity): `ghcr.io/zhixuan312/forge@sha256:c38641252aa8ca788b735e5f56e08a8fb73873646bdaa5e911bf67016503f574`

### Added
- Runtime version reporting through `GET /api/version` (`version` · `gitSha` · `builtAt`).
- Standalone-container packaging (multi-stage `Dockerfile` over Next `output: "standalone"`), compose topology, and provider-agnostic bootstrap (`pnpm db:migrate`, `pnpm db:seed-templates`).
- Database-backed project journal: a `project_journal` staging table replaces the physical `journal.md`. The Reflect stage harvests learnings into the table, the team curates them in place (edit / remove / approve), and on approval they are recorded to the MMA engine via the 5.13 array `journal_record` contract (`records:[{prompt,topic}]`, chunked ≤20, results correlated by content). Journal is no longer an exportable artifact — exploration, specification, and plan remain exportable.
- `matchedMmaVersion` (`5.13.0`) + `src/mma/COMPATIBILITY.md` — the declared, evidence-backed engine contract Forge is built against.

### Changed
- Aligned the MMA client to the current engine contract (matched 5.13.0): corrected the `/status` counter field, adopted the array `journal_record` with a per-record `topic`, and removed the unused typed client wrappers so the client surface is exactly what Forge uses.
- Every team-scoped surface (projects, loops, workspace/repos, usage, team settings) filters strictly by the caller's team; provider configuration is org-admin-only and the team git token is team-admin-only.

### Fixed
- Container image now builds: the runner no longer overlays the standalone bundle's traced `node_modules` onto the full pnpm tree (a real-dir-vs-symlink collision on `puppeteer`); standalone's bundled modules are stripped and the prod install resolves the server plus the `db:migrate`/`db:seed-templates` tooling.
- `GET /api/version` is reachable unauthenticated — an operator running the image can read its build identity (`version`/`gitSha`/`builtAt`, non-sensitive) without first registering an admin.

### Image hardening (packaging)
- Base bumped **Node 20 → Node 22** (current LTS; Node 20 is EOL ~2026-04). Still satisfies `engines.node >=20.9.0`.
- Runner ships a **prod-only `node_modules`** (dedicated `deps-prod` stage; `tsx` + `dotenv` moved to `dependencies` as genuine boot-time deps) — image ~2.64GB → **~2.39GB**, no feature loss.
- Runs as the **non-root `node` user**, with pre-created writable dirs for the Next data cache, the export root, and the `~/.mma` config home.
- Added a `HEALTHCHECK` probing the (public) `/api/version`.
