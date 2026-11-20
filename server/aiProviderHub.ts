/**
 * Universal AI Provider & Auth Hub (Squad 2)
 *
 * Safely persisted in `~/.config/xauusd-aurum-deck/ai-config.json` (API keys masked on GET).
 * Supports 4 connection modes selectable globally or per sub-agent:
 *   Mode A — ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI (local CLIProxyAPI / gemini-oauth + agy/gemini CLI discovery)
 *   Mode B — CUSTOM_OPENAI_COMPATIBLE (/v1/chat/completions with custom baseUrl, apiKey, any modelName)
 *   Mode C — GEMINI_API_KEY (@google/genai SDK with custom modelName, fallbackModelName, thinkingLevel)
 *   Mode D — ANTIGRAVITY_MCP_BRIDGE (delegates to native server-side MCP job queue in server.ts)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const execFileAsync = promisify(execFile);

export type AiProviderMode =
  | 'ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI'
  | 'CUSTOM_OPENAI_COMPATIBLE'
  | 'GEMINI_API_KEY'
  | 'ANTIGRAVITY_MCP_BRIDGE';

export type GeminiThinkingLevelName = 'LOW' | 'MEDIUM' | 'HIGH';

export type SubAgentId =
  | 'macroNewsSentinel'
  | 'smcSniperAnalyst'
  | 'adversarialChallenger'
  | 'chiefExecutionJudge'
  | 'livePositionGuardian';

export interface SubAgentOverrideConfig {
  enabled: boolean;
  providerMode: AiProviderMode | 'INHERIT';
  modelName: string;
  thinkingLevel?: GeminiThinkingLevelName;
  baseUrl?: string;
  apiKey?: string;
}

export interface AiHubConfig {
  providerMode: AiProviderMode;
  gemini: {
    apiKey: string;
    modelName: string;
    fallbackModelName: string;
    thinkingLevel: GeminiThinkingLevelName;
  };
  subscriptionCli: {
    cliProxyBaseUrl: string;
    cliProxyApiKey: string;
    preferredCli: 'auto' | 'agy' | 'gemini';
    modelName: string;
    useLocalOAuthProxyFirst: boolean;
  };
  openaiCompatible: {
    baseUrl: string;
    apiKey: string;
    modelName: string;
    extraHeaders?: Record<string, string>;
  };
  mcpBridge: {
    enabled: boolean;
    jobTimeoutMs: number;
    requireExternalApproval: boolean;
  };
  subAgents: Record<SubAgentId, SubAgentOverrideConfig>;
  macroPollIntervalSec: number;
  updatedAtMs: number;
}

export interface SanitizedAiHubConfig extends AiHubConfig {
  configFilePath: string;
  hasEnvGeminiKey: boolean;
  hasConfiguredGeminiKey: boolean;
  hasConfiguredOpenAiKey: boolean;
  hasConfiguredCliProxyKey: boolean;
}

export interface CliAuthStatusReport {
  agyInstalled: boolean;
  agyPath: string | null;
  agyAuthenticated: boolean;
  agyStatusText: string | null;
  geminiCliInstalled: boolean;
  geminiCliPath: string | null;
  geminiOauthCredsFound: boolean;
  geminiOauthValid: boolean;
  geminiOauthPath: string | null;
  geminiOauthExpiryMs: number | null;
  antigravityConfigFound: boolean;
  antigravityConfigPath: string | null;
  localProxyReachable: boolean;
  localProxyUrl: string;
  localProxyModels: string[];
  geminiEnvKeyPresent: boolean;
  recommendedMode: AiProviderMode;
  summary: string;
  checkedAtMs: number;
}

export interface CliLoginTriggerResult {
  ok: boolean;
  cliUsed: 'agy' | 'gemini' | 'none';
  command: string;
  started: boolean;
  authUrl: string | null;
  message: string;
  stdoutSnippet?: string;
}

export interface AiCompletionRequest {
  subAgentId?: SubAgentId;
  systemInstruction: string;
  prompt: string;
  responseSchema?: Record<string, unknown>;
  overrideMode?: AiProviderMode;
  overrideModel?: string;
  overrideThinkingLevel?: GeminiThinkingLevelName;
  timeoutMs?: number;
}

export interface AiCompletionResult {
  text: string;
  rawReasoning?: string;
  modelUsed: string;
  providerMode: AiProviderMode;
  latencyMs: number;
  usedFallback?: boolean;
}

export interface AiConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  modelUsed: string;
  providerMode: AiProviderMode;
  details?: string;
  error?: string;
}

export type McpBridgeDispatchFn = (payload: {
  subAgentId?: SubAgentId;
  prompt: string;
  systemInstruction: string;
  timeoutMs: number;
}) => Promise<string>;

const VALID_PROVIDER_MODES: AiProviderMode[] = [
  'ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI',
  'CUSTOM_OPENAI_COMPATIBLE',
  'GEMINI_API_KEY',
  'ANTIGRAVITY_MCP_BRIDGE',
];

const VALID_THINKING_LEVELS: GeminiThinkingLevelName[] = ['LOW', 'MEDIUM', 'HIGH'];

const SUB_AGENT_IDS: SubAgentId[] = [
  'macroNewsSentinel',
  'smcSniperAnalyst',
  'adversarialChallenger',
  'chiefExecutionJudge',
  'livePositionGuardian',
];

const CONFIG_DIR = path.join(os.homedir(), '.config', 'xauusd-aurum-deck');
const CONFIG_FILE_PATH = path.join(CONFIG_DIR, 'ai-config.json');

export function maskApiKey(key?: string): string {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 6) return '••••••';
  const prefix = trimmed.includes('-') && trimmed.indexOf('-') <= 4 ? trimmed.slice(0, trimmed.indexOf('-') + 1) : '';
  return `${prefix}••••••••${trimmed.slice(-4)}`;
}

function isMaskedSecretPlaceholder(value?: string): boolean {
  if (!value || typeof value !== 'string') return false;
  return value.includes('••••') || value.includes('***');
}

function buildDefaultSubAgents(): Record<SubAgentId, SubAgentOverrideConfig> {
  return {
    macroNewsSentinel: {
      enabled: true,
      providerMode: 'INHERIT',
      modelName: '',
      thinkingLevel: 'LOW',
    },
    smcSniperAnalyst: {
      enabled: true,
      providerMode: 'INHERIT',
      modelName: '',
      thinkingLevel: 'MEDIUM',
    },
    adversarialChallenger: {
      enabled: true,
      providerMode: 'INHERIT',
      modelName: '',
      thinkingLevel: 'MEDIUM',
    },
    chiefExecutionJudge: {
      enabled: true,
      providerMode: 'INHERIT',
      modelName: '',
      thinkingLevel: 'HIGH',
    },
    livePositionGuardian: {
      enabled: true,
      providerMode: 'INHERIT',
      modelName: '',
      thinkingLevel: 'LOW',
    },
  };
}

export function createDefaultAiHubConfig(): AiHubConfig {
  return {
    providerMode: 'GEMINI_API_KEY',
    gemini: {
      apiKey: '',
      modelName: 'gemini-4-hydrogen',
      fallbackModelName: 'gemini-3.1-flash-lite',
      thinkingLevel: 'LOW',
    },
    subscriptionCli: {
      cliProxyBaseUrl: 'http://127.0.0.1:8080/v1',
      cliProxyApiKey: '',
      preferredCli: 'auto',
      modelName: 'gemini-4-hydrogen',
      useLocalOAuthProxyFirst: true,
    },
    openaiCompatible: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      modelName: 'deepseek-r1',
      extraHeaders: {},
    },
    mcpBridge: {
      enabled: true,
      jobTimeoutMs: 20_000,
      requireExternalApproval: false,
    },
    subAgents: buildDefaultSubAgents(),
    macroPollIntervalSec: 45,
    updatedAtMs: Date.now(),
  };
}

function mapThinkingLevel(level: GeminiThinkingLevelName): ThinkingLevel {
  switch (level) {
    case 'HIGH':
      return ThinkingLevel.HIGH;
    case 'MEDIUM':
      return ThinkingLevel.MEDIUM;
    case 'LOW':
    default:
      return ThinkingLevel.LOW;
  }
}

function supportsGeminiThinkingConfig(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return lower.startsWith('gemini-3') || lower.startsWith('gemini-4');
}

function isQuotaOrModelUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const lower = msg.toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    lower.includes('quota') ||
    msg.includes('404') ||
    msg.includes('NOT_FOUND')
  );
}

/**
 * Extracts clean JSON object/array text from LLM outputs that may include
 * DeepSeek `<think>...</think>` reasoning blocks or Markdown code fences.
 */
