#!/usr/bin/env bash
# CMM server setup for Ubuntu, in one file: CMM behind nginx, served on your tailnet with a real HTTPS certificate
# from Tailscale, plus Claude Code for the terminals.
#
#   CMM    127.0.0.1:7420 (--port), plain HTTP, only reachable through nginx (trustedProxies ["127.0.0.1"])
#   nginx  :443 (--https-port; :80 redirects when it is 443) for https://<machine>.<tailnet>.ts.net,
#          tailnet and loopback only
#
# Fast way: copy this script and a CMM server package (cmm-server-<version>-linux-<arch>.tar.gz, plus its .sha256)
# to the new server and run:
#
#   sudo ./cmm-server-setup.sh --package ./cmm-server-1.1.4-linux-x64.tar.gz
#
# Without --package it clones CMM and builds the package here first (needs internet, about 10 minutes):
#
#   sudo ./cmm-server-setup.sh --ref v1.1.4
#
# Options:
#   --package <file>     install this server package instead of building one
#   --repo <url>         repository to build from (default: the GitHub repository)
#   --ref <branch|tag>   branch or tag to build (default: main)
#   --storage <path>     a folder CMM may use; repeat for more (default on a fresh install: /srv/cmm)
#   --no-libreoffice     skip LibreOffice (previews of .pptx, .doc, .xls, .odt, .rtf; several hundred MB)
#   --no-claude          don't install Claude Code for the cmm user
#   --https-port <n>     the port nginx serves CMM on (default 443). Any other port leaves 80 and 443 alone,
#                        for example for another site on the same server, and the address becomes host:<n>
#   --port <n>           CMM's own port on 127.0.0.1 (default 7420, or the one already in /etc/cmm/config.json)
#   --yes, -y            don't ask before starting
#
# Safe to run again: it upgrades or repairs CMM and rewrites the nginx site it wrote (a site you edited is kept).
# Your config, users and files are kept.
set -euo pipefail

REPO_URL="https://github.com/JoshWAMiasco/context-memory-manager.git"
REF="main"
PACKAGE=""
STORAGES=()
WITH_LIBREOFFICE=1
WITH_CLAUDE=1
ASSUME_YES=0
HTTPS_PORT=443
CMM_PORT=""

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\ncmm-setup: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --package) PACKAGE="${2:?--package needs a file}"; shift 2 ;;
    --repo) REPO_URL="${2:?--repo needs a url}"; shift 2 ;;
    --ref) REF="${2:?--ref needs a branch or tag}"; shift 2 ;;
    --storage) STORAGES+=("${2:?--storage needs a path}"); shift 2 ;;
    --no-libreoffice) WITH_LIBREOFFICE=0; shift ;;
    --no-claude) WITH_CLAUDE=0; shift ;;
    --https-port) HTTPS_PORT="${2:?--https-port needs a number}"; shift 2 ;;
    --port) CMM_PORT="${2:?--port needs a number}"; shift 2 ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    --help | -h) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

is_port() { case "$1" in "" | *[!0-9]*) return 1 ;; esac; [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
is_port "$HTTPS_PORT" || die "--https-port must be a port number (1-65535), not $HTTPS_PORT"
[ -z "$CMM_PORT" ] || is_port "$CMM_PORT" || die "--port must be a port number (1-65535), not $CMM_PORT"
[ -z "$CMM_PORT" ] || [ "$CMM_PORT" != "$HTTPS_PORT" ] || die "--port and --https-port can't be the same port"

# ---------------------------------------------------------------------------------------------------------------
# 0. Checks
[ "$(id -u)" = 0 ] || die "run with sudo"
[ -d /run/systemd/system ] || die "systemd isn't running; CMM installs as a systemd service"
. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in *" ubuntu "* | *" debian "*) ;; *) die "this script is for Ubuntu (found ${PRETTY_NAME:-unknown})" ;; esac
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) die "unsupported architecture $(uname -m)" ;; esac
if [ -n "$PACKAGE" ]; then
  PACKAGE="$(readlink -f "$PACKAGE")"
  [ -f "$PACKAGE" ] || die "no package at $PACKAGE"
  case "$(basename "$PACKAGE")" in *"-linux-$ARCH.tar.gz") ;; *) die "$(basename "$PACKAGE") isn't a linux-$ARCH package" ;; esac
