#!/usr/bin/env bash
# scripts/rh-test/docker-up.sh
# リリースハードニング E2E 用の一時 PostgreSQL コンテナを起動する。
# 本番から完全分離: localhost のみ・専用DB名/user/password・非標準ポート・破棄可能。
set -euo pipefail

CONTAINER="ws-rh-pg"
DB="whale_studio_release_hardening_test"
USER_="rh_test_user"
PASS="rh_test_pw_local_only"     # ローカル専用の非機密ダミー（本番passwordではない）
PORT="55432"                      # 非標準ポート（既存PGと衝突回避）
IMAGE="postgres:16-alpine"

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "[docker-up] container ${CONTAINER} already exists; (re)starting"
  docker start "${CONTAINER}" >/dev/null
else
  echo "[docker-up] starting ${IMAGE} as ${CONTAINER} on localhost:${PORT}"
  docker run -d --name "${CONTAINER}" \
    -e POSTGRES_USER="${USER_}" \
    -e POSTGRES_PASSWORD="${PASS}" \
    -e POSTGRES_DB="${DB}" \
    -p 127.0.0.1:${PORT}:5432 \
    "${IMAGE}" >/dev/null
fi

# healthcheck: readiness を待つ
echo -n "[docker-up] waiting for postgres readiness"
for i in $(seq 1 30); do
  if docker exec "${CONTAINER}" pg_isready -U "${USER_}" -d "${DB}" >/dev/null 2>&1; then
    echo " -> ready"
    break
  fi
  echo -n "."
  sleep 1
done

# 本番 Supabase が既定で持つ拡張を分離DBにも用意（Work.publicId の gen_unique_public_id が pgcrypto 依存）。
# ※ 本番相当のスキーマ挙動にするための test 環境準備であり、migration/schema は変更しない。
docker exec "${CONTAINER}" psql -U "${USER_}" -d "${DB}" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null 2>&1 || true

# 非機密のみ表示（host / db / port）。password/URL は出さない。
echo "[docker-up] host=127.0.0.1 port=${PORT} db=${DB} user=${USER_}"
echo "[docker-up] (DATABASE_URL は .env.test.local に記載済み・gitignore)"
