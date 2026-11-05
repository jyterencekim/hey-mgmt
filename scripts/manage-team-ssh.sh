#!/usr/bin/env bash
# manage-team-ssh.sh
#
# Run this on the Mac Mini to manage team SSH access.
#
# Usage:
#   bash scripts/manage-team-ssh.sh add <member> <public-key>
#   bash scripts/manage-team-ssh.sh list
#   bash scripts/manage-team-ssh.sh remove <member>

set -euo pipefail

AUTHORIZED_KEYS="${HOME}/.ssh/authorized_keys"
mkdir -p "${HOME}/.ssh"
touch "${AUTHORIZED_KEYS}"
chmod 700 "${HOME}/.ssh"
chmod 600 "${AUTHORIZED_KEYS}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

VALID_MEMBERS=("alice" "bob")

validate_member() {
  local member="$1"
  for valid in "${VALID_MEMBERS[@]}"; do
    if [ "${member}" = "${valid}" ]; then
      return 0
    fi
  done
  error "Unknown member: ${member}. Valid members: ${VALID_MEMBERS[*]}"
  exit 1
}

cmd_add() {
  local member="${1:-}"
  local pubkey="${2:-}"

  if [ -z "${member}" ] || [ -z "${pubkey}" ]; then
    error "Usage: $0 add <member> \"<public-key>\""
    exit 1
  fi

  validate_member "${member}"

  # Remove existing key for this member (if any)
  if grep -q "# hey-mgmt-team:${member}" "${AUTHORIZED_KEYS}" 2>/dev/null; then
    warn "Replacing existing key for ${member}"
    grep -v "# hey-mgmt-team:${member}" "${AUTHORIZED_KEYS}" > "${AUTHORIZED_KEYS}.tmp"
    mv "${AUTHORIZED_KEYS}.tmp" "${AUTHORIZED_KEYS}"
  fi

  # Add the key with a comment tag
  echo "${pubkey} # hey-mgmt-team:${member}" >> "${AUTHORIZED_KEYS}"
  info "Added SSH key for ${member}"
}

cmd_list() {
  echo ""
  echo "Authorized team members:"
  echo "========================"
  for member in "${VALID_MEMBERS[@]}"; do
    if grep -q "# hey-mgmt-team:${member}" "${AUTHORIZED_KEYS}" 2>/dev/null; then
      local keytype
      keytype=$(grep "# hey-mgmt-team:${member}" "${AUTHORIZED_KEYS}" | awk '{print $1}')
      echo -e "  ${GREEN}[OK]${NC} ${member} (${keytype})"
    else
      echo -e "  ${RED}[--]${NC} ${member} (no key)"
    fi
  done
  echo ""
}

cmd_remove() {
  local member="${1:-}"

  if [ -z "${member}" ]; then
    error "Usage: $0 remove <member>"
    exit 1
  fi

  validate_member "${member}"

  if grep -q "# hey-mgmt-team:${member}" "${AUTHORIZED_KEYS}" 2>/dev/null; then
    grep -v "# hey-mgmt-team:${member}" "${AUTHORIZED_KEYS}" > "${AUTHORIZED_KEYS}.tmp"
    mv "${AUTHORIZED_KEYS}.tmp" "${AUTHORIZED_KEYS}"
    info "Removed SSH key for ${member}"
  else
    warn "No key found for ${member}"
  fi
}

case "${1:-}" in
  add)    cmd_add "${2:-}" "${3:-}" ;;
  list)   cmd_list ;;
  remove) cmd_remove "${2:-}" ;;
  *)
    echo "Usage: $0 {add|list|remove}"
    echo ""
    echo "  add <member> \"<public-key>\"  — Add a team member's SSH public key"
    echo "  list                          — Show which members have keys"
    echo "  remove <member>               — Remove a team member's key"
    echo ""
    echo "Valid members: ${VALID_MEMBERS[*]}"
    ;;
esac
