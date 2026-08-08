#!/usr/bin/env node
/**
 * 合鸣 CLI —— 原生命令行接口（通过本地 HTTP API 驱动）
 *
 * 用法：
 *   ma status                        查看健康与 Agent 概览
 *   ma agents                        列出 Agent
 *   ma providers                     列出 Provider
 *   ma skills                        列出 Skill
 *   ma workflows                     列出工作流
 *   ma run --agent <id> "prompt"     单发任务
 *   ma run --workflow <id> "prompt"  工作流任务
 *   ma run --chat <a,b> --rounds 3 "prompt"  群聊
 *   ma create agent --id x --name y --provider p --model m [--tools t1,t2]
 *   ma create agent --id x --name y --command "claude -p"   # --command 即本地 Agent
 *   ma create provider --id x --name y --type openai --base-url U --api-key K
 *   ma create skill --name x --desc d --body-file f
 */
export {};
const BASE = process.env.MA_API ?? "http://localhost:8787";

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return json.data as T;
}

function parseArgs(argv: string[]): { flags: Record<string, string>; rest: string[] } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else flags[a.slice(2)] = argv[++i] ?? "";
    } else rest.push(a);
  }
  return { flags, rest };
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c]?.length ?? 0)));
  return rows.map((r) => r.map((v, c) => v.padEnd(widths[c])).join("  ")).join("\n");
}

async function cmdStatus(): Promise<void> {
  const d = await api<any>("GET", "/health");
  console.log(`合鸣 ${d.status}`);
  console.log(`  agents: ${d.agents?.length ?? 0} | providers: ${d.providers ?? 0} | workflows: ${d.workflows ?? 0}`);
  console.log(`  tools: ${(d.tools ?? []).join(", ")}`);
}

async function cmdList(type: string): Promise<void> {
  if (type === "agents") {
    const list = await api<any[]>("GET", "/agents");
    if (!list.length) return console.log("(无 Agent)");
    console.log(table([
      ["ID", "名称", "类型", "模型", "状态"],
      ...list.map((a) => [a.id, a.name, a.kind, a.model || "-", a.enabled ? "启用" : "停用"]),
    ]));
  } else if (type === "providers") {
    const list = await api<any[]>("GET", "/providers");
    if (!list.length) return console.log("(无 Provider)");
    console.log(table([
      ["ID", "名称", "类型", "Key", "模型"],
      ...list.map((p) => [p.id, p.name, p.type, p.apiKeySet ? "✓" : "✗", p.defaultModel || "-"]),
    ]));
  } else if (type === "skills") {
    const list = await api<any[]>("GET", "/skills");
    if (!list.length) return console.log("(无 Skill)");
    list.forEach((s) => console.log(`- ${s.name}：${s.description}`));
  } else if (type === "workflows") {
    const list = await api<any[]>("GET", "/workflows");
    if (!list.length) return console.log("(无工作流)");
    list.forEach((w) => console.log(`- ${w.name} (${w.nodes.length} 步)`));
  }
}

async function cmdRun(args: string[], flags: Record<string, string>): Promise<void> {
  const prompt = args.join(" ") || flags.prompt;
  if (!prompt) return console.error("用法: ma run --agent <id>|--workflow <id>|--chat <ids> \"prompt\"");
  let input: unknown;
  if (flags.agent) input = { mode: "single", prompt, agentIds: flags.agent.split(",") };
  else if (flags.workflow) input = { mode: "workflow", workflowId: flags.workflow, prompt };
  else if (flags.chat)
    input = { mode: "chat", prompt, participantIds: flags.chat.split(","), maxRounds: Number(flags.rounds ?? 3) };
  else return console.error("用法: ma run --agent <id>|--workflow <id>|--chat <ids> \"prompt\"");

  const run = await api<any>("POST", "/tasks", { title: prompt.slice(0, 40), input });
  console.log(`任务已创建: ${run.id} (${run.mode})`);
  // 轮询上限（最多 10 分钟），避免卡死的 run 挂住 CLI
  for (let i = 0; i < 300; i++) {
    await sleep(2000);
    const d = await api<any>("GET", `/runs/${run.id}`);
    const cur = d.run;
    if (cur.status !== "running" && cur.status !== "queued") {
      if (cur.error) console.error(`运行 ${cur.status}: ${cur.error}`);
      else console.log(`运行 ${cur.status}: ${cur.finalResult ?? "(无结果)"}`);
      return;
    }
  }
  console.error("运行超时（10 分钟），可到看板查看");
}

async function cmdCreateAgent(flags: Record<string, string>): Promise<void> {
  if (!flags.id || !flags.name) return console.error("需要 --id 和 --name");
  const agent: any = {
    id: flags.id,
    name: flags.name,
    kind: flags.command ? "local" : "builtin",
    providerId: flags.provider ?? "",
    model: flags.model ?? "",
    tools: flags.tools ? flags.tools.split(",") : [],
    enabled: true,
    ...(flags.command ? { local: { command: flags.command, promptMode: flags.promptMode ?? "arg" } } : {}),
  };
  const created = await api<any>("POST", "/agents", agent);
  console.log(`Agent 已创建: ${created.id} (${created.kind})`);
}

async function cmdCreateProvider(flags: Record<string, string>): Promise<void> {
  if (!flags.id || !flags.name || !flags.type) return console.error("需要 --id --name --type(anthropic|openai|custom)");
  const created = await api<any>("POST", "/providers", {
    id: flags.id,
    name: flags.name,
    type: flags.type,
    baseUrl: flags["base-url"],
    apiKey: flags["api-key"],
    defaultModel: flags.model,
    enabled: true,
  });
  console.log(`Provider 已创建: ${created.id} (${created.type})`);
}

async function cmdCreateSkill(flags: Record<string, string>): Promise<void> {
  const { readFileSync } = await import("node:fs");
  if (!flags.name || !flags.desc) return console.error("需要 --name 和 --desc");
  const body = flags["body-file"] ? readFileSync(flags["body-file"], "utf8") : flags.body ?? "# 技能";
  const created = await api<any>("POST", "/skills", { name: flags.name, description: flags.desc, body });
  console.log(`Skill 已创建: ${created.name}`);
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2).filter((a) => a !== "--");
  const [cmd, sub] = raw;
  const { flags, rest } = parseArgs(raw.slice(1));
  switch (cmd) {
    case "status": await cmdStatus(); break;
    case "agents": case "providers": case "skills": case "workflows": await cmdList(cmd); break;
    case "run": await cmdRun(rest, flags); break;
    case "create":
      if (sub === "agent") await cmdCreateAgent(flags);
      else if (sub === "provider") await cmdCreateProvider(flags);
      else if (sub === "skill") await cmdCreateSkill(flags);
      else console.error("create 子命令: agent | provider | skill");
      break;
    default:
      console.log("合鸣 CLI\n\n命令: status | agents | providers | skills | workflows | run | create agent|provider|skill");
      process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
