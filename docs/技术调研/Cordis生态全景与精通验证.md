# Cordis 生态全景与精通验证

> 调研日期：2026-08-22（第三轮：生态包 + 官方测试语义 + 从零复现推演）
> 前置阅读：[Cordis插件系统调研.md](Cordis插件系统调研.md)、[Cordis源码深度解析.md](Cordis源码深度解析.md)

## 一、monorepo 包地图

| 包 | 行数 | 职责 | 一句话精髓 |
|---|---|---|---|
| core | 1848 | Context/Fiber/事件/服务 | 一切魔法在 Proxy 陷阱与 epoch 字符串里 |
| loader | ~1500 | 配置树 EntryTree/模块加载 | 配置即插件树，变更自动落盘 |
| include | 219 | 外置 YAML/JSON 配置文件 | `!!js` 自定义 yaml tag → 表达式节点 |
| group | 3 | 组合条目 | 仅 re-export loader 的 Group（配置树里的分组节点）|
| hmr | 405 | 文件监听热重载 | externals 重启、用户文件沿依赖图传播 accept |
| timer | 142 | 定时器 | timeout/interval/throttle/debounce 全部 effect 化 |
| logger-console | ~140 | 终端输出 exporter | 默认日志后端 |
| utils (cosmokit 之外) | 42 | 杂项 | — |

## 二、本轮新挖的实现细节

### Logger（core/src/logger.ts）

- **可调用服务**的范本：`ctx.logger('name')` 通过 `[symbols.invoke]` 实现；无参调用 `ctx.logger.info(...)` 时名字按**解析链**取值：caller 的 intercept 配置 → 显式名 → 所处 Service 的注册名 → 当前 fiber 名（hyphenate）。logger.spec 里有一整组回归用例钉死这条链。
- 每个服务自带一个**环形缓冲**（默认 1000 条），exporter 可插拔且各自有 level 过滤。
- `AggregateError` 自动展开逐条记录（正好接住 `parallel()` 聚合抛出的错误）；带 `cause` 的错误先记 cause。

### Timer（timer/src/index.ts）——「一切皆 effect」贯彻到时间维度

- `ctx.timeout(fn, ms)` 返回 disposer；`ctx.timeout(ms)` 返回 Promise，**dispose 时 reject('Context has been disposed')** —— 取消即类型化错误。
- `ctx.interval(ms)` 无回调形态返回 **AsyncIterableIterator**，`for await` 循环随 fiber 卸载而终止（throw 进迭代器）。
- throttle/debounce 包装函数自带 `.dispose`。任何插件重启时其定时器自动清空——IM 场景的重连退避、 typing 节流都该学这个模式。

### Include（include/src/index.ts）——外置配置文件

- 自定义 yaml Type `tag:yaml.org,2002:js`：`!!js "表达式"` 标量被 construct 成 `{__jsExpr}` 节点对象，由 loader 在注入激活后求值——Harness 文档说的「Include 将 !!js 解析为表达式节点」就是这 14 行代码。
- `patches` 数组按 entry id 做声明式叠加：insert 只能进 group、name 不匹配则跳过（防错位）。
- 写盘是**原子写**（先写 `.tmp` 再 rename），写操作 debounce 到下一个 tick 合并。
- `initial` 字段支持首次引导生成配置文件。

### HMR 补充

从 CLI 入口可达的框架模块标记 externals（改动=整进程重启）；用户文件走 accepted/declined 集合沿 ModuleJob 依赖图传播，stash 队列去抖。等价于 Vite HMR 的 accept 链思想，但跑在 Node 内部 API 上（需 `--expose-internals`）。

## 三、官方测试揭示的语义保证（12 个 spec，约 60 用例）

这些是用例钉死的行为契约，比文档更可信：

1. **inertia 合并时序**（fiber.spec 三个 lock 用例）：加载中依赖消失 → 等 apply 完成再 unload；消失又恢复（值不同）→ 直接从 LOADING 切回 ACTIVE，apply 结果被采用，**从未执行过 unload**。
2. **失败的插件不留残影**（plugin error）：apply 抛错后，它已注册的监听器不生效——因为监听器是 effect，失败路径触发 `_unload()` 回滚了部分副作用。
3. **update 与依赖重载并发无中间态**：provider.update + consumer.update 同时发生，consumer 最终只以 `[新provider值, 新config]` 执行一次，不会出现「旧 provider × 新 config」的组合。
4. **waterfall 短路**：监听器不调 `next()` 直接返回 → 下游所有监听器都不再执行，返回值即最外层结果（events.spec 用 4 个监听器精确断言了调用次数）。
5. **parallel 错误隔离**：同步抛错和异步 reject 都不会打断其他监听器，最终聚合 AggregateError.errors。
6. **isolate 三定律**（isolate.spec）：① 根作用域提供的服务对隔离子树不可见；② 同 label 的两个 isolate 共享同一作用域（一方提供双方可见）；③ 服务构造函数里 emit 的事件只达同作用域监听器（靠 `[symbols.filter]` 按隔离标签相等性过滤）。
7. **caller ≠ shadow**（shadow.spec）：服务方法内 `[symbols.caller]` 是调用方上下文，`this.ctx` 是服务所属上下文，两者被严格区分——这是多租户视图正确性的根基。
8. **v3 没有 ready/dispose 事件**：全仓库 grep 无此二词。生命周期完全由 fiber 状态机 + disposer 承担，「启动完成」就是 state=ACTIVE，「清理」就是 disposer。v2 的心智模型已整体作废。
9. **注入泄漏防护**（reflect.spec 'service inject leak'）：strict 读取要求提供方 fiber 处于 ACTIVE，避免读到正在卸载的服务实例。
10. **根 fiber dispose**：`root.dispose() → restart()`，根上下文不可真正销毁，只能重启全部子树。

