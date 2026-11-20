import { useState } from 'react';
import {
  AlertOctagon,
  CalendarClock,
  ExternalLink,
  Globe,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import type { NewsSourceTier } from '../engine/types';

type NewsTab = 'calendar' | 'wire' | 'sources';

const TIER_LABEL: Record<NewsSourceTier, string> = {
  CENTRAL_BANK: 'Central Bank',
  MACRO_AGENCY: 'US Macro Data',
  CALENDAR_WIRE: 'Calendar & Wire',
  METALS_INSTITUTIONAL: 'Metals Authority',
};

function formatRelativeTime(tsMs: number): string {
  const diffMin = Math.round((Date.now() - tsMs) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const hrs = Math.round(diffMin / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function NewsTicker() {
  const [tab, setTab] = useState<NewsTab>('calendar');
  const newsEvents = useAurumStore((s) => s.newsEvents);
  const newsGate = useAurumStore((s) => s.newsGate);
  const liveNewsIntel = useAurumStore((s) => s.liveNewsIntel);
  const newsRefreshing = useAurumStore((s) => s.newsRefreshing);
  const setNewsScenario = useAurumStore((s) => s.setNewsScenario);
  const pollLiveNews = useAurumStore((s) => s.pollLiveNews);

  const gateTone =
    newsGate.state === 'LOCKOUT' || liveNewsIntel.shockDetected
      ? 'text-red-400'
      : newsGate.state === 'CAUTION'
        ? 'text-amber-300'
        : 'text-emerald-400';

  const sentimentTone =
    liveNewsIntel.macroSentiment === 'GEOPOLITICAL_SHOCK'
      ? 'text-red-400'
      : liveNewsIntel.macroSentiment === 'BULLISH_GOLD'
        ? 'text-emerald-400'
        : liveNewsIntel.macroSentiment === 'BEARISH_GOLD'
          ? 'text-red-400'
          : 'text-slate-300';

  return (
    <section
      dir="ltr"
      aria-label="Core Gold News and Macro Intelligence Hub"
      data-testid="news-intelligence-hub"
      className="rounded-lg border border-white/8 bg-[#111827] overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-2">
            {newsGate.state === 'LOCKOUT' || liveNewsIntel.shockDetected ? (
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <h2 className="text-sm font-semibold text-slate-100">Core Gold News &amp; Macro Hub</h2>
          </div>

          <span className={`font-mono text-xs font-semibold ${gateTone}`} data-testid="news-gate-state">
            {liveNewsIntel.shockDetected ? 'SHOCK VETO' : newsGate.state} · {(newsGate.lotMultiplier * 100).toFixed(0)}% Lot
          </span>

          <span className="hidden md:inline text-white/15" aria-hidden="true">|</span>

          <span className="font-mono text-[11px] text-slate-400">
            Gold Wire:{' '}
            <strong className={sentimentTone}>
              {liveNewsIntel.macroSentiment.replace('_', ' ')} ({liveNewsIntel.sentimentScore >= 0 ? '+' : ''}
              {liveNewsIntel.sentimentScore})
            </strong>
          </span>

          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {liveNewsIntel.liveSourceCount}/{liveNewsIntel.totalSourceCount} feeds synced
          </span>
        </div>

        {/* Right Controls: Sync + Gate Scenario Tests */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
          <button
            type="button"
            disabled={newsRefreshing}
            onClick={() => void pollLiveNews(true)}
            data-testid="news-sync-btn"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0B0F17] text-[#E5BF70] border border-[#D4A853]/30 hover:border-[#D4A853]/60 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3 h-3 ${newsRefreshing ? 'animate-spin' : ''}`} />
            <span>{newsRefreshing ? 'Syncing...' : 'Sync Feeds'}</span>
          </button>

          <span className="text-white/15 mx-0.5" aria-hidden="true">|</span>

          {(['CLEAR', 'CAUTION', 'LOCKOUT'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setNewsScenario(mode)}
              data-testid={`news-mode-${mode.toLowerCase()}`}
              className={`px-2 py-1 rounded border transition-colors whitespace-nowrap shrink-0 ${
                newsGate.state === mode
                  ? mode === 'LOCKOUT'
                    ? 'bg-red-500/15 border-red-400/50 text-red-300'
                    : mode === 'CAUTION'
                      ? 'bg-amber-500/15 border-amber-400/50 text-amber-300'
                      : 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300'
                  : 'bg-[#0B0F17] border-white/10 text-slate-400 hover:text-slate-200'
              }`}
            >
              {mode === 'CLEAR' ? 'Clear' : mode === 'CAUTION' ? 'Caution' : 'Lockout'}
            </button>
          ))}
        </div>
      </div>

      {/* Emergency Breaking Shock Alert Strip */}
      {liveNewsIntel.shockDetected && liveNewsIntel.shockHeadline && (
        <div
          role="alert"
          className="px-4 py-2 bg-red-500/15 border-b border-red-500/30 flex items-center gap-2 text-xs text-red-200"
        >
          <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
          <span className="font-mono font-semibold uppercase">Emergency Macro Shock Veto:</span>
          <span className="truncate">{liveNewsIntel.shockHeadline}</span>
        </div>
      )}

      {/* Clean Underline Tabs */}
      <div className="px-4 border-b border-white/8 bg-[#0E1420] flex items-center justify-between gap-4">
        <div className="flex items-center gap-5 text-xs font-medium" role="tablist" aria-label="News intelligence views">
          {(
            [
              ['calendar', `USD Calendar (${newsEvents.length})`, CalendarClock],
              ['wire', `Live Gold Wire (${liveNewsIntel.headlines.length})`, Newspaper],
              ['sources', `Core Websites (${liveNewsIntel.totalSourceCount})`, Globe],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              data-testid={`news-tab-${key}`}
              onClick={() => setTab(key)}
              className={`py-2.5 inline-flex items-center gap-1.5 border-b-2 transition-colors whitespace-nowrap ${
                tab === key
                  ? 'border-[#D4A853] text-[#E5BF70]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <span className="hidden sm:inline font-mono text-[11px] text-slate-500">
          {liveNewsIntel.calendarSource === 'FOREX_FACTORY_LIVE'
            ? 'Live ForexFactory JSON + Central Bank RSS'
            : 'Fed · BLS · BEA · ECB · BoE · ForexFactory · FXStreet · Kitco · WGC · CME'}
        </span>
      </div>

      {/* Tab 1: Economic Calendar */}
      {tab === 'calendar' && (
        <div className="divide-y divide-white/6">
          {newsEvents.map((ev) => {
            const mins = Math.round((ev.scheduledAtMs - Date.now()) / 60_000);
            const timeLabel = mins >= 0 ? `T-${mins}m` : `T+${Math.abs(mins)}m`;
            const isActive = newsGate.activeEvent?.id === ev.id && newsGate.state !== 'CLEAR';
            return (
              <div
                key={ev.id}
                className={`px-4 py-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 text-xs ${
                  isActive ? 'bg-red-500/6' : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      ev.impact === 'HIGH' ? 'bg-red-400' : 'bg-amber-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-100 truncate">{ev.title}</div>
                    <div className="font-mono text-[11px] text-slate-400">
                      {ev.currency} · {ev.impact} IMPACT
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                  <span>Fcst {ev.forecast}</span>
                  <span>Prev {ev.previous}</span>
                  <span
                    className={`font-semibold ${
                      ev.impact === 'HIGH' && mins <= 15 && mins >= -30
                        ? 'text-red-400'
                        : mins <= 10 && mins >= -10
                          ? 'text-amber-300'
                          : 'text-slate-200'
                    }`}
                  >
                    {timeLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab 2: Live Gold Wire (Scored RSS Headlines) */}
      {tab === 'wire' && (
        <div className="max-h-[340px] overflow-y-auto divide-y divide-white/6">
          {liveNewsIntel.headlines.length === 0 ? (
            <div className="px-4 py-8 text-center space-y-1.5">
              <p className="text-xs text-slate-300 font-medium">
                No live RSS headlines cached yet in this network session.
              </p>
              <p className="text-[11px] text-slate-500">
                Click <span className="font-mono text-[#E5BF70]">Sync Feeds</span> to poll Federal Reserve, BLS, BEA,
                ECB, BoE, FXStreet, Kitco, CNBC &amp; MarketWatch, or inspect all 14 core websites under{' '}
                <span className="font-mono text-slate-300">Core Websites</span>.
              </p>
            </div>
          ) : (
            liveNewsIntel.headlines.map((item) => {
              const biasColor =
                item.goldBias === 'BULLISH_GOLD'
                  ? 'text-emerald-400'
                  : item.goldBias === 'BEARISH_GOLD'
                    ? 'text-red-400'
                    : 'text-slate-400';
              const biasLabel =
                item.goldBias === 'BULLISH_GOLD'
                  ? 'BULL XAU'
                  : item.goldBias === 'BEARISH_GOLD'
                    ? 'BEAR XAU'
                    : 'NEUTRAL';
              return (
                <div key={item.id} className="px-4 py-2.5 flex items-start justify-between gap-3 text-xs hover:bg-white/[0.02]">
                  <div className="min-w-0 space-y-1">
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-slate-100 hover:text-[#E5BF70] transition-colors inline-flex items-center gap-1.5 leading-snug"
                    >
                      <span>{item.title}</span>
                      <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                    </a>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[11px] text-slate-400">
                      <span className="text-slate-300">{item.sourceName}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(item.publishedAtMs)}</span>
                      {item.matchedDrivers.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-slate-300">{item.matchedDrivers.join(' · ')}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums text-[11px] shrink-0">
                    <div className={`font-semibold ${biasColor}`}>{biasLabel}</div>
                    <div className="text-slate-500">Imp {item.impactScore}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 3: Core Authoritative Gold-Moving Websites Registry (14) */}
      {tab === 'sources' && (
        <div className="max-h-[360px] overflow-y-auto" data-testid="core-news-sources-table">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-[#0E1420] border-b border-white/8 text-[11px] font-mono uppercase text-slate-400">
              <tr>
                <th className="py-2 px-4 font-medium">Authority Source</th>
                <th className="py-2 px-3 font-medium">Category</th>
                <th className="py-2 px-3 font-medium hidden md:table-cell">Price-Moving Focus</th>
                <th className="py-2 px-3 font-medium text-right">Weight</th>
                <th className="py-2 px-4 font-medium text-right">Feed Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {liveNewsIntel.sources.map((src) => {
                const statusColor =
                  src.status === 'ONLINE'
                    ? 'text-emerald-400'
                    : src.status === 'REFERENCE'
                      ? 'text-sky-400'
                      : 'text-slate-500';
                const statusText =
                  src.status === 'ONLINE'
                    ? `${src.feedType === 'JSON_CALENDAR' ? 'LIVE JSON' : 'LIVE RSS'} (${src.headlineCount ?? 0})`
                    : src.feedType === 'PORTAL'
                      ? 'DIRECT PORTAL'
                      : 'STANDBY RSS';
                return (
                  <tr key={src.id} className="hover:bg-white/[0.02]">
                    <td className="py-2 px-4">
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-slate-100 hover:text-[#E5BF70] inline-flex items-center gap-1"
                      >
                        <span>{src.name}</span>
                        <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                      </a>
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                      {TIER_LABEL[src.tier]}
                    </td>
                    <td className="py-2 px-3 text-[11px] text-slate-400 hidden md:table-cell">
                      {src.focus}
                    </td>
                    <td className="py-2 px-3 font-mono tabular-nums text-[11px] text-right text-[#E5BF70] whitespace-nowrap">
                      {src.impactWeight}/10
                    </td>
                    <td className={`py-2 px-4 font-mono tabular-nums text-[11px] text-right whitespace-nowrap ${statusColor}`}>
                      {statusText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
