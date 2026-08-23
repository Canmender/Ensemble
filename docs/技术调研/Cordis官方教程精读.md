# Cordis 官方教程精读：DeepSeek Harness 开发实践

> 调研日期：2026-08-23 | 来源：deepseek-harness.github.io/develop/cordis-tutorial/（总览 + 7 章全读）
> 定位：前三轮 Cordis 调研覆盖了"概念/源码/生态"，本篇补上第四块——**官方推荐的插件作者实践路径**
> 直接服务对象：《合鸣功能插件系统方案》《用户插件与本地UI呈现方案》的 SDK 设计

## 一、教程结构与教学设计（本身值得抄）

7 章递进，每章一个可运行的最小示例 + 确切命令 + 预期输出：

1. 第一个插件（函数形态 + cordis.yml 组装）
2. 生命周期与 effect（定时器包装 + fiber.dispose）
3. 服务（Service 子类 + declare module 合并 + inject 消费）
4. 事件（类型化事件声明 + 五分发模式 + waterfall 短路演示）
5. 配置（Schema 校验 + 明确报错 + !!js 计算值）
6. 组合与 HMR（id 稳定标识 + 热重载 + PENDING 诊断器）
7. 进入 harness（defineTool 注册真工具 + 观察者插件 + 无密钥跑通）

**对合鸣的直接借鉴：我们的插件开发文档应该按同样的骨架写**——每章一个能跑的最小插件、给出确切命令和预期输出、最后接入真实服务。第 7 章"无密钥环境可运行全部示例"的设计让门槛降到零。

## 二、新学到的关键知识（参考文档没有的）

### 2.1 插件模块的标准导出约定

```ts
export const name = 'hello'          // 可选显示名，用于诊断
export const inject = ['tools']      // 服务依赖（PENDING 语义）
export function apply(ctx, config) {} // 入口；函数形态连 apply 都可省
```

三种形态的选择纪律：**需要公开服务之前一律用函数形态**；对象形态要求 apply 方法；类形态留给 Service。

### 2.2 PENDING 是"静默合法态"，也是头号新手陷阱

- inject 的服务无人提供 → 插件停在 PENDING，不崩溃、不报错、不部分运行；
- **PENDING 的 fiber 不保持事件循环活跃**——组合里没有其他运行项时进程静默以 0 退出（极难排查）；
- HMR 插件若缺 timer 服务也会永远 PENDING 且不提示；
- **官方诊断模式**：遍历 `ctx.registry.values()` 打印所有 `FiberState.PENDING` 的插件——一段 15 行的诊断插件解决整类问题。

→ 合鸣 PluginHost 必须内置这个诊断器，且启动日志要打印每个插件的最终状态。

### 2.3 配置校验的双面约定

```ts
export interface Config { greeting: string; targets: string[] }   // 给消费方类型
export const Config: Schema<Config> = Schema.object({...})        // 同名运行时校验器
```

- 接口和 schema 同名导出，"类型给 TS、验证给框架"一体两面；
- cordis 接受任意 Standard Schema 验证器（我们用 zod 即可，不必学 Schemastery）；
- **apply 收到的配置永远完整且经过验证**——schema 默认值在进 apply 前补齐；
- 校验失败 → fiber FAILED + 精确路径报错（`$.targets expected array (at targets)`），进程退出码 1；
- 教程纪律："如果资源不可用，插件应当在能解析该引用时立即拒绝"——fail-fast 写进官方实践。

### 2.4 loader 配置项元数据（manifest 设计再校准)

- `id` 字段是**稳定标识**：loader 按 id 区分"修改现有条目 vs 删旧加新"。不带 id 的条目每次读取获得新生成 id，配置文件任何编辑都会导致它重挂——这是热重载语义的关键细节；
- `disabled: true` 卸载但保留配置项，改回即恢复（连同所有因它而 PENDING 的依赖方一起复活）；
- group 嵌套子列表作为整体装卸；`isolate` 让两个组各得一份同名服务的独立实例（多租户配置化）；
- `!!js` 表达式只在 config 和 disabled 字段内有效，其余元数据保持静态字面量——安全边界明确。

→ 《功能插件系统方案》的 manifest 应补充 `id` 与 `disabled` 字段语义。

### 2.5 waterfall 的官方纪律（一句话版）

> "只观察或标注的监听器必须调用 next()；不调用就返回 = 有意短路。日志插件忘调 next() 会无声吞掉下游全部默认行为。"

教程用两个监听器精确演示了转换（toUpperCase 包装）与短路（blocked 拦截）的组合顺序。合鸣消息管线文档应原样收录这条纪律为代码评审检查项。

### 2.6 disposer 并发警告

逆序启动但**多个异步 disposer 并发运行**——有顺序要求的清理步骤必须合并进同一个 disposer 内依次 await。这修正了我此前"逆序=完全串行"的隐含理解。

### 2.7 工具注册的完整闭环（第 7 章精华）

`defineTool` 做了三件事：parameters 转换为面向模型的 JSON Schema、推导 args 类型、**execute 运行前校验模型给的参数**。工具结果有规范值（output.schema）与原生渲染（output.render）两层。观察方通过 `tools/result` 事件旁路监听全部调用——生产者与消费者互不相识，由注册表+事件连接。

## 三、对合鸣三个方案的修订点

| 方案 | 修订 |
|---|---|
| 功能插件系统 | ① manifest 补 id/disabled 语义；② PluginHost 内置 PENDING 诊断器 + 启动状态报告；③ 插件模板仓库按教程 7 章结构组织（每章一个最小可运行样例）；④ 文档承诺"无密钥可跑通全部示例" |
| 用户插件 UI | ⑤ 工具参数校验前置（defineTool 三合一）值得抄进 AgentTool 接口演进；⑥ tools/result 式观察事件模式用于聊天卡片状态广播 |
| Cordis 应用方案 | ⑦ disposer 并发警告写入阶段 1 的 dispose 改造注意事项 |

## 四、一句话总结

这份教程证明 Cordis 的学习曲线可以压到"一小时从 hello world 到真实工具注册"，而它的教学骨架（最小示例+确切输出+无密钥环境+诊断陷阱专章）就是合鸣插件 SDK 文档的现成蓝本。

来源：[Cordis 教程总览](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/) 及其 01~07 各章
