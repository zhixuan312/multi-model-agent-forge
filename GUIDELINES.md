# mma-forge (team mode) — Product Guidelines

> Forge is MMA's team (collaboration) mode: a gated, standardized SDLC workflow
> built on the engine, where a product team moves work through Exploration → Spec
> → Plan → Execute → Review with review gates and shared knowledge.

## Role in the MMA product

Forge is the **team adoption mode** — a server-deployed, collaborative
orchestration app built on top of the engine (over HTTP). Where the engine, used
directly, is the flexible individual path, Forge gives a team the same lifecycle
made *standard*: consistent stages, review gates, roles, and a shared knowledge
graph. Forge owns the SDLC chain and its gates; the engine executes each stateless
per-stage rod. The global north star is `DIRECTION.md`; this document carries
Forge's product-specific direction.

## Product-specific principles

1. **The lifecycle is a gated spine, not a free-for-all.** Every project moves
   through Exploration → Spec → Plan → Execute → Review (and Journal), each stage a
   gate the work must clear before advancing. Standardization is the point: the
   workflow is the same across people, so a team's delivery doesn't depend on which
   engineer drove it.
2. **Automation gates at design; humans keep the merge.** Forge's automated mode
   may drive post-design stages, but never the design phases (exploration and early
   spec are hand-authored), and it never auto-merges — output lands as a PR for
   human review. (This is Forge's expression of the global principle "No autonomy
   theater.")
3. **Roles and review gates make quality legible to a team.** Spec components map
   to role owners (business, PM, SWE, QE); review gates surface findings the team
   acts on. Cross-agent review from the engine plus human gates is how quality
   becomes structural for a team. (Global principle "Quality is structural.")
4. **Team knowledge is shared and cumulative.** A team-level journal (a decision
   graph) records learnings and is recalled before work, so the team doesn't
   re-tread ground it already covered. Knowledge is a team asset, not per-engineer
   memory.
5. **The team owns the workflow; the engine owns each task.** Forge holds all
   workflow state — stages, gates, RBAC, projects — in its own store; the engine
   stays stateless. (Global principle "We harness the lifecycle; we don't author
   it": Forge instruments the chain, the team decides what to build and whether to
   advance.)

## What this package does

- One consolidated Next.js app in its own repo (Postgres + Drizzle), calling the
  engine over HTTP at `127.0.0.1:7337` (202-then-poll); it never links engine
  internals.
- **The SDLC spine:** Exploration (investigate/research fan-out + synthesis) → Spec
  (per-component Q&A + audit) → Plan (TDD plan + audit) → Execute (build + PR) →
  Review (findings) → Journal (harvest learnings).
- **3-tier RBAC:** `org_admin` (shared infra — the engine connection, model tiers,
  teams, cross-team usage), `team_admin`, and `member`.
- Per-team workspace and git repos; a per-team knowledge journal.
- Automated vs. human-gated mode per project (gated to post-design; always
  PR-for-review).
- An in-app Usage view — a team-scoped operational cut of the same cost/savings
  data the telemetry surface aggregates.

## What this package won't do

- **Won't auto-merge.** Output is always a PR for human review.
- **Won't drive the design phases automatically** — exploration and early spec are
  hand-authored.
- **Won't reimplement the engine** — the boundary is strictly HTTP; no linking of
  engine internals.
- **Won't fork into a second product** — it is one engine underneath, made standard
  for teams.

## Relationship to the other surfaces

- Built **on** the engine, over HTTP; the engine executes each rod and knows
  nothing of teams, projects, or gates.
- Emits usage to **telemetry**, tagged as team-mode, so the proof surface can show
  the team story alongside the individual one under one shared evidence model.
- Forge now has team tenancy + RBAC — this reflects current reality and supersedes
  the retired "no orgs / multi-team / RBAC" scope of journal node 0037.

## /direction mirror note

The public `/direction` page mirrors this document's sections under the `forge`
group. Keep them in sync via
`multi-model-agent-telemetry-frontend/docs/direction-parity-checklist.md`; an edit
here requires the mirrored page section to be updated in the same change.
