import { writeFileSync } from "fs";

const API_TOKEN = "pk_81923455_D3302HBP8J8RWE5X6PS9Q1NIBUU0ZBWW";
const BASE_URL = "https://api.clickup.com/api/v2";
const LIST_ID = "211110999";

async function clickupFetch(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: API_TOKEN, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickUp API ${response.status}: ${text}`);
  }
  return response.json();
}

const minutesToDays = (min) => Math.round((min / 60 / 24) * 10) / 10;
const BLOCKED_STATUSES = ["bloqueado produto", "bloqueado pedido", "aguardando cliente"];

async function main() {
  console.log("Fetching tasks from list...");

  // Fetch all tasks (paginated)
  let allTasks = [];
  let page = 0;
  while (true) {
    const data = await clickupFetch(
      `/list/${LIST_ID}/task?include_closed=true&subtasks=false&page=${page}`
    );
    const tasks = data.tasks ?? [];
    allTasks = [...allTasks, ...tasks];
    console.log(`  Page ${page}: ${tasks.length} tasks`);
    if (data.last_page !== false || tasks.length < 100) break;
    page++;
  }

  console.log(`Total tasks: ${allTasks.length}`);

  // Extract basic info
  const taskMap = {};
  for (const t of allTasks) {
    taskMap[t.id] = {
      id: t.id,
      name: t.name,
      status: t.status?.status ?? "unknown",
      date_created: parseInt(t.date_created),
      date_done: t.date_done ? parseInt(t.date_done) : null,
      tags: (t.tags ?? []).map((tag) => tag.name),
      assignees: (t.assignees ?? []).map((a) => a.username),
    };
  }

  // Fetch time_in_status for each task
  console.log("Fetching time_in_status for each task...");
  const timeData = {};
  let i = 0;
  for (const task_id of Object.keys(taskMap)) {
    try {
      const data = await clickupFetch(`/task/${task_id}/time_in_status`);

      const history = (data.status_history ?? []).filter(
        (s) => s.status !== "Open"
      );

      const totals = history.reduce(
        (acc, s) => {
          const min = s.total_time.by_minute;
          if (BLOCKED_STATUSES.includes(s.status)) acc.blocked += min;
          else acc.active += min;
          acc.total += min;
          return acc;
        },
        { active: 0, blocked: 0, total: 0 }
      );

      // Also get phase breakdown
      const PHASE_MAP = {
        "contato/comunicação": "preparacao",
        "todo/dados coletados": "preparacao",
        "aguardando cliente": "preparacao",
        "progresso produto": "produto",
        "produtos integrado": "produto",
        "bloqueado produto": "produto",
        "progresso pedido": "pedido",
        "bloqueado pedido": "pedido",
        "revisão": "teste",
        "testando": "teste",
        "implantado": "concluido",
        "backlog": "backlog",
        "não vão iniciar": "cancelado",
      };

      const phases = { preparacao: 0, produto: 0, pedido: 0, teste: 0, concluido: 0, backlog: 0 };
      for (const s of history) {
        const phase = PHASE_MAP[s.status] ?? "outros";
        if (phases[phase] !== undefined) phases[phase] += s.total_time.by_minute;
      }

      timeData[task_id] = {
        current_status: data.current_status?.status ?? taskMap[task_id].status,
        total_days: minutesToDays(totals.total),
        active_days: minutesToDays(totals.active),
        blocked_days: minutesToDays(totals.blocked),
        blocked_pct: totals.total > 0 ? Math.round((totals.blocked / totals.total) * 100) : 0,
        status_breakdown: history.map((s) => ({
          status: s.status,
          minutes: s.total_time.by_minute,
          days: minutesToDays(s.total_time.by_minute),
          entered_at: new Date(parseInt(s.total_time.since)).toISOString(),
        })),
        phases: {
          preparacao: minutesToDays(phases.preparacao),
          produto: minutesToDays(phases.produto),
          pedido: minutesToDays(phases.pedido),
          teste: minutesToDays(phases.teste),
        },
      };

      i++;
      if (i % 10 === 0) console.log(`  Processed ${i}/${Object.keys(taskMap).length}`);
    } catch (err) {
      console.error(`  Error for ${task_id}: ${err.message}`);
      timeData[task_id] = { error: err.message };
    }
  }

  // Merge data
  const result = Object.values(taskMap).map((t) => ({
    ...t,
    ...(timeData[t.id] ?? {}),
  }));

  writeFileSync(
    "C:/Users/guilh/projetos/clickup-activity-mcp/dashboard-data.json",
    JSON.stringify({ generated_at: new Date().toISOString(), tasks: result }, null, 2)
  );

  console.log("\nDone! Data saved to dashboard-data.json");
  console.log(`Total tasks processed: ${result.length}`);

  // Quick summary
  const byStatus = {};
  for (const t of result) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  }
  console.log("\nBy status:");
  for (const [s, count] of Object.entries(byStatus).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${s}: ${count}`);
  }
}

main().catch(console.error);
