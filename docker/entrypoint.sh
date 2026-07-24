#!/bin/sh
set -eu

exec node /app/scripts/container-bootstrap.mjs "$@"
