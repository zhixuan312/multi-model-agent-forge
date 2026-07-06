---
id: "0008"
title: "A file-only node absent from the index"
status: "adopted"
tags:
  - stale-index
  - source-of-truth
timestamp: "2026-05-28"
links: []
supersededBy: null
---

## Context
This node exists in nodes/ but is NOT listed in index.md. Because nodes/ is the
source of truth, it must still appear in the list at first paint.

## Consequences
readAllNodes reconciles against nodes/, not index.md alone.
