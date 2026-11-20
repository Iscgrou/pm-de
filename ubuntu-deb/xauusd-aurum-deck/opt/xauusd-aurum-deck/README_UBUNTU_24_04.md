# Payam XAUUSD — Aurum Command Deck (Ubuntu 24.04 LTS Unified Package)

This package installs the unified **TypeScript/Node.js + React** institutional XAU/USD workstation into `/opt/xauusd-aurum-deck/`.

## Unified Engine Architecture
- Obsolete duplicate Python indicator scripts (`methods/*.py`, `gold_confluence_engine.py`) have been removed to eliminate indicator drift.
- All System-1 SMC/ICT quantitative engines (`src/engine/smcQuant.ts`, `payamBrain.ts`, `chartEngine.ts`, `agentGovernance.ts`, `newsIntelligence.ts`, `tradeSimulator.ts`) run deterministically from a single TypeScript source of truth.
- The production Vite bundle (`dist/`) is served directly by `server.ts` under `xauusd-aurum-deck.service`.

## Quick Start on Ubuntu 24.04 LTS
```bash
# 1. Build the unified .deb package from repository root
chmod +x ubuntu-deb/build-deb.sh
./ubuntu-deb/build-deb.sh

# 2. Install package & resolve dependencies
sudo dpkg -i ubuntu-deb/dist/xauusd-aurum-deck_3.0.0_amd64.deb
sudo apt-get install -f

# 3. Connect local Antigravity (agy) or CLIProxyAPI for Gemini Pro/Ultra Subscription OAuth
xauusd-ai-oauth-bridge login
xauusd-ai-oauth-bridge start-proxy
xauusd-ai-oauth-bridge status

# 4. Launch Aurum Command Deck in browser
xauusd-aurum-deck open
```
