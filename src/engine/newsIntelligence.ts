import type {
  CoreNewsSource,
  LiveNewsIntelligence,
  NewsEvent,
  ScoredNewsHeadline,
} from './types';

/**
 * Authoritative Core Gold (XAU/USD) Price-Moving Websites Registry (14 Institutional Sources).
 * Covers Tier-1 Central Banks, Official US Macro Data Agencies, Economic Calendars,
 * Real-Time Institutional FX Wires, and Precious Metals Authorities.
 */
export const CORE_GOLD_NEWS_SOURCES: CoreNewsSource[] = [
  {
    id: 'us-fed-press',
    name: 'Federal Reserve Board — All Press Releases',
    shortName: 'US Federal Reserve',
    tier: 'CENTRAL_BANK',
    url: 'https://www.federalreserve.gov/newsevents/pressreleases.htm',
    feedUrl: 'https://www.federalreserve.gov/feeds/press_all.xml',
    feedType: 'RSS',
    impactWeight: 10,
    focus: 'FOMC Rate Decisions, Powell Statements, Balance Sheet & Liquidity',
    status: 'REFERENCE',
  },
  {
    id: 'us-fed-monetary',
    name: 'Federal Reserve — Monetary Policy & H.15 Rates',
    shortName: 'Fed Monetary',
    tier: 'CENTRAL_BANK',
    url: 'https://www.federalreserve.gov/monetarypolicy.htm',
    feedUrl: 'https://www.federalreserve.gov/feeds/monetary.xml',
    feedType: 'RSS',
    impactWeight: 10,
    focus: 'FOMC Minutes, Dot Plot, Real Rate Path & Fed Funds Guidance',
    status: 'REFERENCE',
  },
  {
    id: 'us-bls',
    name: 'U.S. Bureau of Labor Statistics (CPI / NFP / PPI)',
    shortName: 'US BLS (CPI/NFP)',
    tier: 'MACRO_AGENCY',
    url: 'https://www.bls.gov/news.release/',
    feedUrl: 'https://www.bls.gov/feed/bls_latest.rss',
    feedType: 'RSS',
    impactWeight: 10,
    focus: 'Consumer Price Index (CPI), Non-Farm Payrolls (NFP), Unemployment & PPI',
    status: 'REFERENCE',
  },
  {
    id: 'us-bea',
    name: 'U.S. Bureau of Economic Analysis (Core PCE / GDP)',
    shortName: 'US BEA (PCE/GDP)',
    tier: 'MACRO_AGENCY',
    url: 'https://www.bea.gov/news/current-releases',
    feedUrl: 'https://www.bea.gov/rss/news_release.xml',
    feedType: 'RSS',
    impactWeight: 10,
    focus: 'Fed Preferred Core PCE Inflation & Quarterly US GDP Revisions',
    status: 'REFERENCE',
  },
  {
    id: 'ecb-press',
    name: 'European Central Bank (ECB)',
    shortName: 'ECB Press',
    tier: 'CENTRAL_BANK',
    url: 'https://www.ecb.europa.eu/press/html/index.en.html',
    feedUrl: 'https://www.ecb.europa.eu/rss/press.html',
    feedType: 'RSS',
    impactWeight: 9,
    focus: 'EUR/USD DXY Basket Weight (57.6%), Lagarde Speeches & Rate Decisions',
    status: 'REFERENCE',
  },
  {
    id: 'boe-news',
    name: 'Bank of England (BoE)',
    shortName: 'Bank of England',
    tier: 'CENTRAL_BANK',
    url: 'https://www.bankofengland.co.uk/news',
    feedUrl: 'https://www.bankofengland.co.uk/rss/news',
    feedType: 'RSS',
    impactWeight: 8,
    focus: 'London Bullion Session Liquidity, GBP/DXY Spillover & MPC Votes',
    status: 'REFERENCE',
  },
  {
    id: 'forexfactory-cal',
    name: 'Forex Factory / Fair Economy Economic Calendar',
    shortName: 'Forex Factory',
    tier: 'CALENDAR_WIRE',
    url: 'https://www.forexfactory.com/calendar',
    feedUrl: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    feedType: 'JSON_CALENDAR',
    impactWeight: 10,
    focus: 'Live Red/Orange Folder USD Releases (NFP, CPI, FOMC, Jobless Claims)',
    status: 'REFERENCE',
  },
  {
    id: 'fxstreet-wire',
    name: 'FXStreet — Real-Time XAU/USD & Macro Wire',
    shortName: 'FXStreet Gold',
    tier: 'CALENDAR_WIRE',
    url: 'https://www.fxstreet.com/news?q=gold',
    feedUrl: 'https://www.fxstreet.com/rss',
    feedType: 'RSS',
    impactWeight: 9,
    focus: 'Breaking XAU/USD Order Flow, DXY Yield Reaction & Central Bank Alerts',
    status: 'REFERENCE',
  },
  {
    id: 'kitco-gold',
    name: 'Kitco News — Precious Metals & Gold Authority',
    shortName: 'Kitco News',
    tier: 'METALS_INSTITUTIONAL',
    url: 'https://www.kitco.com/news/gold',
    feedUrl: 'https://www.kitco.com/rss/news',
    feedType: 'RSS',
    impactWeight: 9,
    focus: 'Spot Gold Flows, COMEX Positioning, Mining & Institutional Gold Desk Commentary',
    status: 'REFERENCE',
  },
  {
    id: 'cnbc-commodities',
    name: 'CNBC Commodities & Macro Markets',
    shortName: 'CNBC Metals',
    tier: 'METALS_INSTITUTIONAL',
    url: 'https://www.cnbc.com/commodities/',
    feedUrl: 'https://www.cnbc.com/id/15839069/device/rss/rss.html',
    feedType: 'RSS',
    impactWeight: 8,
    focus: 'US Treasury Yields, Oil-Inflation Link, Geopolitical Risk & Safe-Haven Flows',
    status: 'REFERENCE',
  },
  {
    id: 'marketwatch-pulse',
    name: 'MarketWatch — Real-Time Market Pulse',
    shortName: 'MarketWatch',
    tier: 'CALENDAR_WIRE',
    url: 'https://www.marketwatch.com/latest-news',
    feedUrl: 'https://feeds.marketwatch.com/marketwatch/marketpulse/',
    feedType: 'RSS',
    impactWeight: 8,
    focus: 'Breaking US Yield Spikes, Equity Risk-Off Shocks & Dollar Moves',
    status: 'REFERENCE',
  },
  {
    id: 'cme-fedwatch',
    name: 'CME Group — FedWatch Rate Probability Monitor',
    shortName: 'CME FedWatch',
    tier: 'CENTRAL_BANK',
    url: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html',
    feedUrl: null,
    feedType: 'PORTAL',
    impactWeight: 10,
    focus: 'Fed Funds Futures Implied Rate Cut/Hike Odds Driving Real Yields & Gold',
    status: 'REFERENCE',
  },
  {
    id: 'world-gold-council',
    name: 'World Gold Council (GoldHub)',
    shortName: 'World Gold Council',
    tier: 'METALS_INSTITUTIONAL',
    url: 'https://www.gold.org/goldhub/research',
    feedUrl: null,
    feedType: 'PORTAL',
    impactWeight: 9,
    focus: 'Central Bank Physical Gold Reserves, Global ETF Flows & Sovereign Demand',
    status: 'REFERENCE',
  },
  {
    id: 'investing-reuters-macro',
    name: 'Investing.com / Reuters Commodities & InvestingLive',
    shortName: 'Investing / Reuters',
    tier: 'CALENDAR_WIRE',
    url: 'https://www.investing.com/economic-calendar/',
    feedUrl: null,
    feedType: 'PORTAL',
    impactWeight: 9,
    focus: 'Global Geopolitical Breaking Wires, Sovereign Bond Yields & Live Tick Catalysts',
    status: 'REFERENCE',
  },
];

