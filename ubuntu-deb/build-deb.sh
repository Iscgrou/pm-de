#!/usr/bin/env bash
set -euo pipefail

# Build script for Ubuntu .deb package: xauusd-aurum-deck
# Usage on Ubuntu:
#   chmod +x build-deb.sh
#   ./build-deb.sh
#   sudo dpkg -i dist/xauusd-aurum-deck_2.0.0_amd64.deb
#   sudo apt-get install -f

PKG_NAME="xauusd-aurum-deck"
PKG_VERSION="2.0.0"
PKG_ARCH="amd64"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE_DIR="${ROOT_DIR}/${PKG_NAME}"
OUT_DIR="${ROOT_DIR}/dist"
DEB_FILE="${OUT_DIR}/${PKG_NAME}_${PKG_VERSION}_${PKG_ARCH}.deb"

echo "[0/4] Running Python syntax pre-flight check..."
if command -v python3 >/dev/null 2>&1; then
  find "${STAGE_DIR}/opt/xauusd-agy-advisor" -name '*.py' -print0 | xargs -0 python3 -m py_compile
  find "${STAGE_DIR}/opt/xauusd-agy-advisor" -type d -name '__pycache__' -exec rm -rf {} +
fi

echo "[1/4] Setting Debian maintainer script permissions..."
chmod 0755 "${STAGE_DIR}/DEBIAN/postinst"
chmod 0755 "${STAGE_DIR}/DEBIAN/prerm"
chmod 0755 "${STAGE_DIR}/DEBIAN/postrm"
chmod 0755 "${STAGE_DIR}/usr/bin/xauusd-aurum-deck"

echo "[2/4] Computing Installed-Size metadata..."
INSTALLED_KB=$(du -sk "${STAGE_DIR}/opt" "${STAGE_DIR}/usr" "${STAGE_DIR}/etc" | awk '{s+=$1} END {print s}')
if grep -q '^Installed-Size:' "${STAGE_DIR}/DEBIAN/control"; then
  sed -i "s/^Installed-Size:.*/Installed-Size: ${INSTALLED_KB}/" "${STAGE_DIR}/DEBIAN/control"
else
  echo "Installed-Size: ${INSTALLED_KB}" >> "${STAGE_DIR}/DEBIAN/control"
fi

echo "[3/4] Creating output directory ${OUT_DIR}..."
mkdir -p "${OUT_DIR}"

echo "[4/4] Building Debian package via dpkg-deb..."
dpkg-deb --root-owner-group --build "${STAGE_DIR}" "${DEB_FILE}"

echo ""
echo "Success: ${DEB_FILE}"
echo "Install with:"
echo "  sudo dpkg -i ${DEB_FILE} && sudo apt-get install -f"
echo "Verify service:"
echo "  systemctl status xauusd-sentinel.service"
echo "  curl -s http://127.0.0.1:8787/api/v1/health | jq ."
