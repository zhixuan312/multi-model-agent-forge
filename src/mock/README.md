# Mock backend

A swappable, **file-backed fake backend** so the front end runs fully without a real
database or LLM. Reads are seeded; **writes are captured to disk** so the UI stays
self-consistent (add a member → it appears; delete → it's gone), surviving reloads.
Every mock payload matches the real endpoint contract, so the real backend drops in
behind the same endpoints with **no front-end change**.

Currently wired for **Team Settings only** (members · providers · roster · connections).
The mechanism is generic — other pages plug in the same way.

## How it works

```
src/mock/
  config.ts                 USE_MOCK switch + mockLatency()
  store.ts                  MockTable<T> — generic file-backed collection (reusable)
  seed/*.json               committed seed data, in endpoint-payload shapes (the "DB")
  domains/settings/*.ts     per-domain mock impls of the *-core contracts
.mock-db/                   working copy (gitignored) — the live fake DB, captures writes
```

Injection is at the **data/service layer**: each `*-core` function has one guard at the
top — `if (USE_MOCK) return xMock.fn(...)`. Route handlers and RSC reads both call the
core functions unchanged, so their validation / auth / business logic is **untouched**.

- **ON** in `next dev` by default (no env change needed). **OFF** under `test` and
  `production`. Force with `MOCK_BACKEND=1` / `MOCK_BACKEND=0`.
- The working DB lives in `.mock-db/*.json`. Delete it to re-seed from `seed/`.

## Add a new page (e.g. "projects")

1. `seed/projects.json` — initial rows in the endpoint-response shape.
2. `domains/projects/<x>.ts` — implement the page's `*-core` contract over a
   `new MockTable('projects', () => seed)`. Wrap each fn in `await mockLatency()`.
3. In the page's `*-core`, add `if (USE_MOCK) return xMock.fn(...)` at the top of each
   function. Done — reads + writes now flow through the fake DB.

## LLM / async endpoints (future)

Same pattern: the service that *will* call a model gets the guard and instead returns a
pre-built payload from a `domains/<page>/llm/*.json` after `mockLatency(<bigger ms>)` —
so loading states render and **no model is ever called**.

## Remove it

Set `MOCK_BACKEND=0` (or flip `USE_MOCK`), or delete the `if (USE_MOCK)` guards + this
folder + `.mock-db/`. The real `*-core` logic underneath is unchanged.
