import { useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { useAurumStore } from './store/useStore';
import { PayamLogo } from './components/PayamLogo';
import { HealthBar } from './components/HealthBar';
import { AgentCommandBar } from './components/AgentCommandBar';
import { SmcChart } from './components/SmcChart';
import { PayamBrainMatrix } from './components/PayamBrainMatrix';
import { ProposalsPanel } from './components/ProposalsPanel';
import { ConfirmedPositionsMonitor } from './components/ConfirmedPositionsMonitor';
import { PositionCard } from './components/PositionCard';
import { AdvisoryPanel } from './components/AdvisoryPanel';
import { NewsTicker } from './components/NewsTicker';
import { VectorViewModal } from './components/VectorViewModal';
import { AgentControlCenter } from './components/AgentControlCenter';
import { Audit18GatesView } from './components/Audit18GatesView';
import { DebCodebaseStudio } from './components/DebCodebaseStudio';

export default function App() {
  const activeTab = useAurumStore((s) => s.activeTab);
  const setActiveTab = useAurumStore((s) => s.setActiveTab);
  const streaming = useAurumStore((s) => s.streaming);
  const feedMode = useAurumStore((s) => s.feedMode);
  const agentEnabled = useAurumStore((s) => s.agentEnabled);
  const applyTickUpdate = useAurumStore((s) => s.applyTickUpdate);
  const hydrateRealCandles = useAurumStore((s) => s.hydrateRealCandles);
  const pollLiveMarket = useAurumStore((s) => s.pollLiveMarket);
  const pollLiveNews = useAurumStore((s) => s.pollLiveNews);
  const runAgentScanCycle = useAurumStore((s) => s.runAgentScanCycle);
  const statusBanner = useAurumStore((s) => s.statusBanner);
  const clearBanner = useAurumStore((s) => s.clearBanner);

  // Initial + periodic real Multi-Timeframe Calibrated XAU/USD Candle Hydration (240 bars/TF)
  useEffect(() => {
    void hydrateRealCandles();
    if (!streaming) return;
    const candleSyncId = window.setInterval(() => {
      void hydrateRealCandles();
    }, 60_000);
    return () => window.clearInterval(candleSyncId);
  }, [streaming, hydrateRealCandles]);

  // Initial + periodic real Interbank Spot + PAXGUSDT live market polling
  useEffect(() => {
    void pollLiveMarket();
    if (!streaming) return;
    const livePollId = window.setInterval(() => {
      void pollLiveMarket();
    }, 3800);
    return () => window.clearInterval(livePollId);
  }, [streaming, pollLiveMarket]);

  // Initial + periodic 14-source Core Gold News & Macro Calendar polling
  useEffect(() => {
    void pollLiveNews();
    if (!streaming) return;
    const newsPollId = window.setInterval(() => {
      void pollLiveNews();
    }, 90_000);
    return () => window.clearInterval(newsPollId);
  }, [streaming, pollLiveNews]);

  // Smooth local micro-tick heartbeat when in replay simulation mode
  useEffect(() => {
    if (!streaming || feedMode === 'LIVE_INTERBANK') return;
    const id = window.setInterval(() => {
      applyTickUpdate();
    }, 1800);
    return () => window.clearInterval(id);
  }, [streaming, feedMode, applyTickUpdate]);

  // Autonomous Payam Agentic Engine periodic scanner while Master Switch is ON
  useEffect(() => {
    if (!agentEnabled) return;
    const scanId = window.setInterval(() => {
      void runAgentScanCycle();
    }, 18_000);
    return () => window.clearInterval(scanId);
  }, [agentEnabled, runAgentScanCycle]);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#0B0F17]/95 backdrop-blur-xs">
        <div className="max-w-[1600px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Unique Payam geometric bullion logo + single-line wordmark */}
          <a
            href="#deck"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('deck');
            }}
            aria-label="Payam XAUUSD Desk Home"
            className="hover:opacity-95 transition-opacity shrink-0"
          >
            <PayamLogo />
          </a>

          {/* Zone 2: Clean single-line text nav links */}
          <nav aria-label="Primary sections" className="flex items-center gap-6 text-sm font-medium">
            {(
              [
                ['deck', 'Command Deck'],
                ['audit', '18-Gate Audit'],
                ['deb', 'Ubuntu .deb Code'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                aria-current={activeTab === key ? 'page' : undefined}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  activeTab === key
                    ? 'text-[#E5BF70] border-[#D4A853]'
                    : 'text-slate-400 border-transparent hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 primary action */}
          <a
            href="/api/deb/download"
            download="payam-xauusd-ubuntu-source.tar.gz"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-[#D4A853] text-slate-950 hover:bg-[#e1b968] transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download .deb Source
          </a>
        </div>
      </header>

      {/* Live Telemetry Bar */}
      <HealthBar />

      {/* Payam Autonomous Agentic Control Bar (Master Switch + Basis Divergence) */}
      <AgentCommandBar />

      {/* Dismissible Action Feedback Banner */}
      {statusBanner && (
        <div
          role="status"
          className="border-b border-[#D4A853]/25 bg-[#D4A853]/10 px-4 lg:px-6 py-2 text-xs text-amber-100"
        >
          <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
            <span className="font-mono">{statusBanner}</span>
            <button
              type="button"
              onClick={clearBanner}
              aria-label="Dismiss notification"
              className="text-amber-200/70 hover:text-amber-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <main className="flex-1">
        {activeTab === 'deck' && (
          <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-5 space-y-4">
            {/* Primary Institutional Row: SMC Chart + Live Confirmed Broker Positions Monitor */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
              <div className="xl:col-span-8 space-y-4">
                <SmcChart />
                <PayamBrainMatrix />
                <ProposalsPanel />
              </div>

              <div className="xl:col-span-4 space-y-4">
                <AdvisoryPanel />
                <ConfirmedPositionsMonitor />
              </div>
            </div>

            {/* Secondary Operational Row: Macroeconomic News Gate + Manual Guardrail Execution Ticket */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
              <div className="xl:col-span-8">
                <NewsTicker />
              </div>
              <div className="xl:col-span-4">
                <PositionCard />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'audit' && <Audit18GatesView />}
        {activeTab === 'deb' && <DebCodebaseStudio />}
      </main>

      <VectorViewModal />
      <AgentControlCenter />
    </div>
  );
}
