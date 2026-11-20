#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Payam XAUUSD Institutional Workstation — Ubuntu 22.04 / 24.04 TimescaleDB Setup
# Run on your target Ubuntu laptop/desktop:
#   sudo bash db/timescaledb/install_ubuntu_timescaledb.sh
# ============================================================================

DB_NAME="${PAYAM_DB_NAME:-payam_xauusd}"
DB_USER="${PAYAM_DB_USER:-payam_trader}"
DB_PASS="${PAYAM_DB_PASS:-payam_local_secure_change_me}"
PG_VERSION="${PG_VERSION:-16}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_SQL="${SCRIPT_DIR}/001_init_timescaledb.sql"

if [ "${EUID}" -ne 0 ]; then
  echo "[ERROR] Please run as root: sudo bash $0"
  exit 1
fi

echo "[1/6] Installing prerequisites & official PostgreSQL + TimescaleDB APT repositories..."
apt-get update -qq
apt-get install -y -qq curl gnupg lsb-release ca-certificates apt-transport-https

CODENAME="$(lsb_release -cs)"
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | gpg --dearmor --yes -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list

curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey \
  | gpg --dearmor --yes -o /usr/share/keyrings/timescaledb-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/timescaledb-archive-keyring.gpg] https://packagecloud.io/timescale/timescaledb/ubuntu/ ${CODENAME} main" \
  > /etc/apt/sources.list.d/timescaledb.list

echo "[2/6] Installing PostgreSQL ${PG_VERSION} & TimescaleDB 2..."
apt-get update -qq
apt-get install -y -qq "postgresql-${PG_VERSION}" "timescaledb-2-postgresql-${PG_VERSION}" timescaledb-tools

echo "[3/6] Tuning PostgreSQL + TimescaleDB for your laptop's RAM & CPU cores..."
timescaledb-tune --pg-config="/usr/lib/postgresql/${PG_VERSION}/bin/pg_config" --quiet --yes || true
systemctl enable postgresql
systemctl restart postgresql

echo "[4/6] Creating role '${DB_USER}' and database '${DB_NAME}'..."
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" | grep -q 1 || psql -c \"CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';\""
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" | grep -q 1 || psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\""

echo "[5/6] Applying TimescaleDB hypertables & Continuous Aggregates schema..."
su - postgres -c "psql -v ON_ERROR_STOP=1 -d ${DB_NAME} -f '${SCHEMA_SQL}'"
su - postgres -c "psql -d ${DB_NAME} -c \"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER}; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};\""

echo "[6/6] Done! Add this line to your .env file on Ubuntu:"
echo ""
echo "  DATABASE_URL=\"postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}\""
echo "  CANDLE_STORAGE_DRIVER=\"timescaledb\""
echo ""
echo "Then start the workstation with: npm run dev (or npm run build && npm start)"
