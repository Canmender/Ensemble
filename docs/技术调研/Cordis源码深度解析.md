# Cordis 源码深度解析

> 调研日期：2026-08-22（基于上游 cordiverse/cordis 主分支，core 共 1848 行）
> 前置阅读：[Cordis插件系统调研.md](Cordis插件系统调研.md)
> 方法：浅克隆上游仓库逐文件通读 `packages/core/src`（context / reflect / events / fiber / registry / service / utils），辅读 loader 与 hmr 包

## 一、总体架构：一张图

```
root Fiber (uid=0, trunk)
 └─ 每个插件 = 一个 Fiber，且作为 effect 挂在父 fiber 上
     Fiber.ctx = parent.ctx.extend({ fiber })   ← 原型链子上下文
         ├─ [symbols.isolate]  ← 原型链式作用域映射表（isolate() 只加一层）
         ├─ [symbols.intercept]← 原型链式配置拦截表（intercept() 只加一层）
         └─ Proxy(ReflectService.handler)  ← 所有属性读写走这里
```

三个关键事实：
1. **Context 构造函数返回的是自身的 Proxy**（`new Proxy(this, ReflectService.handler)`），一切魔法都在 get/set/has 陷阱里。
2. **每个插件的 ctx 是父 ctx 的原型继承对象**——`extend()` 用 `Object.create` 实现，零拷贝。
3. **插件树 = effect 树**：fiber 在构造时把自己注册为父 fiber 的一个 effect（label `'ctx.plugin()'`），因此卸载任何子树时，disposer 沿注册逆序自动级联执行。

## 二、服务解析的完整路径（reflect.ts）

读取 `ctx.foo` 时，Proxy get 陷阱依次经过：

1. **特殊属性直通**：symbol、`prototype`、`then`、纯数字串、下划线开头 —— 直接 `Reflect.get`，避免代理干扰语言内部协议（如 await 检查 `then`）。
2. **自有属性直通**：target 上真实存在的属性不走服务解析。
3. **accessor 属性**：调用注册的 get 钩子。
4. **非运行期（根上下文装配阶段）**：宽松读取（strict=false）。
5. **正式路径：先过 `internal/get` waterfall**（宿主可拦截/审计每次服务读取），默认闭包做真正的解析：

```ts
let fiber = (ctx[symbols.shadow] ?? ctx).fiber
while (true) {
  const impl = fiber.store?.[prop]          // ① 查当前 fiber 的服务快照
  if (impl) return impl.value
  if (prop in fiber.inject) throw ...       // ② 声明了但不可用 → 报"inactive"
  if (!fiber.runtime) throw ...             // ③ 走到根还没找到
  if (fiber.parent[symbols.isolate][prop] !== key) throw ... // ④ 跨越隔离边界，停
  fiber = fiber.parent.fiber                // ⑤ 沿 fiber 父链向上找
}
```

要点：解析走的是 **fiber 父链**而不是上下文原型链；每一步都校验隔离标签一致才继续上溯。未声明就访问会直接抛错（fail-closed 封装）。

### 作用域隔离的实现

`isolate(name)` 的实现只有两行：

```ts
const shadow = Object.create(this[symbols.isolate])  // 原型链挂一层新映射
shadow[name] = label ?? Symbol(name)
return this.extend({ [symbols.isolate]: shadow })
```

查找 `ctx[symbols.isolate][name]` 时沿映射表的原型链自然命中最近的祖先定义。而服务实例统一存放在一个扁平的 `ReflectService.store: Dict<Impl, symbol>` 里，**键就是作用域 symbol** —— 同名服务在不同作用域中各自存在、互不干扰。这是"多租户"能力的全部实现基础。

## 三、Fiber：epoch 驱动的生命周期状态机（fiber.ts）

这是整个框架最精巧的部分。插件体不是"启动一次"，而是**每当依赖的提供者集合变化就重新执行**。

### epoch 字符串

```ts
_refresh() {
  let epoch = ''
  for (const name of Object.keys(this.inject)) {
    const impl = this._store[name]
    if (!impl) { epoch = INACTIVE; break }      // '__INACTIVE__'
    epoch += ':' + impl.fiber.uid               // 提供者的身份，不是值！
  }
  this._setEpoch(epoch)
}
```

- 任一必需服务缺失 → epoch = INACTIVE → 卸载状态。
- 服务**值**变化不会触发重启（uid 不变则 epoch 不变）——天然防止重载风暴；只有提供者 fiber 换人才重启。

