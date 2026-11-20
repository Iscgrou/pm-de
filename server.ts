import express from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { validateTradeGuardrails } from './src/engine/smcQuant.ts';
import {
  CORE_GOLD_NEWS_SOURCES,
  aggregateNewsIntelligence,
  parseForexFactoryEvents,
  parseRssXmlHeadlines,
} from './src/engine/newsIntelligence.ts';
import type { CoreNewsSource, LiveNewsIntelligence, NewsEvent, ScoredNewsHeadline, Timeframe } from './src/engine/types.ts';
import { chartStore } from './server/timescaleStore.ts';
import { fetchAllTimeframesBundle, fetchCalibratedCandles } from './server/marketCandles.ts';
import { aiProviderHub, type SubAgentId } from './server/aiProviderHub.ts';
import { verifyProposalAgainstFactLedger } from './server/factLedger.ts';
import {
  subAgentOrchestrator,
  type SubAgentTelemetryEvent,
} from './server/subAgentOrchestrator.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEB_ROOT = path.resolve(__dirname, 'ubuntu-deb');

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.toLowerCase().includes('quota');
}

function isMissingKeyError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return code === 'MISSING_API_KEY' || msg.includes('MISSING_API_KEY') || msg.includes('GEMINI_API_KEY is not configured');
}

// --- Native Mode D: Antigravity MCP Bridge Server State ---
interface McpPendingJob {
  job_id: string;
  jobId: string;
  kind: 'PROPOSAL' | 'ADVISORY' | 'SUB_AGENT';
  subAgentId?: SubAgentId;
  prompt: string;
  systemInstruction: string;
  createdAtMs: number;
  expiresAtMs: number;
}

interface McpAuditEntry {
  id: string;
  timestampMs: number;
  category: 'SCAN' | 'PROPOSAL' | 'STAND_DOWN' | 'CIRCUIT_BREAKER' | 'ADVISORY' | 'MCP_BRIDGE' | 'AI_CONFIG';
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  title: string;
  detail: string;
}

interface LiveSpotSnapshot {
  live: boolean;
  spot: { bid: number; ask: number; mid: number; spread: number; source: string; tier: 1 | 2 | 3 } | null;
  paxg: { bid: number; ask: number; mid: number } | null;
  basisUsd: number;
  storageBackend: 'timescaledb' | 'memory';
  timestampMs: number;
  reason?: string;
}

const mcpPendingJobs: McpPendingJob[] = [];
const mcpJobResolvers = new Map<
  string,
  { resolve: (text: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
>();
const mcpProposals: Array<Record<string, unknown>> = [];
const mcpAdvisories: Array<Record<string, unknown>> = [];
const serverAuditLog: McpAuditEntry[] = [];
let latestCircuitBreakers: Record<string, unknown> = {
  canOpenNewTrades: true,
  effectiveRiskMultiplier: 1.0,
  consecutiveLosses: 0,
  cooldownRemainingMin: 0,
  dailyDrawdownPct: 0,
  openPortfolioHeatPct: 0,
  openPositionsCount: 0,
  activeBreakers: [],
  breakers: [],
  summaryEn: 'Server risk circuit breakers nominal.',
  summaryFa: 'فیوزهای مدیریت ریسک سرور در وضعیت عادی قرار دارند.',
  updatedAtMs: Date.now(),
};

function recordServerAudit(
  category: McpAuditEntry['category'],
  severity: McpAuditEntry['severity'],
  title: string,
  detail: string
): McpAuditEntry {
  const entry: McpAuditEntry = {
    id: `aud-srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestampMs: Date.now(),
    category,
    severity,
    title,
    detail,
  };
  serverAuditLog.unshift(entry);
  if (serverAuditLog.length > 100) serverAuditLog.length = 100;
  return entry;
}

function resolvePendingMcpJob(jobId: string | undefined, serializedPayload: string): boolean {
  const targetId = jobId || mcpPendingJobs[0]?.jobId;
  if (!targetId) return false;
  const idx = mcpPendingJobs.findIndex((j) => j.jobId === targetId || j.job_id === targetId);
  if (idx !== -1) {
    mcpPendingJobs.splice(idx, 1);
  }
  const pending = mcpJobResolvers.get(targetId);
  if (pending) {
    clearTimeout(pending.timer);
    mcpJobResolvers.delete(targetId);
    pending.resolve(serializedPayload);
    return true;
  }
  return false;
}

aiProviderHub.setMcpBridgeDispatcher(async ({ subAgentId, prompt, systemInstruction, timeoutMs }) => {
  const jobId = `mcp-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const nowMs = Date.now();
  const job: McpPendingJob = {
    job_id: jobId,
    jobId,
    kind: 'SUB_AGENT',
    subAgentId,
    prompt,
    systemInstruction,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + timeoutMs,
  };
  mcpPendingJobs.push(job);
  recordServerAudit('MCP_BRIDGE', 'INFO', `Queued MCP Job ${jobId}`, `Sub-agent=${subAgentId ?? 'general'}, timeout=${timeoutMs}ms`);

  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = mcpPendingJobs.findIndex((j) => j.jobId === jobId);
      if (idx !== -1) mcpPendingJobs.splice(idx, 1);
      mcpJobResolvers.delete(jobId);
      reject(
        new Error(
          `ANTIGRAVITY_MCP_BRIDGE timeout after ${timeoutMs}ms waiting for external MCP client to answer job ${jobId} via /api/v1/agent/proposals or /api/v1/agent/submit-advisory.`
        )
      );
    }, timeoutMs);
    mcpJobResolvers.set(jobId, { resolve, reject, timer });
  });
});

// Shared real-time SSE client registry & 1000ms spot snapshot cache
const sseClients = new Set<express.Response>();
let cachedLiveMarket: LiveSpotSnapshot | null = null;
let cachedLiveMarketAtMs = 0;
let liveMarketFetchInFlight: Promise<LiveSpotSnapshot> | null = null;

