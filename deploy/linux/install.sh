#!/usr/bin/env bash
# Installs or upgrades the CCM server from this unpacked package.
#
#   sudo ./install.sh [--port 7420] [--bind 0.0.0.0] [--storage /path]... [--tls-self-signed] [--no-start] [--yes]
#
# Everything it installs comes from this package: it makes no network calls and never runs apt,
# npm, curl or wget. Running it again is safe; from a newer package it upgrades, keeping the
# previous version for `sudo ccm rollback`.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: sudo ./install.sh [options]

  --port <number>     Port CCM listens on (default 7420, or the port already configured)
  --bind <address>    Address to listen on (default 0.0.0.0: every interface)
  --storage <path>    A folder CCM may use; repeat for more. Created if missing. Without any,
                      a fresh install uses /srv/ccm.
  --tls-self-signed   Create a self-signed certificate and serve HTTPS (sudo ccm gen-cert)
  --no-start          Install and enable the service, but don't start it
  --yes, -y           Don't ask for confirmation
  --help, -h          Show this help
USAGE
}

say() { printf '%s\n' "ccm-install: $*"; }
warn() { printf '%s\n' "ccm-install: warning: $*" >&2; }
die() {
  printf '%s\n' "ccm-install: error: $*" >&2
  exit 1
}

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
[ -f "$PACKAGE_DIR/VERSION" ] || die "VERSION is missing: run install.sh from the unpacked CCM package."
VERSION="$(tr -d '[:space:]' <"$PACKAGE_DIR/VERSION")"
PACKAGE_ARCH="$(tr -d '[:space:]' <"$PACKAGE_DIR/ARCH")"

# Test-only: a folder standing in for / (see server/cli/paths.ts). Nothing system-wide is touched:
# no users, no chown, no systemctl.
SANDBOX="${CCM_SANDBOX_ROOT:-}"
is_sandbox() { [ -n "$SANDBOX" ]; }

PORT=""
BIND=""
STORAGES=()
TLS_SELF_SIGNED=0
NO_START=0
ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:?--port needs a number}"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --bind) BIND="${2:?--bind needs an address}"; shift 2 ;;
    --bind=*) BIND="${1#*=}"; shift ;;
    --storage) STORAGES+=("${2:?--storage needs a path}"); shift 2 ;;
    --storage=*) STORAGES+=("${1#*=}"); shift ;;
    --tls-self-signed) TLS_SELF_SIGNED=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    --help | -h) usage; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done
if [ -n "$PORT" ]; then
  case "$PORT" in *[!0-9]* | "") die "--port must be a number" ;; esac
  [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "--port must be between 1 and 65535"
fi
case "$BIND" in *[[:space:]]*) die "--bind must be one address" ;; esac
STORAGE_COUNT=${#STORAGES[@]}
for storage in ${STORAGES[@]+"${STORAGES[@]}"}; do
  case "$storage" in /*) ;; *) die "--storage needs an absolute path (got $storage)" ;; esac
done

# Runs a command that changes the system, or only reports it in a sandbox.
system() {
  if is_sandbox; then say "sandbox: skipped $*"; else "$@"; fi
}

# make_dir <mode> <owner> <group> <path>
make_dir() {
  mkdir -p "$4"
  chmod "$1" "$4"
  if ! is_sandbox; then chown "$2:$3" "$4"; fi
}

# ---------------------------------------------------------------- 1. pre-flight
machine_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) echo x64 ;;
    aarch64 | arm64) echo arm64 ;;
    *) uname -m ;;
  esac
}
if is_sandbox; then
  say "sandbox install into $SANDBOX (root, systemd, OS and architecture checks skipped)"
else
  [ "$(id -u)" -eq 0 ] || die "run as root: sudo ./install.sh"
  [ -d /run/systemd/system ] || die "systemd is not running on this machine; CCM installs as a systemd service."
  os_family="$(. /etc/os-release 2>/dev/null && echo "${ID:-} ${ID_LIKE:-}")"
  case " $os_family " in
    *" ubuntu "* | *" debian "*) ;;
    *)
      [ "$ASSUME_YES" -eq 1 ] || die "this is not Ubuntu or Debian ($os_family); add --yes to install anyway."
      warn "not Ubuntu or Debian ($os_family); continuing because of --yes"
      ;;
  esac
  [ "$(machine_arch)" = "$PACKAGE_ARCH" ] || die "this package is for $PACKAGE_ARCH, but this machine is $(machine_arch)."
fi
"$PACKAGE_DIR/node/bin/node" --version >/dev/null 2>&1 ||
  die "the bundled Node runtime does not run here (glibc 2.28 or newer is needed; Ubuntu 22.04+ has it)."

if [ "$ASSUME_YES" -ne 1 ]; then
  if [ -t 0 ]; then
    printf 'Install CCM %s (%s) as the systemd service "ccm"? [y/N] ' "$VERSION" "$PACKAGE_ARCH"
    read -r answer
    case "$answer" in y | Y | yes | YES) ;; *) die "cancelled" ;; esac
  else
    die "no terminal to confirm on; add --yes"
  fi
fi

INSTALL_ROOT="$SANDBOX/opt/ccm"
ETC_DIR="$SANDBOX/etc/ccm"
CONFIG="$ETC_DIR/config.json"
DATA_DIR="$SANDBOX/var/lib/ccm"
SYSTEMD_DIR="$SANDBOX/etc/systemd/system"
DEFAULT_STORAGE="$SANDBOX/srv/ccm"

# ---------------------------------------------------------------- 2. service user
if is_sandbox; then
  say "sandbox: skipped creating the ccm user"
else
  if ! id ccm >/dev/null 2>&1; then
    useradd --system --user-group --home-dir /var/lib/ccm --no-create-home --shell /usr/sbin/nologin \
      --comment "CCM server" ccm
    say "created the system user ccm"
  fi
  if getent group plugdev >/dev/null 2>&1; then usermod -a -G plugdev ccm; fi
fi

# ---------------------------------------------------------------- 3. files
make_dir 0755 root root "$INSTALL_ROOT"
current_version="$(readlink "$INSTALL_ROOT/current" 2>/dev/null || true)"
current_version="${current_version##*/}"
staging="$INSTALL_ROOT/.staging-$VERSION-$$"
rm -rf "$staging"
mkdir -p "$staging"
cp -a "$PACKAGE_DIR/." "$staging/"
if ! is_sandbox; then
  chown -R root:root "$staging"
  chmod -R go-w "$staging"