export function extractJsonAndReasoning(rawText: string): { jsonText: string; rawReasoning?: string } {
  let working = String(rawText ?? '').trim();
  let rawReasoning: string | undefined;

  // Capture DeepSeek / Qwen <think>...</think> blocks before parsing JSON
  const thinkMatch = working.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    rawReasoning = thinkMatch[1].trim();
    working = working.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  // Strip ```json ... ``` fences
  const fenceMatch = working.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    working = fenceMatch[1].trim();
  }

  // If leading/trailing commentary surrounds the JSON payload, extract outermost object or array
  if (!(working.startsWith('{') && working.endsWith('}')) && !(working.startsWith('[') && working.endsWith(']'))) {
    const firstObj = working.indexOf('{');
    const lastObj = working.lastIndexOf('}');
    const firstArr = working.indexOf('[');
    const lastArr = working.lastIndexOf(']');

    const objValid = firstObj !== -1 && lastObj > firstObj;
    const arrValid = firstArr !== -1 && lastArr > firstArr;

    if (objValid && (!arrValid || firstObj < firstArr)) {
      working = working.slice(firstObj, lastObj + 1);
    } else if (arrValid) {
      working = working.slice(firstArr, lastArr + 1);
    }
  }

  return { jsonText: working, rawReasoning };
}

async function whichBinary(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [bin], { timeout: 1500 });
    const resolved = stdout.trim().split('\n')[0]?.trim();
    return resolved || null;
  } catch {
    return null;
  }
}

interface DiscoveredOAuthCreds {
  found: boolean;
  path: string | null;
  valid: boolean;
  accessToken: string | null;
  expiryMs: number | null;
}

function readOAuthCredsFile(candidatePaths: string[]): DiscoveredOAuthCreds {
  for (const filePath of candidatePaths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const accessToken =
        typeof parsed.access_token === 'string'
          ? parsed.access_token
          : typeof parsed.accessToken === 'string'
            ? parsed.accessToken
            : typeof parsed.token === 'string'
              ? parsed.token
              : null;
      const refreshToken =
        typeof parsed.refresh_token === 'string'
          ? parsed.refresh_token
          : typeof parsed.refreshToken === 'string'
            ? parsed.refreshToken
            : null;
      const expiryRaw = parsed.expiry_date ?? parsed.expiryDate ?? parsed.expires_at ?? parsed.expiresAt;
      const expiryMs =
        typeof expiryRaw === 'number'
          ? expiryRaw > 1e12
            ? expiryRaw
            : expiryRaw * 1000
          : typeof expiryRaw === 'string'
            ? Date.parse(expiryRaw)
            : null;

      const isNotExpired = !expiryMs || !Number.isFinite(expiryMs) || expiryMs > Date.now() - 30_000;
      const valid = Boolean((accessToken && isNotExpired) || refreshToken);
      return {
        found: true,
        path: filePath,
        valid,
        accessToken: accessToken && isNotExpired ? accessToken : null,
        expiryMs: expiryMs && Number.isFinite(expiryMs) ? expiryMs : null,
      };
    } catch {
      // Malformed or unreadable cred file; try next candidate
    }
  }
  return { found: false, path: null, valid: false, accessToken: null, expiryMs: null };
}