function broadcastSseEvent(eventName: string, payload: unknown): void {
  if (sseClients.size === 0) return;
  const serialized = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(serialized);
    } catch {
      sseClients.delete(client);
    }
  }
}

subAgentOrchestrator.on('telemetry', (evt: SubAgentTelemetryEvent) => {
  broadcastSseEvent('sub_agent_telemetry', evt);
  if (evt.eventType === 'MACRO_CACHE_UPDATED') {
    broadcastSseEvent('macro_brief', subAgentOrchestrator.getCachedMacroBrief());
  }
});

interface DebFileEntry {
  path: string;
  name: string;
  subsystem: string;
  sizeBytes: number;
  lines: number;
  language: string;
}

function detectLanguage(filePath: string): string {
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.sql')) return 'sql';
  if (filePath.endsWith('.svg')) return 'xml';
  if (
    filePath.endsWith('.sh') ||
    filePath.endsWith('postinst') ||
    filePath.endsWith('prerm') ||
    filePath.endsWith('postrm') ||
    filePath.endsWith('xauusd-aurum-deck')
  ) {
    return 'bash';
  }
  if (filePath.endsWith('.service') || filePath.endsWith('.desktop') || filePath.endsWith('control')) {
    return 'ini';
  }
  return 'text';
}

function detectSubsystem(relPath: string): string {
  if (
    relPath === 'build-deb.sh' ||
    relPath.includes('/DEBIAN/') ||
    relPath.includes('/etc/') ||
    relPath.includes('/usr/')
  ) {
    return 'Debian .deb Packaging';
  }
  if (relPath.includes('/data_pipeline/') || relPath.endsWith('cdp_streamer.py')) return '1. Data Pipeline & CDP';
  if (relPath.includes('/storage/')) return '2. SQLite WAL Storage';
  if (relPath.includes('/methods/') || relPath.endsWith('gold_confluence_engine.py')) return '3. System 1 SMC & Guardrails';
  if (relPath.includes('/agent_copilot/')) return '4. System 2 Agent Copilot';
  if (relPath.includes('/engines/')) return '5. News & Signal Daemons';
  if (relPath.includes('/sentinel_app/')) return '6. Sentinel FastAPI & WS Hub';
  if (relPath.includes('/mcp_server/')) return '7. FastMCP Bridge';
  if (relPath.includes('/tests/') || relPath.endsWith('self_verify_10gates.py')) return '8. 18-Gate Audit & Tests';
  return 'Root Manifest';
}

function collectDebFiles(dir: string, baseDir: string, out: DebFileEntry[] = []): DebFileEntry[] {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectDebFiles(full, baseDir, out);
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, full).replace(/\\/g, '/');
      const raw = fs.readFileSync(full, 'utf8');
      out.push({
        path: rel,
        name: entry.name,
        subsystem: detectSubsystem(rel),
        sizeBytes: Buffer.byteLength(raw, 'utf8'),
        lines: raw.split('\n').length,
        language: detectLanguage(rel),
      });
    }
  }
  return out;
}

function buildTarGzBuffer(rootDir: string, archivePrefix: string): Buffer {
  const files = collectDebFiles(rootDir, rootDir);
  const blocks: Buffer[] = [];

  for (const f of files) {
    const fullPath = path.join(rootDir, f.path);
    const content = fs.readFileSync(fullPath);
    const tarName = `${archivePrefix}/${f.path}`;
    const isExec =
      f.path.endsWith('.sh') ||
      f.path.endsWith('DEBIAN/postinst') ||
      f.path.endsWith('DEBIAN/prerm') ||
      f.path.endsWith('DEBIAN/postrm') ||
      f.path.endsWith('usr/bin/xauusd-aurum-deck');

    const header = Buffer.alloc(512, 0);
    let nameField = tarName;
    let prefixField = '';
    if (Buffer.byteLength(tarName) > 100) {
      const idx = tarName.lastIndexOf('/');
      if (idx > 0 && idx <= 155 && tarName.length - idx - 1 <= 100) {
        prefixField = tarName.slice(0, idx);
        nameField = tarName.slice(idx + 1);
      }
    }

    header.write(nameField, 0, 100, 'utf8');
    header.write((isExec ? '0000755' : '0000644') + '\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii');
    header.write('        ', 148, 8, 'ascii');
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    header.write('root', 265, 32, 'utf8');
    header.write('root', 297, 32, 'utf8');
    if (prefixField) {
      header.write(prefixField, 345, 155, 'utf8');
    }

    let chksum = 0;
    for (let i = 0; i < 512; i++) chksum += header[i];
    header.write(chksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

    blocks.push(header);
    blocks.push(content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad > 0) blocks.push(Buffer.alloc(pad, 0));
  }

  blocks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(blocks), { level: 6 });
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 2400): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'PayamXAUUSD/2.0' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs = 2800): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PayamXAUUSD/2.0; +https://payam.desk)',
        Accept: 'application/rss+xml, application/xml, application/json, text/xml, */*',
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

let cachedNewsIntel: LiveNewsIntelligence | null = null;
let cachedNewsAtMs = 0;
const NEWS_CACHE_TTL_MS = 60_000;