fi
chmod 0755 "$staging"
if [ -e "$INSTALL_ROOT/$VERSION" ]; then
  # Reinstalling a version: swap the folder (a running service keeps its open files).
  mv "$INSTALL_ROOT/$VERSION" "$INSTALL_ROOT/.replaced-$VERSION-$$"
  mv "$staging" "$INSTALL_ROOT/$VERSION"
  rm -rf "$INSTALL_ROOT/.replaced-$VERSION-$$"
else
  mv "$staging" "$INSTALL_ROOT/$VERSION"
fi
if [ -n "$current_version" ] && [ "$current_version" != "$VERSION" ]; then
  ln -sfn "$current_version" "$INSTALL_ROOT/previous"
  say "upgrading from $current_version to $VERSION (roll back with: sudo ccm rollback)"
fi
ln -sfn "$VERSION" "$INSTALL_ROOT/current"
previous_version="$(readlink "$INSTALL_ROOT/previous" 2>/dev/null || true)"
previous_version="${previous_version##*/}"
for version_dir in "$INSTALL_ROOT"/*/; do
  [ -d "$version_dir" ] || continue
  version_name="$(basename "$version_dir")"
  case "$version_name" in current | previous | "$VERSION" | "$previous_version") ;; *) rm -rf "$version_dir" ;; esac
done
mkdir -p "$SANDBOX/usr/local/bin"
ln -sfn "$INSTALL_ROOT/current/bin/ccm" "$SANDBOX/usr/local/bin/ccm"
CCM="$INSTALL_ROOT/current/bin/ccm"
NODE="$INSTALL_ROOT/current/node/bin/node"
say "installed CCM $VERSION in $INSTALL_ROOT/$VERSION"

# ---------------------------------------------------------------- 4. directories and config
make_dir 0750 root ccm "$ETC_DIR"
fresh_config=0
if [ ! -f "$CONFIG" ]; then
  cp "$INSTALL_ROOT/current/deploy/config.example.json" "$CONFIG"
  fresh_config=1
fi
chmod 0640 "$CONFIG"
if ! is_sandbox; then chown root:ccm "$CONFIG"; fi
make_dir 0750 ccm ccm "$DATA_DIR"

# Applies --port and --bind; on a fresh config, --storage replaces the example's /srv/ccm.
clear_roots=0
if [ "$fresh_config" -eq 1 ] && [ "$STORAGE_COUNT" -gt 0 ]; then clear_roots=1; fi
"$NODE" -e '
const fs = require("node:fs");
const [configFile, port, bindHost, clearRoots, isFresh, defaultStorage] = process.argv.slice(1);
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
if (port) config.port = Number(port);
if (bindHost) config.bindHost = bindHost;
if (clearRoots === "1") config.storageRoots = [];
else if (isFresh === "1" && Array.isArray(config.storageRoots))
  config.storageRoots = config.storageRoots.map((root) => (root.path === "/srv/ccm" ? { ...root, path: defaultStorage } : root));
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
' "$CONFIG" "$PORT" "$BIND" "$clear_roots" "$fresh_config" "$DEFAULT_STORAGE"
if [ "$fresh_config" -eq 1 ]; then say "wrote $CONFIG"; else say "kept the existing $CONFIG"; fi
if [ "$fresh_config" -eq 1 ] && [ "$STORAGE_COUNT" -eq 0 ]; then make_dir 0750 ccm ccm "$DEFAULT_STORAGE"; fi

# ---------------------------------------------------------------- 5. storage access
for storage in ${STORAGES[@]+"${STORAGES[@]}"}; do
  if [ ! -e "$storage" ]; then
    make_dir 0750 ccm ccm "$storage"
    say "created $storage"
  fi
  "$CCM" add-storage "$storage" --no-restart
done

# ---------------------------------------------------------------- 6. unit and drop-in
mkdir -p "$SYSTEMD_DIR"
cp "$INSTALL_ROOT/current/deploy/ccm.service" "$SYSTEMD_DIR/ccm.service"
chmod 0644 "$SYSTEMD_DIR/ccm.service"
"$CCM" write-dropin --no-restart >/dev/null
say "installed $SYSTEMD_DIR/ccm.service and its storage drop-in"

# ---------------------------------------------------------------- 7. USB mounting
usb_note=""
if command -v udisksctl >/dev/null 2>&1; then
  mkdir -p "$SANDBOX/etc/polkit-1/rules.d"
  cp "$INSTALL_ROOT/current/deploy/50-ccm-udisks.rules" "$SANDBOX/etc/polkit-1/rules.d/50-ccm-udisks.rules"
  chmod 0644 "$SANDBOX/etc/polkit-1/rules.d/50-ccm-udisks.rules"
  if [ -d "$SANDBOX/etc/polkit-1/localauthority" ]; then
    mkdir -p "$SANDBOX/etc/polkit-1/localauthority/50-local.d"
    cp "$INSTALL_ROOT/current/deploy/50-ccm-udisks.pkla" "$SANDBOX/etc/polkit-1/localauthority/50-local.d/50-ccm-udisks.pkla"
    chmod 0644 "$SANDBOX/etc/polkit-1/localauthority/50-local.d/50-ccm-udisks.pkla"
  fi
  say "installed the udisks2 polkit rule (CCM can mount and eject USB drives)"
else
  usb_note="USB auto-mount unavailable; mount drives under /media or /mnt manually; see guide §USB"
  say "$usb_note"
fi

# ---------------------------------------------------------------- 8. TLS
if [ "$TLS_SELF_SIGNED" -eq 1 ]; then "$CCM" gen-cert --no-restart; fi

# ---------------------------------------------------------------- 9. setup code
setup_code="$("$CCM" setup-code --plain)"

# ---------------------------------------------------------------- 10. start
system systemctl daemon-reload
system systemctl enable ccm
started=0
if [ "$NO_START" -eq 0 ]; then
  if is_sandbox; then
    say "sandbox: skipped starting ccm"
  else
    if systemctl is-active --quiet ccm; then systemctl restart ccm; else systemctl start ccm; fi
    if "$CCM" status --wait 60 >/dev/null 2>&1; then
      started=1
    else
      warn "CCM did not answer its health check within 60 seconds; see: sudo ccm logs"
    fi
  fi
fi

# ---------------------------------------------------------------- 11. summary
port="$("$NODE" -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).port ?? 7420)' "$CONFIG")"
urls="$("$CCM" status 2>/dev/null | sed -n 's/^Open: *//p' || true)"
lines=()
if [ "$started" -eq 1 ]; then
  lines+=("CCM $VERSION is installed and running.")
