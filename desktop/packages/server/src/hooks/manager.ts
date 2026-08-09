import type { LoopContext, LoopHook, OnErrorResult } from "./types";

/** Hook 管理器：按注册序执行事件；onError 短路返回首个 retry */
export class HookManager {
  private hooks: LoopHook[] = [];

  add(h: LoopHook): () => void {
    this.hooks.push(h);
    return () => this.remove(h.name);
  }

  remove(name: string): void {
    this.hooks = this.hooks.filter((h) => h.name !== name);
  }

  list(): string[] {
    return this.hooks.map((h) => h.name);
  }

  async run(event: keyof LoopHook, ctx: LoopContext, ...args: unknown[]): Promise<void> {
    for (const h of this.hooks) {
      const fn = h[event] as ((c: LoopContext, ...rest: unknown[]) => Promise<void> | void) | undefined;
      if (fn) await fn.call(h, ctx, ...args);
    }
  }

  async runError(ctx: LoopContext, err: unknown): Promise<OnErrorResult | undefined> {
    for (const h of this.hooks) {
      if (!h.onError) continue;
      const res = await h.onError(ctx, err);
      if (res?.retry) return res;
    }
    return undefined;
  }
}
