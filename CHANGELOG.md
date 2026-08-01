# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- **Releases are built and published by GitHub Actions, not from a maintainer's laptop**
  (`.github/workflows/release.yml`, `workflow_dispatch`). Both architectures now build on
  **native runners** (no QEMU emulation), each is **boot-tested against a real Postgres**, and
  the push happens inside GitHub's network with the built-in `GITHUB_TOKEN` — so the ~12-minute
  upload and the expiring registry token that left **0.1.3 tagged but never published** cannot
  recur. The git tag is created **last**, only after the gates, both builds, both boot tests and
  the GHCR push succeed, which makes an orphaned tag structurally impossible.
- **The image digest now lives in the GitHub Release** for each version, not in this file. The
  Release is immutable and needs no bot commit back to `master`; entries from 0.1.4 and earlier
  keep their inline digests.

### Removed
- **Dead code sweep.** An import-graph walk from the real production entry points, a
  route-caller walk, and an export-reference pass removed ~40 files that nothing reached:
  five unused design-system primitives (`dialog`, `tabs`, `kbd`, `page-header`, `skeleton`)
  and five now-unused dependencies with them, `src/anthropic/` (Forge reaches models only
  through MMA — the client was never instantiated in production), 14 unwired scripts, and
  the selective-spec-export feature orphaned when PDF export became a direct download.
- **Eight API routes with no caller**, nearly all left behind when a page moved to
  server-side data loading: `/api/mma-health`, `/api/model-profiles`, `/api/usage`,
  `/api/journal/log`, `/api/loops/[id]/runs`, `/api/projects/[id]/review/passes`,
  `/api/projects/[id]/artifacts/[kind]/download`, `/api/notifications/[id]/dismiss`.

### Changed
- **All HTTP endpoints now live under `app/api/`.** Five route handlers sat under
  `app/(app)/` beside page files, which also split middleware behaviour — `/api/*` returns a
  401 JSON while everything else redirects to `/login`, so an expired session failed
  differently depending on the endpoint. Internal paths only; no external contract changes.
- **`engines.node` is now `>=22.0.0`**, matching what actually runs. It declared `>=20.9.0`
  while every Dockerfile stage, CI, and the bundled MMA engine required 22 — so a Node 20
  install succeeded and then failed at runtime on the engine co-process.

### Fixed
- **"Stop & take over" now stops the engine.** It cleared automation and released the driver
  lease but never cancelled the task MMA had already been given, which kept running — still
  spending tokens, and still committing to the project branch after a human took the wheel.
- **The spec audit gate and the review UI now read findings by the same rules.** The gate
  accepted envelope shapes the display path did not, so a finding could gate a stage while
  the page and the fix prompt both labelled it `medium`.
- **`session.revoke` and `startup.fatal` are now emitted.** Both were in the operational log
  catalogue but never written, so a password change silently signing out every other device,
  and the one fatal boot path, left no structured trace.

## [0.1.4] - 2026-07-30

> **Image digest:** `ghcr.io/zhixuan312/forge@sha256:82bf9ac9beadc0f55bb67a48d0e112e2b3e55eb19b95d8eacb717b00d0f16809`
> — the immutable release identity (multi-arch index: `linux/amd64` + `linux/arm64`).
> Per-arch: amd64 `sha256:d0d173ac1192e6481b1828d13f686bdad7eedb59cf1f1329be832cc39e0f1c17`,
> arm64 `sha256:f7895ad741d9fea94a779b31a41e62ecb249e9700d7311ccca7ce0794e192061`.
> Built from `3e0adec` at `2026-07-30T04:07:26Z`.

> **Supersedes 0.1.3, which was never published.** `v0.1.3` was tagged but its image never reached
> GHCR, so no operator could pull it. 0.1.4 contains everything in 0.1.3 (Settings › Guide with the
> sidebar-rail navigation and the Forge-native section renderers) plus the engine-5.16 adoption
> below. Pull `0.1.4`; the `v0.1.3` tag has no image by design.

Aligns Forge to MMA engine **5.16.0** and adopts its new lifecycle surface. The engine change
is additive over the same HTTP REST API (wire `SCHEMA_VERSION` is still **6**), so there is no
wire break — and no database migration: `ops_mma_batch.status` is a `text` column with a
TS-level enum, so its new value is a code change.

