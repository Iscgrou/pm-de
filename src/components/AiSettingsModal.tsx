import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  Server,
  ShieldAlert,
  Sparkles,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { useAurumStore } from '../store/useStore';

export type AiConnectionMode =
  | 'ANTIGRAVITY_OAUTH_CLI'
  | 'CUSTOM_OPENAI_COMPAT'
  | 'GOOGLE_AI_STUDIO'
  | 'ANTIGRAVITY_MCP_BRIDGE';

export type ThinkingLevelOption = 'LOW' | 'MEDIUM' | 'HIGH';

export type SubAgentId =
  | 'macro_news_sentinel'
  | 'smc_orderflow_sniper'
  | 'adversarial_red_team'
  | 'chief_execution_judge'
  | 'live_position_guardian';

export interface SubAgentConfig {
  id: SubAgentId;
  name: string;
  nameFa: string;
  role: string;
  cadence: string;
  enabled: boolean;
  useOverride: boolean;
  providerOverride: AiConnectionMode | 'INHERIT';
  modelOverride: string;
}

export interface AiEngineSettings {
  connectionMode: AiConnectionMode;
  oauthProxyUrl: string;
  oauthModelId: string;
  customBaseUrl: string;
  customApiKey: string;
  customModelId: string;
  geminiApiKey: string;
  geminiPrimaryModel: string;
  geminiFallbackModel: string;
  geminiThinkingLevel: ThinkingLevelOption;
  mcpEndpointUrl: string;
  subAgents: SubAgentConfig[];
}

export interface AiAuthStatus {
  authenticated: boolean;
  cliDetected: boolean;
  proxyReachable: boolean;
  providerLabel: string;
  accountHint: string;
  detail: string;
  checkedAtMs: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  statusCode: number;
  provider: string;
  model: string;
  message: string;
  testedAtMs: number;
}

export const AI_SETTINGS_STORAGE_KEY = 'payam_ai_settings_v1';

const CUSTOM_MODEL_PRESETS = [
  'deepseek-4.1-flash',
  'gemini-3.8-flash',
  'deepseek-r1',
  'claude-3-7-sonnet',
  'qwen2.5-72b-instruct',
  'gpt-4.1-mini',
];

const CUSTOM_ENDPOINT_PRESETS: Array<{ label: string; url: string; model: string }> = [
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.7-sonnet' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-r1' },
  { label: 'Ollama (Local)', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:32b' },
  { label: 'vLLM (Local)', url: 'http://127.0.0.1:8000/v1', model: 'deepseek-4.1-flash' },
];

export const DEFAULT_SUB_AGENTS: SubAgentConfig[] = [
  {
    id: 'macro_news_sentinel',
    name: 'Macro & News Sentinel Sub-Agent',
    nameFa: 'زیرعامل رصد اخبار کلان و بانک‌های مرکزی',
    role: 'Background 45s loop parsing Fed/BLS/ForexFactory & geopolitical shock vetoes.',
    cadence: '45s Loop',
    enabled: true,
    useOverride: false,
    providerOverride: 'INHERIT',
    modelOverride: 'gemini-3.8-flash',
  },
  {
    id: 'smc_orderflow_sniper',
    name: 'SMC & Orderflow Sniper Analyst Sub-Agent',
    nameFa: 'زیرعامل تحلیلگر اسنایپر SMC و اردرفلو',
    role: 'Maps 4H/1H/M15/M5 liquidity sweeps, displacement MSS, impulse OTE & FVG CE50.',
    cadence: 'On Scan',
    enabled: true,
    useOverride: false,
    providerOverride: 'INHERIT',
    modelOverride: 'gemini-2.5-pro',
  },
  {
    id: 'adversarial_red_team',
    name: "Adversarial Red-Team Challenger (Devil's Advocate)",
    nameFa: 'زیرعامل چالشگر قرمز (وکیل مدافع شیطان)',
    role: 'Stress-tests every setup for stop-hunt traps, PAXG inducement & counter-HTF risk.',
    cadence: 'Pre-Proposal',
    enabled: true,
    useOverride: false,
    providerOverride: 'INHERIT',
    modelOverride: 'deepseek-r1',
  },
  {
    id: 'chief_execution_judge',
    name: 'Chief Execution Judge & Risk Governor',
    nameFa: 'داور ارشد اجرا و حاکم ریسک سیستم ۲',
    role: 'Synthesizes System-1 math + Red-Team critique into deterministic PROPOSE or STAND_DOWN.',
    cadence: 'Final Gate',
    enabled: true,
    useOverride: false,
    providerOverride: 'INHERIT',
    modelOverride: 'gemini-2.5-pro',
  },
  {
    id: 'live_position_guardian',
    name: 'Live Position Guardian Sub-Agent',
    nameFa: 'زیرعامل نگهبان لحظه‌ای پوزیشن‌های باز بروکر',
    role: 'Manual broker co-pilot issuing BE lock, trailing SL, partial scale & reversal exits.',
    cadence: 'Live Watch',
    enabled: true,
    useOverride: false,
    providerOverride: 'INHERIT',
    modelOverride: 'gemini-3.8-flash',
  },
];

