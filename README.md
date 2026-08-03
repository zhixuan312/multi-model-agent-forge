# MMA Forge

A team-level platform for AI-assisted software development, operational maintenance, and knowledge management. Built on [multi-model-agent](https://github.com/zhixuan312/multi-model-agent) (MMA).

Forge is designed around one principle: **teams outperform individuals**. Knowledge belongs to the team, not to any one person. When someone leaves, their expertise stays — captured in the journal through daily work, not through documentation efforts. When operations need attention, loops handle it — not heroes working overtime.

## Three pillars

### 1. SDLC — build together

The AI software development lifecycle as a team workflow. Business users, engineers, and product managers each contribute what they're best at — without anyone needing to open a terminal.

The lifecycle is six stages — the labels below are exactly what the stepper shows:

- **Explore** — business user describes the problem in their own language; investigation, research and journal recall fan out in parallel, then synthesize a grounded brief
- **Spec** — components are drafted and approved per section, then audited to a clean pass
- **Plan** — engineer reviews the technical plan; architecture and risk decisions stay with human judgment
- **Execute** — Forge checks the project's branch out in a worktree of its own, then MMA workers implement the approved tasks in place there; the engine cuts no branch and no worktree itself
- **Review** — code review runs per repo; quality gates require both AI and human satisfaction before approval
- **Reflect** — learnings are harvested from the run and recorded into the team journal

Each stage routes to the person best suited for that job. The business user for the problem. The engineer for the solution. Both for the decision.

**Exploration** — brain-dump your idea, attach files, or use voice. Forge fans out investigation, research, and journal recall in parallel, then synthesizes a grounded brief.

![Explore stage](public/screenshots/explore.png)

**Spec crafting** — multi-approver component review. Each spec section (Context, Problem, Goals, Technical Design, Testing Plan) is reviewed and approved by the right team members.

![Spec craft](public/screenshots/spec-craft.png)

**Spec audit** — AI audits the spec across multiple passes, auto-applies fixes, and shows findings by severity. The team reviews before proceeding to plan.

![Spec audit](public/screenshots/spec-audit.png)

### 2. Journal — know together

A persistent team-level knowledge graph at `<workspaceRoot>/.mma/journal/`. Every team member contributes — business owners recording process decisions, engineers capturing design rationale, product managers logging user behavior patterns. Knowledge accumulates through daily work, not through dedicated documentation sprints.

- **Decisions** stay: why we chose this architecture, why we rejected that vendor, what the regulator requires
- **Learnings** compound: a bug fix today becomes a pattern the team recognizes next quarter
- **People move on, knowledge doesn't**: the journal is the team's institutional memory, not any individual's

Every project, every loop, every operational task feeds back into the journal. Future work recalls prior learnings before starting — the team gets smarter over time, not just busier.

![Journal](public/screenshots/journal.png)

### 3. Loops — operate together

Automated, recurring maintenance jobs that keep the lights on. As teams ship more, operational burden grows — loops absorb that burden so people can focus on building.

- **Scheduled maintenance**: cron-driven jobs that run test pipelines, catch regressions, validate dependencies
- **Small-bug governance**: loops detect and triage minor issues before they compound into incidents
- **PR-for-review, never auto-merge**: loops propose changes for human review, they don't act unilaterally
- **Extensible**: kind-registry pattern — add new loop types as operational needs evolve

The goal is simple: reduce the amount of work needed to keep operations running. Every repeatable task that a loop can govern is a task a person doesn't have to remember.

![Loops](public/screenshots/loops.png)

### Usage — see the cost

Full visibility into what the AI is doing and what it costs. Breakdown by projects, loops, and standalone tasks. See actual spend, estimated savings vs. your main model, agent hours, and token consumption.

![Usage](public/screenshots/usage.png)

## Why team-level

Most AI tools empower individuals. Forge empowers teams.

The difference matters. Individual tools create individual silos — one person's Claude history, one developer's Cursor context, one engineer's terminal session. When that person is unavailable, the knowledge is gone. When they leave, it's gone permanently.

Forge inverts this. The system holds the knowledge, not the person. The process captures expertise, not the individual. Every team member — business owner, engineer, product manager — contributes to the same journal, benefits from the same loops, works through the same SDLC. The tool becomes the team's memory, the process becomes the team's standard, and the knowledge compounds regardless of who's on the roster.

## Architecture

- **Frontend**: Next.js 16 (App Router), shadcn/ui (Radix + Tailwind), TanStack Table
- **Backend**: Next.js API routes, Drizzle ORM, PostgreSQL
- **AI Engine**: MMA over HTTP (`POST /task`) — routes work to Claude, Codex, or any configured provider
- **Auth**: Session-based with Argon2 password hashing
- **Time**: Asia/Singapore (UTC+8) for all scheduling and display

## Run the released image

Forge ships as a versioned **all-in-one** container image on GHCR — no repo checkout
needed. **One container carries Forge and its matched MMA engine** (pinned at
`matchedMmaVersion`, run as a loopback co-process). You do **not** run MMA separately:
engine reachability, the shared bearer token, and workspace file identity are all
internal to the container. You provide a Postgres, a secret key, provider credentials,
and a workspace mount.

The only **required** configuration is a database and a secret key — providers are set up
in the app afterward.

```bash
# docker compose — Forge (with bundled MMA) + optional local Postgres
DATABASE_URL="postgres://forge:forge@postgres:5432/forge" \
FORGE_SECRET_KEY="<32+ byte secret>" \
FORGE_IMAGE_TAG=0.1.4 docker compose --profile postgres up -d

# or a single container against your own Postgres
docker run -d -p 3000:3000 \
  -e DATABASE_URL="postgres://user:pass@host:5432/forge" \
  -e FORGE_SECRET_KEY="<32+ byte secret>" \
  -v forge-workspace:/workspace \
  -v forge-mma-config:/home/node/.mma \
  ghcr.io/zhixuan312/forge:0.1.4
```

On start the supervisor starts the bundled MMA on `127.0.0.1:7337`, health-gates it,
then creates the schema, runs migrations, and seeds templates (idempotent), and serves
on `http://localhost:3000`. Open it, register the first admin at `/setup`, create your
teams, add git connections, and **configure providers per tier in Settings → Models**.

**Providers are configured in the app, not locked to a vendor.** The **Models** page
(org-admin) sets each agent tier (`standard` / `complex` / `main`) to any
provider/model/endpoint/key — Anthropic-compatible (`claude`) or OpenAI-compatible
(`codex`), including vendors like DeepSeek / Z.ai / Kimi behind their own endpoint — and MMA
validates and persists it (to the `/home/node/.mma` volume, so it survives upgrades). If you
prefer, you can **seed** the initial config at first boot with env vars (`PROVIDER`,
`PROVIDER_<TIER>`, `MODEL_<TIER>`, `BASE_URL_<TIER>`, `API_KEY_ENV_<TIER>`, and the key
itself); those apply only when no config exists yet, then the UI is authoritative. Keyless
tiers fall back to native OAuth — mount `~/.claude` / `~/.codex` to use it.

The `/workspace` volume is where Forge clones each team's repos and where MMA operates. Pin
to a digest (`ghcr.io/zhixuan312/forge@sha256:…`, see the CHANGELOG) for an immutable deploy.
See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full guide (multi-tenant workspace
layout, per-tier providers, backup/upgrade) and `.env.example` for every variable.

## Getting started (development)

```bash
# Prerequisites: Node >= 22, PostgreSQL, MMA server running
pnpm install
pnpm db:migrate
pnpm db:seed-templates
pnpm dev              # http://localhost:3000
```

The MMA engine runs separately (`mma serve` on port 7337). Forge calls its `POST /task` endpoint to dispatch work.

Useful during development:

```bash
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint, incl. the governed-components rule
pnpm test             # vitest (no database required — tests/setup.ts unsets DATABASE_URL)
pnpm governance:check # every page/component conforms to its governed layer
```

Loops need no extra process: the scheduler that fires `recurring` (cron) loops ticks inside
the Forge server. `pnpm loop-worker` runs that same scheduler standalone if you would rather
keep it out of the web process — set `FORGE_DISABLE_LOOP_SCHEDULER=true` so only one of them
ticks.

## Operating a deployment

Three maintenance commands are the operator's, not the app's — nothing schedules them:

```bash
pnpm db:reap             # delete expired sessions; run on a cron/systemd timer
pnpm db:migrate-artifacts # one-shot: move project artifacts under each team's own
                          # workspace root (--dry to preview). A no-op while all
                          # teams share one root; idempotent, and never overwrites.
pnpm db:seed-journal     # DESTRUCTIVE. Replaces the team journal under
                          # <workspaceRoot>/.mma/journal/ with the demo dataset —
                          # it DELETES nodes/ first. That store is where every
                          # recall reads and where MMA appends each run's
                          # learnings, and nothing else backs it up. Intended for a
                          # fresh install or a demo environment. It refuses to run
                          # once the journal holds nodes; pass --force to override.
```

Session validation rejects stale sessions regardless, so skipping the reaper is a
storage problem rather than a security one — but nothing else bounds the table.

## Container bootstrap notes

- The image is **all-in-one**: `scripts/container-supervisor.mjs` (under `tini`) starts the bundled MMA engine on loopback, health-gates it, runs the DB bootstrap, then starts Forge. Both processes share one lifecycle — if either dies the container exits for a clean restart.
- The bundled MMA is pinned at `package.json#matchedMmaVersion` and installed at build time. To move it, bump that field and cut a new Forge release — the image never pulls `@latest`.
- Mount `~/.mma/config.json` (to `/home/node/.mma/config.json`) when you want a mixed-tier or pre-existing MMA config to win untouched.
- Otherwise the supervisor generates a config from the env. `PROVIDER` names the WIRE
  PROTOCOL (`claude` = Anthropic-compatible, `codex` = OpenAI-compatible; `anthropic` and
  `openai` are accepted aliases) and is only the DEFAULT for tiers with no override —
  `PROVIDER_<TIER>`, `MODEL_<TIER>`, `BASE_URL_<TIER>` and `API_KEY_ENV_<TIER>` set each
  tier independently, so mixed layouts are first-class. (This bullet previously described
  `PROVIDER` as a single vendor switch applied to every tier, contradicting the Models
  paragraph above it in this same file.)
- OAuth mode is supported by mounting `~/.claude` and/or `~/.codex` (to `/home/node/...`) and leaving the generated tiers keyless.

## Project structure

```
app/
  (app)/           UI pages
    projects/        SDLC workflow (explore → spec → plan → execute → review → reflect)
    journal/         Team knowledge graph viewer
    loops/           Operational loop management
    settings/        Workspace config (models, members, connections)
    usage/           Cost and activity dashboards
  (auth)/          Login + setup
  api/             Backend API routes
src/
  build/           Build-phase orchestration
  collab/          Real-time collaboration (SSE)
  components/      Shared UI components (shadcn/ui)
  db/              Drizzle schema + queries (5 table groups: team/workspace/project/loop/ops)
  dispatch/        MMA task dispatch layer
  journal/         Team knowledge graph (recall, record, pins)
  loops/           Loop kind-registry, run-engine, scheduler
  mma/             MMA client + config
  plan/            Plan authoring + audit
  spec/            Spec generation + audit
```

## Key concepts

- **Workspace**: a team's top-level container — one MMA config, one journal, shared settings
- **Project**: a unit of work flowing through explore → spec → plan → execute → review → reflect.
  Those six STAGES group into three PHASES (`design` · `build` · `learn`) — "build" is a
  phase, not a stage, and the execute stage's URL segment is `/execute`
- **Loop**: a recurring automated maintenance job (scheduled, governed, always PR-for-review)
- **Journal**: team-level knowledge graph — decisions, designs, behaviors, processes, learnings, style conventions
- **Project Activity**: a durable timeline of all events in a project — spec drafts, approvals, component confirmations, user transitions, and discover tasks. Stored in the `project_activity` table with actor attribution and source tracking (user vs. MMA)

The project timeline lives in `project_activity`. Team-level FAQ suggestions come from `topFaqs(...)`, which reads recent `ops_mma_batch` `journal_recall` history rather than any project-local event store.

## Relationship to MMA

Forge is the team layer. MMA is the engine. Forge calls MMA to dispatch work — audit, investigate, delegate, execute_plan, review, debug, research, orchestrate. MMA routes each task to the right model, runs the two-phase pipeline (implementer + refiner), and returns structured results. Forge manages the human workflow, the team knowledge, and the operational loops around those results.

## License

MIT — see [LICENSE](./LICENSE).
