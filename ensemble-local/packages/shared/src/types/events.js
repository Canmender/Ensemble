"use strict";
// 归一化 Agent 事件 —— 适配器 / 编排引擎 / 前端 / 持久化 全部统一使用这一套事件。
Object.defineProperty(exports, "__esModule", { value: true });
exports.accumulateAgentText = accumulateAgentText;
/** 把 output 事件按时间顺序拼接成一段可渲染文本 */
function accumulateAgentText(events) {
    return events
        .filter((e) => e.type === "output")
        .map((e) => e.text)
        .join("");
}
//# sourceMappingURL=events.js.map