### 状态机与惯性（inertia）

状态由三件事推导：`uid === null → DISPOSED`；有 `_error → FAILED`；epoch ≠ INACTIVE → ACTIVE，否则 PENDING。转换途中显示 LOADING / UNLOADING。

- `_setEpoch()` 发现变化时，若当前没有进行中的转换（inertia），立即发起 `_reload()` 或 `_unload()`；若有，只更新 epoch。
- 转换结束时重新检查 epoch，若又变了就继续下一轮转换。**快速连续的服务变更被自动合并**，`await()` 会排空所有 inertia 再返回。
- `_reload()`：先把依赖快照发布为 `store = {...this._store}`（消费方从此快照读取），再执行插件回调；出错则记 `_error` 并回到 INACTIVE。
- `_unload()`：清空并按序 await 全部 disposables，然后 `store = undefined`。
- 跨越 ACTIVE 边界时，通知本 fiber 提供的所有服务（`reflect.notify`）→ 扫描全部已注册 fiber，对注入了该服务的做 `_checkImpl` + `_refresh` —— 这就是**响应式依赖图**的传播边。

## 四、effect 系统：可逆副作用的四种形态

`ctx.effect(execute)` 的 execute 返回值支持四种形态（`_execute` 分派）：

| 形态 | 行为 |
|---|---|
| 函数 | 直接作为 disposer |
| Promise\<disposer\> | then 收集 |
| 同步生成器 | 逐个 yield disposer，**产生即注册**（边跑边可清理） |
| 异步生成器 | 同上，但每轮迭代检查 `runner.epoch !== oldEpoch` 及时中止过期迭代 |

清理语义：
- 每个 effect 有独立 disposables 列表，触发时**逆序**执行；异步 disposer 用 `task.then(nextDispose)` 链式保序。
- wrapper 幂等（epoch 标志位）、带 `.then()`（await 它会等清理完成）、防 unhandled rejection（失败兜底再清理一次再记日志）。
- `EffectMeta { label, children }` 树随收集自动构建，`getEffects()` 可导出诊断树——DeepSeek Harness 文档里的诊断能力就来自这里。
- 错误堆栈增强：`composeError` 把外层（注册时）栈拼接进异步错误的 stack，解决 async 断栈问题。

## 五、事件系统实现细节（events.ts）

- **分发前置处理 `_resolve`**：首参可为 thisArg（作用域分发）；非 internal 事件先 emit 一条 `internal/dispatch`（全局观测点）；再用 `thisArg[Context.filter]` 过滤监听器——scope 包的"按 agent 作用域过滤事件"就是靠这个钩子。
- **waterfall 是同步组合**（验证了 Harness 表格的"不 await"）：监听器拿到同步 `next`，异步监听器返回的 promise 由调用方决定是否等待；分发器本身立即返回最外层结果。
- `parallel` = `Promise.allSettled` 后聚合抛 `AggregateError`——单个监听器失败不影响其他监听器执行完毕，错误集中上报。
- `serial` 顺序 await 到首个 bail 值；`bail` 是其同步版。bail 判定：非 null/false/undefined。
- `on()` 会用 `reflect.bind` 包装监听器：调用时对 this 和参数做 traceable 化——**监听器里的 `this` 和 ctx 参数自动变成分发方作用域的视图**。
- 特殊事件路由：监听 `internal/update` 的非 global 监听器实际挂到所属 fiber 的私有列表里，随 fiber 卸载而死；框架自带一条 global 的 internal/update 处理器把各 fiber 的钩子串成瀑布。

## 六、Tracing：一份服务实例如何服务多个上下文（utils.ts)

`createTraceable` 是理解 Cordis"上下文感知"的钥匙。Service 实例携带 tracker `{associate: 服务名, property: 'ctx'}`，当从某个 ctx 读出服务时，拿到的其实是代理：

- 读 `.ctx` 返回**你读取时所用的那个 ctx**（而非服务创建时的 ctx）；
- 调用方法时，this 被绑到一个 shadow 接收器（原属性值 + 覆盖后的 ctx），方法体内访问其他服务时按调用方的作用域解析；
- `associate` 支撑 `bot.channel` 式关联属性：查 accessor 注册表的 `${name}.${prop}` 键。

