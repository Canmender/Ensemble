/**
 * RouterRegistry（R3-C）：路由挂载面对插件开放。
 * 宿主与插件经 register() 声明子路由，app.ts 装配段末尾统一挂载——
 * 路径与中间件顺序完全由注册顺序决定（内置 21 条先注册即先挂，契约不变）。
 */
import type { Router } from "express";

export class RouterRegistry {
  private entries: Array<{ path: string; router: Router }> = [];

  register(path: string, router: Router): void {
    if (this.entries.some((e) => e.path === path)) {
      throw new Error(`路由路径重复注册: ${path}`);
    }
    this.entries.push({ path, router });
  }

  /** 全部按注册序返回（app.ts 遍历挂载） */
  list(): Array<{ path: string; router: Router }> {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }
}
