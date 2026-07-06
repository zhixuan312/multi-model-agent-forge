---
id: "0002"
title: "Prefer same-repo parallel dispatch with scoped commits"
status: "adopted"
tags:
  - concurrency
  - dispatch
  - parallel
timestamp: "2026-05-24"
links:
  - type: "supersedes"
    target: "0001"
  - type: "relates"
    target: "0003"
  - type: "depends-on"
    target: "0004"
supersededBy: null
---

Fix the dangerous operation precisely rather than sacrificing concurrency.

## Context
Same-repo workers became safe to run in parallel once each worker committed only
its own harness-tracked files with pathspec-scoped staging.

## Consequences
Repository identity is no longer a reason to downgrade a dispatch to serial.
