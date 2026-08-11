import type { ProviderConfig } from "@ensemble/shared";
import type { KeyStore } from "../keychain";
import type { LLMProvider, ProviderRuntimeConfig } from "./types";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai";
import { logger } from "../util/logger";

/** Provider 实例注册表：按配置构造 provider（API key 从 KeyStore 解密注入） */
export class ProviderRegistry {
  private map = new Map<string, LLMProvider>();
  /** 原始配置快照（供 getRuntimeConfig 复用凭证构造 embedding 等） */
  private configs = new Map<string, ProviderConfig>();

  constructor(private keyStore: KeyStore) {}

  get(id: string): LLMProvider {
    const found = this.map.get(id);
    if (!found) throw new Error(`provider not configured: ${id}`);
    return found;
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  /** 获取 provider 的运行时配置（含 apiKey），供 embedding 等复用凭证 */
  getRuntimeConfig(id: string): ProviderRuntimeConfig | undefined {
    const cfg = this.configs.get(id);
    if (!cfg) return undefined;
    return {
      id: cfg.id,
      type: cfg.type,
      baseUrl: cfg.baseUrl,
      apiKey: this.keyStore.get(cfg.id),
      defaultModel: cfg.defaultModel,
      extraHeaders: cfg.extraHeaders,
    };
  }

  buildProvider(cfg: ProviderConfig): LLMProvider {
    const runtime: ProviderRuntimeConfig = {
      id: cfg.id,
      type: cfg.type,
      baseUrl: cfg.baseUrl,
      apiKey: this.keyStore.get(cfg.id),
      defaultModel: cfg.defaultModel,
      extraHeaders: cfg.extraHeaders,
    };
    if (cfg.type === "anthropic") return new AnthropicProvider(runtime);
    return new OpenAICompatibleProvider(runtime);
  }

  reload(providers: ProviderConfig[]): void {
    const seen = new Set<string>();
    for (const cfg of providers) {
      if (!cfg.enabled) continue;
      seen.add(cfg.id);
      this.configs.set(cfg.id, cfg);
      try {
        this.map.set(cfg.id, this.buildProvider(cfg));
      } catch (err) {
        logger.warn(`provider ${cfg.id} build failed`, String(err));
      }
    }
    for (const id of [...this.map.keys()]) {
      if (!seen.has(id)) {
        this.map.delete(id);
        this.configs.delete(id);
      }
    }
  }

  list(): string[] {
    return [...this.map.keys()];
  }

  disposeAll(): void {
    this.map.clear();
    this.configs.clear();
  }
}
