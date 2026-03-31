#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/setup-test-webhook.sh
#
# テスト OA の webhook URL を確認 / コピーするヘルパー。
# ngrok が起動していれば URL を自動取得して表示する。
#
# 使い方:
#   bash scripts/setup-test-webhook.sh
#   bash scripts/setup-test-webhook.sh [oaId]   # oaId 指定版
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

OA_ID="${1:-}"
NGROK_API="http://localhost:4040/api/tunnels"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  LINE 謎解き Bot — テスト Webhook セットアップ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── ngrok の公開 URL を取得 ──────────────────────────────────────────────────

NGROK_URL=""
if curl -s "$NGROK_API" > /dev/null 2>&1; then
  NGROK_URL=$(curl -s "$NGROK_API" | \
    python3 -c "import sys,json; tunnels=json.load(sys.stdin)['tunnels']; \
    https=[t for t in tunnels if t['proto']=='https']; \
    print(https[0]['public_url'] if https else '')" 2>/dev/null || true)
fi

if [ -z "$NGROK_URL" ]; then
  echo ""
  echo "⚠️  ngrok が起動していません。"
  echo "   別ターミナルで以下を実行してください:"
  echo ""
  echo "   ngrok http 3000"
  echo ""
  echo "   起動後、このスクリプトを再実行してください。"
  echo ""
  exit 1
fi

echo ""
echo "✅ ngrok URL 検出:"
echo "   $NGROK_URL"

# ── OA ID の確認 ─────────────────────────────────────────────────────────────

if [ -z "$OA_ID" ]; then
  echo ""
  echo "📋 管理画面の OA 一覧から oaId を確認してください:"
  echo "   http://localhost:3000/oas"
  echo ""
  echo "   例: URL が /oas/abc123/works なら oaId = abc123"
  echo ""
  read -rp "▶ oaId を入力してください: " OA_ID
fi

if [ -z "$OA_ID" ]; then
  echo "❌ oaId が未入力です。終了します。"
  exit 1
fi

WEBHOOK_URL="${NGROK_URL}/api/line/${OA_ID}/webhook"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Webhook URL（LINE Developer Console に貼り付ける）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  $WEBHOOK_URL"
echo ""

# クリップボードにコピー（macOS）
if command -v pbcopy > /dev/null 2>&1; then
  echo "$WEBHOOK_URL" | pbcopy
  echo "  ✅ クリップボードにコピーしました"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  次のステップ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. LINE Developer Console を開く:"
echo "     https://developers.line.biz/console/"
echo ""
echo "  2. テスト用チャネル → [Messaging API 設定] タブ"
echo ""
echo "  3. Webhook URL に貼り付けて「検証」を押す"
echo "     → {\"ok\":true} が返れば成功"
echo ""
echo "  4. 「Webhookの利用」を ON にする"
echo ""
echo "  5. けんぴちゃんの userId を取得するには:"
echo "     bot に何かメッセージを送ってもらい、サーバーログを確認:"
echo "     [Webhook] text message  userId=Uxxxxx..."
echo ""
echo "  6. .env.local に設定:"
echo "     TEST_MODE=true"
echo '     TEST_LINE_USER_ID="Uxxxxx..."'
echo ""
echo "  詳細手順: docs/test-oa-setup.md"
echo ""

# ── ngrok Web UI のリンク ─────────────────────────────────────────────────────
echo "  📊 ngrok Web UI（リクエスト確認）: http://localhost:4040"
echo ""
