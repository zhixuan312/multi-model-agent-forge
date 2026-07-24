# Changelog

All notable changes to this project will be documented in this file.

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