const BULLISH_GOLD_PATTERNS: Array<{ re: RegExp; weight: number; label: string }> = [
  { re: /\b(rate cut|cuts rates|cutting rates|dovish|pivot|easing)\b/i, weight: 28, label: 'Dovish / Rate Cut' },
  { re: /\b(gold (surges|rallies|jumps|hits record|all-time high|climbs|gains)|bullion (rallies|jumps))\b/i, weight: 22, label: 'Gold Momentum' },
  { re: /\b(safe[- ]?haven|flight to safety|geopolitical|missile|airstrike|war escalat|middle east|tariff shock)\b/i, weight: 26, label: 'Safe-Haven / Geopolitics' },
  { re: /\b(yields? (fall|drop|plunge|slide|tumble)|dollar (falls|drops|weakens|slides)|dxy (falls|drops))\b/i, weight: 20, label: 'Yields / DXY Weak' },
  { re: /\b(central bank(s)? buy|gold reserves|pboc gold|etf inflows|stagflation|recession fears?)\b/i, weight: 22, label: 'Sovereign / Macro Bid' },
  { re: /\b(cpi (cools|slows|misses|below)|pce (cools|slows)|unemployment rises|jobless claims (surge|jump|rise))\b/i, weight: 24, label: 'Soft US Data / Cooling Inflation' },
];

