#!/usr/bin/env bash
# poll 插件动作的 curl 复现样例（双端联调对照基准，U1 验收配套）
#
# 前置：
#   1. 云端服务器已部署含 U1 的版本（>= v0.8.24）
#   2. 测试账号两个（A 发起/投票，B 观察新卡片广播）
#   3. 目标会话 runId（从聊天页 URL /runs/<runId> 或 DB conversations 表取）
#
# 用法：替换前三个变量后整段执行。
set -euo pipefail

HOST="${HOST:-http://YOUR-SERVER:8787}"
USER_A="${USER_A:-alice}"
PASS_A="${PASS_A:-alice-password}"
RUN_ID="${RUN_ID:-run-xxxxxxxx}"

echo "== 1. 登录拿 token =="
TOKEN=$(curl -s -X POST "$HOST/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER_A\",\"password\":\"$PASS_A\"}" | python -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
AUTH="Authorization: Bearer $TOKEN"

echo "== 2. 确认插件候选与启用状态 =="
curl -s "$HOST/api/users/me/plugins" -H "$AUTH" | python -m json.tool

echo "== 3. 启用 poll 插件（幂等；已启用返回 ok） =="
curl -s -X POST "$HOST/api/users/me/plugins/poll/enable" -H "$AUTH" | python -m json.tool

echo "== 4. 发起投票（聊天流应出现 cardType=poll 卡片消息） =="
curl -s -X POST "$HOST/api/users/me/plugins/poll/actions/create" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"runId\":\"$RUN_ID\",\"question\":\"周五团建去哪\",\"options\":[\"爬山\",\"聚餐\",\"KTV\"]}" \
  | python -m json.tool
# 记下响应里的 pollId，下一步投票用：
POLL_ID=$(curl -s -X POST "$HOST/api/users/me/plugins/poll/actions/create" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"runId\":\"$RUN_ID\",\"question\":\"重复发起仅取 pollId 用\",\"options\":[\"a\",\"b\"]}" \
  | python -c "import sys,json;print(json.load(sys.stdin)['data']['pollId'])")

echo "== 5. 投票（应返回 totalVotes 且聊天流追加新版本卡片） =="
curl -s -X POST "$HOST/api/users/me/plugins/poll/actions/vote" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"pollId\":\"$POLL_ID\",\"optionId\":\"opt-1\"}" \
  | python -m json.tool

echo "== 6. 未启用插件的用户调用同动作 → 应 400「插件未运行」或 404「未知动作」 =="
echo "   （换 B 账号 token 重放第 5 步验证隔离；B 启用 poll 后才允许投票）"

echo "完成。验证点："
echo "  A/B 两端的聊天流都出现卡片消息（WS chat.message 带 attachment.type=plugin-card）"
echo "  点选项 → 新版本卡片追加、票数增长"
echo "  B 未启用插件时 vote 返回 400/404（per-user 动作表隔离）"
