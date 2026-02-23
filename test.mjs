const TOKEN = "pk_81923455_D3302HBP8J8RWE5X6PS9Q1NIBUU0ZBWW";

const res = await fetch("https://api.clickup.com/api/v2/task/86adpbfdb/time_in_status", {
  headers: { Authorization: TOKEN },
});
const d = await res.json();

const history = (d.status_history || []).filter((s) => s.status !== "Open");

console.log("=== Almeida Supermercado — Tempo por status ===");
console.log("Status atual:", d.current_status?.status);
console.log("");
for (const s of history) {
  const days = Math.round((s.total_time.by_minute / 60 / 24) * 10) / 10;
  const date = new Date(parseInt(s.total_time.since)).toLocaleDateString("pt-BR");
  console.log(`  ${s.status.padEnd(28)} ${String(days).padStart(6)} dias  (desde ${date})`);
}