const BEARISH_GOLD_PATTERNS: Array<{ re: RegExp; weight: number; label: string }> = [
  { re: /\b(rate hike|hikes rates|hawkish|higher for longer|tightening)\b/i, weight: 28, label: 'Hawkish / Rate Hike' },
  { re: /\b(gold (drops|falls|slumps|slides|tumbles|retreats|sells off)|bullion (falls|slumps))\b/i, weight: 22, label: 'Gold Sell-Off' },
  { re: /\b(yields? (surge|jump|spike|climb|rise)|dollar (surges|rallies|strengthens|jumps)|dxy (surges|rallies))\b/i, weight: 20, label: 'Yields / DXY Surge' },
  { re: /\b(hotter[- ]than[- ]expected|cpi (beats|hot|jumps|surges)|nfp (beats|surges|blowout)|strong payrolls|retail sales beat)\b/i, weight: 24, label: 'Hot US Data' },
  { re: /\b(ceasefire|peace deal|de-escalation|truce reached|risk[- ]on rally)\b/i, weight: 20, label: 'Geopolitical De-escalation' },
];

const GOLD_RELEVANCE_RE =
  /\b(gold|xau|bullion|fed|fomc|powell|cpi|pce|nfp|payroll|inflation|treasury|yield|dollar|dxy|ecb|lagarde|boe|central bank|recession|tariff|geopolitical|missile|war|oil|metal|commodity|commodities|interest rate|gdp|jobless|ppi)\b/i;

const EMERGENCY_SHOCK_RE =
  /\b(emergency rate|unscheduled (fed|fomc)|nuclear strike|missile strike|war declared|invasion begins|bank collapse|bank failure|flash crash|trading halted|sovereign default)\b/i;

function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lightweight deterministic RSS 2.0 & Atom XML headline parser (zero external dependencies).
 */
export function parseRssXmlHeadlines(
  xml: string,
  source: CoreNewsSource,
  maxItems = 8,
  nowMs = Date.now()
): ScoredNewsHeadline[] {
  if (!xml || xml.length < 40) return [];
  const items: ScoredNewsHeadline[] = [];

  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (let i = 0; i < blocks.length && items.length < maxItems * 2; i++) {
    const block = blocks[i];
    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue;
    const title = decodeXmlEntities(titleMatch[1]);
    if (!title || title.length < 10) continue;

    // Prioritize Gold / Macro / Central Bank relevant items (always keep Central Bank / Macro Agency feeds)
    const isDirectMacroFeed = source.tier === 'CENTRAL_BANK' || source.tier === 'MACRO_AGENCY';
    if (!isDirectMacroFeed && !GOLD_RELEVANCE_RE.test(title)) {
      continue;
    }

    const linkTagMatch = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    const linkBodyMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const link = decodeXmlEntities(linkTagMatch?.[1] ?? linkBodyMatch?.[1] ?? source.url) || source.url;

    const dateMatch = block.match(/<(pubDate|published|updated|dc:date)\b[^>]*>([\s\S]*?)<\/\1>/i);
    const parsedTime = dateMatch ? Date.parse(decodeXmlEntities(dateMatch[2])) : NaN;
    const publishedAtMs = Number.isFinite(parsedTime) ? parsedTime : nowMs - i * 600_000;

    items.push(scoreGoldHeadline(title, link, publishedAtMs, source, i));
  }

  return items.slice(0, maxItems);
}

/**
 * Scores an individual financial headline for XAU/USD directional bias, impact (0..100),
 * and Emergency Macro/Geopolitical Shock veto status.
 */
export function scoreGoldHeadline(
  title: string,
  link: string,
  publishedAtMs: number,
  source: CoreNewsSource,
  index = 0
): ScoredNewsHeadline {
  let bullPts = 0;
  let bearPts = 0;
  const matchedDrivers: string[] = [];

  for (const p of BULLISH_GOLD_PATTERNS) {
    if (p.re.test(title)) {
      bullPts += p.weight;
      matchedDrivers.push(`+${p.label}`);
    }
  }
  for (const p of BEARISH_GOLD_PATTERNS) {
    if (p.re.test(title)) {
      bearPts += p.weight;
      matchedDrivers.push(`-${p.label}`);
    }
  }

  const isEmergencyShock = EMERGENCY_SHOCK_RE.test(title);
  if (isEmergencyShock) {
    bullPts += 35;
    matchedDrivers.unshift('EMERGENCY SHOCK');
  }

  const net = bullPts - bearPts;
  const goldBias: ScoredNewsHeadline['goldBias'] =
    net >= 12 ? 'BULLISH_GOLD' : net <= -12 ? 'BEARISH_GOLD' : 'NEUTRAL';

  const baseWeight = source.impactWeight * 5; // 40..50
  const impactScore = Math.min(
    100,
    Math.round(baseWeight + Math.min(45, bullPts + bearPts) + (isEmergencyShock ? 20 : 0))
  );

  return {
    id: `news-${source.id}-${publishedAtMs}-${index}`,
    sourceId: source.id,
    sourceName: source.shortName,
    tier: source.tier,
    title,
    link,
    publishedAtMs,
    goldBias,
    impactScore,
    isEmergencyShock,
    matchedDrivers: matchedDrivers.slice(0, 3),
  };
}