elif [ "$NO_START" -eq 1 ] || is_sandbox; then
  lines+=("CCM $VERSION is installed (not started: sudo systemctl start ccm).")
else
  lines+=("CCM $VERSION is installed, but it is not answering yet (sudo ccm logs).")
fi
lines+=("" "Open CCM in a browser:")
for url in $urls; do lines+=("  $url"); done
if [ -n "$setup_code" ]; then
  lines+=("" "Setup code (the first page asks for it):" "  $setup_code")
fi
lines+=("" "Firewall: if ufw is active, allow the port:" "  sudo ufw allow $port/tcp")
lines+=("" "Next steps:"
  "  sudo ccm status               check the service"
  "  sudo ccm add-storage <path>   let CCM use another folder"
  "  sudo ccm gen-cert             serve HTTPS with a self-signed certificate"
  "  sudo ccm logs                 follow the log")
width=0
for line in "${lines[@]}"; do [ ${#line} -gt "$width" ] && width=${#line}; done
border="+$(printf '%*s' $((width + 2)) '' | tr ' ' '-')+"
printf '\n%s\n' "$border"
for line in "${lines[@]}"; do printf '| %-*s |\n' "$width" "$line"; done
printf '%s\n\n' "$border"
if [ -n "$usb_note" ]; then printf '%s\n\n' "$usb_note"; fi