## 四、迷你版 Cordis：精通验证

能否用最少代码复现骨架？以下是推演（省略 tracing/HMR/错误栈增强，保留三大支柱）：

```ts
// ── 支柱一：Proxy 服务容器 + 原型链作用域 ──────────────
const isolate = Symbol(), shadowFiber = Symbol()

class Ctx {
  [isolate] = Object.create(null)
  constructor() { return new Proxy(this, handler) }  // 构造器返回代理
  extend(meta) {
    const c = Object.create(this)                    // 子上下文 = 原型继承
    Object.assign(c, meta); return c
  }
  isolate(name, label = Symbol(name)) {
    const map = Object.create(this[isolate]); map[name] = label
    return this.extend({ [isolate]: map })
  }
}

const handler = {
  get(target, prop, receiver) {
    if (prop in target) return Reflect.get(target, prop)      // 自有属性直通
    let fiber = receiver.fiber                                 // 沿 fiber 父链找
    while (fiber) {
      if (fiber.store[prop]) return fiber.store[prop].value    // 快照命中
      if (!(prop in fiber.inject)) {
        if (fiber.parent?.[isolate][prop] !== receiver[isolate][prop]) break // 隔离边界
      }
      fiber = fiber.parent?.fiber
    }
    throw new Error(`cannot get "${prop}" without inject`)     // fail-closed
  }
}

// ── 支柱二：effect 收集（LIFO 清理）──────────────────
class Fiber {
  disposables = []
  effect(execute) {
    const d = []
    this.disposables.push(() => d.reverse().map(f => f()))
    for (const item of [execute()].flat()) typeof item === 'function' && d.push(item)
  }
  async unload() {
    await Promise.all(this.disposables.splice(0).reverse().map(f => f())) // 逆序
  }
}

// ── 支柱三：epoch 状态机 ─────────────────────────────
refresh(fiber) {                                   // 任一依赖提供/撤销时触发
  const epoch = fiber.inject.map(n => fiber.impls[n]?.fiber.uid ?? null).join(':')
  if (epoch !== fiber.epoch) {
    fiber.epoch = epoch.includes('null') ? INACTIVE : epoch
    queueTransition(fiber)                         // reload: 发布快照+执行插件体
  }                                                // unload: 逆序跑光 disposables
}                                                  // inertia: 转换中只记目标态，
                                                   // 结束后再比对 epoch 决定是否续转
```

复现过程中体会到的三个设计必然性：
- **为什么快照 store 与权威 store 分离**：消费方读的是 `_reload` 时发布的 `{..._store}`，这样依赖重载期间旧实例仍可安全使用，切换是原子的。
- **为什么 epoch 用 uid 不用引用相等**：字符串比较天然 O(1)，且能作为「转换目标」暂存，inertia 合并才成立。
- **为什么 Proxy 必须放行 symbol/reserved 属性**：await 协议查 `then`、工具链查各种 symbol，不放行会破坏语言互操作。

## 五、给合鸣的可操作结论

1. **直接可抄的思想**（无需引入 cordis 本体）：effect 化资源管理（定时器/连接/监听器统一 LIFO 清理）、epoch 式「提供者身份变化才重建」、fail-closed 服务访问、原子快照切换。
2. **值得引入 cordis 的场景**：若合鸣云端要做**插件化扩展**（第三方能力包、可替换存储/推送后端），cordis 的 isolate+intercept+loader 组合是现成答案，且它零运行时依赖（仅 cosmokit）、1848 行可审计。
3. **需要改造的点**：notify 全量扫描换反向索引；跨进程场景下 fiber 模型不适用（需配合进程管理器，参考 Harness 的 jobs/subprocess 层）。
4. **风险提示**：tracing 代理会让调试栈变深、`console.log(service)` 显示为 Proxy；团队需接受这个学习成本。

## 六、待深入方向

- [x] ~~include 插件 `!!js` 配置插值~~（第二节）
- [x] ~~group 组合机制~~（第二节，实为 loader Group 的转发）
- [x] ~~官方测试边界语义~~（第三节）
- [ ] 若决定落地：跑通一个最小 demo（cordis + storage 双后端并列注册）验证工程手感