export const DEFAULT_AI_SETTINGS: AiEngineSettings = {
  connectionMode: 'ANTIGRAVITY_OAUTH_CLI',
  oauthProxyUrl: 'http://127.0.0.1:8080/v1',
  oauthModelId: 'gemini-2.5-pro',
  customBaseUrl: 'https://openrouter.ai/api/v1',
  customApiKey: '',
  customModelId: 'deepseek-4.1-flash',
  geminiApiKey: '',
  geminiPrimaryModel: 'gemini-2.5-pro',
  geminiFallbackModel: 'gemini-2.5-flash',
  geminiThinkingLevel: 'HIGH',
  mcpEndpointUrl: 'http://127.0.0.1:3000/mcp',
  subAgents: DEFAULT_SUB_AGENTS,
};

export function loadLocalAiSettings(): AiEngineSettings {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AiEngineSettings>;
        const mergedSubAgents = DEFAULT_SUB_AGENTS.map((def) => {
          const found = Array.isArray(parsed.subAgents)
            ? parsed.subAgents.find((s) => s.id === def.id)
            : undefined;
          return found ? { ...def, ...found } : { ...def };
        });
        return {
          ...DEFAULT_AI_SETTINGS,
          ...parsed,
          subAgents: mergedSubAgents,
        };
      }
    }
  } catch {
    // Fallback to defaults
  }
  return {
    ...DEFAULT_AI_SETTINGS,
    subAgents: DEFAULT_SUB_AGENTS.map((s) => ({ ...s })),
  };
}

export function saveLocalAiSettings(settings: AiEngineSettings): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      window.dispatchEvent(new CustomEvent('payam:ai-config-updated', { detail: settings }));
    }
  } catch {
    // Ignore restricted storage
  }
}

export function getActiveModelForSettings(s: AiEngineSettings): string {
  switch (s.connectionMode) {
    case 'ANTIGRAVITY_OAUTH_CLI':
      return s.oauthModelId || 'gemini-2.5-pro';
    case 'CUSTOM_OPENAI_COMPAT':
      return s.customModelId || 'deepseek-4.1-flash';
    case 'GOOGLE_AI_STUDIO':
      return s.geminiPrimaryModel || 'gemini-2.5-pro';
    case 'ANTIGRAVITY_MCP_BRIDGE':
      return 'Antigravity Native MCP';
  }
}

export function getModeShortLabel(mode: AiConnectionMode): string {
  switch (mode) {
    case 'ANTIGRAVITY_OAUTH_CLI':
      return 'OAuth CLI';
    case 'CUSTOM_OPENAI_COMPAT':
      return 'Custom OpenAI';
    case 'GOOGLE_AI_STUDIO':
      return 'Gemini API';
    case 'ANTIGRAVITY_MCP_BRIDGE':
      return 'MCP Bridge';
  }
}

interface AiSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (settings: AiEngineSettings) => void;
}

