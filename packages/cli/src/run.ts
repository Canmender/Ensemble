/**
 * ma run —— 通过后端 API 运行一个任务。
 * 用法：ma run --agent <id> "prompt"
 *       ma run --workflow <workflowId> "prompt"
 *       ma run --chat <id1>,<id2> --rounds 3 "prompt"
 */
export {};
const BASE = process.env.MA_API ?? "http://localhost:8787";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        args[a.slice(2)] = argv[++i] ?? "";
      }
    } else {
      rest.push(a);
    }
  }
  return { args, prompt: rest.join(" ") };
}

async function main(): Promise<void> {
  const { args, prompt } = parseArgs(process.argv.slice(2));

  let input: unknown;
  if (args.agent) {
    input = { mode: "single", prompt, agentIds: args.agent.split(",") };
  } else if (args.workflow) {
    input = { mode: "workflow", workflowId: args.workflow, prompt };
  } else if (args.chat) {
    input = {
      mode: "chat",
      prompt,
      participantIds: args.chat.split(","),
      maxRounds: Number(args.rounds ?? 3),
    };
  } else {
    console.error("usage: ma run --agent <id>|--workflow <id>|--chat <ids> \"prompt\"");
    process.exit(1);
  }

  const res = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: prompt.slice(0, 40), input }),
  });
  if (!res.ok) {
    console.error("failed:", await res.text());
    process.exit(1);
  }
  const { data: run } = (await res.json()) as any;
  console.log(`run created: ${run.id} (${run.mode})`);

  // 轮询直到终态
  let prevResult: string | undefined;
  for (;;) {
    await sleep(2000);
    const r = await fetch(`${BASE}/api/runs/${run.id}`);
    const d = (await r.json()) as any;
    const cur = d.data.run;
    if (cur.status !== "running" && cur.status !== "queued") {
      if (cur.error) console.error(`run ${cur.status}: ${cur.error}`);
      else console.log(`run ${cur.status}: ${cur.finalResult ?? "(no result)"}`);
      break;
    }
    if (cur.finalResult && cur.finalResult !== prevResult) {
      console.log(cur.finalResult.slice(-120));
      prevResult = cur.finalResult;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