这解释了 isolate 场景下的行为：不同租户子树读同一个 Service 单例，各自看到"自己的"视图。`getTraceable` 负责在传递中解包 shadow、保持单例身份。

其余基础设施：
- **DisposableList**：Map 序号 + WeakMap 反向索引，`clear()` 返回反转快照供 LIFO 清理；WeakMap 保证已释放 effect 不阻塞 GC。
- **跨 realm 品牌**：所有内部符号都用 `Symbol.for('cordis.*')` 全局注册；`Context.is` 更是利用 `Symbol.toPrimitive` 把静态方法本身转成全局 symbol——多个 cordis 副本共存也能互相识别。
- **@Inject 装饰器**（registry.ts）：类级别把 inject 映射做成**原型链式**（checkProto 标记），子类自动继承父类依赖声明；方法级别在构造后自动包一层 `ctx.inject(...)`，方法随依赖变化自动重跑。
- **Service 类**：构造即 `reflect.provide(name, this, check)`；`[symbols.invoke]` 让服务可调用（如 `ctx.logger('name')`），用 `joinPrototype` 保住类方法原型链；`[symbols.resolveConfig]` 沿 intercept 原型链祖先优先合并配置（支持自定义 merge）；`[symbols.filter]` 以隔离标签相等性限定事件可见范围；重写 `[Symbol.hasInstance]` 让 instanceof 穿透代理。

## 七、loader 与 hmr：配置持久化与热重载

**Loader**（EntryTree 配置树）：
- 通过两条 global `internal/update` 监听实现配置回写：插件配置更新时写回 entry.options 并 `tree.write()` 落盘。
- 监听 `internal/plugin` 做"自关闭检测"：发现某 entry 的根 fiber 被 `dispose()` 且非加载器行为所致 → 把 `disabled: true` 写回配置文件（用户在运行时禁用插件会被持久化）。
- `locate(fiber)` 沿父链找到 entry id，用于日志命名空间。

**HMR**：
- chokidar 监听文件 + Node 内部模块 API（`--expose-internals`，ModuleJob/ModuleLoader）遍历模块依赖图。
- 从 CLI 入口可达的框架文件标记为 externals——这些文件变更只能整进程重启。
- 其余用户文件的变更走 accepted/declined 集合沿依赖图传播（类似 Vite HMR 的 accept 链），stashed 变更队列去抖。

## 八、性能与并发评注（源码视角）

- 全部依赖追踪基于**原型链查找 + 字符串 epoch 比较**，无代理数组、无深比较；单次解析 O(depth)。
- `notify()` 变更传播是全量扫描所有 fiber（O(插件数 × 注入数)）。几百个插件无感；上千个高频服务抖动时会成为热点——若借鉴到合鸣，需要换成反向索引。
- 无锁并发模型成立的前提是 JS 单线程事件循环 + inertia 合并；移植到多线程/多进程场景需另行设计。
- WeakRef/WeakMap 大量用于生命周期登记，避免框架自身造成内存滞留。

## 九、安全评注（源码视角）

- **fail-closed 属性访问**：Proxy 对未声明的服务读取直接抛错，"没 inject 就看不见"是运行时强制的访问边界，不只是类型约定。
- **写所有权校验**：`set` 要求提供者 fiber 与当前 fiber 相同（`cannot set property X in multiple fibers`），防止跨插件篡改服务状态。
- **internal/* 瀑布**等于给宿主留了全套审计面：get/set/listener/dispatch/service 全部可观测、可改写。
- **作用域即权限域**：isolate 标签不等则解析失败 + 事件过滤器不匹配，双重隔离。
- 注意边界：这套封装防的是"误用"，不是恶意代码——同进程内插件仍可绕过 Proxy 直取 `ReflectService.store`。真沙箱要靠进程/VM 边界（Harness 正是用 subprocess/e2b/vm 补齐这一层）。

## 十、待深入方向

- [x] ~~拉源码读 Proxy 解析与 fiber 调度~~（本文）
- [x] ~~waterfall 异步语义与错误传播~~（第五节：同步组合 + AggregateError + composeError 长栈）
- [x] ~~include 插件的 `!!js` Loader 配置插值~~ → 见 [Cordis生态全景与精通验证.md](Cordis生态全景与精通验证.md)
- [x] ~~group 包（组合包机制）与 logger 的分代日志~~ → 同上
- [ ] 若决定落地：跑通最小 demo 验证工程手感（引入 cordis 本体 vs 自研轻量版）