async function fetchCoreGoldNewsIntelligence(force = false): Promise<LiveNewsIntelligence> {
  const nowMs = Date.now();
  if (!force && cachedNewsIntel && nowMs - cachedNewsAtMs < NEWS_CACHE_TTL_MS) {
    return cachedNewsIntel;
  }

  const updatedSources: CoreNewsSource[] = CORE_GOLD_NEWS_SOURCES.map((s) => ({ ...s }));
  const headlines: ScoredNewsHeadline[] = [];
  let calendarEvents: NewsEvent[] = [];
  let calendarSource: 'FOREX_FACTORY_LIVE' | 'LOCAL_SCHEDULE' = 'LOCAL_SCHEDULE';

  const jobs = updatedSources.map(async (src) => {
    if (!src.feedUrl || src.feedType === 'PORTAL') {
      src.status = 'REFERENCE';
      return;
    }
    try {
      const rawText = await fetchTextWithTimeout(src.feedUrl, 2800);
      if (src.feedType === 'JSON_CALENDAR') {
        const parsedJson = JSON.parse(rawText);
        const events = parseForexFactoryEvents(parsedJson, nowMs);
        calendarEvents = events;
        if (events.length > 0) calendarSource = 'FOREX_FACTORY_LIVE';
        src.status = 'ONLINE';
        src.lastFetchedMs = nowMs;
        src.headlineCount = events.length;
      } else {
        const parsedHeadlines = parseRssXmlHeadlines(rawText, src, 6, nowMs);
        headlines.push(...parsedHeadlines);
        src.status = 'ONLINE';
        src.lastFetchedMs = nowMs;
        src.headlineCount = parsedHeadlines.length;
      }
    } catch {
      src.status = 'OFFLINE';
      src.headlineCount = 0;
    }
  });

  await Promise.allSettled(jobs);

  const intel = aggregateNewsIntelligence({
    sources: updatedSources,
    headlines,
    calendarEvents,
    calendarSource,
    fetchedAtMs: nowMs,
  });

  cachedNewsIntel = intel;
  cachedNewsAtMs = nowMs;
  return intel;
}

async function pollLiveMarketSnapshot(force = false): Promise<LiveSpotSnapshot> {
  const nowMs = Date.now();
  if (!force && cachedLiveMarket && nowMs - cachedLiveMarketAtMs < 950) {
    return cachedLiveMarket;
  }
  if (liveMarketFetchInFlight) {
    return await liveMarketFetchInFlight;
  }

  liveMarketFetchInFlight = (async (): Promise<LiveSpotSnapshot> => {
    const [sqResult, paxgResult] = await Promise.allSettled([
      fetchJsonWithTimeout('https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD', 2200),
      fetchJsonWithTimeout('https://api.binance.com/api/v3/ticker/bookTicker?symbol=PAXGUSDT', 2200),
    ]);

    let spot: { bid: number; ask: number; mid: number; spread: number; source: string; tier: 1 | 2 | 3 } | null = null;
    if (sqResult.status === 'fulfilled' && Array.isArray(sqResult.value)) {
      for (const venue of sqResult.value as Array<{ spreadProfilePrices?: Array<{ bid: number; ask: number }> }>) {
        const p0 = venue?.spreadProfilePrices?.[0];
        if (p0 && Number.isFinite(p0.bid) && Number.isFinite(p0.ask)) {
          const bid = Number(p0.bid.toFixed(2));
          const ask = Number(p0.ask.toFixed(2));
          spot = {
            bid,
            ask,
            mid: Number(((bid + ask) / 2).toFixed(2)),
            spread: Number(Math.max(0, ask - bid).toFixed(2)),
            source: 'Swissquote Interbank BBO',
            tier: 1,
          };
          break;
        }
      }
    }

    let paxg: { bid: number; ask: number; mid: number } | null = null;
    if (paxgResult.status === 'fulfilled' && paxgResult.value && typeof paxgResult.value === 'object') {
      const d = paxgResult.value as { bidPrice?: string; askPrice?: string };
      const bid = Number(d.bidPrice);
      const ask = Number(d.askPrice);
      if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0) {
        paxg = { bid: Number(bid.toFixed(2)), ask: Number(ask.toFixed(2)), mid: Number(((bid + ask) / 2).toFixed(2)) };
      }
    }

    if (!spot && paxg) {
      spot = {
        bid: paxg.bid,
        ask: paxg.ask,
        mid: paxg.mid,
        spread: Number(Math.max(0, paxg.ask - paxg.bid).toFixed(2)),
        source: 'Binance PAXGUSDT (Tier 2)',
        tier: 2,
      };
    }

    const ts = Date.now();
    if (!spot) {
      const offlineSnap: LiveSpotSnapshot = {
        live: false,
        spot: null,
        paxg: null,
        basisUsd: 0,
        storageBackend: chartStore.getStatus().driver,
        timestampMs: ts,
        reason: 'Upstream interbank feeds unreachable in current network environment',
      };
      cachedLiveMarket = offlineSnap;
      cachedLiveMarketAtMs = ts;
      return offlineSnap;
    }

    const basisUsd = paxg ? Number((spot.mid - paxg.mid).toFixed(2)) : 0;
    chartStore.recordTick({
      symbol: 'XAUUSD',
      bid: spot.bid,
      ask: spot.ask,
      mid: spot.mid,
      spread: spot.spread,
      paxgMid: paxg?.mid ?? null,
      basisUsd,
      source: spot.source,
      timestampMs: ts,
    });

    const snap: LiveSpotSnapshot = {
      live: true,
      spot,
      paxg,
      basisUsd,
      storageBackend: chartStore.getStatus().driver,
      timestampMs: ts,
    };
    cachedLiveMarket = snap;
    cachedLiveMarketAtMs = ts;
    return snap;
  })();

  try {
    return await liveMarketFetchInFlight;
  } finally {
    liveMarketFetchInFlight = null;
  }
}

