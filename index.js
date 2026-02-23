import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const BASE_URL = "https://api.clickup.com/api/v2";

if (!API_TOKEN) {
  process.stderr.write("Error: CLICKUP_API_TOKEN env var is required\n");
  process.exit(1);
}

async function clickupFetch(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: API_TOKEN,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickUp API ${response.status}: ${text}`);
  }

  return response.json();
}

const server = new McpServer({
  name: "clickup-activity",
  version: "1.0.0",
});

server.tool(
  "clickup_get_task_time_in_status",
  `Get how long a ClickUp task has spent in each status.
Returns the current status, full status history with time in minutes and entry timestamps.
Use this to calculate: time in each phase, blocked vs active time, SLA metrics.`,
  {
    task_id: z.string().describe("The ClickUp task ID (e.g. '86adpbfdb')"),
  },
  async ({ task_id }) => {
    const data = await clickupFetch(`/task/${task_id}/time_in_status`);

    const minutesToDays = (min) => Math.round((min / 60 / 24) * 10) / 10;
    const minutesToHours = (min) => Math.round((min / 60) * 10) / 10;

    const history = (data.status_history ?? [])
      .filter((s) => s.status !== "Open") // remove the generic "Open" aggregate
      .map((s) => ({
        status: s.status,
        color: s.color,
        total_minutes: s.total_time.by_minute,
        total_hours: minutesToHours(s.total_time.by_minute),
        total_days: minutesToDays(s.total_time.by_minute),
        entered_at: new Date(parseInt(s.total_time.since)).toISOString(),
        orderindex: s.orderindex,
      }))
      .sort((a, b) => new Date(a.entered_at) - new Date(b.entered_at));

    const current = data.current_status
      ? {
          status: data.current_status.status,
          total_minutes: data.current_status.total_time.by_minute,
          total_hours: minutesToHours(data.current_status.total_time.by_minute),
          total_days: minutesToDays(data.current_status.total_time.by_minute),
          entered_at: new Date(
            parseInt(data.current_status.total_time.since)
          ).toISOString(),
        }
      : null;

    // Classify statuses as active or blocked
    const BLOCKED_STATUSES = ["bloqueado produto", "bloqueado pedido", "aguardando cliente"];

    const totals = history.reduce(
      (acc, s) => {
        if (BLOCKED_STATUSES.includes(s.status)) {
          acc.blocked_minutes += s.total_minutes;
        } else {
          acc.active_minutes += s.total_minutes;
        }
        return acc;
      },
      { active_minutes: 0, blocked_minutes: 0 }
    );

    const totalMinutes = totals.active_minutes + totals.blocked_minutes;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              task_id,
              current_status: current,
              status_history: history,
              summary: {
                total_days: minutesToDays(totalMinutes),
                active_days: minutesToDays(totals.active_minutes),
                blocked_days: minutesToDays(totals.blocked_minutes),
                active_pct:
                  totalMinutes > 0
                    ? Math.round((totals.active_minutes / totalMinutes) * 100)
                    : 0,
                blocked_pct:
                  totalMinutes > 0
                    ? Math.round((totals.blocked_minutes / totalMinutes) * 100)
                    : 0,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "clickup_get_list_time_in_status",
  `Get time-in-status data for ALL tasks in a ClickUp list.
Returns aggregated metrics per task: current status, total days, active vs blocked time.
Use this to build dashboards like: average time per phase, blocked percentage, time per store.`,
  {
    list_id: z.string().describe("The ClickUp list ID (e.g. '211110999' for Integrações)"),
    task_ids: z
      .array(z.string())
      .optional()
      .describe("Optional: filter to specific task IDs. If omitted, fetches all tasks from the list first."),
  },
  async ({ list_id, task_ids }) => {
    let ids = task_ids;

    // If no task_ids provided, fetch them from the list
    if (!ids || ids.length === 0) {
      const listData = await clickupFetch(
        `/list/${list_id}/task?include_closed=true&subtasks=false&page=0`
      );
      ids = (listData.tasks ?? []).map((t) => t.id);
    }

    const minutesToDays = (min) => Math.round((min / 60 / 24) * 10) / 10;
    const BLOCKED_STATUSES = ["bloqueado produto", "bloqueado pedido", "aguardando cliente"];

    const results = [];

    for (const task_id of ids) {
      try {
        const data = await clickupFetch(`/task/${task_id}/time_in_status`);

        const history = (data.status_history ?? []).filter(
          (s) => s.status !== "Open"
        );

        const totals = history.reduce(
          (acc, s) => {
            const min = s.total_time.by_minute;
            if (BLOCKED_STATUSES.includes(s.status)) {
              acc.blocked += min;
            } else {
              acc.active += min;
            }
            acc.total += min;
            return acc;
          },
          { active: 0, blocked: 0, total: 0 }
        );

        results.push({
          task_id,
          current_status: data.current_status?.status ?? "unknown",
          total_days: minutesToDays(totals.total),
          active_days: minutesToDays(totals.active),
          blocked_days: minutesToDays(totals.blocked),
          blocked_pct:
            totals.total > 0
              ? Math.round((totals.blocked / totals.total) * 100)
              : 0,
          status_breakdown: history.map((s) => ({
            status: s.status,
            days: minutesToDays(s.total_time.by_minute),
          })),
        });
      } catch (err) {
        results.push({ task_id, error: err.message });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ total_tasks: results.length, tasks: results }, null, 2),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