### Fixed
- **A cancelled MMA task was indistinguishable from a failed one, so automation retried it.**
  `interpretTerminal()` decided failure purely by "is the envelope's `error` non-null", but the
  engine's `cancelled` terminal carries `error.code === 'aborted'` — so a deliberate stop read as
  a fault and Forge's auto driver re-dispatched the very work a human had just cancelled.
  Cancellation is now a first-class terminal state throughout: `MMA_STATUS` and the details
  `attemptStatus` gained `cancelled`, the poll manager persists it (not `failed`) and emits
  `task.cancelled`/`dispatch.cancelled`, the sync dispatch path throws a distinct
  `TaskCancelledError`, and the automation resolver PARKS the stage for a human instead of
  re-dispatching. A failure still retries; `done_with_concerns` is still a success.

### Added
- **Cancel a running MMA batch** (engine 5.16 `DELETE /task/:taskId`). `MmaClient.cancel()`
  distinguishes *requested* (202) from *already terminal* (200) and *unknown* (404, returned as a
  state rather than thrown). `PollManager.requestCancel()` is the idempotent entry point:
  cancellation is cooperative, so the request only marks the batch and the existing poll loop
  carries it through to the terminal `cancelled` envelope. Reachable at
  `POST /api/projects/[id]/batches/[batchId]/cancel`, gated on the caller being able to read that
  project AND the batch belonging to it. No UI affordance yet — that is a separate decision.
- **"Stopping…" state.** A pending cancellation (ours, or one seen via `cancellationRequested`
  on the engine's 202 poll body — e.g. another instance cancelled it) surfaces on the batch's
  progress events, so a client can show the interim state before the task actually stops.

### Changed
- **`matchedMmaVersion` → `5.16.0`**, with `src/mma/COMPATIBILITY.md` recording the new
  cancellation/terminal-state contract and an "Adopted in 5.16" delta table.
- **The engine's `interrupted` terminal state maps to `failed` — deliberately.** It means the
  daemon restarted mid-task and carries `retryable: true`, so resubmitting is correct and it
  reuses the existing retry path; its distinct `daemon_restarted` code and message are preserved
  rather than flattened into a generic pipeline failure. Durable execution records also make the
  old 404-after-restart path (`task_not_found`) the rare case rather than the normal one.

## [0.1.3] - 2026-07-27

Reframes the in-app product manifesto as a user-facing **Guide** ("what runs behind the scenes
when you trigger a route") and aligns its pages with Forge's own design system. No engine, schema,
or deployment change.

> **No image was ever published for this version** — see the 0.1.4 note above; 0.1.4 supersedes it.

### Changed
- **Direction → Guide, now under Settings.** The manifesto moves to `/settings/guide` (a Settings
  nav item alongside Usage / Team settings / Components); the product-direction masthead is dropped.
- **Section navigation moved into the sidebar rail.** The part-grouped section list renders in the
  left rail the same way the Components governance rail does, so the content area shows only the
  selected section — no menu-inside-a-menu. Each section is its own route (`/settings/guide/<id>`).
  The sidebar imports a lightweight `guide-nav` projection (drift-guarded by a test) rather than the
  ~55 KB content; the import boundary is rescoped to the guide route.
- **Guide renderers rebuilt on Forge primitives.** All eight section renderers now use
  `Card`/`ProseBlock`/`Eyebrow`/`Badge`/`Table` with semantic tokens instead of ported telemetry
  styling — no arrow glyphs or hand-rolled boxes. Removed the now-unused `SectionNavigator`
  component and its governed slot.

### Fixed
- **`RouteBlock` referenced an undefined `--danger` CSS token** for the critical-severity color;
  now uses the defined `rose`/`amber` severity badges.

## [0.1.2] - 2026-07-27

Deployment-hardening release driven by a full external-operator test of the `0.1.1` image on a
clean Ubuntu 24.04 / 1 vCPU / 2 GB box. Every item below is a packaging, configuration, or
documentation defect found by deploying the published artifact exactly as `DEPLOYMENT.md`
instructs — the application runtime itself came up correctly. This is the first **multi-arch**
image (`0.1.1` shipped arm64-only and would not `docker pull` on any x86_64 server) and the
first to bundle the `codex` CLI so codex-protocol tiers run.

> **Release note:** built and pushed **multi-arch** (`linux/amd64` + `linux/arm64`, see
> `DEPLOYMENT.md` §8). Image: `ghcr.io/zhixuan312/forge:0.1.2` (alias `:latest`).
> Digest (immutable, multi-arch index):
> `ghcr.io/zhixuan312/forge@sha256:12c4a2b575072307c1e6e03e23c369f21f989b17fc78c562f558894c8ec82e56`
> (`linux/amd64` → `sha256:bd9a3c0a…`, `linux/arm64` → `sha256:f451b167…`).

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
