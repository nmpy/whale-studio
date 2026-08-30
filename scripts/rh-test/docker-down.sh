#!/usr/bin/env bash
# scripts/rh-test/docker-down.sh
# E2E 用一時 PostgreSQL コンテナを停止・削除（データも破棄）。
set -euo pipefail
CONTAINER="ws-rh-pg"
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  docker rm -f "${CONTAINER}" >/dev/null
  echo "[docker-down] removed container ${CONTAINER} (ephemeral data destroyed)"
else
  echo "[docker-down] container ${CONTAINER} not present"
fi