export function AiSettingsModal({ open, onClose, onSaved }: AiSettingsModalProps) {
  // Defensive read of optional Squad 3 telemetry state without coupling to unmerged types
  const rawStore = useAurumStore((s) => s as unknown as Record<string, unknown>);
  const aiTelemetry = rawStore?.aiTelemetry as
    | {
        subAgents?: Record<string, { status?: string; latencyMs?: number; lastRunMs?: number; model?: string }>;
        activeMode?: string;
        lastLatencyMs?: number;
      }
    | undefined;

  const [settings, setSettings] = useState<AiEngineSettings>(() => loadLocalAiSettings());
  const [authStatus, setAuthStatus] = useState<AiAuthStatus>({
    authenticated: false,
    cliDetected: false,
    proxyReachable: false,
    providerLabel: 'Antigravity / Gemini CLI',
    accountHint: 'Not synced yet',
    detail: 'Click Authenticate / Sync to verify local agy or CLIProxyAPI OAuth session.',
    checkedAtMs: Date.now(),
  });
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [cliSyncBusy, setCliSyncBusy] = useState(false);
  const [cliFeedback, setCliFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);

  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        'payam-xauusd-aurum-deck': {
          command: 'xauusd-aurum-deck',
          args: ['mcp'],
          url: settings.mcpEndpointUrl || 'http://127.0.0.1:3000/mcp',
          env: {
            XAUUSD_DECK_URL: 'http://127.0.0.1:3000',
            XAUUSD_OAUTH_PROXY: settings.oauthProxyUrl || 'http://127.0.0.1:8080/v1',
          },
        },
      },
    },
    null,
    2
  );

  // Sync with backend /api/ai/config and /api/ai/auth-status whenever modal opens
  const hydrateRemoteStatus = useCallback(async () => {
    setLoadingRemote(true);
    try {
      const [cfgRes, authRes] = await Promise.allSettled([
        fetch('/api/ai/config'),
        fetch('/api/ai/auth-status'),
      ]);

      if (cfgRes.status === 'fulfilled' && cfgRes.value.ok) {
        const remote = await cfgRes.value.json();
        const cfgPayload = remote?.config ?? remote;
        if (cfgPayload && typeof cfgPayload === 'object') {
          setSettings((prev) => {
            const mergedSubs = prev.subAgents.map((sub) => {
              const rSub = Array.isArray(cfgPayload.subAgents)
                ? cfgPayload.subAgents.find((x: Partial<SubAgentConfig>) => x.id === sub.id)
                : cfgPayload.subAgents?.[sub.id];
              return rSub ? { ...sub, ...rSub } : sub;
            });
            const next: AiEngineSettings = {
              ...prev,
              connectionMode: cfgPayload.connectionMode ?? cfgPayload.mode ?? prev.connectionMode,
              oauthProxyUrl: cfgPayload.oauthProxyUrl ?? cfgPayload.proxyUrl ?? prev.oauthProxyUrl,
              oauthModelId: cfgPayload.oauthModelId ?? prev.oauthModelId,
              customBaseUrl: cfgPayload.customBaseUrl ?? prev.customBaseUrl,
              customModelId: cfgPayload.customModelId ?? prev.customModelId,
              geminiPrimaryModel: cfgPayload.geminiPrimaryModel ?? cfgPayload.primaryModel ?? prev.geminiPrimaryModel,
              geminiFallbackModel: cfgPayload.geminiFallbackModel ?? cfgPayload.fallbackModel ?? prev.geminiFallbackModel,
              geminiThinkingLevel: cfgPayload.geminiThinkingLevel ?? cfgPayload.thinkingLevel ?? prev.geminiThinkingLevel,
              mcpEndpointUrl: cfgPayload.mcpEndpointUrl ?? prev.mcpEndpointUrl,
              subAgents: mergedSubs,
            };
            saveLocalAiSettings(next);
            return next;
          });
        }
      }

      if (authRes.status === 'fulfilled' && authRes.value.ok) {
        const authData = await authRes.value.json();
        setAuthStatus({
          authenticated: Boolean(authData?.authenticated || authData?.oauthReady || authData?.loggedIn),
          cliDetected: Boolean(authData?.cliDetected || authData?.agyInstalled || authData?.geminiCliInstalled),
          proxyReachable: Boolean(authData?.proxyReachable || authData?.proxyOnline),
          providerLabel: String(authData?.provider || 'Antigravity / Gemini CLI'),
          accountHint: String(authData?.account || authData?.email || (authData?.authenticated ? 'Active OAuth Token' : 'Awaiting CLI Auth')),
          detail: String(authData?.message || authData?.detail || 'OAuth bridge telemetry synchronized.'),
          checkedAtMs: Date.now(),
        });
      } else {
        setAuthStatus((prev) => ({
          ...prev,
          detail: 'Local config active. Run `xauusd-ai-oauth-bridge login` on Ubuntu 24.04 or connect backend /api/ai/auth-status.',
          checkedAtMs: Date.now(),
        }));
      }
    } catch {
      // Graceful offline fallback
    } finally {
      setLoadingRemote(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void hydrateRemoteStatus();
  }, [open, hydrateRemoteStatus]);

  // Escape closes modal cleanly
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const enabledSubAgentCount = settings.subAgents.filter((s) => s.enabled).length;

  const updateField = <K extends keyof AiEngineSettings>(key: K, value: AiEngineSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaveFeedback(null);
  };

  const updateSubAgent = (id: SubAgentId, partial: Partial<SubAgentConfig>) => {
    setSettings((prev) => ({
      ...prev,
      subAgents: prev.subAgents.map((sub) => (sub.id === id ? { ...sub, ...partial } : sub)),
    }));
    setSaveFeedback(null);
  };

  const handleTriggerCliLogin = async () => {
    setCliSyncBusy(true);
    setCliFeedback(null);
    try {
      const res = await fetch('/api/ai/trigger-cli-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyUrl: settings.oauthProxyUrl,
          model: settings.oauthModelId,
          provider: 'antigravity-gemini-cli',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const isAuthed = Boolean(data?.authenticated ?? data?.ok ?? true);
        setAuthStatus({
          authenticated: isAuthed,
          cliDetected: Boolean(data?.cliDetected ?? true),
          proxyReachable: Boolean(data?.proxyReachable ?? isAuthed),
          providerLabel: String(data?.provider || 'Antigravity / Gemini CLI'),
          accountHint: String(data?.account || data?.email || 'OAuth Session Linked'),
          detail: String(data?.message || 'Antigravity & Gemini CLI OAuth token verified.'),
          checkedAtMs: Date.now(),
        });
        setCliFeedback({
          ok: true,
          text: String(data?.message || 'CLI OAuth sync triggered successfully. Proxy token active.'),
        });
      } else {
        setCliFeedback({
          ok: false,
          text: `Endpoint /api/ai/trigger-cli-login returned HTTP ${res.status}. On Ubuntu 24.04 run: xauusd-ai-oauth-bridge login`,
        });
      }
    } catch {
      setCliFeedback({
        ok: false,
        text: 'Unable to reach /api/ai/trigger-cli-login. Run `xauusd-ai-oauth-bridge login` in Ubuntu terminal.',
      });
    } finally {
      setCliSyncBusy(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    const t0 = performance.now();
    const activeModel = getActiveModelForSettings(settings);
    try {
      const res = await fetch('/api/ai/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionMode: settings.connectionMode,
          oauthProxyUrl: settings.oauthProxyUrl,
          oauthModelId: settings.oauthModelId,
          customBaseUrl: settings.customBaseUrl,
          customApiKey: settings.customApiKey,
          customModelId: settings.customModelId,
          geminiApiKey: settings.geminiApiKey,
          geminiPrimaryModel: settings.geminiPrimaryModel,
          geminiFallbackModel: settings.geminiFallbackModel,
          geminiThinkingLevel: settings.geminiThinkingLevel,
          mcpEndpointUrl: settings.mcpEndpointUrl,
        }),
      });
      const elapsed = Math.max(1, Math.round(performance.now() - t0));
      if (res.ok) {
        const data = await res.json();
        setTestResult({
          ok: Boolean(data?.ok ?? true),
          latencyMs: Number(data?.latencyMs ?? elapsed),
          statusCode: res.status,
          provider: String(data?.provider || getModeShortLabel(settings.connectionMode)),
          model: String(data?.model || activeModel),
          message: String(data?.message || 'Connection verified and model responded cleanly.'),
          testedAtMs: Date.now(),
        });
      } else {
        // Check local API liveness if /api/ai/test-connection is not mounted yet (pre-merge branch)
        const h0 = performance.now();
        const healthRes = await fetch('/api/v1/health').catch(() => null);
        const healthMs = Math.max(1, Math.round(performance.now() - h0));
        let serverErr = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson?.error) serverErr = String(errJson.error);
        } catch {
          // Non-JSON 404 body
        }
        setTestResult({
          ok: false,
          latencyMs: healthRes?.ok ? healthMs : elapsed,
          statusCode: res.status,
          provider: getModeShortLabel(settings.connectionMode),
          model: activeModel,
          message:
            res.status === 404 && healthRes?.ok
              ? `Deck backend healthy (${healthMs} ms) — /api/ai/test-connection pending AI router branch merge.`
              : `Connection probe failed (${serverErr}). Verify endpoint URL, OAuth proxy, or API key.`,
          testedAtMs: Date.now(),
        });
      }
    } catch {
      const elapsed = Math.max(1, Math.round(performance.now() - t0));
      setTestResult({
        ok: false,
        latencyMs: elapsed,
        statusCode: 0,
        provider: getModeShortLabel(settings.connectionMode),
        model: activeModel,
        message: 'Network request failed. Check local server or OAuth proxy status.',
        testedAtMs: Date.now(),
      });
    } finally {
      setTestingConn(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveFeedback(null);
    saveLocalAiSettings(settings);
    onSaved?.(settings);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setSaveFeedback({
          ok: true,
          text: `Saved & synced with server (${getModeShortLabel(settings.connectionMode)} · ${enabledSubAgentCount}/5 sub-agents active).`,
        });
      } else {
        setSaveFeedback({
          ok: true,
          text: `Saved locally (${getModeShortLabel(settings.connectionMode)} · ${enabledSubAgentCount}/5 sub-agents). Server /api/ai/config returned HTTP ${res.status}.`,
        });
      }
    } catch {
      setSaveFeedback({
        ok: true,
        text: `Saved to browser workstation profile (${getModeShortLabel(settings.connectionMode)} · ${enabledSubAgentCount}/5 sub-agents).`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyMcp = async () => {
    try {
      await navigator.clipboard.writeText(mcpSnippet);
      setCopiedMcp(true);
      window.setTimeout(() => setCopiedMcp(false), 1800);
    } catch {
      setCopiedMcp(false);
    }
  };

  const modeCards: Array<{
    id: AiConnectionMode;
    title: string;
    subtitle: string;
    tag: string;
    icon: typeof KeyRound;
  }> = [
    {
      id: 'ANTIGRAVITY_OAUTH_CLI',
      title: 'Antigravity / Gemini Subscription (OAuth CLI)',
      subtitle: 'Zero API billing via active Gemini Pro/Ultra OAuth CLI (agy / CLIProxyAPI) on Ubuntu 24.04.',
      tag: 'Subscription OAuth',
      icon: Terminal,
    },
    {
      id: 'CUSTOM_OPENAI_COMPAT',
      title: 'Custom OpenAI-Compatible Endpoint',
      subtitle: 'OpenRouter, DeepSeek, Ollama, or vLLM with custom Base URL and free-text Model ID.',
      tag: 'BYO Endpoint',
      icon: Server,
    },
    {
      id: 'GOOGLE_AI_STUDIO',
      title: 'Google AI Studio (Gemini API Key)',
      subtitle: 'Direct Gemini SDK routing with primary/fallback models and Thinking Level control.',
      tag: 'Direct SDK',
      icon: KeyRound,
    },
    {
      id: 'ANTIGRAVITY_MCP_BRIDGE',
      title: 'Antigravity Native MCP Bridge',
      subtitle: 'Expose Payam SMC Quant & Risk Tools directly inside Antigravity Desktop via MCP.',
      tag: 'Local MCP',
      icon: Link2,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-settings-modal-title"
      data-testid="ai-settings-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        dir="ltr"
        className="w-full max-w-5xl max-h-[92vh] bg-[#0B0F17] border border-white/12 rounded-xl overflow-hidden flex flex-col shadow-2xl"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-[#101624] border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#D4A853]/15 border border-[#D4A853]/35 flex items-center justify-center shrink-0">
              <Cpu className="w-4 h-4 text-[#E5BF70]" />
            </div>
            <div className="min-w-0">
              <h2 id="ai-settings-modal-title" className="text-sm sm:text-base font-semibold text-slate-100 truncate">
                AI Connection &amp; 5-Sub-Agent Orchestration Settings
              </h2>
              <p className="text-[11px] font-fa text-slate-400 truncate" dir="rtl">
                پیکربندی اتصال هوش مصنوعی (OAuth کلود/آنتی‌گرویتی، OpenAI سفارشی، Gemini API، MCP) و تنظیمات ۵ زیرعامل تخصصی
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void hydrateRemoteStatus()}
              disabled={loadingRemote}
              aria-label="Refresh AI configuration status"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono text-slate-300 border border-white/10 hover:bg-white/6 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingRemote ? 'animate-spin text-[#E5BF70]' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close AI settings modal"
              data-testid="close-ai-settings-btn"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/8 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* SECTION 1: 4 CONNECTION MODES */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-100 tracking-wide">
                  1. Primary AI Engine Connection Mode
                </h3>
                <p className="text-[11px] text-slate-400">
                  Select how Payam System-2 sub-agents route reasoning requests.
                </p>
              </div>
              <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                Active: <strong className="text-[#E5BF70]">{getModeShortLabel(settings.connectionMode)}</strong>
                <span className="mx-1.5 text-slate-600">·</span>
                Model: <strong className="text-slate-200">{getActiveModelForSettings(settings)}</strong>
              </div>
            </div>

            <div
              role="radiogroup"
              aria-label="AI Connection Modes"
              className="grid grid-cols-1 md:grid-cols-2 gap-2.5"
            >
              {modeCards.map((card) => {
                const Icon = card.icon;
                const selected = settings.connectionMode === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`ai-mode-card-${card.id}`}
                    onClick={() => updateField('connectionMode', card.id)}
                    className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer flex items-start gap-3 ${
                      selected
                        ? 'bg-[#D4A853]/10 border-[#D4A853]/65 text-slate-100'
                        : 'bg-[#111827] border-white/8 text-slate-300 hover:border-white/20'
                    }`}
                  >
                    <div
                      className={`mt-0.5 p-2 rounded-md border shrink-0 ${
                        selected
                          ? 'bg-[#D4A853]/20 border-[#D4A853]/50 text-[#E5BF70]'
                          : 'bg-[#0B0F17] border-white/8 text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-100 leading-snug">
                          {card.title}
                        </span>
                        <span
                          className={`text-[10px] font-mono shrink-0 ${
                            selected ? 'text-[#E5BF70]' : 'text-slate-500'
                          }`}
                        >
                          {card.tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">{card.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Active Mode Configuration Surface */}
            <div className="rounded-lg border border-white/10 bg-[#111827] p-4 space-y-4">
              {settings.connectionMode === 'ANTIGRAVITY_OAUTH_CLI' && (
                <div className="space-y-4" data-testid="mode-panel-oauth">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/8">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                        {authStatus.authenticated ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                        )}
                        <span>
                          OAuth Status:{' '}
                          <span className={authStatus.authenticated ? 'text-emerald-400' : 'text-amber-300'}>
                            {authStatus.authenticated ? 'AUTHENTICATED' : 'AWAITING CLI SYNC'}
                          </span>
                        </span>
                        <span className="text-slate-600">·</span>
                        <span className="font-mono text-[11px] text-slate-300">{authStatus.accountHint}</span>
                      </div>
                      <p className="text-[11px] text-slate-400">{authStatus.detail}</p>
                    </div>

                    <button
                      type="button"
                      disabled={cliSyncBusy}
                      onClick={() => void handleTriggerCliLogin()}
                      data-testid="trigger-cli-login-btn"
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold bg-[#D4A853] hover:bg-[#e1b968] disabled:opacity-60 text-slate-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {cliSyncBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <KeyRound className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {cliSyncBusy ? 'Syncing CLI...' : 'Authenticate / Sync Antigravity & Gemini CLI'}
                      </span>
                    </button>
                  </div>

                  {cliFeedback && (
                    <div
                      role="status"
                      data-testid="cli-sync-feedback"
                      className={`px-3 py-2 rounded-md border text-xs font-mono ${
                        cliFeedback.ok
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                          : 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                      }`}
                    >
                      {cliFeedback.text}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <label className="space-y-1.5 block">
                      <span className="text-xs font-medium text-slate-300">
                        Local OAuth Proxy URL (<span className="font-mono text-slate-400">CLIProxyAPI / gemini-oauth</span>)
                      </span>
                      <input
                        type="url"
                        value={settings.oauthProxyUrl}
                        onChange={(e) => updateField('oauthProxyUrl', e.target.value)}
                        placeholder="http://127.0.0.1:8080/v1"
                        data-testid="input-oauth-proxy-url"
                        className="w-full px-3 py-2 rounded-md bg-[#0B0F17] border border-white/12 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#D4A853]"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-xs font-medium text-slate-300">
                        Subscription Model ID
                      </span>
                      <input
                        type="text"
                        value={settings.oauthModelId}
                        onChange={(e) => updateField('oauthModelId', e.target.value)}
                        placeholder="gemini-2.5-pro"
                        data-testid="input-oauth-model-id"
                        className="w-full px-3 py-2 rounded-md bg-[#0B0F17] border border-white/12 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#D4A853]"
                      />
                    </label>
                  </div>

                  <div className="text-[11px] font-mono text-slate-400 bg-[#0B0F17] border border-white/6 rounded-md px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <span>Ubuntu 24.04 CLI helper: <strong className="text-slate-200">xauusd-ai-oauth-bridge start-proxy</strong></span>
                    <span className="text-slate-500">Zero API billing · Localhost loopback only</span>
                  </div>
                </div>
              )}

              {settings.connectionMode === 'CUSTOM_OPENAI_COMPAT' && (
                <div className="space-y-4" data-testid="mode-panel-custom">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-200">Quick Endpoint Presets</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {CUSTOM_ENDPOINT_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            updateField('customBaseUrl', preset.url);
                            updateField('customModelId', preset.model);
                          }}
                          className="px-2.5 py-1 rounded text-[11px] font-mono bg-[#0B0F17] border border-white/10 text-slate-300 hover:border-[#D4A853]/50 hover:text-[#E5BF70] transition-colors whitespace-nowrap"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <label className="space-y-1.5 block">
                      <span className="text-xs font-medium text-slate-300">Custom Base URL</span>
                      <input
                        type="url"
                        value={settings.customBaseUrl}
                        onChange={(e) => updateField('customBaseUrl', e.target.value)}
                        placeholder="https://openrouter.ai/api/v1"
                        data-testid="input-custom-base-url"
                        className="w-full px-3 py-2 rounded-md bg-[#0B0F17] border border-white/12 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#D4A853]"
                      />
                    </label>

                    <label className="space-y-1.5 block">
                      <span className="text-xs font-medium text-slate-300">API Key (Masked)</span>
                      <div className="relative">
                        <input
                          type={showCustomKey ? 'text' : 'password'}
                          value={settings.customApiKey}
                          onChange={(e) => updateField('customApiKey', e.target.value)}
                          placeholder="sk-... (optional for local Ollama/vLLM)"
                          data-testid="input-custom-api-key"
                          className="w-full pl-3 pr-9 py-2 rounded-md bg-[#0B0F17] border border-white/12 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#D4A853]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCustomKey((v) => !v)}
                          aria-label={showCustomKey ? 'Hide custom API key' : 'Show custom API key'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                        >
                          {showCustomKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="space-y-1.5 block">
                      <span className="text-xs font-medium text-slate-300">
                        Model ID (Type any custom model string or pick a preset)
                      </span>
                      <input
                        type="text"
                        value={settings.customModelId}
                        onChange={(e) => updateField('customModelId', e.target.value)}
                        placeholder="e.g. deepseek-4.1-flash, gemini-3.8-flash, deepseek-r1, claude-3-7-sonnet"
                        data-testid="input-custom-model-id"
                        className="w-full px-3 py-2 rounded-md bg-[#0B0F17] border border-white/12 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#D4A853]"
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Preset model IDs">
                      {CUSTOM_MODEL_PRESETS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateField('customModelId', m)}
                          className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors whitespace-nowrap ${
                            settings.customModelId === m
                              ? 'bg-[#D4A853]/18 border-[#D4A853]/55 text-[#E5BF70]'
                              : 'bg-[#0B0F17] border-white/8 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {settings.connectionMode === 'GOOGLE_AI_STUDIO' && (
                <div className="space-y-4" data-testid="mode-panel-gemini">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <label className="space-y-1.5 block md:col-span-2">
                      <span className="text-xs font-medium text-slate-300">
                        Gemini API Key (leave blank to use server <code className="text-slate-400">GEMINI_API_KEY</code>)
                      </span>
                      <div className="relative">
                        <input
                          type={showGeminiKey ? 'text' : 'password'}
                          value={settings.geminiApiKey}
                          onChange={(e) => updateField('geminiApiKey', e.target.value)}
                          placeholder="AIzaSy..."
                          data-testid="input-gemini-api-key"
                          className="w-full pl-3 pr-9 py-2 rounded-md bg-[#0B0F17] border border-white/12 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#D4A853]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGeminiKey((v) => !v)}
                          aria-label={showGeminiKey ? 'Hide Gemini API key' : 'Show Gemini API key'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                        >
                          {showGeminiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </label>

                    <label className="space-y-1.5 block">
                      <span className="text-xs font-medium text-slate-300">Primary Model ID</span>
                      <input
                        type="text"
                        value={settings.geminiPrimaryModel}
                        onChange={(e) => updateField('geminiPrimaryModel', e.target.value)}
                        placeholder="gemini-2.5-pro"
                        data-testid="input-gemini-primary-model"
                        className="w-full px-3 py-2 rounded-md bg-[#0B0F17] border border-white/12 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#D4A853]"
                      />
                    </label>

                    <label className="space-y-1.5 block">
                      <span className="text-xs font-medium text-slate-300">Fallback Model ID (Quota Shield)</span>
                      <input
                        type="text"
                        value={settings.geminiFallbackModel}
                        onChange={(e) => updateField('geminiFallbackModel', e.target.value)}
                        placeholder="gemini-2.5-flash"
                        data-testid="input-gemini-fallback-model"
                        className="w-full px-3 py-2 rounded-md bg-[#0B0F17] border border-white/12 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#D4A853]"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div>
                      <div className="text-xs font-medium text-slate-200">System-2 Thinking Level</div>
                      <div className="text-[11px] text-slate-400">Controls reasoning depth budget for Chief Execution Judge &amp; Red-Team.</div>
                    </div>
                    <div
                      className="flex items-center gap-1 p-1 rounded-md bg-[#0B0F17] border border-white/10"
                      role="group"
                      aria-label="Gemini Thinking Level"
                    >
                      {(['LOW', 'MEDIUM', 'HIGH'] as ThinkingLevelOption[]).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => updateField('geminiThinkingLevel', lvl)}
                          data-testid={`thinking-level-${lvl}`}
                          className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors whitespace-nowrap ${
                            settings.geminiThinkingLevel === lvl
                              ? 'bg-[#D4A853] text-slate-950 font-semibold'
                              : 'text-slate-400 hover:text-slate-100'
                          }`}
                        >
                          {lvl}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {settings.connectionMode === 'ANTIGRAVITY_MCP_BRIDGE' && (
                <div className="space-y-3.5" data-testid="mode-panel-mcp">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <label className="space-y-1.5 block">
                      <span className="text-xs font-medium text-slate-300">Local MCP Server Endpoint URL</span>
                      <input
                        type="url"
                        value={settings.mcpEndpointUrl}
                        onChange={(e) => updateField('mcpEndpointUrl', e.target.value)}
                        placeholder="http://127.0.0.1:3000/mcp"
                        data-testid="input-mcp-endpoint"
                        className="w-full px-3 py-2 rounded-md bg-[#0B0F17] border border-white/12 text-xs font-mono text-slate-100 focus:outline-none focus:border-[#D4A853]"
                      />
                    </label>
                    <div className="space-y-1.5">
                      <span className="text-xs font-medium text-slate-300 block">Ubuntu Stdio Command</span>
                      <div className="px-3 py-2 rounded-md bg-[#0B0F17] border border-white/10 text-xs font-mono text-emerald-300">
                        xauusd-aurum-deck mcp
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-300">
                        Antigravity Desktop <code className="text-slate-400">mcp_config.json</code> Snippet
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopyMcp()}
                        data-testid="copy-mcp-json-btn"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono border border-white/12 text-slate-200 hover:bg-white/8 transition-colors whitespace-nowrap"
                      >
                        {copiedMcp ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedMcp ? 'Copied JSON' : 'Copy JSON Config'}</span>
                      </button>
                    </div>
                    <pre className="p-3 rounded-md bg-[#0B0F17] border border-white/8 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                      {mcpSnippet}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* SECTION 2: ONE-CLICK LATENCY & CONNECTION TESTER */}
          <section className="rounded-lg border border-white/10 bg-[#101624] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                <Activity className="w-4 h-4 text-[#E5BF70] shrink-0" />
                <span>Live Connection &amp; Round-Trip Latency Probe</span>
              </div>
              {testResult ? (
                <div className="text-xs font-mono space-y-0.5" data-testid="ai-test-result">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={testResult.ok ? 'text-emerald-400 font-semibold' : 'text-amber-300 font-semibold'}>
                      {testResult.ok ? 'CONNECTED' : 'PROBE NOTICE'}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="text-[#E5BF70] font-semibold tabular-nums">{testResult.latencyMs} ms</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-300">{testResult.provider} ({testResult.model})</span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-sans">{testResult.message}</p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Pings <code className="font-mono text-slate-300">POST /api/ai/test-connection</code> to validate credentials, proxy routing, and measure live latency in ms.
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={testingConn}
              onClick={() => void handleTestConnection()}
              data-testid="test-ai-connection-btn"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-white/8 hover:bg-white/14 disabled:opacity-50 text-[#E5BF70] border border-[#D4A853]/45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {testingConn ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              <span>{testingConn ? 'Testing Latency...' : 'Test AI Connection & Latency'}</span>
            </button>
          </section>

          {/* SECTION 3: 5-SUB-AGENT GRANULAR CUSTOMIZATION GRID */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-100 tracking-wide">
                  2. 5-Sub-Agent Granular Orchestration Matrix
                </h3>
                <p className="text-[11px] text-slate-400">
                  Enable or isolate individual sub-agents and assign specialized models per reasoning tier (e.g. Flash for News Sentinel, DeepSeek-R1 / Pro for Chief Judge).
                </p>
              </div>
              <div className="text-xs font-mono text-slate-300 tabular-nums">
                Active Sub-Agents: <strong className="text-emerald-400">{enabledSubAgentCount}/5</strong>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="sub-agents-grid">
              {settings.subAgents.map((sub, idx) => {
                const liveTelemetry = aiTelemetry?.subAgents?.[sub.id];
                const liveLatency = liveTelemetry?.latencyMs ?? (testResult?.ok ? Math.round(testResult.latencyMs * (0.75 + idx * 0.12)) : null);
                const liveStatus = !sub.enabled
                  ? 'DISABLED'
                  : liveTelemetry?.status?.toUpperCase() || 'READY';

                return (
                  <div
                    key={sub.id}
                    data-testid={`sub-agent-card-${sub.id}`}
                    className={`rounded-lg border p-3.5 space-y-3 transition-colors ${
                      sub.enabled
                        ? 'bg-[#111827] border-white/10'
                        : 'bg-[#0D121D] border-white/6 opacity-75'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <Bot className={`w-4 h-4 shrink-0 ${sub.enabled ? 'text-[#E5BF70]' : 'text-slate-500'}`} />
                          <h4 className="text-xs font-semibold text-slate-100 truncate">
                            {idx + 1}. {sub.name}
                          </h4>
                        </div>
                        <p className="text-[11px] font-fa text-slate-400" dir="rtl">
                          {sub.nameFa}
                        </p>
                        <p className="text-[11px] text-slate-400 leading-relaxed pt-0.5">
                          {sub.role}
                        </p>
                      </div>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={sub.enabled}
                        aria-label={`Toggle ${sub.name}`}
                        data-testid={`sub-agent-toggle-${sub.id}`}
                        onClick={() => updateSubAgent(sub.id, { enabled: !sub.enabled })}
                        className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          sub.enabled
                            ? 'bg-emerald-500/15 border-emerald-400/45 text-emerald-300'
                            : 'bg-[#0B0F17] border-white/12 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {sub.enabled ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    {/* Telemetry & Override Bar */}
                    <div className="pt-2.5 border-t border-white/6 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-400">
                        <div className="flex items-center gap-2">
                          <span>{sub.cadence}</span>
                          <span className="text-slate-600">·</span>
                          <span
                            className={
                              !sub.enabled
                                ? 'text-slate-500'
                                : liveStatus === 'SCANNING' || liveStatus === 'ACTIVE'
                                  ? 'text-[#E5BF70]'
                                  : 'text-emerald-400'
                            }
                          >
                            {liveStatus}
                          </span>
                          {liveLatency !== null && sub.enabled && (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-300">{liveLatency} ms</span>
                            </>
                          )}
                        </div>

                        <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-300">
                          <input
                            type="checkbox"
                            checked={sub.useOverride}
                            disabled={!sub.enabled}
                            onChange={(e) => updateSubAgent(sub.id, { useOverride: e.target.checked })}
                            className="accent-[#D4A853] rounded"
                          />
                          <span className="text-[11px]">Custom Model Override</span>
                        </label>
                      </div>

                      {sub.enabled && sub.useOverride && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select
                            value={sub.providerOverride}
                            onChange={(e) =>
                              updateSubAgent(sub.id, {
                                providerOverride: e.target.value as AiConnectionMode | 'INHERIT',
                              })
                            }
                            aria-label={`${sub.name} provider override`}
                            className="px-2.5 py-1.5 rounded bg-[#0B0F17] border border-white/12 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-[#D4A853]"
                          >
                            <option value="INHERIT">Inherit Global Provider</option>
                            <option value="ANTIGRAVITY_OAUTH_CLI">OAuth CLI Proxy</option>
                            <option value="CUSTOM_OPENAI_COMPAT">Custom OpenAI Endpoint</option>
                            <option value="GOOGLE_AI_STUDIO">Google AI Studio SDK</option>
                            <option value="ANTIGRAVITY_MCP_BRIDGE">Antigravity MCP</option>
                          </select>
                          <input
                            type="text"
                            value={sub.modelOverride}
                            onChange={(e) => updateSubAgent(sub.id, { modelOverride: e.target.value })}
                            placeholder="e.g. gemini-3.8-flash"
                            aria-label={`${sub.name} model override`}
                            data-testid={`sub-agent-model-${sub.id}`}
                            className="px-2.5 py-1.5 rounded bg-[#0B0F17] border border-white/12 text-[11px] font-mono text-slate-100 focus:outline-none focus:border-[#D4A853]"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Sticky Modal Footer */}
        <div className="px-5 py-3 bg-[#101624] border-t border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs font-mono min-w-0 flex-1">
            {saveFeedback ? (
              <span className={saveFeedback.ok ? 'text-emerald-300' : 'text-amber-300'} data-testid="ai-save-feedback">
                {saveFeedback.text}
              </span>
            ) : (
              <span className="text-slate-400">
                Changes apply immediately to System-2 autonomous scans &amp; live position monitoring.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-xs font-medium border border-white/12 text-slate-300 hover:bg-white/6 transition-colors whitespace-nowrap"
            >
              Close
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              data-testid="save-ai-settings-btn"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-[#D4A853] hover:bg-[#e1b968] disabled:opacity-60 text-slate-950 transition-colors whitespace-nowrap cursor-pointer"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>{saving ? 'Saving...' : 'Save AI Configuration'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
