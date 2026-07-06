---
id: "0005"
title: "A node with an unknown status value"
status: "frobnicated"
tags:
  - unknown-status
  - leniency
timestamp: "2026-05-27"
links:
  - type: "wobbles"
    target: "0002"
supersededBy: null
---

## Context
This node has a valid frontmatter but a status value outside the known enum, and
an edge type outside the known set. It must still parse and render (neutral
chips), never be skipped.

## Consequences
Renderer leniency is exercised by this fixture.
