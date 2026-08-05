#!/usr/bin/env bash
#
# One-command Agent Runner demo.
#
#   ./scripts/demo.sh                     # self-correction demo (default)
#   ./scripts/demo.sh order-total         # happy path
#
# Seeds the demo tasks, fires the webhook with a valid HMAC signature, and
# prints the run URL.
set -euo pipefail

cd "$(dirname "$0")/.."

TASK_SLUG="${1:-self-correction-deps}"
API_URL="${API_URL:-http://localhost:3001}"
CLIENT_URL="${CLIENT_URL:-http://localhost:3000}"

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  echo "ERROR: no .env found. Copy .env.example and append .env.agent-runner.example." >&2
  exit 1
fi

# Read the secret without sourcing .env, which would execute whatever is in it.
WEBHOOK_SECRET="$(grep -E '^AGENT_RUNNER_WEBHOOK_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'' | tr -d '\r')"

if [ -z "${WEBHOOK_SECRET}" ]; then
  echo "ERROR: AGENT_RUNNER_WEBHOOK_SECRET is not set in .env" >&2
  echo "Generate one with:" >&2
  echo "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"" >&2
  exit 1
fi

ENABLED="$(grep -E '^AGENT_RUNNER_ENABLED=' .env | head -1 | cut -d= -f2- | tr -d '\r' || true)"
if [ "${ENABLED}" != "true" ]; then
  echo "ERROR: AGENT_RUNNER_ENABLED is not true in .env — the routes will not exist." >&2
  exit 1
fi

if ! curl -sf "${API_URL}/health" >/dev/null; then
  echo "ERROR: server is not responding at ${API_URL}. Start it with 'docker compose up'." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Seed
# ---------------------------------------------------------------------------
echo "==> Seeding demo tasks"
node scripts/seed-demo.js

# ---------------------------------------------------------------------------
# 2. Sign and fire the webhook
# ---------------------------------------------------------------------------
BODY="{\"source\":\"demo.sh\",\"nonce\":\"$(date +%s%N)\"}"
TIMESTAMP="$(date +%s)"

# The signature covers v1:<timestamp>:<raw body>, matching middleware/hmac.js.
# printf, not echo: a trailing newline would change the signed bytes and the
# signature would not verify.
SIGNATURE="$(printf '%s' "v1:${TIMESTAMP}:${BODY}" \
  | openssl dgst -sha256 -hmac "${WEBHOOK_SECRET}" \
  | sed 's/^.* //')"

echo "==> Firing webhook for task '${TASK_SLUG}'"

# The custom content type is required: the app mounts express.json() globally,
# which would consume the body and make the raw bytes unverifiable. See
# server/src/agent-runner/middleware/hmac.js.
RESPONSE="$(curl -s -w '\n%{http_code}' -X POST \
  "${API_URL}/api/runs/trigger/${TASK_SLUG}" \
  -H "Content-Type: application/agent-runner+json" \
  -H "x-agentrunner-timestamp: ${TIMESTAMP}" \
  -H "x-agentrunner-signature: v1=${SIGNATURE}" \
  -H "x-agentrunner-idempotency-key: demo-${TIMESTAMP}" \
  --data-binary "${BODY}")"

HTTP_CODE="$(printf '%s' "${RESPONSE}" | tail -1)"
PAYLOAD="$(printf '%s' "${RESPONSE}" | sed '$d')"

if [ "${HTTP_CODE}" != "202" ] && [ "${HTTP_CODE}" != "200" ]; then
  echo "ERROR: webhook returned HTTP ${HTTP_CODE}" >&2
  echo "${PAYLOAD}" >&2
  exit 1
fi

RUN_ID="$(printf '%s' "${PAYLOAD}" | sed -n 's/.*"runId":"\([^"]*\)".*/\1/p')"

if [ -z "${RUN_ID}" ]; then
  echo "ERROR: could not parse runId from response:" >&2
  echo "${PAYLOAD}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Report
# ---------------------------------------------------------------------------
cat <<EOF

  Accepted (HTTP ${HTTP_CODE}) — the webhook returned immediately; execution
  happens on the queue worker.

  Run id:  ${RUN_ID}
  Watch:   ${CLIENT_URL}/runs/${RUN_ID}
  Stream:  ${API_URL}/api/runs/${RUN_ID}/stream   (needs a Bearer token)

EOF

if [ "${TASK_SLUG}" = "self-correction-deps" ]; then
  cat <<'EOF'
  This is the self-correction task. It asks for a YAML file to be parsed, and
  Node has no YAML parser in its standard library — so the honest first move is
  require("js-yaml"). The sandbox ships no third-party packages and has no
  network, so attempt 1 dies with MODULE_NOT_FOUND, every time.

  The failure comes from the ENVIRONMENT, not from trick data: no amount of
  careful coding avoids a dependency that is not installed. Attempt 2 gets the
  real stderr fed back and must rewrite using only the standard library.

  Open the run and expand the attempts to see the diff between them.

EOF
fi