fi
for storage in "${STORAGES[@]}"; do case "$storage" in /*) ;; *) die "--storage needs an absolute path ($storage)" ;; esac; done
# The account that ran sudo builds CMM (never root) and is told where things are.
BUILD_USER="${SUDO_USER:-root}"

echo "CMM server setup on $(hostname) (${PRETTY_NAME}, $ARCH)"
echo "  package:      ${PACKAGE:-build from $REPO_URL @ $REF}"
echo "  storages:     ${STORAGES[*]:-(default /srv/cmm on a fresh install)}"
echo "  ports:        nginx $HTTPS_PORT$([ "$HTTPS_PORT" = 443 ] && echo " (and 80)"), CMM ${CMM_PORT:-7420 or the configured one}"
echo "  LibreOffice:  $([ $WITH_LIBREOFFICE = 1 ] && echo yes || echo no)    Claude Code for cmm: $([ $WITH_CLAUDE = 1 ] && echo yes || echo no)"
if [ $ASSUME_YES = 0 ]; then
  read -r -p "Continue? [y/N] " answer
  case "$answer" in y | Y | yes | YES) ;; *) die "cancelled" ;; esac
fi

WORK_DIR="$(mktemp -d /tmp/cmm-setup.XXXXXX)"
chmod 0755 "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

# ---------------------------------------------------------------------------------------------------------------
# 1. System packages (if the mirror refuses a file, retry once from archive.ubuntu.com)
say "Installing system packages"
PKGS=(curl ca-certificates git acl nginx python3 xz-utils)
[ -z "$PACKAGE" ] && PKGS+=(build-essential)
[ $WITH_LIBREOFFICE = 1 ] && PKGS+=(libreoffice-nogui)
export DEBIAN_FRONTEND=noninteractive
apt-get update
if ! apt-get install -y "${PKGS[@]}"; then
  SOURCES=/etc/apt/sources.list.d/ubuntu.sources
  [ -f "$SOURCES" ] || die "apt-get install failed"
  echo "mirror failed; retrying from archive.ubuntu.com"
  cp "$SOURCES" "$WORK_DIR/ubuntu.sources"
  sed -i -E 's#http://[a-z]{2}\.archive\.ubuntu\.com/ubuntu/?#http://archive.ubuntu.com/ubuntu/#' "$SOURCES"
  apt-get update
  install_status=0; apt-get install -y "${PKGS[@]}" || install_status=$?
  cp "$WORK_DIR/ubuntu.sources" "$SOURCES"; apt-get update -qq || true
  [ $install_status = 0 ] || die "apt-get install failed"
fi

# ---------------------------------------------------------------------------------------------------------------
# 2. Tailscale: installed, signed in, and HTTPS certificates enabled for the tailnet
say "Checking Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! tailscale status >/dev/null 2>&1; then
  echo "Sign this machine in to your tailnet: open the link tailscale prints below."
  tailscale up
fi
TS_JSON="$(tailscale status --json)"
HOST="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' <<<"$TS_JSON")"
CERT_OK="$(python3 -c 'import json,sys; print("yes" if json.load(sys.stdin).get("CertDomains") else "no")' <<<"$TS_JSON")"
[ -n "$HOST" ] || die "Tailscale has no DNS name for this machine; turn on MagicDNS in the Tailscale admin console (DNS)"
[ "$CERT_OK" = yes ] || die "turn on HTTPS Certificates in the Tailscale admin console (DNS page), then run this again"
echo "This machine is $HOST"

# ---------------------------------------------------------------------------------------------------------------
# 3. The CMM server package: given, or built here as $BUILD_USER
if [ -z "$PACKAGE" ]; then
  say "Building CMM from $REPO_URL ($REF) as $BUILD_USER"
  BUILD_DIR="$WORK_DIR/build"
  install -d -o "$BUILD_USER" "$BUILD_DIR"
  sudo -u "$BUILD_USER" -H env BUILD_DIR="$BUILD_DIR" REPO_URL="$REPO_URL" REF="$REF" ARCH="$ARCH" bash -euo pipefail -c '
    cd "$BUILD_DIR"
    # Node 22 for building (the package brings its own runtime for running).
    node_arch=$([ "$ARCH" = arm64 ] && echo arm64 || echo x64)
    version=$(curl -fsSL https://nodejs.org/dist/index.json | python3 -c "import json,sys; print(next(r[\"version\"] for r in json.load(sys.stdin) if r[\"version\"].startswith(\"v22.\")))")
    tarball="node-$version-linux-$node_arch.tar.xz"
    curl -fsSLO "https://nodejs.org/dist/$version/$tarball"
    curl -fsSL "https://nodejs.org/dist/$version/SHASUMS256.txt" | grep " $tarball\$" | sha256sum -c -
    tar xf "$tarball"; export PATH="$BUILD_DIR/node-$version-linux-$node_arch/bin:$PATH"
    git clone --depth 1 --branch "$REF" "$REPO_URL" cmm
    cd cmm
    npm ci
    # The runtime the package ships, pinned in scripts/package-server.ts and checked against vendor/node/SHASUMS256.txt.
    pinned=$(grep -oE "NODE_VERSION = \"[^\"]+\"" scripts/package-server.ts | cut -d\" -f2)
    curl -fsSLo "vendor/node/node-v$pinned-linux-$ARCH.tar.xz" "https://nodejs.org/dist/v$pinned/node-v$pinned-linux-$ARCH.tar.xz"
    npm run build:web
    npx tsx scripts/package-server.ts --arch "$ARCH" --skip-build
  '
  PACKAGE="$(ls "$BUILD_DIR"/cmm/dist/cmm-server-*-linux-"$ARCH".tar.gz | head -1)"
  [ -f "$PACKAGE" ] || die "the build made no package"
fi

say "Checking and unpacking $(basename "$PACKAGE")"
if [ -f "$PACKAGE.sha256" ]; then
  (cd "$(dirname "$PACKAGE")" && sha256sum -c "$(basename "$PACKAGE").sha256")
else
  echo "no $(basename "$PACKAGE").sha256 next to it; skipping the checksum"
fi
tar -xzf "$PACKAGE" -C "$WORK_DIR"
PKG_DIR="$(find "$WORK_DIR" -maxdepth 1 -type d -name 'cmm-server-*' | head -1)"
[ -x "$PKG_DIR/install.sh" ] || die "the package has no install.sh"

# ---------------------------------------------------------------------------------------------------------------
# 4. Install CMM on 127.0.0.1 and make it trust nginx
say "Installing CMM"
INSTALL_ARGS=(--bind 127.0.0.1 --yes)
if [ -n "$CMM_PORT" ]; then INSTALL_ARGS+=(--port "$CMM_PORT"); fi
for storage in "${STORAGES[@]}"; do INSTALL_ARGS+=(--storage "$storage"); done
(cd "$PKG_DIR" && ./install.sh "${INSTALL_ARGS[@]}")
# nginx does HTTPS, so CMM speaks plain HTTP behind it. Don't run `cmm gen-cert` on this server.
/opt/cmm/current/node/bin/node -e '
const fs = require("fs"); const f = "/etc/cmm/config.json";
const c = JSON.parse(fs.readFileSync(f, "utf8"));
c.bindHost = "127.0.0.1"; c.trustedProxies = ["127.0.0.1"]; c.tls = null;
fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");'
systemctl restart cmm
# The port CMM really uses (an existing install keeps its own unless --port was given): nginx must match it.
CMM_PORT="$(/opt/cmm/current/node/bin/node -e 'console.log(JSON.parse(require("fs").readFileSync("/etc/cmm/config.json", "utf8")).port || 7420)')"
URL="https://$HOST$([ "$HTTPS_PORT" = 443 ] || echo ":$HTTPS_PORT")"

# ---------------------------------------------------------------------------------------------------------------
# 5. Tailscale certificate for nginx, renewed weekly
say "Getting the HTTPS certificate for $HOST"
CERT_DIR=/etc/nginx/tailscale
install -d -m 0750 -o root -g www-data "$CERT_DIR"
cat >/usr/local/sbin/cmm-renew-tailscale-cert <<EOF
#!/bin/sh
# Renews the Tailscale certificate nginx uses for CMM (tailscale only fetches a new one near expiry).
set -e
tailscale cert --cert-file $CERT_DIR/$HOST.crt --key-file $CERT_DIR/$HOST.key $HOST
chgrp www-data $CERT_DIR/$HOST.crt $CERT_DIR/$HOST.key
chmod 0640 $CERT_DIR/$HOST.key
systemctl reload nginx 2>/dev/null || true
EOF
chmod 0755 /usr/local/sbin/cmm-renew-tailscale-cert
printf '#!/bin/sh\nexec /usr/local/sbin/cmm-renew-tailscale-cert\n' >/etc/cron.weekly/cmm-tailscale-cert
chmod 0755 /etc/cron.weekly/cmm-tailscale-cert
/usr/local/sbin/cmm-renew-tailscale-cert

# ---------------------------------------------------------------------------------------------------------------
# 6. nginx site
say "Configuring nginx"
ACCESS="allow 100.64.0.0/10; allow fd7a:115c:a1e0::/48; allow 127.0.0.1; allow ::1; deny all;"
# http2 is its own directive from nginx 1.25.1; older nginx (Ubuntu 24.04 has 1.24) takes it on the listen line.
NGINX_VERSION="$(nginx -v 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
if [ "$(printf '%s\n1.25.1\n' "$NGINX_VERSION" | sort -V | head -1)" = 1.25.1 ]; then
  LISTEN_SSL="listen $HTTPS_PORT ssl;
    listen [::]:$HTTPS_PORT ssl;
    http2 on;"
else
  LISTEN_SSL="listen $HTTPS_PORT ssl http2;
    listen [::]:$HTTPS_PORT ssl http2;"
fi
# On 443, port 80 redirects to it. On any other port, 80 belongs to someone else.
REDIRECT_80=""
if [ "$HTTPS_PORT" = 443 ]; then
  REDIRECT_80="server {
    listen 80;
    listen [::]:80;
    server_name $HOST;
    $ACCESS
    return 301 https://$HOST\$request_uri;
}
"
fi
rm -f /etc/nginx/sites-enabled/default
SITE=/etc/nginx/sites-available/cmm
if [ -f "$SITE" ] && ! grep -q 'written by cmm-server-setup.sh' "$SITE"; then
  # Someone wrote or edited this site by hand (another listen address, more sites beside it): keep it.
  echo "keeping your own $SITE (delete it and run this again to get the default one)"
else
cat >"$SITE" <<EOF
# CMM behind nginx on the tailnet (written by cmm-server-setup.sh). CMM listens on 127.0.0.1:$CMM_PORT
# with trustedProxies ["127.0.0.1"].
map \$http_upgrade \$cmm_connection_upgrade {
    default upgrade;
    ''      close;
}

${REDIRECT_80}
server {
    $LISTEN_SSL
    server_name $HOST;

    ssl_certificate     $CERT_DIR/$HOST.crt;
    ssl_certificate_key $CERT_DIR/$HOST.key;

    # Tailnet and the machine itself only.
    $ACCESS

    # Uploads of any size; CMM enforces its own limits.
    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:$CMM_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        # Overwrite, don't append: CMM must see the real client, not whatever the browser sent.
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Terminal WebSockets.
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$cmm_connection_upgrade;
        # Large uploads/downloads and Server-Sent Events stream through without buffering.
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
EOF
fi
ln -sfn /etc/nginx/sites-available/cmm /etc/nginx/sites-enabled/cmm
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow in on tailscale0 to any port "$HTTPS_PORT" proto tcp
  if [ "$HTTPS_PORT" = 443 ]; then ufw allow in on tailscale0 to any port 80 proto tcp; fi
fi

# ---------------------------------------------------------------------------------------------------------------
# 7. Claude Code for the cmm user (terminals run as cmm)
if [ $WITH_CLAUDE = 1 ]; then
  say "Installing Claude Code for the cmm user"
  sudo -u cmm -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
  # CMM puts ~/.local/bin on the terminal PATH itself; this .profile covers versions before that fix.
  if [ ! -f /var/lib/cmm/.profile ]; then
    printf '# Claude Code and other per-user tools.\n[ -d "$HOME/.local/bin" ] && PATH="$HOME/.local/bin:$PATH"\n' >/var/lib/cmm/.profile
    chown cmm:cmm /var/lib/cmm/.profile
  fi
fi

# ---------------------------------------------------------------------------------------------------------------
# 8. Done
say "Checking"
cmm status --wait 30 >/dev/null || true
HEALTH="$(curl -sS --max-time 10 "$URL/api/health" || true)"
case "$HEALTH" in
  *'"ok":true'*) echo "CMM answers through nginx: $HEALTH" ;;
  *) echo "WARNING: CMM doesn't answer through nginx (got: ${HEALTH:0:120}). Check: sudo cmm logs" ;;
esac
SETUP_CODE="$(cmm setup-code --plain 2>/dev/null || true)"
cat <<EOF

+------------------------------------------------------------------------------
| CMM is installed behind nginx on your tailnet.
|
| Open from any device on the tailnet:   $URL
| Setup code (first page asks for it):   ${SETUP_CODE:-none, setup is already done}
|
| Terminals: turn them on in Settings > Security > Terminals.$([ $WITH_CLAUDE = 1 ] && printf '\n|   Then run "claude" in one and sign in once.')
|
| Useful:  sudo cmm status | sudo cmm logs | sudo cmm add-storage <path> | sudo cmm rollback
| Don't run "sudo cmm gen-cert" here: nginx does HTTPS, and CMM must stay on plain HTTP behind it.
+------------------------------------------------------------------------------
EOF
