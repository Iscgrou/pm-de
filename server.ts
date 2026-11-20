import express from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEB_ROOT = path.resolve(__dirname, 'ubuntu-deb');

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.toLowerCase().includes('quota');
}

async function generateStructuredJson(
  ai: GoogleGenAI,
  contents: string,
  responseSchema: Record<string, unknown>
): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema,
      },
    });
    return (response.text ?? '{}').trim();
  } catch (primaryErr) {
    if (!isQuotaError(primaryErr)) throw primaryErr;
    // Fallback to gemini-2.5-flash when primary model free-tier quota is exhausted
    const fallbackResp = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema,
      },
    });
    return (fallbackResp.text ?? '{}').trim();
  }
}

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

async function startServer() {
  await chartStore.init();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/health', (_req, res) => {
    const files = collectDebFiles(DEB_ROOT, DEB_ROOT);
    res.json({
      status: 'nominal',
      service: 'Payam XAUUSD Institutional Workstation & Ubuntu .deb Suite',
      geminiConfigured: Boolean(getGeminiClient()),
      debFilesCount: files.length,
      storage: chartStore.getStatus(),
      port: Number(process.env.PORT || 3000),
      ubuntuTargetPort: 8787,
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
    const [sqResult, paxgResult] = await Promise.allSettled([
      fetchJsonWithTimeout('https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD', 2500),
      fetchJsonWithTimeout('https://api.binance.com/api/v3/ticker/bookTicker?symbol=PAXGUSDT', 2500),
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

    if (!spot) {
      res.json({ live: false, reason: 'Upstream interbank feeds unreachable in current network environment' });
      return;
    }

    const basisUsd = paxg ? Number((spot.mid - paxg.mid).toFixed(2)) : 0;
    const nowMs = Date.now();
    chartStore.recordTick({
      symbol: 'XAUUSD',
      bid: spot.bid,
      ask: spot.ask,
      mid: spot.mid,
      spread: spot.spread,
      paxgMid: paxg?.mid ?? null,
      basisUsd,
      source: spot.source,
      timestampMs: nowMs,
    });
    res.json({
      live: true,
      spot,
      paxg,
      basisUsd,
      storageBackend: chartStore.getStatus().driver,
      timestampMs: nowMs,
    });
  });

  // Live 14-Source Institutional Gold News, Central Bank RSS & ForexFactory Calendar Aggregator
  app.get('/api/news/live', async (req, res) => {
    try {
      const force = String(req.query.force ?? '') === '1';
      const intel = await fetchCoreGoldNewsIntelligence(force);
      res.json({ ok: true, ...intel });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Core Gold news aggregator error',
      });
    }
  });

  // Server-Side Gemini Agentic Proposal Endpoint (gemini-4-hydrogen + Payam Institutional Brain v3 Constitution)
  app.post('/api/agent/propose', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in server Secrets.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    const { spotPrice, spread, timeframe, quant, newsGate, divergence, basis, agentConfig, circuitBreakers, liveNews } =
      req.body ?? {};
    const basisCtx = divergence ?? basis;
    if (!Number.isFinite(spotPrice) || !quant) {
      res.status(400).json({ error: 'Missing spotPrice or quant context' });
      return;
    }

    const brain = quant.brain;
    // Hard server-side discipline: NEVER override deterministic Risk Circuit Breakers, Kill Switch, News LOCKOUT, or Brain hard vetoes
    if (circuitBreakers && circuitBreakers.canOpenNewTrades === false) {
      res.json({
        ok: true,
        decision: 'STAND_DOWN',
        standDownReasonEn:
          circuitBreakers.summaryEn ||
          `Risk Circuit Breaker halted new entries (${(circuitBreakers.activeBreakers ?? []).join(', ')}).`,
        standDownReasonFa:
          circuitBreakers.summaryFa ||
          'فیوزهای مدیریت ریسک و حفاظت سرمایه فعال شده‌اند؛ صدور معامله جدید مسدود است.',
        watchlistZone: brain?.watchlistZone ?? null,
      });
      return;
    }

    if (newsGate?.vetoNewEntries || liveNews?.shockDetected || (Array.isArray(brain?.hardVetoes) && brain.hardVetoes.length > 0)) {
      res.json({
        ok: true,
        decision: 'STAND_DOWN',
        standDownReasonEn:
          brain?.summaryEn ||
          `Hard Veto active (${(brain?.hardVetoes ?? ['NEWS_SHIELD']).join(', ')}). Payam Brain refused to chase or force a low-edge entry.`,
        standDownReasonFa:
          brain?.summaryFa ||
          'فیلتر ضد هیجان و مدیریت ریسک فعال است؛ مغز تحلیلی پیام از صدور پوزیشن پرریسک خودداری کرد.',
        watchlistZone: brain?.watchlistZone ?? null,
      });
      return;
    }

    try {
      const atr = Number(quant.regime?.atr ?? 3.5);
      const minRr = Number(agentConfig?.minRrRatio ?? 1.75);
      const minScore = Number(agentConfig?.minConfluenceScore ?? 62);
      const minStop = Math.max(2.0, atr * 0.85, Number(spread ?? 0.24) * 3.5);
      const topHeadlines = Array.isArray(liveNews?.headlines)
        ? liveNews.headlines.slice(0, 6).map((h: ScoredNewsHeadline) => ({
            source: h.sourceName,
            title: h.title,
            bias: h.goldBias,
            impact: h.impactScore,
          }))
        : [];
      const prompt = [
        `You are Payam, a ruthless, zero-emotion institutional XAU/USD (Gold) quantitative trader.`,
        `YOUR TRADING CONSTITUTION (STRICTLY ENFORCED):`,
        `1. TOP-DOWN HIERARCHY: 4H (H4) is the Macro Directional Compass (20 pts). Never trade blindly against a strong H4 trend unless Counter-H4 is enabled AND an H1/M15 liquidity sweep + Regular RSI(14) divergence confirm a temporary scalp.`,
        `2. EXECUTION CORE (1H & LOWER): Require 1H/M15/M5 structural confirmation (BOS/CHoCH or stop-hunt wick sweep of BSL/SSL, 20 pts), institutional Order Block quality (body >= 55%, displacement >= 1.1x ATR, 18 pts), and Fair Value Gap CE 50% / Golden OB+FVG overlap (15 pts).`,
        `3. WILDER RSI(14) REGIME & DIVERGENCE (15 pts): Respect Cardwell/Hayden regimes (Bullish 40-80, Bearish 20-60). Prioritize Hidden Divergence for trend pullbacks and Regular Divergence for reversal confirmation. NEVER chase RSI > 72 on longs or RSI < 28 on shorts.`,
        `4. OTE, CENTRAL BANK & MACRO HYGIENE (12 pts): Prefer Discount (<50%, OTE 61.8%-78.6%) for LONG and Premium (>50%, OTE 61.8%-78.6%) for SHORT. Weigh live Federal Reserve / BLS / BEA / ECB / Kitco / FXStreet Gold Macro Sentiment & USD News Gate.`,
        `5. ZERO-EMOTION STAND_DOWN RULE: If weighted confluence < ${minScore}/100, price is overextended (>1.85x ATR), chop efficiency is low, or macro wire conflicts sharply, you MUST return decision="STAND_DOWN" instead of forcing a trade.`,
        `6. HARD MATHEMATICAL INVARIANTS (if decision="PROPOSE"):`,
        `   - LONG: stopLoss < entry < tp1 < tp2 | SHORT: stopLoss > entry > tp1 > tp2`,
        `   - R:R |tp1 - entry| / |entry - stopLoss| MUST be >= ${minRr.toFixed(2)}`,
        `   - Stop distance |entry - stopLoss| MUST be >= ${minStop.toFixed(2)} USD and structurally beyond the OB extreme wick.`,
        `   - Anchor Entry strictly to provided OB MT50, FVG CE50, OTE level, or spot ${Number(spotPrice).toFixed(2)}. Never hallucinate numbers.`,
        `Deterministic Payam Brain Snapshot JSON: ${JSON.stringify({
          spotPrice,
          spread,
          timeframe,
          agentConfig: agentConfig
            ? {
                minConfluenceScore: minScore,
                minRrRatio: minRr,
                allowCounterH4Scalps: Boolean(agentConfig.allowCounterH4Scalps),
                maxPortfolioHeatPct: agentConfig.maxPortfolioHeatPct,
              }
            : null,
          circuitBreakers: circuitBreakers
            ? {
                effectiveRiskMultiplier: circuitBreakers.effectiveRiskMultiplier,
                dailyDrawdownPct: circuitBreakers.dailyDrawdownPct,
                openPortfolioHeatPct: circuitBreakers.openPortfolioHeatPct,
                consecutiveLosses: circuitBreakers.consecutiveLosses,
              }
            : null,
          liveMacroNews: {
            macroSentiment: liveNews?.macroSentiment ?? 'NEUTRAL',
            sentimentScore: liveNews?.sentimentScore ?? 0,
            topHeadlines,
          },
          brain: brain
            ? {
                decision: brain.decision,
                convictionGrade: brain.convictionGrade,
                totalScore: brain.totalScore,
                longScore: brain.longScore,
                shortScore: brain.shortScore,
                h4Bias: brain.h4Bias,
                h1Bias: brain.h1Bias,
                killzone: brain.killzone,
                atrExtension: brain.atrExtension,
                kaufmanEfficiency: brain.kaufmanEfficiency,
                goldenConfluence: brain.goldenConfluence,
                sweepDetected: brain.sweepDetected,
                pillars: brain.pillars,
                defenseGates: brain.defenseGates,
                watchlistZone: brain.watchlistZone,
              }
            : null,
          rsi: quant.rsi ? { active: quant.rsi.active, h4: quant.rsi.byTimeframe?.H4, h1: quant.rsi.byTimeframe?.H1, m15: quant.rsi.byTimeframe?.M15, m5: quant.rsi.byTimeframe?.M5 } : null,
          dealingRange: quant.dealingRange,
          regime: quant.regime,
          fvgs: quant.fvgs?.slice(-3),
          orderBlocks: quant.orderBlocks?.slice(-3),
          newsGate: newsGate?.state,
          basis: basisCtx,
        })}`,
      ].join('\n');

      const rawJson = await generateStructuredJson(ai, prompt, {
        type: Type.OBJECT,
        properties: {
          decision: { type: Type.STRING, description: 'PROPOSE or STAND_DOWN' },
          direction: { type: Type.STRING, description: 'LONG or SHORT' },
          setupType: { type: Type.STRING, description: 'Concise institutional setup name (e.g., Golden OB+FVG OTE Retest + H4 Bullish)' },
          entry: { type: Type.NUMBER },
          stopLoss: { type: Type.NUMBER },
          tp1: { type: Type.NUMBER },
          tp2: { type: Type.NUMBER },
          confidence: { type: Type.NUMBER, description: '0.62 to 0.96' },
          rationaleEn: { type: Type.STRING, description: '2 concise sentences explaining H4 bias, OB/FVG/Sweep trigger, RSI regime, and invalidation in English' },
          rationaleFa: { type: Type.STRING, description: '2 concise sentences explaining H4 bias, OB/FVG/Sweep trigger, RSI regime, and invalidation in Persian (Farsi)' },
          standDownReasonEn: { type: Type.STRING, description: 'If STAND_DOWN, why Payam refused to trade' },
          standDownReasonFa: { type: Type.STRING, description: 'If STAND_DOWN, Persian explanation of why Payam stood down' },
          toolsUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['decision', 'direction', 'setupType', 'entry', 'stopLoss', 'tp1', 'tp2', 'confidence', 'rationaleEn', 'rationaleFa', 'toolsUsed'],
      });

      const parsed = JSON.parse(rawJson);
      if (String(parsed.decision).toUpperCase() === 'STAND_DOWN') {
        res.json({
          ok: true,
          decision: 'STAND_DOWN',
          standDownReasonEn: String(parsed.standDownReasonEn || parsed.rationaleEn || brain?.summaryEn || 'Setup did not meet Payam institutional threshold.'),
          standDownReasonFa: String(parsed.standDownReasonFa || parsed.rationaleFa || brain?.summaryFa || 'ستاپ معاملاتی به حد نصاب امتیاز نهادی پیام نرسید.'),
          watchlistZone: brain?.watchlistZone ?? null,
        });
        return;
      }

      const dir = String(parsed.direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
      const guard = validateTradeGuardrails(dir, Number(parsed.entry), Number(parsed.stopLoss), Number(parsed.tp1), Number(parsed.tp2), atr);

      if (!guard.valid) {
        res.status(422).json({
          error: `Agent proposal rejected by System 1 mathematical guardrails: ${guard.errors.join('; ')}`,
          guard,
        });
        return;
      }

      const activeRsi = quant.rsi?.active;
      const rsiSummary = activeRsi
        ? `RSI(14) ${Number(activeRsi.value).toFixed(1)} · ${String(activeRsi.regime).replace('_', ' ')}${activeRsi.divergence !== 'NONE' ? ` · ${String(activeRsi.divergence).replace('_', ' ')}` : ''}`
        : undefined;

      res.json({
        ok: true,
        decision: 'PROPOSE',
        proposal: {
          id: `prop-ai-${Date.now().toString(36)}`,
          direction: dir,
          setupType: String(parsed.setupType || 'Institutional SMC+RSI Confluence'),
          timeframe: timeframe || 'M15',
          entry: Number(Number(parsed.entry).toFixed(2)),
          stopLoss: Number(Number(parsed.stopLoss).toFixed(2)),
          tp1: Number(Number(parsed.tp1).toFixed(2)),
          tp2: Number(Number(parsed.tp2).toFixed(2)),
          rrRatio: guard.rrRatio,
          confidence: Math.max(0.60, Math.min(0.96, Number(parsed.confidence || (brain?.totalScore ? brain.totalScore / 100 : 0.8)))),
          rationaleEn: String(parsed.rationaleEn || ''),
          rationaleFa: String(parsed.rationaleFa || ''),
          toolsUsed: Array.isArray(parsed.toolsUsed) && parsed.toolsUsed.length > 0
            ? parsed.toolsUsed
            : ['h4_macro_compass', 'h1_liquidity_sweep', 'ob_quality_displacement', 'fvg_golden_overlap', 'wilder_rsi14_divergence', 'anti_chase_7gate_shield', 'validate_rr_guardrails'],
          engineSource: 'GEMINI_AGENT',
          status: 'PROPOSED',
          createdAtMs: Date.now(),
          confluenceScore: brain?.totalScore,
          convictionGrade: brain?.convictionGrade,
          h4Bias: brain?.h4Bias,
          rsiSummary,
          recommendedRiskMultiplier: brain?.recommendedRiskMultiplier,
          pillarBreakdown: Array.isArray(brain?.pillars)
            ? brain.pillars.map((p: { label: string; score: number; maxScore: number }) => ({
                label: p.label,
                score: p.score,
                maxScore: p.maxScore,
              }))
            : undefined,
          goldenConfluence: Boolean(brain?.goldenConfluence),
          counterTrendFlag:
            (brain?.h4Bias === 'BULLISH' && dir === 'SHORT') ||
            (brain?.h4Bias === 'BEARISH' && dir === 'LONG'),
        },
      });
    } catch (err) {
      if (isQuotaError(err)) {
        res.status(429).json({
          error: 'Gemini API quota temporarily exhausted. Payam Institutional Brain v3 deterministic engine remains active.',
          code: 'GEMINI_QUOTA_EXHAUSTED',
        });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Gemini agent scan failed';
      res.status(502).json({ error: msg, code: 'UPSTREAM_GEMINI_ERROR' });
    }
  });

  // Server-Side Gemini Multi-Position Broker Monitor Endpoint
  app.post('/api/agent/monitor', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in server Secrets.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    const { spotPrice, positions, quant, newsGate, divergence, basis, liveNews } = req.body ?? {};
    const basisCtx = divergence ?? basis;
    if (!Array.isArray(positions) || positions.length === 0) {
      res.json({ ok: true, reviews: [], updates: [] });
      return;
    }

    try {
      const prompt = [
        `You are Payam, a disciplined institutional XAU/USD position management copilot.`,
        `Review each user-confirmed broker position below against live spot ${Number(spotPrice).toFixed(2)}, 4H Macro Compass, 1H/15M/5M SMC structure, Wilder RSI(14) regime & divergences, Basis Divergence, Live Core Gold News Wire, and USD News Gate.`,
        `Prioritize capital preservation: flag opposing Regular RSI divergence, H4 trend flips, emergency breaking headlines, or impending USD News LOCKOUT immediately.`,
        `Provide specific, professional, actionable trade management advice in both English and concise Persian (Farsi) for each positionId.`,
        `Context: ${JSON.stringify({
          spotPrice,
          positions,
          h4Bias: quant?.brain?.h4Bias,
          brainScore: quant?.brain?.totalScore,
          hardVetoes: quant?.brain?.hardVetoes,
          rsiActive: quant?.rsi?.active,
          rsiH1: quant?.rsi?.byTimeframe?.H1,
          regime: quant?.regime,
          tpi: quant?.tpi,
          newsGate: newsGate?.state,
          macroSentiment: liveNews?.macroSentiment,
          shockHeadline: liveNews?.shockHeadline,
          divergence: basisCtx,
        })}`,
      ].join('\n');

      const rawReviews = await generateStructuredJson(ai, prompt, {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            positionId: { type: Type.STRING },
            urgency: { type: Type.STRING, description: 'NORMAL, ATTENTION, or CRITICAL' },
            actionTag: {
              type: Type.STRING,
              description: 'HOLD_RUNNER, ARM_BE, MOVE_SL_RF, SCALE_PARTIAL, PROTECT_NEWS, or EXIT_WARNING',
            },
            adviceEn: { type: Type.STRING },
            adviceFa: { type: Type.STRING },
          },
          required: ['positionId', 'urgency', 'actionTag', 'adviceEn', 'adviceFa'],
        },
      });

      const reviews = JSON.parse(rawReviews || '[]');
      res.json({ ok: true, reviews, updates: reviews });
    } catch (err) {
      if (isQuotaError(err)) {
        res.status(429).json({
          error: 'Gemini API quota temporarily exhausted; deterministic HSM position monitor active.',
          code: 'GEMINI_QUOTA_EXHAUSTED',
        });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Gemini position monitor failed';
      res.status(502).json({ error: msg, code: 'UPSTREAM_GEMINI_ERROR' });
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