/**
 * Parses ForexFactory / Fair Economy weekly JSON feed into USD High/Medium NewsEvents.
 */
export function parseForexFactoryEvents(raw: unknown, nowMs = Date.now()): NewsEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: NewsEvent[] = [];

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as Record<string, unknown>;
    const country = String(row?.country ?? '').toUpperCase();
    const impactRaw = String(row?.impact ?? '').toUpperCase();
    if (country !== 'USD') continue;
    if (impactRaw !== 'HIGH' && impactRaw !== 'MEDIUM') continue;

    const parsedDate = Date.parse(String(row?.date ?? ''));
    if (!Number.isFinite(parsedDate)) continue;
    // Keep releases from 2 hours ago up to 72 hours ahead
    if (parsedDate < nowMs - 2 * 3600_000 || parsedDate > nowMs + 72 * 3600_000) continue;

    out.push({
      id: `ff-${i}-${parsedDate}`,
      title: String(row?.title ?? 'USD Macro Release').trim(),
      currency: 'USD',
      impact: impactRaw === 'HIGH' ? 'HIGH' : 'MEDIUM',
      scheduledAtMs: parsedDate,
      forecast: String(row?.forecast || '—'),
      previous: String(row?.previous || '—'),
    });
  }

  return out.sort((a, b) => a.scheduledAtMs - b.scheduledAtMs).slice(0, 12);
}

/**
 * Aggregates scored headlines and source health into a deterministic LiveNewsIntelligence snapshot.
 */
export function aggregateNewsIntelligence(params: {
  sources: CoreNewsSource[];
  headlines: ScoredNewsHeadline[];
  calendarEvents: NewsEvent[];
  calendarSource: 'FOREX_FACTORY_LIVE' | 'LOCAL_SCHEDULE';
  fetchedAtMs?: number;
}): LiveNewsIntelligence {
  const fetchedAtMs = params.fetchedAtMs ?? Date.now();
  const sortedHeadlines = [...params.headlines]
    .sort((a, b) => {
      if (a.isEmergencyShock !== b.isEmergencyShock) return a.isEmergencyShock ? -1 : 1;
      return b.publishedAtMs - a.publishedAtMs;
    })
    .slice(0, 24);

  const shockItem = sortedHeadlines.find(
    (h) => h.isEmergencyShock && Math.abs(fetchedAtMs - h.publishedAtMs) <= 6 * 3600_000
  );

  let weightedBiasSum = 0;
  let weightTotal = 0;
  for (const h of sortedHeadlines.slice(0, 14)) {
    const dir = h.goldBias === 'BULLISH_GOLD' ? 1 : h.goldBias === 'BEARISH_GOLD' ? -1 : 0;
    const w = Math.max(10, h.impactScore);
    weightedBiasSum += dir * w;
    weightTotal += w;
  }

  const sentimentScore =
    weightTotal > 0 ? Math.max(-100, Math.min(100, Math.round((weightedBiasSum / weightTotal) * 100))) : 0;

  let macroSentiment: LiveNewsIntelligence['macroSentiment'] = 'NEUTRAL';
  if (shockItem) {
    macroSentiment = 'GEOPOLITICAL_SHOCK';
  } else if (sentimentScore >= 18) {
    macroSentiment = 'BULLISH_GOLD';
  } else if (sentimentScore <= -18) {
    macroSentiment = 'BEARISH_GOLD';
  }

  const liveSourceCount = params.sources.filter((s) => s.status === 'ONLINE' || s.status === 'CACHED').length;

  return {
    fetchedAtMs,
    liveSourceCount,
    totalSourceCount: params.sources.length,
    calendarSource: params.calendarSource,
    macroSentiment,
    sentimentScore,
    shockDetected: Boolean(shockItem),
    shockHeadline: shockItem?.title ?? null,
    headlines: sortedHeadlines,
    sources: params.sources,
    calendarEvents: params.calendarEvents,
  };
}

/**
 * Provides an initial deterministic baseline before the first async `/api/news/live` fetch resolves.
 */
export function buildInitialNewsIntelligence(calendarEvents: NewsEvent[], nowMs = Date.now()): LiveNewsIntelligence {
  return aggregateNewsIntelligence({
    sources: CORE_GOLD_NEWS_SOURCES.map((s) => ({ ...s })),
    headlines: [],
    calendarEvents,
    calendarSource: 'LOCAL_SCHEDULE',
    fetchedAtMs: nowMs,
  });
}
