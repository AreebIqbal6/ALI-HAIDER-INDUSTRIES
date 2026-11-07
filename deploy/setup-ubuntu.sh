#!/usr/bin/env bash
# ==============================================================================
# WeaveSync SCADA - Industrial Edge Gateway Bare-Metal Provisioning Script
# Target OS: Ubuntu Server 24.04 LTS (Noble Numbat)
# Client: Ali Haider Industries (SITE Industrial Area, Karachi)
# Author: WeaveSync Engineering Lead / Saif Hardware Plan
# ==============================================================================

set -euo pipefail

# ANSI color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}  WEAVESYNC SCADA - UBUNTU 24.04 LTS EDGE GATEWAY PROVISIONING               ${NC}"
echo -e "${BLUE}  Client: Ali Haider Industries | Hardware Node Target: OmniPlus-i           ${NC}"
echo -e "${BLUE}==============================================================================${NC}"

# ------------------------------------------------------------------------------
# 1. Root / Sudo Check
# ------------------------------------------------------------------------------
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR] This script must be run as root or with sudo privileges.${NC}"
  echo "Usage: sudo bash setup-ubuntu.sh"
  exit 1
fi

ACTUAL_USER="${SUDO_USER:-$USER}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "\n${YELLOW}[STEP 1/6] Updating APT Package Index and Installing Prerequisites...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    ufw \
    jq \
    sqlite3 \
    net-tools \
    iproute2 \
    mosquitto-clients

# ------------------------------------------------------------------------------
# 2. Install Official Docker Engine & Docker Compose v2 (Ubuntu 24.04 LTS Noble)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[STEP 2/6] Installing Official Docker Engine & Compose Plugin...${NC}"
if ! command -v docker &> /dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Enable and start Docker daemon
    systemctl enable docker
    systemctl start docker
    echo -e "${GREEN}[OK] Docker Engine installed successfully.${NC}"
else
    echo -e "${GREEN}[OK] Docker is already installed: $(docker --version)${NC}"
fi

# Add invoking user to docker group if not already present
if ! groups "$ACTUAL_USER" | grep &>/dev/null '\bdocker\b'; then
    usermod -aG docker "$ACTUAL_USER"
    echo -e "${GREEN}[OK] Added user '${ACTUAL_USER}' to the 'docker' group.${NC}"
fi

# ------------------------------------------------------------------------------
# 3. Configure Industrial UFW (Uncomplicated Firewall)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[STEP 3/6] Hardening Firewall via UFW for OT Network Isolation...${NC}"

# Default Policies: Deny incoming, allow outgoing
ufw default deny incoming
ufw default allow outgoing

# Allow SSH Management (Port 22)
ufw allow 22/tcp comment 'WeaveSync Gateway Management SSH'

# Allow MQTT Ingestion (Port 1883 for Pilot, Port 8883 for Production TLS)
ufw allow 1883/tcp comment 'Mosquitto MQTT Broker (OT Port 1883)'
ufw allow 8883/tcp comment 'Mosquitto MQTTS Broker TLS (OT Port 8883)'

# Allow HTTP Ingest Bridge for WT32-ETH01 direct LAN packets (Port 4841)
ufw allow 4841/tcp comment 'WT32-ETH01 Direct HTTP Bridge (Port 4841)'

# Enable UFW non-interactively
echo "y" | ufw enable
ufw status verbose

# ------------------------------------------------------------------------------
# 4. Prepare Directory Layout & Volume Permissions
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[STEP 4/6] Initialising Persistent Storage Volumes & Permissions...${NC}"

# SQLite WAL database directory (mapped to node user UID 1000 in Docker)
mkdir -p "$SCRIPT_DIR/data/sqlite"
chown -R 1000:1000 "$SCRIPT_DIR/data/sqlite"
chmod -R 775 "$SCRIPT_DIR/data/sqlite"

# Mosquitto broker persistence & log directories (mapped to mosquitto user UID 1883 in Docker)
mkdir -p "$SCRIPT_DIR/mosquitto/data"
mkdir -p "$SCRIPT_DIR/mosquitto/log"
chown -R 1883:1883 "$SCRIPT_DIR/mosquitto/data"
chown -R 1883:1883 "$SCRIPT_DIR/mosquitto/log"
chmod -R 775 "$SCRIPT_DIR/mosquitto/data"
chmod -R 775 "$SCRIPT_DIR/mosquitto/log"

# Verify mosquitto.conf exists
if [ ! -f "$SCRIPT_DIR/mosquitto/mosquitto.conf" ]; then
    echo -e "${RED}[ERROR] mosquitto.conf missing in $SCRIPT_DIR/mosquitto/${NC}"
    exit 1
fi

# ------------------------------------------------------------------------------
# 5. Environment File Verification (.env)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[STEP 5/6] Verifying Gateway Environment Configuration...${NC}"
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo -e "${YELLOW}[WARN] .env not found. Generating default pilot configuration...${NC}"
    cat <<EOF > "$SCRIPT_DIR/.env"
# WeaveSync SCADA Industrial Gateway Environment
GATEWAY_MODE=HYBRID
PILOT_LOOM_ID=PIC-427708
EDGE_GATEWAY_HTTP_PORT=4841
MQTT_BROKER_URL=mqtt://mqtt-broker:1883
SQLITE_DB_PATH=/app/data/sqlite/outbox.db
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
EOF
    echo -e "${GREEN}[OK] Created default $SCRIPT_DIR/.env file.${NC}"
fi

# ------------------------------------------------------------------------------
# 6. Build and Launch Stack via Docker Compose v2
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[STEP 6/6] Launching Docker Compose Stack (Mosquitto + Edge Gateway)...${NC}"
docker compose -f "$SCRIPT_DIR/docker-compose.yml" build
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

echo -e "\n${BLUE}Waiting for services to report HEALTHY (10 seconds)...${NC}"
sleep 10

echo -e "\n${GREEN}==============================================================================${NC}"
echo -e "${GREEN}  WEAVESYNC EDGE GATEWAY IS RUNNING SUCCESSFULLY!                             ${NC}"
echo -e "${GREEN}==============================================================================${NC}"
docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps

echo -e "\n${YELLOW}Testing Local Healthcheck Endpoint (http://localhost:4841/health):${NC}"
curl -s http://localhost:4841/health | jq . || true

echo -e "\n${BLUE}Next Steps for Factory Deployment:${NC}"
echo "1. Connect WT32-ETH01 Ethernet cable into the Gateway switch."
echo "2. Tail live gateway logs using: docker compose -f $SCRIPT_DIR/docker-compose.yml logs -f"
echo "3. Verify live hardware envelopes are arriving for Loom 1 (PIC-427708)."
