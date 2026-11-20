#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Ubuntu 24.04 LTS (Noble Numbat) Unified .deb Builder — xauusd-aurum-deck
# Packages the unified TypeScript/Node.js + React production bundle (`npm run build`),
# systemd unit (`xauusd-aurum-deck.service`), Desktop launcher (`.desktop`),
# and the `xauusd-ai-oauth-bridge` helper for local `agy` / `CLIProxyAPI` OAuth.
#
# Usage on Ubuntu 24.04 LTS:
#   chmod +x ubuntu-deb/build-deb.sh
#   ./ubuntu-deb/build-deb.sh
#   sudo dpkg -i ubuntu-deb/dist/xauusd-aurum-deck_3.0.0_amd64.deb
#   sudo apt-get install -f
# =============================================================================

PKG_NAME="xauusd-aurum-deck"
PKG_VERSION="3.0.0"
PKG_ARCH="amd64"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
STAGE_DIR="${SCRIPT_DIR}/${PKG_NAME}"
APP_STAGE="${STAGE_DIR}/opt/${PKG_NAME}"
OUT_DIR="${SCRIPT_DIR}/dist"
DEB_FILE="${OUT_DIR}/${PKG_NAME}_${PKG_VERSION}_${PKG_ARCH}.deb"

echo "[1/6] Building unified TypeScript/Node.js + React production bundle..."
if [ -f "${REPO_ROOT}/package.json" ]; then
  (
    cd "${REPO_ROOT}"
    if [ ! -d "${REPO_ROOT}/node_modules" ]; then
      echo "      Installing Node.js dependencies via npm ci..."
      npm ci --no-audit --no-fund
    fi
    echo "      Running TypeScript typecheck & Vite production build..."
    npx tsc --noEmit
    npm run build
  )
else
  echo "      [WARN] package.json not found at ${REPO_ROOT}; assuming pre-staged dist/ inside ${APP_STAGE}."
fi

echo "[2/6] Staging unified production artifacts into ${APP_STAGE}..."
mkdir -p "${APP_STAGE}"
if [ -d "${REPO_ROOT}/dist" ]; then
  rm -rf "${APP_STAGE}/dist" "${APP_STAGE}/server" "${APP_STAGE}/src" "${APP_STAGE}/db"
  cp -r "${REPO_ROOT}/dist" "${APP_STAGE}/dist"
  cp "${REPO_ROOT}/server.ts" "${APP_STAGE}/server.ts"
  cp "${REPO_ROOT}/package.json" "${APP_STAGE}/package.json"
  [ -f "${REPO_ROOT}/package-lock.json" ] && cp "${REPO_ROOT}/package-lock.json" "${APP_STAGE}/package-lock.json"
  [ -f "${REPO_ROOT}/tsconfig.json" ] && cp "${REPO_ROOT}/tsconfig.json" "${APP_STAGE}/tsconfig.json"
  [ -f "${REPO_ROOT}/.env.example" ] && cp "${REPO_ROOT}/.env.example" "${APP_STAGE}/.env.example"
  mkdir -p "${APP_STAGE}/server" "${APP_STAGE}/src/engine"
  cp -r "${REPO_ROOT}/server/"* "${APP_STAGE}/server/"
  cp -r "${REPO_ROOT}/src/engine/"* "${APP_STAGE}/src/engine/"
  if [ -d "${REPO_ROOT}/db/timescaledb" ]; then
    mkdir -p "${APP_STAGE}/db/timescaledb"
    cp -r "${REPO_ROOT}/db/timescaledb/"* "${APP_STAGE}/db/timescaledb/"
  fi
fi

echo "[3/6] Verifying helper scripts & MCP bridge syntax..."
bash -n "${STAGE_DIR}/DEBIAN/postinst"
bash -n "${STAGE_DIR}/DEBIAN/prerm"
bash -n "${STAGE_DIR}/DEBIAN/postrm"
bash -n "${STAGE_DIR}/usr/bin/xauusd-aurum-deck"
bash -n "${STAGE_DIR}/usr/bin/xauusd-ai-oauth-bridge"
if command -v python3 >/dev/null 2>&1 && [ -f "${STAGE_DIR}/opt/xauusd-agy-advisor/mcp_server/xau_native_smc_mcp.py" ]; then
  python3 -m py_compile "${STAGE_DIR}/opt/xauusd-agy-advisor/mcp_server/xau_native_smc_mcp.py"
  find "${STAGE_DIR}/opt" -type d -name '__pycache__' -exec rm -rf {} +
fi

echo "[4/6] Setting Debian maintainer & executable permissions..."
chmod 0755 "${STAGE_DIR}/DEBIAN/postinst"
chmod 0755 "${STAGE_DIR}/DEBIAN/prerm"
chmod 0755 "${STAGE_DIR}/DEBIAN/postrm"
chmod 0755 "${STAGE_DIR}/usr/bin/xauusd-aurum-deck"
chmod 0755 "${STAGE_DIR}/usr/bin/xauusd-ai-oauth-bridge"
chmod 0644 "${STAGE_DIR}/etc/systemd/system/xauusd-aurum-deck.service"
chmod 0644 "${STAGE_DIR}/usr/share/applications/xauusd-aurum-deck.desktop"

echo "[5/6] Computing Installed-Size metadata..."
INSTALLED_KB=$(du -sk "${STAGE_DIR}/opt" "${STAGE_DIR}/usr" "${STAGE_DIR}/etc" | awk '{s+=$1} END {print s}')
if grep -q '^Installed-Size:' "${STAGE_DIR}/DEBIAN/control"; then
  sed -i "s/^Installed-Size:.*/Installed-Size: ${INSTALLED_KB}/" "${STAGE_DIR}/DEBIAN/control"
else
  echo "Installed-Size: ${INSTALLED_KB}" >> "${STAGE_DIR}/DEBIAN/control"
fi

echo "[6/6] Building Debian package via dpkg-deb..."
mkdir -p "${OUT_DIR}"
dpkg-deb --root-owner-group --build "${STAGE_DIR}" "${DEB_FILE}"

echo ""
echo "==================================================================="
echo "Build Complete: ${DEB_FILE}"
echo "Install on Ubuntu 24.04 LTS:"
echo "  sudo dpkg -i ${DEB_FILE} && sudo apt-get install -f"
echo "Verify service & local Gemini Subscription OAuth bridge:"
echo "  systemctl status xauusd-aurum-deck.service"
echo "  xauusd-ai-oauth-bridge status"
echo "  xauusd-aurum-deck open"
echo "==================================================================="
