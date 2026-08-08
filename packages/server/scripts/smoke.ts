/**
 * 冒烟测试：通过完整装配跑一个内置 agent，打印归一化事件流。
 * 用法：pnpm --filter @multiagent/server smoke -- <agentId> ["prompt"]
 * 注意：需先在设置中配置 provider 并给 agent 指定 model，否则报 provider_missing/model_missing。
 */
import { getEnv } from "../src/config/env";
import { openDb } from "../src/db/sqlite";
import { createAppContext } from "../src/context";

async function main(): Promise<void> {
  const env = getEnv();
  const db = openDb(env.dbPath);
  const ctx = createAppContext(env, db);

  const target = process.argv[2] ?? "builtin-assistant";
  const prompt = process.argv[3] ?? "Reply with exactly: OK";

  const agents = ctx.config.listAgents();
  if (!ctx.registry.has(target)) {
    console.error(`agent not registered: ${target}`);
    console.error(`available: ${agents.filter((a) => a.enabled).map((a) => a.id).join(", ") || "(none)"}`);
    process.exit(1);
  }

  const adapter = ctx.registry.get(target);
  console.log(`\n=== smoke test: ${target} ===`);
  console.log(`prompt: ${prompt}\n`);

  const started = Date.now();
  for await (const ev of adapter.startTask({ prompt, timeoutMs: 180_000 })) {
    console.log(JSON.stringify(ev));
    if (ev.type === "done") break;
  }
  console.log(`\n=== done in ${((Date.now() - started) / 1000).toFixed(1)}s ===`);
  ctx.registry.disposeAll();
  db.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
