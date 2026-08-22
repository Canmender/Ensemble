# 技术调研索引

> ox-alpha 的调研沉淀区。主题：高性能 / 高并发 / 加密安全。
> 每份文档含：结论速览 → 主体分析 → 对合鸣的落地建议 → 参考来源。

## Cordis 插件系统专题（三轮递进）

| 文档 | 层次 | 内容 |
|---|---|---|
| [Cordis插件系统调研.md](Cordis插件系统调研.md) | 概念 / API | 五核心概念、事件五分发模式、Context/Fiber/Registry 速查、安全与并发视角 |
| [Cordis源码深度解析.md](Cordis源码深度解析.md) | 源码 | core 1848 行通读：Proxy 解析路径、epoch 状态机、effect 树、tracing、loader/HMR |
| [Cordis生态全景与精通验证.md](Cordis生态全景与精通验证.md) | 生态 / 验证 | timer/logger/include 生态包、60 个官方用例钉死的语义契约、迷你实现推演 |

## IM 工程专题

| 文档 | 主题 | 关键结论 |
|---|---|---|
| [高并发IM服务器架构调研.md](高并发IM服务器架构调研.md) | 高并发 | 无状态网关+Redis 骨干；at-least-once+幂等去重；会话内 seq；SFU 演进。**含合鸣代码审计核实（4 项缺失 + 1 个补拉参数名 bug）** |
| [IM端到端加密协议调研.md](IM端到端加密协议调研.md) | 加密安全 | Signal 双件套（X3DH+Double Ratchet）；群聊 MLS/TreeKEM；合鸣落地路线（含桌面 KeyStore 落点核实） |

## 待办衔接

- 高并发文档「落地优先级」一节的 P0-a（补拉参数名修复）是当前已知唯一 bug 级发现。
- 凭据轮换待办（见项目记忆）与 E2EE 路线第 3 步形成闭环。
