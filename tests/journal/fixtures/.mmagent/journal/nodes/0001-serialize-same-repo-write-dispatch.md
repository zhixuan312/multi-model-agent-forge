---
id: "0001"
title: "Serialize same-repo write dispatch"
status: "superseded"
tags:
  - concurrency
  - dispatch
  - git
date: "2026-05-24"
links:
  - type: "relates"
    target: "0003"
supersededBy: "0002"
---

## Context
The conservative concurrency rule grouped same-repo tasks and serialized them to
protect the shared checkout. This threw away throughput.

## Consequences
Superseded by the scoped-commit approach in node 0002.
