#!/bin/sh
set -eu

# Runs under tini (PID 1). The supervisor starts the bundled MMA engine + Forge
# and ties their lifecycles together — see scripts/container-supervisor.mjs.
exec node /app/scripts/container-supervisor.mjs "$@"
