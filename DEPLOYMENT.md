# Deploying Forge

Forge ships as a single **all-in-one** container image on GHCR. **One container runs
Forge and its matched MMA engine** (pinned at `package.json#matchedMmaVersion`, started
as a loopback co-process by the in-container supervisor). You do not run MMA separately.

This guide is for the **maintainer/operator** who stands up the server that a company's
teams collaborate on. Engineers who want MMA on its own take the npm package instead —
this image is Forge.

---

## 1. What you provide

| Requirement | Notes |
|---|---|
| A Docker host | Linux server or any Docker engine. ~2 GB RAM min, 4 GB recommended. |
| A PostgreSQL database | Bring your own (managed or self-hosted). A demo Postgres ships as an optional compose profile. |
| `FORGE_SECRET_KEY` | 32+ byte random secret — encrypts sessions. Keep it stable; rotating it invalidates sessions. |
| Provider credentials | **Configured in-app after boot** (Settings → Models), not required to start. Optionally seed at first boot via env. Have your API key(s) — or OAuth creds to mount — ready for the org admin. |
| Two volumes | `/workspace` (every team's repos + `.mma` artifacts) and `/home/node/.mma` (MMA provider config + bearer). Persist both. |

---

## 2. Quick start (single container)

The only required config is a database and a secret key — providers are set up in the app
(§3), so they're not in the boot command:

```bash
docker run -d --name forge -p 3000:3000 \
  -e DATABASE_URL="postgres://user:pass@db-host:5432/forge" \
  -e FORGE_SECRET_KEY="$(openssl rand -base64 48)" \
  -v forge-workspace:/workspace \
  -v forge-mma-config:/home/node/.mma \
  ghcr.io/zhixuan312/forge:0.1.1
```

Or with compose (includes an optional local Postgres):

```bash
# .env: DATABASE_URL, FORGE_SECRET_KEY, FORGE_IMAGE_TAG=0.1.1
docker compose --profile postgres up -d
# (drop --profile postgres if you point DATABASE_URL at your own database)
```

On start the supervisor: writes the MMA config → starts `mma serve` on `127.0.0.1:7337`
→ health-gates it → creates the schema, migrates, and seeds templates (idempotent) →
starts Forge. Watch it come up with `docker logs -f forge`; `curl localhost:3000/api/version`
returns the build identity once ready.

Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front of `:3000` for any
real deployment — Forge itself serves plain HTTP.

> **If you serve Forge over plain HTTP, set `-e FORGE_COOKIE_SECURE=false`.** In
> production Forge marks the session cookie `Secure`, and a browser on `http://` silently
> **discards** it: the login POST succeeds server-side, the session never sticks, and the
> user is bounced back to `/login` **with no error message anywhere**. The tell is
> `login.success` in the logs while the user insists they cannot log in; Forge also logs a
> `login.insecure_cookie` warning naming this exact cause. Two correct fixes:
> - **Preferred** — terminate TLS in the proxy and have it set `X-Forwarded-Proto: https`
>   (then leave `FORGE_COOKIE_SECURE` unset).
> - **Plain-HTTP deploys** (a LAN box, a throwaway test host) — `-e FORGE_COOKIE_SECURE=false`.
>   This ships the session cookie without `Secure`, so do it only where the network is trusted.
>
> `http://localhost` is a browser "secure context" and accepts `Secure` cookies, so local
> dev never hits this.

---

## 3. First-run setup (in the browser)

The onboarding order is deliberate: **the org admin sets up the engine (MMA) first**, then
teams are created, then teams work.

1. Open `http://<host>:3000` → you're redirected to `/setup` to register the **first org
   admin** (the org-level owner). This account has no team; it governs org-wide config.
2. **Set up MMA first (org admin's first job).** Go to **Settings → Models** and configure
   each agent tier — `standard`, `complex`, `main` — with a provider, model, endpoint, and
   key. This is org-admin-only and is what makes the whole platform able to do agent work;
   nothing else runs until it's done. MMA validates each tier live and persists the config
   (to the `/home/node/.mma` volume — it survives upgrades). Providers are protocol-based,
   not vendor-locked: `claude` (Anthropic-compatible) or `codex` (OpenAI-compatible), which
   covers Anthropic, OpenAI, and standard-protocol vendors (DeepSeek, Z.ai/GLM, Kimi, …)
   behind their own endpoint. (If you seeded providers via env at boot, they're already
   filled in here — adjust as needed.)
3. As org admin, create your **teams**. Each team gets a **workspace root** — a directory
   directly under the operator base `/workspace` (see §4). Enter just the directory name,
   e.g. `acme`. Forge stores it **relative to the base**, so a database backup restored on
   another host (or into a container whose base differs) still resolves — see §6.
4. Each **team admin** adds their team's **git connection** (a token to clone repos) and
   invites members. Git tokens are stored encrypted in the database, scoped to the team.
5. Teams run the SDLC (Explore → Spec → Plan → Build → Review); MMA does the agent work
   inside that team's workspace.

---

## 4. Multi-tenant workspace model (important)

Forge is **multi-team**. The container's `/workspace` volume is the **operator base**
(`FORGE_WORKSPACE_BASE=/workspace`), and **each team's workspace is a validated direct
child of it**:

```
/workspace/                 ← FORGE_WORKSPACE_BASE (the mounted volume)
├── acme/                    ← team "acme" workspace root  → MMA ?cwd=/workspace/acme
│   ├── <repo>/              ← repos Forge clones for this team
│   └── .mma/                ← this team's journal + project artifacts
└── globex/                  ← team "globex" workspace root → MMA ?cwd=/workspace/globex
    └── ...
```

- Team roots are **siblings, never nested**; the path is validated (direct child of the
  base, no symlink escape) before it's saved.
- **What the database stores is the leaf, relative to the base** (`acme`), not an absolute
  host path. That is what makes a DB dump portable: move it to a host whose
  `FORGE_WORKSPACE_BASE` differs and every team still resolves, with no manual
  `UPDATE team SET workspace_root_path = …` step. (Rows written by older Forge versions
  hold an absolute path; those are converted by a migration on upgrade, and the runtime
  still honours an absolute value verbatim if you set one by hand.)
- Because Forge and MMA share the one container, MMA sees every team dir at the exact path
  Forge generates — **file identity is automatic**, no bind-mount path-matching to get right.
- **Isolation:** each team's agent work runs with that team's directory as MMA's `cwd`, and
  MMA's sandbox confines **writes** to that cwd. Team data lives in separate sibling dirs and
  the database is tenant-scoped per team. Note that a single shared engine can, in principle,
  **read** across sibling dirs; this deployment is intended for **teams within one trusted
  org** collaborating, not mutually-hostile tenants. If you need hard read-isolation between
  teams, run a Forge instance per trust boundary.

To keep the workspace on the host filesystem instead of a named volume, mount a host dir at
`/workspace` (`-v /srv/forge-workspace:/workspace`) — it's the same base, just host-backed.

---

## 5. Configuration reference

**Required:** `DATABASE_URL`, `FORGE_SECRET_KEY`. That's it — no provider key is required to
boot.

**Providers are configured in the app** (Settings → Models, org admin — see §3), which calls
MMA's `/configure-provider` and persists per-tier config to the `/home/node/.mma` volume. The
env vars below are an **optional first-boot seed**: the bundled MMA generates its initial
`config.json` from them *only when none exists yet*; once a config exists (seeded or set in
the UI), the UI is authoritative and these env vars are ignored. Mount `/home/node/.mma` (see
`docker-compose.yml`) so that config persists across container recreation.

Per-tier seed vars — `<TIER>` is `STANDARD` / `COMPLEX` / `MAIN`:

- `PROVIDER` — default protocol for all tiers (`claude`/`anthropic` or `codex`/`openai`)
- `PROVIDER_<TIER>` — protocol override for that tier (mixed claude/codex layouts are fine)
- `MODEL_<TIER>` — model id
- `BASE_URL_<TIER>` — vendor endpoint (e.g. DeepSeek, Z.ai/GLM, Kimi, MiniMax behind a standard protocol)
- `API_KEY_ENV_<TIER>` — the **name** of the env var holding that tier's key
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — the keys themselves (or your custom-named vars)

To bypass config generation entirely, mount a full `config.json` at
`/home/node/.mma/config.json`.

See `.env.example` for the complete list.

### 5a. Mounting provider OAuth credentials (read this before you mount `~/.claude`)

A tier with no API key falls back to that provider's native **OAuth**, which means mounting
the credential file the CLI wrote. Two things bite here, and neither reports an error — the
tier just never verifies:

**1. Ownership. The container runs as `node` (uid 1000); `claude` and `codex login` write
their credentials as `root`, mode `600`.** A `600 root` file is unreadable by uid 1000, so a
straight `-v $HOME/.claude:/home/node/.claude:ro` mount silently yields no credentials. Stage
a copy the container user owns, and mount the **file**, not the whole directory:

```bash
mkdir -p /root/forge-oauth
cp /root/.claude/.credentials.json /root/forge-oauth/claude-credentials.json
cp /root/.codex/auth.json          /root/forge-oauth/codex-auth.json
chown -R 1000:1000 /root/forge-oauth
chmod 600 /root/forge-oauth/*

docker run -d --name forge -p 3000:3000 \
  … \
  -v /root/forge-oauth/claude-credentials.json:/home/node/.claude/.credentials.json:ro \
  -v /root/forge-oauth/codex-auth.json:/home/node/.codex/auth.json:ro \
  ghcr.io/zhixuan312/forge:<tag>
```

Mounting the individual file (rather than the directory) also keeps the image's pre-synced
`~/.codex/skills` visible; shadowing that directory brings back a harmless-but-alarming
`skill manifest drift detected` warning on every boot.

Alternatives, if you prefer: run the container as the credential owner
(`--user "$(id -u):$(id -g)"` — note the app's pre-created dirs are chowned for uid 1000, so
you may need to chown the mounted volumes to match), or simply `chown 1000:1000` the real
credential files if nothing else on the host reads them.

**2. `:ro` cannot persist a token refresh.** OAuth access tokens are short-lived; the engine
refreshes them and writes the rotated credentials back. A read-only mount makes that write
fail, so an always-on server eventually sits on an expired token and every Claude tier goes
"not verified" until you re-copy the file. For an unattended deployment:

- **Use API keys** (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, or a per-tier
  `API_KEY_ENV_<TIER>`) — they don't expire and need no mount. **This is the recommended
  path for a server.**
- Or mount the credential path **writable** (drop `:ro`) so refreshes persist, accepting that
  the container can then rewrite that file.

OAuth-via-read-only-mount is fine for a short-lived demo box; it is not a durable
server configuration.

---

## 6. Persistence, backup, upgrade

- **State lives in two places:** the Postgres database (teams, members, projects, journal
  metadata, sessions) and the `/workspace` volume (repos + `.mma` artifacts). Back up both.
- **Restoring onto a different host:** load the SQL dump, extract each team's workspace into
  the new base as `<base>/<leaf>` (`chown -R 1000:1000` — the container user), and carry the
  **same `FORGE_SECRET_KEY`** across or the encrypted git tokens and sessions won't decrypt.
  Team workspace paths are stored relative to `FORGE_WORKSPACE_BASE`, so no path rewriting is
  needed as long as the leaf directory names match.
- **Upgrade:** pull a newer image tag and recreate the container — bootstrap is idempotent
  (schema/migrate/seed run safely on every start). The bundled **MMA version moves with the
  Forge release** (it's pinned per release); Forge does not auto-pull a newer MMA.
- **Pin for immutability:** deploy by digest (`ghcr.io/zhixuan312/forge@sha256:…`, in the
  CHANGELOG) rather than a moving tag.

---

## 7. Health & operations

- `GET /api/version` (public) → `{version, gitSha, builtAt}` — liveness + build identity.
  The image's `HEALTHCHECK` probes this.
- If either the MMA co-process or Forge dies, the container exits non-zero so your
  orchestrator restarts a known-good whole. Use `--restart unless-stopped` (or compose's
  `restart:`) so it comes back automatically.
- Logs: MMA lines are prefixed `[mma]`, supervisor lines `[forge-supervisor]`, Forge logs
  are JSON — all on the container's stdout.
- **`pdf_engine_unavailable` on boot** means Chromium did not finish launching inside the
  budget, not that it is missing (the image ships `/usr/bin/chromium`). Cold start can
  exceed the default on a 1-vCPU host or under CPU emulation — raise it with
  `-e FORGE_PDF_LAUNCH_TIMEOUT_MS=120000`. The launch budget defaults to 60 s and is
  deliberately separate from the per-render `FORGE_PDF_TIMEOUT_MS`.

---

## 8. Building the image (maintainers)

**The image must be pushed multi-arch.** Most servers operators deploy to are x86_64, and a
plain `docker build && docker push` publishes only the **build host's** architecture — on an
Apple-Silicon Mac that is arm64-only, and `docker pull` then fails on every amd64 host with
`no matching manifest for linux/amd64`. That is a release blocker, not a nuisance: the
container never starts.

Prerequisites on the build host:

- A `docker-container` buildx builder: `docker buildx create --use`
- QEMU binfmt emulation for the non-native arch (Docker Desktop ships it; on a plain Linux
  daemon run `docker run --privileged --rm tonistiigi/binfmt --install all`)
- `docker login ghcr.io` with a token carrying `write:packages`

Build and push both architectures in one command — buildx assembles the manifest list, so
the tag resolves correctly on amd64 and arm64:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg FORGE_BUILD_GIT_SHA="$(git rev-parse --short HEAD)" \
  --build-arg FORGE_BUILD_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t ghcr.io/zhixuan312/forge:<tag> \
  -t ghcr.io/zhixuan312/forge:latest \
  --push .
```

Then verify and record the result:

```bash
docker manifest inspect ghcr.io/zhixuan312/forge:<tag> \
  | grep -A1 '"platform"'          # expect BOTH linux/amd64 and linux/arm64
docker buildx imagetools inspect ghcr.io/zhixuan312/forge:<tag> --format '{{.Manifest.Digest}}'
```

Put that digest in the CHANGELOG entry for the release — it is the immutable release
identity operators pin with `ghcr.io/zhixuan312/forge@sha256:…`. **The digest changes with
every push, so update the CHANGELOG after the multi-arch push, not before.**

Cross-building the non-native arch runs under emulation and is slow (expect a long
`pnpm install`); that cost is the build host's, not the operator's. Nothing in the
`Dockerfile` assumes a host architecture.