async function fetchJsonWithAbort(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ status: number; ok: boolean; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const text = await resp.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: resp.status, ok: resp.ok, json, text };
  } finally {
    clearTimeout(timer);
  }
}

export class AiProviderHub {
  private config: AiHubConfig;
  private mcpBridgeDispatcher: McpBridgeDispatchFn | null = null;

  constructor() {
    this.config = this.loadConfigFromDisk();
  }

  public setMcpBridgeDispatcher(fn: McpBridgeDispatchFn): void {
    this.mcpBridgeDispatcher = fn;
  }

  public getConfigFilePath(): string {
    return CONFIG_FILE_PATH;
  }

  private loadConfigFromDisk(): AiHubConfig {
    const defaults = createDefaultAiHubConfig();
    try {
      if (!fs.existsSync(CONFIG_FILE_PATH)) {
        return defaults;
      }
      const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AiHubConfig>;
      return this.mergeConfig(defaults, parsed);
    } catch {
      return defaults;
    }
  }

  private persistConfigToDisk(): void {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(this.config, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      try {
        fs.chmodSync(CONFIG_FILE_PATH, 0o600);
      } catch {
        // Ignore chmod failure on restricted FS
      }
    } catch (err) {
      console.warn(
        `[AiProviderHub] Unable to persist ${CONFIG_FILE_PATH}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private mergeConfig(base: AiHubConfig, patch: Partial<AiHubConfig>): AiHubConfig {
    const nextMode =
      patch.providerMode && VALID_PROVIDER_MODES.includes(patch.providerMode)
        ? patch.providerMode
        : base.providerMode;

    const patchGemini = patch.gemini ?? ({} as Partial<AiHubConfig['gemini']>);
    const nextGeminiKey =
      typeof patchGemini.apiKey === 'string'
        ? isMaskedSecretPlaceholder(patchGemini.apiKey)
          ? base.gemini.apiKey
          : patchGemini.apiKey.trim()
        : base.gemini.apiKey;

    const patchSubCli = patch.subscriptionCli ?? ({} as Partial<AiHubConfig['subscriptionCli']>);
    const nextCliProxyKey =
      typeof patchSubCli.cliProxyApiKey === 'string'
        ? isMaskedSecretPlaceholder(patchSubCli.cliProxyApiKey)
          ? base.subscriptionCli.cliProxyApiKey
          : patchSubCli.cliProxyApiKey.trim()
        : base.subscriptionCli.cliProxyApiKey;

    const patchOpenAi = patch.openaiCompatible ?? ({} as Partial<AiHubConfig['openaiCompatible']>);
    const nextOpenAiKey =
      typeof patchOpenAi.apiKey === 'string'
        ? isMaskedSecretPlaceholder(patchOpenAi.apiKey)
          ? base.openaiCompatible.apiKey
          : patchOpenAi.apiKey.trim()
        : base.openaiCompatible.apiKey;

    const patchMcp = patch.mcpBridge ?? ({} as Partial<AiHubConfig['mcpBridge']>);

    const nextSubAgents: Record<SubAgentId, SubAgentOverrideConfig> = { ...base.subAgents };
    if (patch.subAgents && typeof patch.subAgents === 'object') {
      for (const id of SUB_AGENT_IDS) {
        const incoming = patch.subAgents[id];
        if (!incoming) continue;
        const prev = base.subAgents[id];
        const nextSubMode =
          incoming.providerMode === 'INHERIT' ||
          (incoming.providerMode && VALID_PROVIDER_MODES.includes(incoming.providerMode))
            ? incoming.providerMode
            : prev.providerMode;
        const nextSubKey =
          typeof incoming.apiKey === 'string'
            ? isMaskedSecretPlaceholder(incoming.apiKey)
              ? prev.apiKey
              : incoming.apiKey.trim()
            : prev.apiKey;

        nextSubAgents[id] = {
          enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : prev.enabled,
          providerMode: nextSubMode,
          modelName: typeof incoming.modelName === 'string' ? incoming.modelName.trim() : prev.modelName,
          thinkingLevel:
            incoming.thinkingLevel && VALID_THINKING_LEVELS.includes(incoming.thinkingLevel)
              ? incoming.thinkingLevel
              : prev.thinkingLevel,
          baseUrl: typeof incoming.baseUrl === 'string' ? incoming.baseUrl.trim() : prev.baseUrl,
          apiKey: nextSubKey,
        };
      }
    }

    const macroPollIntervalSec =
      typeof patch.macroPollIntervalSec === 'number' && Number.isFinite(patch.macroPollIntervalSec)
        ? Math.max(15, Math.min(300, Math.round(patch.macroPollIntervalSec)))
        : base.macroPollIntervalSec;

    return {
      providerMode: nextMode,
      gemini: {
        apiKey: nextGeminiKey,
        modelName:
          typeof patchGemini.modelName === 'string' && patchGemini.modelName.trim()
            ? patchGemini.modelName.trim()
            : base.gemini.modelName,
        fallbackModelName:
          typeof patchGemini.fallbackModelName === 'string' && patchGemini.fallbackModelName.trim()
            ? patchGemini.fallbackModelName.trim()
            : base.gemini.fallbackModelName,
        thinkingLevel:
          patchGemini.thinkingLevel && VALID_THINKING_LEVELS.includes(patchGemini.thinkingLevel)
            ? patchGemini.thinkingLevel
            : base.gemini.thinkingLevel,
      },
      subscriptionCli: {
        cliProxyBaseUrl:
          typeof patchSubCli.cliProxyBaseUrl === 'string' && patchSubCli.cliProxyBaseUrl.trim()
            ? patchSubCli.cliProxyBaseUrl.trim().replace(/\/+$/, '')
            : base.subscriptionCli.cliProxyBaseUrl,
        cliProxyApiKey: nextCliProxyKey,
        preferredCli:
          patchSubCli.preferredCli === 'agy' ||
          patchSubCli.preferredCli === 'gemini' ||
          patchSubCli.preferredCli === 'auto'
            ? patchSubCli.preferredCli
            : base.subscriptionCli.preferredCli,
        modelName:
          typeof patchSubCli.modelName === 'string' && patchSubCli.modelName.trim()
            ? patchSubCli.modelName.trim()
            : base.subscriptionCli.modelName,
        useLocalOAuthProxyFirst:
          typeof patchSubCli.useLocalOAuthProxyFirst === 'boolean'
            ? patchSubCli.useLocalOAuthProxyFirst
            : base.subscriptionCli.useLocalOAuthProxyFirst,
      },
      openaiCompatible: {
        baseUrl:
          typeof patchOpenAi.baseUrl === 'string' && patchOpenAi.baseUrl.trim()
            ? patchOpenAi.baseUrl.trim().replace(/\/+$/, '')
            : base.openaiCompatible.baseUrl,
        apiKey: nextOpenAiKey,
        modelName:
          typeof patchOpenAi.modelName === 'string' && patchOpenAi.modelName.trim()
            ? patchOpenAi.modelName.trim()
            : base.openaiCompatible.modelName,
        extraHeaders:
          patchOpenAi.extraHeaders && typeof patchOpenAi.extraHeaders === 'object'
            ? patchOpenAi.extraHeaders
            : base.openaiCompatible.extraHeaders,
      },
      mcpBridge: {
        enabled: typeof patchMcp.enabled === 'boolean' ? patchMcp.enabled : base.mcpBridge.enabled,
        jobTimeoutMs:
          typeof patchMcp.jobTimeoutMs === 'number' && Number.isFinite(patchMcp.jobTimeoutMs)
            ? Math.max(3000, Math.min(120_000, Math.round(patchMcp.jobTimeoutMs)))
            : base.mcpBridge.jobTimeoutMs,
        requireExternalApproval:
          typeof patchMcp.requireExternalApproval === 'boolean'
            ? patchMcp.requireExternalApproval
            : base.mcpBridge.requireExternalApproval,
      },
      subAgents: nextSubAgents,
      macroPollIntervalSec,
      updatedAtMs: Date.now(),
    };
  }

  public getRawConfig(): AiHubConfig {
    return this.config;
  }

  public getSanitizedConfig(): SanitizedAiHubConfig {
    const envKey = (process.env.GEMINI_API_KEY || '').trim();
    const hasEnvGeminiKey = Boolean(envKey && envKey !== 'MY_GEMINI_API_KEY');

    const maskedSubAgents = {} as Record<SubAgentId, SubAgentOverrideConfig>;
    for (const id of SUB_AGENT_IDS) {
      const entry = this.config.subAgents[id];
      maskedSubAgents[id] = {
        ...entry,
        apiKey: entry.apiKey ? maskApiKey(entry.apiKey) : '',
      };
    }

    return {
      ...this.config,
      gemini: {
        ...this.config.gemini,
        apiKey: maskApiKey(this.config.gemini.apiKey),
      },
      subscriptionCli: {
        ...this.config.subscriptionCli,
        cliProxyApiKey: maskApiKey(this.config.subscriptionCli.cliProxyApiKey),
      },
      openaiCompatible: {
        ...this.config.openaiCompatible,
        apiKey: maskApiKey(this.config.openaiCompatible.apiKey),
      },
      subAgents: maskedSubAgents,
      configFilePath: CONFIG_FILE_PATH,
      hasEnvGeminiKey,
      hasConfiguredGeminiKey: Boolean(this.config.gemini.apiKey) || hasEnvGeminiKey,
      hasConfiguredOpenAiKey: Boolean(this.config.openaiCompatible.apiKey),
      hasConfiguredCliProxyKey: Boolean(this.config.subscriptionCli.cliProxyApiKey),
    };
  }

  public updateConfig(patch: Partial<AiHubConfig>): SanitizedAiHubConfig {
    this.config = this.mergeConfig(this.config, patch);
    this.persistConfigToDisk();
    return this.getSanitizedConfig();
  }

  public isSubAgentEnabled(subAgentId: SubAgentId): boolean {
    return this.config.subAgents[subAgentId]?.enabled !== false;
  }

  public hasAnyUsableAiProvider(): boolean {
    const envKey = (process.env.GEMINI_API_KEY || '').trim();
    const hasGeminiKey = Boolean(this.config.gemini.apiKey || (envKey && envKey !== 'MY_GEMINI_API_KEY'));
    switch (this.config.providerMode) {
      case 'GEMINI_API_KEY':
        return hasGeminiKey;
      case 'CUSTOM_OPENAI_COMPATIBLE':
        return Boolean(this.config.openaiCompatible.baseUrl && this.config.openaiCompatible.modelName);
      case 'ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI':
        return true; // Local proxy or CLI OAuth checked dynamically
      case 'ANTIGRAVITY_MCP_BRIDGE':
        return this.config.mcpBridge.enabled;
      default:
        return hasGeminiKey;
    }
  }

  public resolveEffectiveRoute(
    subAgentId?: SubAgentId,
    overrides?: {
      overrideMode?: AiProviderMode;
      overrideModel?: string;
      overrideThinkingLevel?: GeminiThinkingLevelName;
    }
  ): {
    mode: AiProviderMode;
    modelName: string;
    fallbackModelName: string;
    thinkingLevel: GeminiThinkingLevelName;
    baseUrl: string;
    apiKey: string;
  } {
    const subCfg = subAgentId ? this.config.subAgents[subAgentId] : undefined;
    const mode: AiProviderMode =
      overrides?.overrideMode ??
      (subCfg && subCfg.providerMode !== 'INHERIT' ? subCfg.providerMode : this.config.providerMode);

    const thinkingLevel: GeminiThinkingLevelName =
      overrides?.overrideThinkingLevel ?? subCfg?.thinkingLevel ?? this.config.gemini.thinkingLevel;

    if (mode === 'CUSTOM_OPENAI_COMPATIBLE') {
      return {
        mode,
        modelName: overrides?.overrideModel || subCfg?.modelName || this.config.openaiCompatible.modelName,
        fallbackModelName: '',
        thinkingLevel,
        baseUrl: subCfg?.baseUrl || this.config.openaiCompatible.baseUrl,
        apiKey: subCfg?.apiKey || this.config.openaiCompatible.apiKey,
      };
    }

    if (mode === 'ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI') {
      return {
        mode,
        modelName: overrides?.overrideModel || subCfg?.modelName || this.config.subscriptionCli.modelName,
        fallbackModelName: this.config.gemini.fallbackModelName,
        thinkingLevel,
        baseUrl: subCfg?.baseUrl || this.config.subscriptionCli.cliProxyBaseUrl,
        apiKey: subCfg?.apiKey || this.config.subscriptionCli.cliProxyApiKey,
      };
    }

    if (mode === 'ANTIGRAVITY_MCP_BRIDGE') {
      return {
        mode,
        modelName: overrides?.overrideModel || subCfg?.modelName || 'antigravity-mcp-bridge',
        fallbackModelName: '',
        thinkingLevel,
        baseUrl: '',
        apiKey: '',
      };
    }

    // Default: GEMINI_API_KEY
    const envKey = (process.env.GEMINI_API_KEY || '').trim();
    const resolvedEnvKey = envKey && envKey !== 'MY_GEMINI_API_KEY' ? envKey : '';
    return {
      mode: 'GEMINI_API_KEY',
      modelName: overrides?.overrideModel || subCfg?.modelName || this.config.gemini.modelName,
      fallbackModelName: this.config.gemini.fallbackModelName,
      thinkingLevel,
      baseUrl: '',
      apiKey: subCfg?.apiKey || this.config.gemini.apiKey || resolvedEnvKey,
    };
  }

  /**
   * Detects installed `agy` (Antigravity CLI) / `gemini` CLI, active OAuth credentials
   * (`~/.config/antigravity/`, `~/.gemini/oauth_creds.json`), `agy auth status`,
   * and local OpenAI-compatible CLI OAuth proxy (`CLIProxyAPI` / `gemini-oauth`).
   */
  public async detectCliAuthStatus(): Promise<CliAuthStatusReport> {
    const home = os.homedir();
    const proxyBaseUrl = this.config.subscriptionCli.cliProxyBaseUrl || 'http://127.0.0.1:8080/v1';

    const [agyPath, geminiCliPath] = await Promise.all([whichBinary('agy'), whichBinary('gemini')]);

    // Check Antigravity config folder & Gemini CLI OAuth creds
    const agyDir = path.join(home, '.config', 'antigravity');
    const antigravityConfigFound = fs.existsSync(agyDir);
    const agyCreds = readOAuthCredsFile([
      path.join(agyDir, 'oauth_creds.json'),
      path.join(agyDir, 'credentials.json'),
      path.join(agyDir, 'auth.json'),
      path.join(agyDir, 'token.json'),
    ]);

    const geminiCreds = readOAuthCredsFile([
      path.join(home, '.gemini', 'oauth_creds.json'),
      path.join(home, '.config', 'gemini', 'oauth_creds.json'),
    ]);

    // Probe `agy auth status` when `agy` is installed
    let agyAuthenticated = agyCreds.valid;
    let agyStatusText: string | null = null;
    if (agyPath) {
      try {
        const { stdout, stderr } = await execFileAsync(agyPath, ['auth', 'status'], { timeout: 2500 });
        const combined = `${stdout}\n${stderr}`.trim();
        agyStatusText = combined.slice(0, 280) || 'agy auth status returned OK';
        const lower = combined.toLowerCase();
        if (
          (lower.includes('authenticated') || lower.includes('logged in') || lower.includes('active')) &&
          !lower.includes('not authenticated') &&
          !lower.includes('not logged in')
        ) {
          agyAuthenticated = true;
        }
      } catch (err) {
        agyStatusText = err instanceof Error ? err.message.slice(0, 200) : 'agy auth status failed';
      }
    }

    // Probe local CLIProxyAPI / gemini-oauth OpenAI-compatible endpoint
    let localProxyReachable = false;
    let localProxyModels: string[] = [];
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.config.subscriptionCli.cliProxyApiKey) {
        headers.Authorization = `Bearer ${this.config.subscriptionCli.cliProxyApiKey}`;
      }
      const probe = await fetchJsonWithAbort(`${proxyBaseUrl.replace(/\/+$/, '')}/models`, { headers }, 1600);
      if (probe.ok || probe.status === 401) {
        localProxyReachable = true;
        const data = (probe.json as { data?: Array<{ id?: string }> } | null)?.data;
        if (Array.isArray(data)) {
          localProxyModels = data
            .map((m) => String(m?.id ?? '').trim())
            .filter(Boolean)
            .slice(0, 25);
        }
      }
    } catch {
      localProxyReachable = false;
    }

    const envKey = (process.env.GEMINI_API_KEY || '').trim();
    const geminiEnvKeyPresent = Boolean(envKey && envKey !== 'MY_GEMINI_API_KEY');

    let recommendedMode: AiProviderMode = this.config.providerMode;
    if (localProxyReachable || agyAuthenticated || geminiCreds.valid) {
      recommendedMode = 'ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI';
    } else if (geminiEnvKeyPresent || this.config.gemini.apiKey) {
      recommendedMode = 'GEMINI_API_KEY';
    } else if (this.config.openaiCompatible.baseUrl) {
      recommendedMode = 'CUSTOM_OPENAI_COMPATIBLE';
    }

    const parts: string[] = [];
    if (localProxyReachable) parts.push(`Local OAuth Proxy online (${proxyBaseUrl})`);
    if (agyInstalledLabel(agyPath, agyAuthenticated)) parts.push(agyInstalledLabel(agyPath, agyAuthenticated));
    if (geminiCliPath) parts.push(`gemini CLI (${geminiCreds.valid ? 'OAuth active' : 'no active OAuth token'})`);
    if (geminiEnvKeyPresent || this.config.gemini.apiKey) parts.push('Gemini API Key available');
    if (parts.length === 0) parts.push('No CLI OAuth session or local proxy detected; configure API key or start CLIProxyAPI.');

    return {
      agyInstalled: Boolean(agyPath),
      agyPath,
      agyAuthenticated,
      agyStatusText,
      geminiCliInstalled: Boolean(geminiCliPath),
      geminiCliPath,
      geminiOauthCredsFound: geminiCreds.found,
      geminiOauthValid: geminiCreds.valid,
      geminiOauthPath: geminiCreds.path,
      geminiOauthExpiryMs: geminiCreds.expiryMs,
      antigravityConfigFound,
      antigravityConfigPath: antigravityConfigFound ? agyDir : null,
      localProxyReachable,
      localProxyUrl: proxyBaseUrl,
      localProxyModels,
      geminiEnvKeyPresent,
      recommendedMode,
      summary: parts.join(' · '),
      checkedAtMs: Date.now(),
    };
  }

  /**
   * Triggers `agy auth login` or `gemini` OAuth login flow on Ubuntu desktop.
   * Non-blocking: captures initial stdout/stderr for up to 2.5s to surface any browser OAuth URL.
   */
  public async triggerCliLogin(preferred?: 'agy' | 'gemini' | 'auto'): Promise<CliLoginTriggerResult> {
    const choice = preferred ?? this.config.subscriptionCli.preferredCli ?? 'auto';
    const [agyPath, geminiPath] = await Promise.all([whichBinary('agy'), whichBinary('gemini')]);

    let targetBin: string | null = null;
    let cliUsed: 'agy' | 'gemini' | 'none' = 'none';
    let args: string[] = [];

    if ((choice === 'agy' || choice === 'auto') && agyPath) {
      targetBin = agyPath;
      cliUsed = 'agy';
      args = ['auth', 'login'];
    } else if ((choice === 'gemini' || choice === 'auto') && geminiPath) {
      targetBin = geminiPath;
      cliUsed = 'gemini';
      args = ['auth', 'login'];
    }

    if (!targetBin) {
      return {
        ok: false,
        cliUsed: 'none',
        command: choice === 'gemini' ? 'gemini auth login' : 'agy auth login',
        started: false,
        authUrl: null,
        message:
          'Neither `agy` (Antigravity CLI) nor `gemini` CLI was found in PATH on this host. Install on Ubuntu 24.04 or run CLIProxyAPI on http://127.0.0.1:8080/v1.',
      };
    }

    const commandStr = `${cliUsed} ${args.join(' ')}`;
    return await new Promise<CliLoginTriggerResult>((resolve) => {
      let output = '';
      let settled = false;

      const finish = (started: boolean, msg: string) => {
        if (settled) return;
        settled = true;
        const urlMatch = output.match(/https?:\/\/[^\s"'<>]+/i);
        resolve({
          ok: started,
          cliUsed,
          command: commandStr,
          started,
          authUrl: urlMatch ? urlMatch[0] : null,
          message: msg,
          stdoutSnippet: output.trim().slice(0, 400) || undefined,
        });
      };

      try {
        const child = spawn(targetBin, args, {
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        });

        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
        child.on('error', (err) => {
          finish(false, `Failed to launch ${commandStr}: ${err.message}`);
        });

        setTimeout(() => {
          child.unref();
          finish(
            true,
            `Launched \`${commandStr}\`. Complete OAuth sign-in in your browser, then refresh Auth Status.`
          );
        }, 2200);
      } catch (err) {
        finish(false, `Unable to spawn ${commandStr}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  /**
   * Executes a structured JSON completion through the resolved provider mode
   * (Mode A, Mode B, Mode C, or Mode D).
   */
  public async generateStructuredCompletion(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const route = this.resolveEffectiveRoute(req.subAgentId, {
      overrideMode: req.overrideMode,
      overrideModel: req.overrideModel,
      overrideThinkingLevel: req.overrideThinkingLevel,
    });
    const timeoutMs = req.timeoutMs ?? 28_000;
    const startedMs = Date.now();

    if (route.mode === 'GEMINI_API_KEY') {
      return await this.runGeminiSdkCompletion(route, req, startedMs);
    }

    if (route.mode === 'CUSTOM_OPENAI_COMPATIBLE') {
      return await this.runOpenAiCompatibleCompletion(
        route.baseUrl,
        route.apiKey,
        route.modelName,
        this.config.openaiCompatible.extraHeaders,
        req,
        'CUSTOM_OPENAI_COMPATIBLE',
        timeoutMs,
        startedMs
      );
    }

    if (route.mode === 'ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI') {
      return await this.runSubscriptionCliCompletion(route, req, timeoutMs, startedMs);
    }

    // Mode D — ANTIGRAVITY_MCP_BRIDGE
    if (!this.mcpBridgeDispatcher) {
      throw new Error('ANTIGRAVITY_MCP_BRIDGE dispatcher is not attached on server.');
    }
    const text = await this.mcpBridgeDispatcher({
      subAgentId: req.subAgentId,
      prompt: req.prompt,
      systemInstruction: req.systemInstruction,
      timeoutMs: this.config.mcpBridge.jobTimeoutMs,
    });
    const { jsonText, rawReasoning } = extractJsonAndReasoning(text);
    return {
      text: jsonText,
      rawReasoning,
      modelUsed: route.modelName,
      providerMode: 'ANTIGRAVITY_MCP_BRIDGE',
      latencyMs: Date.now() - startedMs,
    };
  }

  private async runGeminiSdkCompletion(
    route: {
      modelName: string;
      fallbackModelName: string;
      thinkingLevel: GeminiThinkingLevelName;
      apiKey: string;
    },
    req: AiCompletionRequest,
    startedMs: number
  ): Promise<AiCompletionResult> {
    if (!route.apiKey) {
      const err = new Error('GEMINI_API_KEY is not configured in AI Provider Hub or server Secrets.');
      (err as Error & { code?: string }).code = 'MISSING_API_KEY';
      throw err;
    }

    const ai = new GoogleGenAI({
      apiKey: route.apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const buildConfig = (modelName: string): Record<string, unknown> => {
      const cfg: Record<string, unknown> = {
        systemInstruction: req.systemInstruction,
        responseMimeType: 'application/json',
      };
      if (req.responseSchema) {
        cfg.responseSchema = req.responseSchema;
      }
      if (supportsGeminiThinkingConfig(modelName)) {
        cfg.thinkingConfig = {
          thinkingLevel: mapThinkingLevel(route.thinkingLevel),
        };
      }
      return cfg;
    };

    try {
      const response = await ai.models.generateContent({
        model: route.modelName,
        contents: req.prompt,
        config: buildConfig(route.modelName),
      });
      const { jsonText, rawReasoning } = extractJsonAndReasoning(response.text ?? '{}');
      return {
        text: jsonText || '{}',
        rawReasoning,
        modelUsed: route.modelName,
        providerMode: 'GEMINI_API_KEY',
        latencyMs: Date.now() - startedMs,
      };
    } catch (primaryErr) {
      if (
        !route.fallbackModelName ||
        route.fallbackModelName === route.modelName ||
        !isQuotaOrModelUnavailableError(primaryErr)
      ) {
        throw primaryErr;
      }

      const fallbackResp = await ai.models.generateContent({
        model: route.fallbackModelName,
        contents: req.prompt,
        config: buildConfig(route.fallbackModelName),
      });
      const { jsonText, rawReasoning } = extractJsonAndReasoning(fallbackResp.text ?? '{}');
      return {
        text: jsonText || '{}',
        rawReasoning,
        modelUsed: route.fallbackModelName,
        providerMode: 'GEMINI_API_KEY',
        latencyMs: Date.now() - startedMs,
        usedFallback: true,
      };
    }
  }

  private async runOpenAiCompatibleCompletion(
    baseUrl: string,
    apiKey: string,
    modelName: string,
    extraHeaders: Record<string, string> | undefined,
    req: AiCompletionRequest,
    providerMode: AiProviderMode,
    timeoutMs: number,
    startedMs: number
  ): Promise<AiCompletionResult> {
    if (!baseUrl) {
      throw new Error(`${providerMode} requires a valid baseUrl (e.g., http://127.0.0.1:11434/v1).`);
    }
    if (!modelName) {
      throw new Error(`${providerMode} requires a modelName.`);
    }

    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(extraHeaders ?? {}),
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const messages = [
      {
        role: 'system',
        content: `${req.systemInstruction}\nReturn ONLY valid JSON with no extra prose outside the JSON payload.`,
      },
      {
        role: 'user',
        content: req.prompt,
      },
    ];

    const sendRequest = async (includeResponseFormat: boolean) => {
      const body: Record<string, unknown> = {
        model: modelName,
        messages,
        stream: false,
      };
      if (includeResponseFormat) {
        body.response_format = { type: 'json_object' };
      }
      return await fetchJsonWithAbort(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        },
        timeoutMs
      );
    };

    let resp = await sendRequest(true);
    // Some local Ollama / vLLM / proxy models reject response_format=json_object with HTTP 400
    if (!resp.ok && resp.status === 400) {
      resp = await sendRequest(false);
    }

    if (!resp.ok) {
      throw new Error(
        `${providerMode} HTTP ${resp.status} from ${endpoint}: ${resp.text.slice(0, 260)}`
      );
    }

    const payload = resp.json as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      model?: string;
    } | null;

    const rawContent = payload?.choices?.[0]?.message?.content ?? '';
    const reasoningContent = payload?.choices?.[0]?.message?.reasoning_content;
    const { jsonText, rawReasoning } = extractJsonAndReasoning(rawContent);

    return {
      text: jsonText || '{}',
      rawReasoning: reasoningContent || rawReasoning,
      modelUsed: payload?.model || modelName,
      providerMode,
      latencyMs: Date.now() - startedMs,
    };
  }

  private async runSubscriptionCliCompletion(
    route: { baseUrl: string; apiKey: string; modelName: string },
    req: AiCompletionRequest,
    timeoutMs: number,
    startedMs: number
  ): Promise<AiCompletionResult> {
    const errors: string[] = [];

    // 1. Primary path: Local OpenAI-compatible CLIProxyAPI / gemini-oauth proxy
    if (this.config.subscriptionCli.useLocalOAuthProxyFirst && route.baseUrl) {
      try {
        return await this.runOpenAiCompatibleCompletion(
          route.baseUrl,
          route.apiKey,
          route.modelName,
          undefined,
          req,
          'ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI',
          timeoutMs,
          startedMs
        );
      } catch (err) {
        errors.push(`Local OAuth Proxy (${route.baseUrl}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Secondary path: Discovered local OAuth access token from ~/.gemini/oauth_creds.json or ~/.config/antigravity/
    const home = os.homedir();
    const creds = readOAuthCredsFile([
      path.join(home, '.config', 'antigravity', 'oauth_creds.json'),
      path.join(home, '.config', 'antigravity', 'credentials.json'),
      path.join(home, '.gemini', 'oauth_creds.json'),
    ]);

    if (creds.accessToken) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          route.modelName
        )}:generateContent`;
        const resp = await fetchJsonWithAbort(
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${creds.accessToken}`,
              'User-Agent': 'aistudio-build',
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: req.systemInstruction }] },
              contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
              },
            }),
          },
          timeoutMs
        );

        if (resp.ok) {
          const data = resp.json as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          } | null;
          const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '{}';
          const { jsonText, rawReasoning } = extractJsonAndReasoning(raw);
          return {
            text: jsonText || '{}',
            rawReasoning,
            modelUsed: route.modelName,
            providerMode: 'ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI',
            latencyMs: Date.now() - startedMs,
          };
        }
        errors.push(`OAuth Token REST (${creds.path}): HTTP ${resp.status}`);
      } catch (err) {
        errors.push(`OAuth Token REST: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Tertiary path: Headless `gemini` or `agy` CLI execution if installed
    const [agyPath, geminiPath] = await Promise.all([whichBinary('agy'), whichBinary('gemini')]);
    const preferred = this.config.subscriptionCli.preferredCli;
    const cliCandidates: Array<{ name: 'agy' | 'gemini'; bin: string }> = [];
    if (preferred === 'agy' && agyPath) cliCandidates.push({ name: 'agy', bin: agyPath });
    else if (preferred === 'gemini' && geminiPath) cliCandidates.push({ name: 'gemini', bin: geminiPath });
    else {
      if (agyPath) cliCandidates.push({ name: 'agy', bin: agyPath });
      if (geminiPath) cliCandidates.push({ name: 'gemini', bin: geminiPath });
    }

    for (const cli of cliCandidates) {
      try {
        const combinedPrompt = `${req.systemInstruction}\n\n${req.prompt}\n\nReturn ONLY valid JSON.`;
        const { stdout } = await execFileAsync(
          cli.bin,
          ['-p', combinedPrompt, '-m', route.modelName],
          { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }
        );
        const { jsonText, rawReasoning } = extractJsonAndReasoning(stdout);
        if (jsonText) {
          return {
            text: jsonText,
            rawReasoning,
            modelUsed: `${cli.name}:${route.modelName}`,
            providerMode: 'ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI',
            latencyMs: Date.now() - startedMs,
          };
        }
      } catch (err) {
        errors.push(`${cli.name} CLI: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const failure = new Error(
      `Subscription CLI / Local OAuth Proxy unavailable. ${errors.join(' | ')}`
    );
    (failure as Error & { code?: string }).code = 'SUBSCRIPTION_CLI_UNAVAILABLE';
    throw failure;
  }

  /**
   * Tests connectivity & latency for the active (or transiently overridden) provider config.
   * Uses an isolated non-mutating view so concurrent requests never race with test probes.
   */
  public async testConnection(overridePatch?: Partial<AiHubConfig>): Promise<AiConnectionTestResult> {
    const startedMs = Date.now();
    const targetConfig = overridePatch ? this.mergeConfig(this.config, overridePatch) : this.config;
    const mode = targetConfig.providerMode;

    if (mode === 'ANTIGRAVITY_MCP_BRIDGE') {
      return {
        ok: targetConfig.mcpBridge.enabled,
        latencyMs: Date.now() - startedMs,
        modelUsed: 'antigravity-mcp-bridge',
        providerMode: mode,
        details: targetConfig.mcpBridge.enabled
          ? 'Native MCP Bridge endpoints (/api/v1/agent/poll-jobs, /proposals, /submit-advisory) active and listening.'
          : 'MCP Bridge is disabled in configuration.',
      };
    }

    try {
      const probeInstance = Object.assign(Object.create(AiProviderHub.prototype), {
        config: targetConfig,
        mcpBridgeDispatcher: this.mcpBridgeDispatcher,
      }) as AiProviderHub;

      const result = await probeInstance.generateStructuredCompletion({
        systemInstruction: 'You are a connectivity health probe. Return JSON {"pong": true}.',
        prompt: 'Reply with {"pong": true}',
        timeoutMs: 12_000,
      });

      return {
        ok: true,
        latencyMs: result.latencyMs,
        modelUsed: result.modelUsed,
        providerMode: result.providerMode,
        details: 'Connection verified with structured JSON handshake.',
      };
    } catch (err) {
      const modelUsed =
        mode === 'CUSTOM_OPENAI_COMPATIBLE'
          ? targetConfig.openaiCompatible.modelName
          : mode === 'ANTIGRAVITY_GEMINI_SUBSCRIPTION_CLI'
            ? targetConfig.subscriptionCli.modelName
            : targetConfig.gemini.modelName;
      return {
        ok: false,
        latencyMs: Date.now() - startedMs,
        modelUsed,
        providerMode: mode,
        error: err instanceof Error ? err.message : 'Connection test failed',
      };
    }
  }
}

function agyInstalledLabel(agyPath: string | null, authenticated: boolean): string {
  if (!agyPath) return '';
  return `agy CLI (${authenticated ? 'authenticated' : 'installed, login required'})`;
}

export const aiProviderHub = new AiProviderHub();
