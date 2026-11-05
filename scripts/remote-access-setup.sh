#!/usr/bin/env bash
# remote-access-setup.sh
#
# Run this on YOUR machine (not the Mac Mini) to configure
# SSH tunnel + Hermes remote access to the team Mac Mini.
#
# Usage:
#   curl -sL <raw-url> | bash
#   — or —
#   bash scripts/remote-access-setup.sh
#
# Prerequisites:
#   - SSH access to the Mac Mini (ask the team lead for your public key to be added)
#   - Hermes CLI installed locally (https://docs.hermes.ai/install)

set -euo pipefail

MAC_MINI_HOST="${MAC_MINI_HOST:-10.167.225.62}"
MAC_MINI_USER="${MAC_MINI_USER:-team}"
MAC_MINI_SSH_PORT="${MAC_MINI_SSH_PORT:-22}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# --- Step 1: Verify SSH access ---
echo ""
info "Step 1: Verifying SSH access to ${MAC_MINI_USER}@${MAC_MINI_HOST}..."

if ssh -o ConnectTimeout=5 -o BatchMode=yes -p "${MAC_MINI_SSH_PORT}" "${MAC_MINI_USER}@${MAC_MINI_HOST}" "echo ok" &>/dev/null; then
  info "SSH connection successful."
else
  error "Cannot connect to ${MAC_MINI_USER}@${MAC_MINI_HOST}:${MAC_MINI_SSH_PORT}"
  echo ""
  echo "  Possible fixes:"
  echo "  1. Ask the team lead to add your SSH public key to the Mac Mini"
  echo "  2. Generate a key if you don't have one:  ssh-keygen -t ed25519"
  echo "  3. Share your public key:  cat ~/.ssh/id_ed25519.pub"
  echo ""
  exit 1
fi

# --- Step 2: Check Hermes CLI ---
info "Step 2: Checking Hermes CLI..."

if ! command -v hermes &>/dev/null; then
  error "Hermes CLI not found. Install it first:"
  echo "  https://docs.hermes.ai/install"
  exit 1
fi

info "Hermes CLI found: $(hermes --version 2>/dev/null || echo 'unknown version')"

# --- Step 3: Configure Hermes remote gateway ---
info "Step 3: Configuring Hermes for remote gateway access..."

HERMES_CONFIG="${HOME}/.hermes/hermes.json"
mkdir -p "${HOME}/.hermes"

if [ -f "${HERMES_CONFIG}" ]; then
  warn "Existing config found at ${HERMES_CONFIG}"
  echo "  Backing up to ${HERMES_CONFIG}.bak"
  cp "${HERMES_CONFIG}" "${HERMES_CONFIG}.bak"
fi

echo ""
echo "  The Mac Mini gateway requires an auth token."
echo "  Ask the team lead for the gateway token."
echo ""
read -rp "  Gateway auth token: " GATEWAY_TOKEN

if [ -z "${GATEWAY_TOKEN}" ]; then
  error "Token cannot be empty."
  exit 1
fi

# Write remote gateway config
# If existing config, merge; otherwise create minimal config
if [ -f "${HERMES_CONFIG}" ] && command -v node &>/dev/null; then
  node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('${HERMES_CONFIG}', 'utf8'));
    config.gateway = {
      ...config.gateway,
      mode: 'remote',
      remote: {
        url: 'ws://127.0.0.1:${GATEWAY_PORT}',
        token: '${GATEWAY_TOKEN}'
      }
    };
    fs.writeFileSync('${HERMES_CONFIG}', JSON.stringify(config, null, 2));
  "
else
  cat > "${HERMES_CONFIG}" << JSONEOF
{
  "gateway": {
    "mode": "remote",
    "remote": {
      "url": "ws://127.0.0.1:${GATEWAY_PORT}",
      "token": "${GATEWAY_TOKEN}"
    }
  }
}
JSONEOF
fi

chmod 600 "${HERMES_CONFIG}"
info "Hermes config written to ${HERMES_CONFIG}"

# --- Step 4: Create SSH tunnel helper script ---
info "Step 4: Creating SSH tunnel helper..."

TUNNEL_SCRIPT="${HOME}/.hermes/tunnel-mac-mini.sh"
cat > "${TUNNEL_SCRIPT}" << 'SCRIPTEOF'
#!/usr/bin/env bash
# SSH tunnel to Mac Mini Hermes gateway
# Run this before using Hermes remotely.
# It stays in the foreground — Ctrl+C to stop.

MAC_MINI_HOST="${MAC_MINI_HOST:-10.167.225.62}"
MAC_MINI_USER="${MAC_MINI_USER:-team}"
MAC_MINI_SSH_PORT="${MAC_MINI_SSH_PORT:-22}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"

echo "Opening SSH tunnel to ${MAC_MINI_USER}@${MAC_MINI_HOST}:${GATEWAY_PORT}..."
echo "  Local:  ws://127.0.0.1:${GATEWAY_PORT}"
echo "  Remote: 127.0.0.1:${GATEWAY_PORT} on Mac Mini"
echo ""
echo "Keep this terminal open. Press Ctrl+C to disconnect."
echo ""

ssh -N -L "${GATEWAY_PORT}:127.0.0.1:${GATEWAY_PORT}" \
    -p "${MAC_MINI_SSH_PORT}" \
    -o ServerAliveInterval=60 \
    -o ServerAliveCountMax=3 \
    "${MAC_MINI_USER}@${MAC_MINI_HOST}"
SCRIPTEOF

chmod +x "${TUNNEL_SCRIPT}"
info "Tunnel script created at ${TUNNEL_SCRIPT}"

# --- Step 5: Test the connection ---
echo ""
info "Step 5: Quick connection test..."
echo ""
echo "  To use Hermes on the Mac Mini:"
echo ""
echo "  1. Open a terminal and start the tunnel:"
echo "     ${TUNNEL_SCRIPT}"
echo ""
echo "  2. In another terminal, verify the connection:"
echo "     hermes status"
echo ""
echo "  3. Start a session:"
echo "     hermes chat"
echo ""
info "Setup complete."