async function startServer() {
  await chartStore.init();

  // Start Sub-Agent 1 (Macro & News Sentinel) background 45s pre-warming loop
  subAgentOrchestrator.startMacroBackgroundLoop(() => fetchCoreGoldNewsIntelligence(false));

  // Shared 1000ms SSE live spot broadcaster (only polls upstream while >= 1 SSE client is connected)
  let sseTickTimer: NodeJS.Timeout | null = null;
  const ensureSseTickLoop = () => {
    if (sseTickTimer) return;
    sseTickTimer = setInterval(async () => {
      if (sseClients.size === 0) {
        if (sseTickTimer) {
          clearInterval(sseTickTimer);
          sseTickTimer = null;
        }
        return;
      }
      try {
        const snap = await pollLiveMarketSnapshot(false);
        broadcastSseEvent('spot_tick', snap);
      } catch {
        // Keep SSE stream alive even on transient upstream timeout
      }
    }, 1000);
    sseTickTimer.unref?.();
  };

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/v1/health', (_req, res) => {
    const files = collectDebFiles(DEB_ROOT, DEB_ROOT);
    const aiCfg = aiProviderHub.getSanitizedConfig();
    res.json({
      status: 'nominal',
      service: 'Payam XAUUSD Institutional Workstation & Ubuntu .deb Suite',
      geminiConfigured: aiCfg.hasConfiguredGeminiKey,
      aiProviderConfigured: aiProviderHub.hasAnyUsableAiProvider(),
      aiProviderMode: aiCfg.providerMode,
      macroRegime: subAgentOrchestrator.getCachedMacroBrief().regime,
      sseClientsConnected: sseClients.size,
      mcpPendingJobsCount: mcpPendingJobs.length,
      debFilesCount: files.length,
      storage: chartStore.getStatus(),
      port: Number(process.env.PORT || 3000),
      ubuntuTargetPort: 8787,
      timestampMs: Date.now(),
    });
  });

  // --- Universal AI Provider & Auth Hub Endpoints ---
  app.get('/api/ai/config', (_req, res) => {
    res.json({
      ok: true,
      config: aiProviderHub.getSanitizedConfig(),
      subAgentStatus: subAgentOrchestrator.getSubAgentStatesSnapshot(),
    });
  });

  app.post('/api/ai/config', (req, res) => {
    try {
      const patch = req.body && typeof req.body === 'object' ? req.body : {};
      const updated = aiProviderHub.updateConfig(patch);
      if (typeof patch.macroPollIntervalSec === 'number') {
        subAgentOrchestrator.startMacroBackgroundLoop(
          () => fetchCoreGoldNewsIntelligence(false),
          updated.macroPollIntervalSec
        );
      }
      recordServerAudit(
        'AI_CONFIG',
        'INFO',
        `AI Hub Config Updated (${updated.providerMode})`,
        `Saved safely to ${updated.configFilePath}`
      );
      broadcastSseEvent('ai_config_updated', {
        providerMode: updated.providerMode,
        updatedAtMs: updated.updatedAtMs,
      });
      res.json({
        ok: true,
        config: updated,
        subAgentStatus: subAgentOrchestrator.getSubAgentStatesSnapshot(),
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid AI configuration payload',
      });
    }
  });

  app.get('/api/ai/auth-status', async (_req, res) => {
    try {
      const status = await aiProviderHub.detectCliAuthStatus();
      res.json({ ok: true, ...status });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to inspect CLI / OAuth auth status',
      });
    }
  });

  app.post('/api/ai/trigger-cli-login', async (req, res) => {
    try {
      const rawPreferred = String(req.body?.preferredCli ?? req.body?.cli ?? 'auto').toLowerCase();
      const preferred =
        rawPreferred === 'agy' || rawPreferred === 'gemini' ? rawPreferred : 'auto';
      const result = await aiProviderHub.triggerCliLogin(preferred);
      recordServerAudit(
        'AI_CONFIG',
        result.ok ? 'INFO' : 'WARN',
        `CLI OAuth Trigger (${result.cliUsed})`,
        result.message
      );
      res.status(result.ok ? 200 : 404).json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to trigger CLI login flow',
      });
    }
  });

  app.post('/api/ai/test-connection', async (req, res) => {
    try {
      const overridePatch =
        req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0
          ? req.body
          : undefined;
      const result = await aiProviderHub.testConnection(overridePatch);
      res.status(result.ok ? 200 : 502).json(result);
    } catch (err) {
      res.status(502).json({
        ok: false,
        latencyMs: 0,
        modelUsed: '',
        providerMode: aiProviderHub.getRawConfig().providerMode,
        error: err instanceof Error ? err.message : 'Connection test error',
      });
    }
  });

  app.get('/api/ai/macro-brief', (_req, res) => {
    res.json({
      ok: true,
      macroBrief: subAgentOrchestrator.getCachedMacroBrief(),
      subAgentStatus: subAgentOrchestrator.getSubAgentStatesSnapshot(),
    });
  });

  app.post('/api/ai/macro-brief/refresh', async (_req, res) => {
    try {
      const intel = await fetchCoreGoldNewsIntelligence(true);
      const brief = await subAgentOrchestrator.refreshMacroRegimeBrief(intel, null);
      res.json({ ok: true, macroBrief: brief });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to refresh Macro Sentinel brief',
      });
    }
  });

  // --- Mode D: Native Antigravity MCP Bridge Endpoints ---
  app.get('/api/v1/agent/poll-jobs', (_req, res) => {
    const nowMs = Date.now();
    // Prune expired jobs before returning
    for (let i = mcpPendingJobs.length - 1; i >= 0; i--) {
      if (mcpPendingJobs[i].expiresAtMs <= nowMs) {
        mcpPendingJobs.splice(i, 1);
      }
    }
    res.json({
      ok: true,
      jobs: mcpPendingJobs,
      count: mcpPendingJobs.length,
      timestampMs: nowMs,
    });
  });

  app.get('/api/v1/agent/proposals', (_req, res) => {
    res.json({
      ok: true,
      proposals: mcpProposals,
      advisories: mcpAdvisories.slice(0, 20),
      pendingJobsCount: mcpPendingJobs.length,
    });
  });

  app.post('/api/v1/agent/proposals', (req, res) => {
    const body = req.body ?? {};
    const jobId = typeof body.job_id === 'string' ? body.job_id : typeof body.jobId === 'string' ? body.jobId : undefined;
    const direction = String(body.direction ?? 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
    const entry = Number(body.entry);
    const stopLoss = Number(body.stopLoss ?? body.stop_loss);
    const tp1 = Number(body.tp1);
    const tp2 = Number(body.tp2);
    const atr = Number(body.atr ?? 3.5);
    const spotPrice = Number(body.spotPrice ?? body.spot_price ?? cachedLiveMarket?.spot?.mid ?? entry);
    const minRrRatio = Number(body.minRrRatio ?? body.min_rr_ratio ?? 1.5);

    const ledgerCheck = verifyProposalAgainstFactLedger(
      { direction, entry, stopLoss, tp1, tp2, invalidationPrice: Number(body.invalidationPrice ?? body.invalidation_price ?? stopLoss) },
      {
        spotPrice,
        spread: Number(cachedLiveMarket?.spot?.spread ?? 0.24),
        atr: Number.isFinite(atr) && atr > 0 ? atr : 3.5,
        minRrRatio,
        fvgs: Array.isArray(body.fvgs) ? body.fvgs : [],
        orderBlocks: Array.isArray(body.orderBlocks) ? body.orderBlocks : [],
        dealingRange: body.dealingRange ?? null,
      }
    );

    const guard = validateTradeGuardrails(direction, ledgerCheck.entry, stopLoss, tp1, tp2, atr);
    if (!ledgerCheck.valid || !guard.valid) {
      const errors = [...new Set([...ledgerCheck.errors, ...guard.errors])];
      recordServerAudit('STAND_DOWN', 'WARN', `MCP Proposal Rejected (${direction})`, errors.join('; '));
      res.status(422).json({
        ok: false,
        decision: 'STAND_DOWN',
        errors,
        factLedger: ledgerCheck,
      });
      return;
    }

    const proposal = {
      id: `prop-mcp-${Date.now().toString(36)}`,
      jobId: jobId ?? null,
      direction,
      orderType: String(body.orderType ?? body.order_type ?? 'LIMIT').toUpperCase() === 'MARKET' ? 'MARKET' : 'LIMIT',
      setupType: String(body.setupType ?? body.setup_type ?? 'Antigravity MCP Proposal'),
      timeframe: String(body.timeframe ?? 'M15').toUpperCase(),
      entry: ledgerCheck.entry,
      stopLoss: ledgerCheck.stopLoss,
      tp1: ledgerCheck.tp1,
      tp2: ledgerCheck.tp2,
      invalidationPrice: ledgerCheck.invalidationPrice,
      ttlBars: Math.max(2, Math.min(20, Math.round(Number(body.ttlBars ?? body.ttl_bars ?? 6)))),
      rrRatio: ledgerCheck.rrRatio,
      confidence: Math.max(0.55, Math.min(0.97, Number(body.confidence ?? 0.82))),
      rationaleEn: String(body.rationaleEn ?? body.rationale_en ?? ''),
      rationaleFa: String(body.rationaleFa ?? body.rationale_fa ?? ''),
      thinkingTrace: String(body.thinkingTrace ?? body.thinking_trace ?? ''),
      confluenceScore: Number(body.confluenceScore ?? body.confluence_score ?? 78),
      convictionGrade: String(body.convictionGrade ?? body.conviction_grade ?? 'A'),
      toolsUsed: Array.isArray(body.toolsUsed) ? body.toolsUsed : ['antigravity_mcp_bridge', 'fact_ledger_guard'],
      engineSource: 'ANTIGRAVITY_MCP',
      status: 'PROPOSED',
      factLedgerAudit: {
        snapped: ledgerCheck.snapped,
        originalEntry: ledgerCheck.originalEntry,
        matchedAnchor: ledgerCheck.matchedAnchor?.label ?? null,
        auditSummary: ledgerCheck.auditSummary,
      },
      createdAtMs: Date.now(),
    };

    mcpProposals.unshift(proposal);
    if (mcpProposals.length > 50) mcpProposals.length = 50;

    // Resolve any pending Mode D job waiting on this MCP push
    const resolvedJob = resolvePendingMcpJob(
      jobId,
      JSON.stringify({ decision: 'PROPOSE', ...proposal })
    );

    recordServerAudit(
      'PROPOSAL',
      'INFO',
      `MCP Proposal Registered (${direction} @ $${proposal.entry.toFixed(2)})`,
      `${proposal.setupType} · R:R 1:${proposal.rrRatio.toFixed(2)} · resolvedJob=${resolvedJob}`
    );
    broadcastSseEvent('mcp_proposal', proposal);

    res.json({
      ok: true,
      resolvedJob,
      proposal,
      factLedger: ledgerCheck,
    });
  });

  app.post('/api/v1/agent/submit-advisory', (req, res) => {
    const body = req.body ?? {};
    const jobId = String(body.job_id ?? body.jobId ?? `adv-${Date.now().toString(36)}`);
    const advisory = {
      id: `adv-mcp-${Date.now().toString(36)}`,
      jobId,
      job_id: jobId,
      verdict: String(body.verdict ?? 'HOLD').toUpperCase(),
      confidence: Math.max(0, Math.min(1, Number(body.confidence ?? 0.78))),
      rationaleEn: String(body.rationaleEn ?? body.rationale_en ?? ''),
      rationaleFa: String(body.rationaleFa ?? body.rationale_fa ?? ''),
      thinkingTrace: String(body.thinkingTrace ?? body.thinking_trace ?? ''),
      payload: body.payload ?? null,
      createdAtMs: Date.now(),
    };

    mcpAdvisories.unshift(advisory);
    if (mcpAdvisories.length > 50) mcpAdvisories.length = 50;

    const resolvedJob = resolvePendingMcpJob(
      jobId,
      typeof body.rawJson === 'string'
        ? body.rawJson
        : JSON.stringify(body.payload ?? advisory)
    );

    recordServerAudit(
      'ADVISORY',
      'INFO',
      `MCP Advisory Submitted (${advisory.verdict})`,
      `jobId=${jobId} · resolvedJob=${resolvedJob}`
    );
    broadcastSseEvent('advisory_update', advisory);

    res.json({ ok: true, resolvedJob, advisory });
  });

  app.get('/api/v1/agent/circuit-breakers', (_req, res) => {
    const macroBrief = subAgentOrchestrator.getCachedMacroBrief();
    const shockActive = macroBrief.regime === 'SHOCK_LOCKOUT';
    const currentCanTrade = Boolean(latestCircuitBreakers.canOpenNewTrades) && !shockActive;
    const activeBreakers = Array.isArray(latestCircuitBreakers.activeBreakers)
      ? [...(latestCircuitBreakers.activeBreakers as string[])]
      : [];
    if (shockActive && !activeBreakers.includes('NEWS_SHOCK_GUARD')) {
      activeBreakers.push('NEWS_SHOCK_GUARD');
    }

    res.json({
      ok: true,
      ...latestCircuitBreakers,
      canOpenNewTrades: currentCanTrade,
      activeBreakers,
      macroRegime: macroBrief.regime,
      liveSpread: cachedLiveMarket?.spot?.spread ?? null,
      timestampMs: Date.now(),
    });
  });

  app.get('/api/v1/agent/audit', (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 40) || 40));
    res.json({
      ok: true,
      entries: serverAuditLog.slice(0, limit),
      total: serverAuditLog.length,
      timestampMs: Date.now(),
    });
  });

  // Real Multi-Source Calibrated XAU/USD Candles (Binance PAXGUSDT -> OKX XAUT -> Yahoo GC=F + Swissquote Spot Calibration + TimescaleDB)
  app.get('/api/candles', async (req, res) => {
    try {
      const rawTf = String(req.query.tf || 'M15').toUpperCase();
      const validTfs: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4'];
      const tf: Timeframe = validTfs.includes(rawTf as Timeframe) ? (rawTf as Timeframe) : 'M15';
      const limit = Number(req.query.limit || 240);
      const force = String(req.query.force || '') === '1';
      const data = await fetchCalibratedCandles(tf, Number.isFinite(limit) ? limit : 240, force);
      res.json(data);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to fetch calibrated XAUUSD candles',
      });
    }
  });

  app.get('/api/candles/bundle', async (req, res) => {
    try {
      const limit = Number(req.query.limit || 240);
      const force = String(req.query.force || '') === '1';
      const bundle = await fetchAllTimeframesBundle(Number.isFinite(limit) ? limit : 240, force);
      res.json(bundle);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to hydrate multi-timeframe XAUUSD bundle',
      });
    }
  });

  // Live Interbank Swissquote XAU/USD BBO + Binance PAXGUSDT basis cross-validation proxy
  app.get('/api/market/live', async (_req, res) => {
    const snap = await pollLiveMarketSnapshot(false);
    if (!snap.live) {
      res.json({ live: false, reason: snap.reason });
      return;
    }
    res.json(snap);
  });

  // Real-Time Server-Sent Events (SSE) Stream: 1000ms live spot ticks + live sub-agent telemetry
  app.get('/api/market/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sseClients.add(res);
    ensureSseTickLoop();

    // Send immediate handshake + current sub-agent snapshot + cached macro brief
    res.write(
      `event: connected\ndata: ${JSON.stringify({
        ok: true,
        cadenceMs: 1000,
        providerMode: aiProviderHub.getRawConfig().providerMode,
        subAgentSnapshot: subAgentOrchestrator.getSubAgentStatesSnapshot(),
        timestampMs: Date.now(),
      })}\n\n`
    );

    if (cachedLiveMarket) {
      res.write(`event: spot_tick\ndata: ${JSON.stringify(cachedLiveMarket)}\n\n`);
    } else {
      pollLiveMarketSnapshot(false)
        .then((snap) => {
          if (sseClients.has(res)) {
            res.write(`event: spot_tick\ndata: ${JSON.stringify(snap)}\n\n`);
          }
        })
        .catch(() => {});
    }

    const heartbeat = setInterval(() => {
      if (!sseClients.has(res)) {
        clearInterval(heartbeat);
        return;
      }
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        sseClients.delete(res);
        clearInterval(heartbeat);
      }
    }, 15_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Live 14-Source Institutional Gold News, Central Bank RSS & ForexFactory Calendar Aggregator
  app.get('/api/news/live', async (req, res) => {
    try {
      const force = String(req.query.force ?? '') === '1';
      const intel = await fetchCoreGoldNewsIntelligence(force);
      // Asynchronously refresh Sub-Agent 1 Macro Sentinel cache whenever news updates (zero added latency to response)
      void subAgentOrchestrator.refreshMacroRegimeBrief(intel, null);
      res.json({ ok: true, ...intel });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Core Gold news aggregator error',
      });
    }
  });

  // Server-Side 5-Sub-Agent Parallel Proposal Endpoint (with Gate Short-Circuit Fix + Fact Ledger)
  app.post('/api/agent/propose', async (req, res) => {
    const {
      spotPrice,
      spread,
      timeframe,
      quant,
      newsGate,
      divergence,
      basis,
      agentConfig,
      circuitBreakers,
      liveNews,
      forceDeepAudit,
    } = req.body ?? {};
    const basisCtx = divergence ?? basis;

    if (!Number.isFinite(spotPrice) || !quant) {
      res.status(400).json({ error: 'Missing spotPrice or quant context' });
      return;
    }

    if (circuitBreakers && typeof circuitBreakers === 'object') {
      latestCircuitBreakers = { ...circuitBreakers, updatedAtMs: Date.now() };
    }

    const brain = quant.brain;
    const minScore = Number(agentConfig?.minConfluenceScore ?? 62);
    const bypassDeterministicGate = forceDeepAudit === true;

    // 1. Absolute Non-Bypassable Risk Circuit Breaker Gate
    if (circuitBreakers && circuitBreakers.canOpenNewTrades === false) {
      const reasonEn =
        circuitBreakers.summaryEn ||
        `Risk Circuit Breaker halted new entries (${(circuitBreakers.activeBreakers ?? []).join(', ')}).`;
      const reasonFa =
        circuitBreakers.summaryFa ||
        'فیوزهای مدیریت ریسک و حفاظت سرمایه فعال شده‌اند؛ صدور معامله جدید مسدود است.';
      recordServerAudit('CIRCUIT_BREAKER', 'WARN', 'Proposal Short-Circuited by Circuit Breaker', reasonEn);
      res.json({
        ok: true,
        decision: 'STAND_DOWN',
        shortCircuited: true,
        standDownReasonEn: reasonEn,
        standDownReasonFa: reasonFa,
        watchlistZone: brain?.watchlistZone ?? null,
        macroBrief: subAgentOrchestrator.getCachedMacroBrief(),
      });
      return;
    }

    // 2. Fixed Gate Short-Circuit (Zero Wasted LLM Latency/Tokens unless forceDeepAudit === true)
    if (!bypassDeterministicGate) {
      const hasHardVetoes = Array.isArray(brain?.hardVetoes) && brain.hardVetoes.length > 0;
      const isBrainStandDown = String(brain?.decision ?? '').toUpperCase() === 'STAND_DOWN';
      const isScoreBelowMin = typeof brain?.totalScore === 'number' && brain.totalScore < minScore;
      const isNewsBlocked = Boolean(newsGate?.vetoNewEntries) || Boolean(liveNews?.shockDetected);

      if (isNewsBlocked || hasHardVetoes || isBrainStandDown || isScoreBelowMin) {
        const reasons: string[] = [];
        if (isNewsBlocked) reasons.push('NEWS_LOCKOUT_OR_SHOCK');
        if (hasHardVetoes) reasons.push(`HARD_VETOES(${brain.hardVetoes.join(', ')})`);
        if (isBrainStandDown) reasons.push('BRAIN_DECISION=STAND_DOWN');
        if (isScoreBelowMin) reasons.push(`SCORE=${brain.totalScore}/${minScore}`);

        const reasonEn =
          brain?.summaryEn ||
          `Deterministic gate short-circuited scan (${reasons.join(' · ')}). Zero LLM latency incurred.`;
        const reasonFa =
          brain?.summaryFa ||
          `فیلتر قطعی سیستم ۱ پیش از فراخوانی هوش مصنوعی دستور ایست صادر کرد (${reasons.join(' · ')}).`;

        recordServerAudit('STAND_DOWN', 'INFO', 'Gate Short-Circuit STAND_DOWN', reasons.join(' · '));
        res.json({
          ok: true,
          decision: 'STAND_DOWN',
          shortCircuited: true,
          shortCircuitReasons: reasons,
          standDownReasonEn: reasonEn,
          standDownReasonFa: reasonFa,
          watchlistZone: brain?.watchlistZone ?? null,
          macroBrief: subAgentOrchestrator.getCachedMacroBrief(),
        });
        return;
      }
    }

    if (!aiProviderHub.hasAnyUsableAiProvider()) {
      res.status(503).json({
        error:
          'No AI provider is configured. Configure Gemini API Key, Local Subscription CLIProxyAPI, Custom OpenAI-Compatible URL, or MCP Bridge in AI Provider Hub.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    try {
      // Pass COMPLETE 5-Stage ICT payload into Zero-Latency 5-Sub-Agent Parallel Orchestrator
      const pipelineResult = await subAgentOrchestrator.runProposalPipeline({
        spotPrice: Number(spotPrice),
        spread: Number(spread ?? 0.24),
        timeframe: String(timeframe || quant.timeframe || 'M15'),
        quant: {
          ...quant,
          structures: quant.structures ?? [],
          liquidity: quant.liquidity ?? [],
          tfs: quant.tfs ?? null,
          tpi: quant.tpi ?? null,
          dealingRange: quant.dealingRange ?? null,
          fvgs: quant.fvgs ?? [],
          orderBlocks: quant.orderBlocks ?? [],
          rsi: quant.rsi ?? null,
          regime: quant.regime ?? null,
          brain: {
            ...(brain ?? {}),
            mtfMatrix: brain?.mtfMatrix ?? quant.mtfMatrix ?? [],
          },
        },
        newsGate,
        basis: basisCtx,
        agentConfig,
        circuitBreakers,
        liveNews,
        forceDeepAudit: bypassDeterministicGate,
      });

      if (pipelineResult.decision === 'STAND_DOWN' || !pipelineResult.proposal) {
        recordServerAudit(
          'STAND_DOWN',
          'INFO',
          `5-Sub-Agent STAND_DOWN (${pipelineResult.totalLatencyMs}ms)`,
          pipelineResult.standDownReasonEn || 'Chief Execution Judge or Fact Ledger enforced STAND_DOWN.'
        );
        res.json({
          ok: true,
          decision: 'STAND_DOWN',
          pipelineId: pipelineResult.pipelineId,
          totalLatencyMs: pipelineResult.totalLatencyMs,
          standDownReasonEn:
            pipelineResult.standDownReasonEn ||
            brain?.summaryEn ||
            'Setup did not pass Payam 5-Sub-Agent & Fact Ledger institutional verification.',
          standDownReasonFa:
            pipelineResult.standDownReasonFa ||
            brain?.summaryFa ||
            'ستاپ معاملاتی نتوانست تایید ۵ زیرعامل و دفتر کل ضد توهم پیام را کسب کند.',
          watchlistZone: brain?.watchlistZone ?? null,
          macroBrief: pipelineResult.macroBrief,
          subAgents: {
            sniper: pipelineResult.sniper,
            redTeam: pipelineResult.redTeam,
            judge: pipelineResult.judge,
          },
          factLedger: pipelineResult.factLedger,
        });
        return;
      }

      // Secondary System-1 deterministic guardrail sanity check
      const atr = Number(quant.regime?.atr ?? 3.5);
      const guard = validateTradeGuardrails(
        pipelineResult.proposal.direction,
        pipelineResult.proposal.entry,
        pipelineResult.proposal.stopLoss,
        pipelineResult.proposal.tp1,
        pipelineResult.proposal.tp2,
        atr
      );

      if (!guard.valid) {
        res.status(422).json({
          error: `Agent proposal rejected by System 1 mathematical guardrails: ${guard.errors.join('; ')}`,
          guard,
          factLedger: pipelineResult.factLedger,
        });
        return;
      }

      recordServerAudit(
        'PROPOSAL',
        'INFO',
        `5-Sub-Agent Proposal ${pipelineResult.proposal.direction} ${pipelineResult.proposal.orderType} (${pipelineResult.totalLatencyMs}ms)`,
        `${pipelineResult.proposal.setupType} @ $${pipelineResult.proposal.entry.toFixed(2)} · R:R 1:${pipelineResult.proposal.rrRatio.toFixed(2)}`
      );

      res.json({
        ok: true,
        decision: 'PROPOSE',
        pipelineId: pipelineResult.pipelineId,
        totalLatencyMs: pipelineResult.totalLatencyMs,
        proposal: pipelineResult.proposal,
        macroBrief: pipelineResult.macroBrief,
        subAgents: {
          sniper: pipelineResult.sniper,
          redTeam: pipelineResult.redTeam,
          judge: pipelineResult.judge,
        },
        factLedger: pipelineResult.factLedger,
      });
    } catch (err) {
      if (isMissingKeyError(err)) {
        res.status(503).json({
          error: err instanceof Error ? err.message : 'AI provider credentials not configured.',
          code: 'MISSING_API_KEY',
        });
        return;
      }
      if (isQuotaError(err)) {
        res.status(429).json({
          error: 'AI provider quota temporarily exhausted. Payam Institutional Brain v3 deterministic engine remains active.',
          code: 'GEMINI_QUOTA_EXHAUSTED',
        });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Multi-sub-agent scan failed';
      res.status(502).json({ error: msg, code: 'UPSTREAM_AI_ERROR' });
    }
  });

  // Server-Side Sub-Agent 5 (Live Position Guardian) Multi-Position Broker Monitor Endpoint
  app.post('/api/agent/monitor', async (req, res) => {
    const { spotPrice, positions, quant, newsGate, divergence, basis, liveNews } = req.body ?? {};
    const basisCtx = divergence ?? basis;
    if (!Array.isArray(positions) || positions.length === 0) {
      res.json({ ok: true, directives: [], reviews: [], updates: [] });
      return;
    }

    if (!aiProviderHub.hasAnyUsableAiProvider() && aiProviderHub.isSubAgentEnabled('livePositionGuardian')) {
      res.status(503).json({
        error: 'No AI provider is configured for Live Position Guardian.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    try {
      const result = await subAgentOrchestrator.runPositionGuardian({
        spotPrice: Number(spotPrice),
        positions,
        quant,
        newsGate,
        basis: basisCtx,
        liveNews,
      });

      res.json({
        ok: true,
        pipelineId: result.pipelineId,
        latencyMs: result.latencyMs,
        modelUsed: result.modelUsed,
        providerMode: result.providerMode,
        macroBrief: result.macroBrief,
        directives: result.directives,
        reviews: result.directives,
        updates: result.directives,
      });
    } catch (err) {
      if (isMissingKeyError(err)) {
        res.status(503).json({
          error: err instanceof Error ? err.message : 'AI provider credentials not configured.',
          code: 'MISSING_API_KEY',
        });
        return;
      }
      if (isQuotaError(err)) {
        res.status(429).json({
          error: 'AI provider quota temporarily exhausted; deterministic HSM position monitor active.',
          code: 'GEMINI_QUOTA_EXHAUSTED',
        });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Live Position Guardian monitor failed';
      res.status(502).json({ error: msg, code: 'UPSTREAM_AI_ERROR' });
    }
  });

  app.get('/api/deb/tree', (_req, res) => {
    const files = collectDebFiles(DEB_ROOT, DEB_ROOT);
    const totalBytes = files.reduce((s, f) => s + f.sizeBytes, 0);
    const totalLines = files.reduce((s, f) => s + f.lines, 0);
    res.json({ files, totalFiles: files.length, totalBytes, totalLines });
  });

  app.get('/api/deb/file', (req, res) => {
    const relPath = String(req.query.path || '');
    if (!relPath || relPath.includes('..') || path.isAbsolute(relPath)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    const target = path.resolve(DEB_ROOT, relPath);
    if (!target.startsWith(DEB_ROOT + path.sep) || !fs.existsSync(target)) {
      res.status(404).json({ error: 'File not found in Ubuntu .deb tree' });
      return;
    }
    const content = fs.readFileSync(target, 'utf8');
    res.json({ path: relPath, content, language: detectLanguage(relPath) });
  });

  app.get('/api/deb/download', (_req, res) => {
    try {
      const gz = buildTarGzBuffer(DEB_ROOT, 'payam-xauusd-ubuntu-deb');
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', 'attachment; filename="payam-xauusd-ubuntu-source.tar.gz"');
      res.setHeader('Content-Length', String(gz.length));
      res.send(gz);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Archive generation failed' });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Payam XAUUSD Command Deck server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
