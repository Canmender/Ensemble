/** ma smoke —— 检查后端健康与 Agent 注册状态。 */
export {};
const BASE = process.env.MA_API ?? "http://localhost:8787";

async function main(): Promise<void> {
  const res = await fetch(`${BASE}/api/health`);
  if (!res.ok) {
    console.error(`health check failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const d = (await res.json()) as any;
  console.log(`status: ${d.data.status}`);
  console.log(`agents (${d.data.agents.length}):`);
  for (const a of d.data.agents) {
    console.log(`  - ${a.id.padEnd(20)} ${a.kind.padEnd(12)} ${a.registered ? "registered" : "MISSING"}`);
  }
  console.log(`workflows: ${d.data.workflows}`);
  if (d.data.configErrors?.length) {
    console.log(`config errors:`);
    for (const e of d.data.configErrors) console.log(`  - ${e}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
