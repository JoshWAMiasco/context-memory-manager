#!/usr/bin/env bash
# Updates the cmm-installer folder (what gets copied to a new server) to the version in package.json:
#
#   cmm-server-<version>-linux-<arch>.tar.gz  + .sha256   from dist/ (built by `npm run package:server`)
#   cmm-server-setup.sh                                    from deploy/linux/
#
# Older cmm-server-*-linux-<arch>.tar.gz packages in the folder are removed, unless --keep-old.
#
#   scripts/update-installer.sh [--build] [--arch x64|arm64] [--dir <folder>] [--keep-old]
#
#   --build      build the server package first (npx tsx scripts/package-server.ts --arch <arch>)
#   --arch       target architecture (default: x64)
#   --dir        the installer folder (default: $CMM_INSTALLER_DIR, else ~/cmm-installer)
#   --keep-old   leave older packages in the folder
set -euo pipefail

die() { echo "update-installer: $*" >&2; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH=x64
INSTALLER_DIR="${CMM_INSTALLER_DIR:-$HOME/cmm-installer}"
BUILD=0
KEEP_OLD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD=1 ;;
    --arch) ARCH="${2:?--arch needs a value}"; shift ;;
    --dir) INSTALLER_DIR="${2:?--dir needs a value}"; shift ;;
    --keep-old) KEEP_OLD=1 ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
  shift
done
case "$ARCH" in x64|arm64) ;; *) die "--arch must be x64 or arm64" ;; esac

VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version")"
PACKAGE_NAME="cmm-server-$VERSION-linux-$ARCH.tar.gz"
PACKAGE="$PROJECT_ROOT/dist/$PACKAGE_NAME"
SETUP_SCRIPT="$PROJECT_ROOT/deploy/linux/cmm-server-setup.sh"

if [ "$BUILD" = 1 ]; then
  (cd "$PROJECT_ROOT" && npx tsx scripts/package-server.ts --arch "$ARCH")
fi

[ -f "$PACKAGE" ] || die "dist/$PACKAGE_NAME is missing; run with --build, or: npx tsx scripts/package-server.ts --arch $ARCH"
[ -f "$PACKAGE.sha256" ] || die "dist/$PACKAGE_NAME.sha256 is missing"
(cd "$(dirname "$PACKAGE")" && sha256sum --quiet -c "$PACKAGE_NAME.sha256") || die "dist/$PACKAGE_NAME doesn't match its .sha256"

mkdir -p "$INSTALLER_DIR"
cp "$PACKAGE" "$PACKAGE.sha256" "$INSTALLER_DIR/"
install -m 755 "$SETUP_SCRIPT" "$INSTALLER_DIR/cmm-server-setup.sh"
(cd "$INSTALLER_DIR" && sha256sum --quiet -c "$PACKAGE_NAME.sha256") || die "the copy in $INSTALLER_DIR doesn't match its .sha256"

if [ "$KEEP_OLD" = 0 ]; then
  for old in "$INSTALLER_DIR"/cmm-server-*-linux-"$ARCH".tar.gz; do
    [ "$(basename "$old")" = "$PACKAGE_NAME" ] && continue
    [ -e "$old" ] || continue
    echo "removing $(basename "$old")"
    rm -f "$old" "$old.sha256"
  done
fi

echo "$INSTALLER_DIR now has CMM $VERSION ($ARCH):"
ls -l "$INSTALLER_DIR"
