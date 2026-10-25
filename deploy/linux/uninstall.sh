#!/usr/bin/env bash
# Removes the CCM server.
#
#   sudo ./uninstall.sh            removes the service and the program; keeps config, data and storages
#   sudo ./uninstall.sh --purge    also removes /etc/ccm, /var/lib/ccm and the ccm user
#
# Storage roots are never deleted, not even with --purge.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: sudo ./uninstall.sh [--purge] [--yes]

  --purge     Also delete /etc/ccm (config, TLS key), /var/lib/ccm (database, setup code) and the
              ccm user. Your storage folders are never deleted.
  --yes, -y   Don't ask for confirmation
USAGE
}

say() { printf '%s\n' "ccm-uninstall: $*"; }
warn() { printf '%s\n' "ccm-uninstall: warning: $*" >&2; }
die() {
  printf '%s\n' "ccm-uninstall: error: $*" >&2
  exit 1
}

# Test-only: a folder standing in for / (see server/cli/paths.ts).
SANDBOX="${CCM_SANDBOX_ROOT:-}"
is_sandbox() { [ -n "$SANDBOX" ]; }
system() {
  if is_sandbox; then say "sandbox: skipped $*"; else "$@"; fi
}

PURGE=0
ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    --help | -h) usage; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

if ! is_sandbox; then
  [ "$(id -u)" -eq 0 ] || die "run as root: sudo ./uninstall.sh"
fi

INSTALL_ROOT="$SANDBOX/opt/ccm"
ETC_DIR="$SANDBOX/etc/ccm"
DATA_DIR="$SANDBOX/var/lib/ccm"
SYSTEMD_DIR="$SANDBOX/etc/systemd/system"
NODE="$INSTALL_ROOT/current/node/bin/node"

# The storage roots, read before anything is removed, so --purge can make sure it spares them.
storage_roots=""
if [ -x "$NODE" ] && [ -f "$ETC_DIR/config.json" ]; then
  storage_roots="$("$NODE" -e '
const config = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
for (const root of config.storageRoots ?? []) if (typeof root.path === "string") console.log(root.path);
' "$ETC_DIR/config.json" || true)"
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  [ -t 0 ] || die "no terminal to confirm on; add --yes"
  if [ "$PURGE" -eq 1 ]; then
    printf 'Remove CCM with its config (%s), database (%s) and the ccm user? Storage folders are kept.\nType "purge" to confirm: ' "$ETC_DIR" "$DATA_DIR"
    read -r answer
    [ "$answer" = "purge" ] || die "cancelled"
  else
    printf 'Remove the CCM service and program? Config, database and storages are kept. [y/N] '
    read -r answer
    case "$answer" in y | Y | yes | YES) ;; *) die "cancelled" ;; esac
  fi
fi

system systemctl disable --now ccm || warn "could not stop ccm (it may not be installed)"
rm -f "$SYSTEMD_DIR/ccm.service"
rm -rf "$SYSTEMD_DIR/ccm.service.d"
rm -f "$SANDBOX/etc/polkit-1/rules.d/50-ccm-udisks.rules"
rm -f "$SANDBOX/etc/polkit-1/localauthority/50-local.d/50-ccm-udisks.pkla"
if [ -L "$SANDBOX/usr/local/bin/ccm" ]; then rm -f "$SANDBOX/usr/local/bin/ccm"; fi
rm -rf "$INSTALL_ROOT"
system systemctl daemon-reload
system systemctl reset-failed ccm 2>/dev/null || true
say "removed the service, the polkit rule, /usr/local/bin/ccm and $INSTALL_ROOT"

# True when the folder $1 is, or contains, one of the storage roots.
holds_storage() {
  local folder="$1" root
  while IFS= read -r root; do
    [ -n "$root" ] || continue
    case "$root/" in "$folder"/*) return 0 ;; esac
  done <<<"$storage_roots"
  return 1
}

if [ "$PURGE" -eq 1 ]; then
  for folder in "$ETC_DIR" "$DATA_DIR"; do
    if holds_storage "$folder"; then
      warn "kept $folder: it holds a storage root"
    else
      rm -rf "$folder"
      say "deleted $folder"
    fi
  done
  if is_sandbox; then
    say "sandbox: skipped removing the ccm user"
  elif id ccm >/dev/null 2>&1; then
    userdel ccm || warn "could not remove the user ccm"
    if getent group ccm >/dev/null 2>&1; then groupdel ccm || true; fi
    say "removed the user ccm"
  fi
  if [ -n "$storage_roots" ]; then
    say "storage folders were not touched:"
    printf '%s\n' "$storage_roots" | sed 's/^/  /'
  fi
else
  say "kept $ETC_DIR, $DATA_DIR, the storages and the ccm user (run with --purge to remove config and data)"
fi
