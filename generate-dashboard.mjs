import { readFileSync, writeFileSync } from "fs";

const raw = JSON.parse(readFileSync("C:/Users/guilh/projetos/clickup-activity-mcp/dashboard-data.json", "utf8"));
const implantadoresRaw = JSON.parse(readFileSync("C:/Users/guilh/projetos/clickup-activity-mcp/implantadores-data.json", "utf8"));

const ACTIVE_STATUSES = [
  "contato/comunicação", "todo/dados coletados", "progresso produto",
  "produtos integrado", "progresso pedido", "bloqueado pedido",
  "bloqueado produto", "revisão", "aguardando cliente", "backlog",
];
const BLOCKED_STATUSES = ["bloqueado pedido", "bloqueado produto", "aguardando cliente"];
const IN_PROGRESS_STATUSES = [
  "contato/comunicação", "todo/dados coletados", "progresso produto",
  "produtos integrado", "progresso pedido", "revisão",
];

const STATUS_ORDER = {
  "bloqueado pedido": 0, "bloqueado produto": 1, "aguardando cliente": 2,
  "revisão": 3, "progresso pedido": 4, "produtos integrado": 5,
  "progresso produto": 6, "todo/dados coletados": 7, "contato/comunicação": 8,
  "backlog": 9,
};

const STATUS_COLORS = {
  "contato/comunicação": "#6366f1",
  "todo/dados coletados": "#8b5cf6",
  "aguardando cliente": "#f59e0b",
  "progresso produto": "#3b82f6",
  "produtos integrado": "#06b6d4",
  "bloqueado produto": "#ef4444",
  "progresso pedido": "#10b981",
  "bloqueado pedido": "#f97316",
  "revisão": "#a855f7",
  "backlog": "#475569",
};

function normalizeERP(tags) {
  if (!tags || tags.length === 0) return "N/A";
  const erpTags = tags.filter(t => /erp/i.test(t));
  if (erpTags.length === 0) return "N/A";
  const cleaned = erpTags.map(t => {
    const c = t.replace(/^[:\s]*erp[:\s]*/i, "").trim();
    return c.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }).filter(Boolean);
  return [...new Set(cleaned)].join(", ");
}

function cleanName(name) {
  return name
    .replace("[INTEGRACAO] ", "")
    .replace(/\[MIGRAÇÃO MERCADAPP\]/gi, "")
    .replace(/\[MIGRAÇÃO VTEX\]/gi, "")
    .replace(/\(Migração Mercadapp\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Detect store group (network)
function detectGroup(name) {
  const n = cleanName(name).toLowerCase();
  if (n.includes("redem") || n.includes("redemix")) return "RedeMIX";
  if (n.includes("empório natural mix") || n.includes("emporio natural mix")) return "Empório Natural Mix";
  if (n.includes("empório pas") || n.includes("emporio pas")) return "Empório Pas";
  if (n.includes("araripe")) return "Araripe Supermercado";
  if (n.includes("ana risorlange")) return "Ana Risorlange";
  if (n.includes("compre certo")) return "Compre Certo";
  if (n.includes("telefrango")) return "Telefrango Supermercados";
  if (n.includes("super portugal")) return "Super Portugal";
  if (n.includes("r center")) return "R Center";
  if (n.includes("hortisul")) return "Hortisul";
  return "Individual";
}

// Load active tasks
const tasks = raw.tasks
  .filter(t => t.name.startsWith("[INTEGRACAO]") && !t.name.toLowerCase().includes("integrações paradas"))
  .filter(t => ACTIVE_STATUSES.includes(t.status))
  .map(t => ({
    id: t.id,
    name: cleanName(t.name),
    rawName: t.name,
    status: t.status,
    color: STATUS_COLORS[t.status] || "#475569",
    isBlocked: BLOCKED_STATUSES.includes(t.status),
    isInProgress: IN_PROGRESS_STATUSES.includes(t.status),
    isBacklog: t.status === "backlog",
    erp: normalizeERP(t.tags),
    group: detectGroup(t.name),
    date_created: t.date_created,
    total_days: t.total_days || 0,
    active_days: t.active_days || 0,
    blocked_days: t.blocked_days || 0,
    blocked_pct: t.blocked_pct || 0,
    phases: t.phases || { preparacao: 0, produto: 0, pedido: 0, teste: 0 },
    status_breakdown: t.status_breakdown || [],
    url: `https://app.clickup.com/t/${t.id}`,
    created_label: t.date_created ? new Date(t.date_created).toLocaleDateString("pt-BR") : "—",
    days_since_created: t.date_created
      ? Math.round((Date.now() - t.date_created) / 86400000)
      : null,
  }));

console.log(`Active tasks: ${tasks.length}`);
const byStatus = {};
tasks.forEach(t => { byStatus[t.status] = (byStatus[t.status]||0)+1; });
console.log("By status:", JSON.stringify(byStatus));

// ── KPIs ──────────────────────────────────────────────────────────────────────
const kpis = {
  total: tasks.length,
  inProgress: tasks.filter(t => t.isInProgress).length,
  blocked: tasks.filter(t => t.isBlocked).length,
  backlog: tasks.filter(t => t.isBacklog).length,
  blockedPct: Math.round(tasks.filter(t=>t.isBlocked).length / tasks.filter(t=>!t.isBacklog).length * 100),
  avgDays: (() => {
    const w = tasks.filter(t=>t.total_days>0);
    return w.length ? Math.round(w.reduce((a,t)=>a+t.total_days,0)/w.length*10)/10 : 0;
  })(),
  groups: [...new Set(tasks.map(t=>t.group))].length,
};

// ── By status (for kanban + chart) ───────────────────────────────────────────
const statusGroups = {};
for (const t of tasks) {
  if (!statusGroups[t.status]) statusGroups[t.status] = [];
  statusGroups[t.status].push(t);
}

// ── Groups ────────────────────────────────────────────────────────────────────
const groups = {};
for (const t of tasks) {
  if (!groups[t.group]) groups[t.group] = [];
  groups[t.group].push(t);
}

// ── Sorted tasks ──────────────────────────────────────────────────────────────
const sortedByPriority = [...tasks].sort((a,b) =>
  (STATUS_ORDER[a.status]||99) - (STATUS_ORDER[b.status]||99) ||
  b.blocked_days - a.blocked_days
);

const sortedByBlocked = [...tasks]
  .filter(t => t.blocked_days > 0 || t.isBlocked)
  .sort((a,b) => b.blocked_pct - a.blocked_pct);

const sortedByGroup = [...tasks].sort((a,b) =>
  a.group.localeCompare(b.group) || (STATUS_ORDER[a.status]||99) - (STATUS_ORDER[b.status]||99)
);

// ── D4: Phase breakdown for tasks with data ───────────────────────────────────
const withPhases = tasks.filter(t => t.total_days > 0 && (t.phases.preparacao + t.phases.produto + t.phases.pedido + t.phases.teste > 0));

const phaseStats = ["preparacao", "produto", "pedido", "teste"].map(ph => {
  const vals = withPhases.map(t=>t.phases[ph]).filter(v=>v>0);
  if (!vals.length) return { phase: ph, avg: 0, min: 0, max: 0, count: 0 };
  vals.sort((a,b)=>a-b);
  return {
    phase: ph,
    avg: Math.round(vals.reduce((a,b)=>a+b,0)/vals.length*10)/10,
    min: vals[0],
    max: vals[vals.length-1],
    median: vals[Math.floor(vals.length/2)],
    count: vals.length,
  };
});

// ── Implantadores data ────────────────────────────────────────────────────────
const IMP_COLORS = { "Derik": "#8b5cf6", "Laissa": "#10b981", "Ana Débora": "#f59e0b" };
const IMP_INITIALS = { "Derik": "DL", "Laissa": "LO", "Ana Débora": "AD" };

const implantadoresData = {
  implantadores: ["Derik", "Laissa", "Ana Débora"].map(name => {
    const itasks = implantadoresRaw.tasks.filter(t => t.implantador === name);
    const byStatus = {};
    itasks.forEach(t => { byStatus[t.status] = (byStatus[t.status]||0)+1; });
    return {
      name,
      color: IMP_COLORS[name],
      initials: IMP_INITIALS[name],
      total: itasks.length,
      blocked: itasks.filter(t => t.isBlocked).length,
      inProgress: itasks.filter(t => !t.isBlocked && t.status !== "backlog").length,
      backlog: itasks.filter(t => t.status === "backlog").length,
      avgDays: itasks.length ? Math.round(itasks.reduce((s,t) => s+t.daysSinceCreated,0)/itasks.length) : 0,
      maxDays: itasks.length ? Math.max(...itasks.map(t=>t.daysSinceCreated)) : 0,
      byStatus,
      tasks: itasks.map(t => ({
        id: t.id,
        name: t.name.replace("[INTEGRACAO] ","").replace(/\[MIGRAÇÃO.*?\]/gi,"").replace(/\(Migração.*?\)/gi,"").trim(),
        status: t.status,
        isBlocked: t.isBlocked,
        erp: t.erp || "N/A",
        daysSinceCreated: t.daysSinceCreated,
        daysSinceUpdated: t.daysSinceUpdated,
        engajamento: t.engajamento_lojista,
        assignees: t.assignees,
        url: t.url,
      })),
    };
  }),
  noImplantador: implantadoresRaw.noImplantador.map(t => ({
    ...t,
    name: t.name.replace("[INTEGRACAO] ","").replace(/\[MIGRAÇÃO.*?\]/gi,"").replace(/\(Migração.*?\)/gi,"").trim().substring(0,50),
  })),
  total: implantadoresRaw.tasks.length,
};

// ── Serialize to embed in HTML ────────────────────────────────────────────────
const DATA = {
  kpis,
  tasks: sortedByPriority.map(t => ({
    id: t.id, name: t.name, status: t.status, color: t.color,
    isBlocked: t.isBlocked, isBacklog: t.isBacklog, erp: t.erp, group: t.group,
    total_days: t.total_days, active_days: t.active_days, blocked_days: t.blocked_days,
    blocked_pct: t.blocked_pct, url: t.url, created_label: t.created_label,
    days_since_created: t.days_since_created,
    phases: t.phases,
    status_breakdown: t.status_breakdown,
  })),
  statusGroups: Object.entries(statusGroups)
    .sort((a,b) => (STATUS_ORDER[a[0]]||99) - (STATUS_ORDER[b[0]]||99))
    .map(([status, tasks]) => ({
      status, color: STATUS_COLORS[status]||"#475569",
      count: tasks.length,
      blocked: BLOCKED_STATUSES.includes(status),
      tasks: tasks.map(t => ({ id:t.id, name:t.name, group:t.group, erp:t.erp, total_days:t.total_days, blocked_days:t.blocked_days, blocked_pct:t.blocked_pct, url:t.url }))
    })),
  groups: Object.entries(groups)
    .sort((a,b) => b[1].length - a[1].length)
    .map(([group, tasks]) => ({
      group,
      count: tasks.length,
      blocked: tasks.filter(t=>t.isBlocked).length,
      inProgress: tasks.filter(t=>t.isInProgress).length,
      backlog: tasks.filter(t=>t.isBacklog).length,
      statuses: [...new Set(tasks.map(t=>t.status))],
      avgDays: (() => {
        const w = tasks.filter(t=>t.total_days>0);
        return w.length ? Math.round(w.reduce((a,t)=>a+t.total_days,0)/w.length*10)/10 : 0;
      })(),
    })),
  phaseStats,
  sortedByBlocked: sortedByBlocked.map(t => ({ name:t.name, status:t.status, color:t.color, blocked_days:t.blocked_days, blocked_pct:t.blocked_pct, total_days:t.total_days, url:t.url, group:t.group })),
};

const generatedAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

// ── Pre-compute implantadores tab HTML ────────────────────────────────────────
function daysColor(d) {
  if (d > 90) return "text-red-400";
  if (d > 60) return "text-orange-400";
  if (d > 30) return "text-yellow-400";
  return "text-slate-300";
}

const implantadoresTabHTML = (() => {
  // Cards
  const cardsHTML = implantadoresData.implantadores.map(imp => {
    const statusEntries = Object.entries(imp.byStatus).sort((a,b) => b[1]-a[1]);
    const alertHTML = imp.maxDays > 90
      ? '<div class="mt-3"><span class="badge text-xs" style="background:#ef444422;color:#ef4444;border:1px solid #ef444440">⚠ até ' + imp.maxDays + 'd na fila</span></div>'
      : '';
    const blockedBarW = Math.round(imp.blocked / Math.max(imp.total,1) * 100);
    const inProgBarW  = Math.round(imp.inProgress / Math.max(imp.total,1) * 100);
    const backlogBarW = Math.round(imp.backlog / Math.max(imp.total,1) * 100);
    const avgDaysCls  = daysColor(imp.avgDays);
    const statusBreakdown = statusEntries.map(([s, c]) => {
      const sc = STATUS_COLORS[s] || '#475569';
      return '<div class="flex items-center justify-between text-xs">'
        + '<span class="flex items-center gap-1.5">'
        + '<span class="w-1.5 h-1.5 rounded-full inline-block" style="background:' + sc + '"></span>'
        + '<span class="text-slate-400">' + s + '</span></span>'
        + '<span class="text-slate-300 font-mono">' + c + '</span></div>';
    }).join('');

    return '<div class="card p-5 border-2" style="border-color:' + imp.color + '44">'
      + '<div class="flex items-start justify-between mb-3">'
        + '<div class="flex items-center gap-3">'
          + '<div class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style="background:' + imp.color + '">' + imp.initials + '</div>'
          + '<div><p class="font-bold text-white">' + imp.name + '</p>'
          + '<p class="text-xs text-slate-500">' + imp.total + ' loja' + (imp.total!==1?'s':'') + ' ativas</p></div>'
        + '</div>'
        + '<p class="text-2xl font-bold" style="color:' + imp.color + '">' + imp.total + '</p>'
      + '</div>'
      + '<div class="flex gap-0 h-2 rounded overflow-hidden mb-3 bg-slate-800">'
        + (imp.blocked  > 0 ? '<div style="background:#ef4444;width:' + blockedBarW + '%" title="' + imp.blocked + ' bloqueadas"></div>' : '')
        + (imp.inProgress > 0 ? '<div style="background:#3b82f6;width:' + inProgBarW  + '%" title="' + imp.inProgress + ' em andamento"></div>' : '')
        + (imp.backlog   > 0 ? '<div style="background:#475569;width:' + backlogBarW + '%" title="' + imp.backlog + ' backlog"></div>' : '')
      + '</div>'
      + '<div class="grid grid-cols-3 gap-2 mb-3 text-center">'
        + '<div class="bg-red-900/20 rounded-lg p-2"><p class="text-xs text-slate-500">Bloqueadas</p><p class="font-bold ' + (imp.blocked > 0 ? 'text-red-400' : 'text-slate-600') + '">' + imp.blocked + '</p></div>'
        + '<div class="bg-blue-900/20 rounded-lg p-2"><p class="text-xs text-slate-500">Andamento</p><p class="font-bold text-blue-400">' + imp.inProgress + '</p></div>'
        + '<div class="bg-slate-800 rounded-lg p-2"><p class="text-xs text-slate-500">Backlog</p><p class="font-bold text-slate-400">' + imp.backlog + '</p></div>'
      + '</div>'
      + '<div class="flex items-center justify-between text-xs mb-3">'
        + '<span class="text-slate-500">Média na fila</span>'
        + '<span class="font-mono font-semibold ' + avgDaysCls + '">' + imp.avgDays + 'd</span>'
      + '</div>'
      + '<div class="space-y-1">' + statusBreakdown + '</div>'
      + alertHTML
      + '</div>';
  }).join('');

  // Balance bars
  const total = implantadoresData.total;
  const noImpLen = implantadoresData.noImplantador.length;
  const balanceRows = implantadoresData.implantadores.map(imp => {
    const bW = Math.round(imp.blocked   / total * 100);
    const iW = Math.round(imp.inProgress/ total * 100);
    const kW = Math.round(imp.backlog   / total * 100);
    return '<div class="flex items-center gap-3">'
      + '<span class="text-xs font-medium w-24 text-right" style="color:' + imp.color + '">' + imp.name + '</span>'
      + '<div class="flex-1 flex h-7 rounded overflow-hidden bg-slate-800">'
        + (imp.blocked   > 0 ? '<div class="flex items-center justify-center text-xs text-white font-bold" style="background:#ef4444;width:' + bW + '%;min-width:22px">' + imp.blocked + '</div>' : '')
        + (imp.inProgress> 0 ? '<div class="flex items-center justify-center text-xs text-white" style="background:#3b82f6aa;width:' + iW + '%">' + imp.inProgress + '</div>' : '')
        + (imp.backlog   > 0 ? '<div class="flex items-center justify-center text-xs text-slate-400" style="background:#47556940;width:' + kW + '%">' + imp.backlog + '</div>' : '')
      + '</div>'
      + '<span class="text-xs font-mono text-slate-400 w-8 text-right">' + imp.total + '</span>'
      + '</div>';
  }).join('');

  // Filter buttons
  const filterBtns = implantadoresData.implantadores.map(imp =>
    '<button class="imp-filter-btn text-xs px-3 py-1 rounded-full border transition-all text-slate-400"'
    + ' style="border-color:' + imp.color + '44"'
    + ' onmouseover="this.style.background=\'' + imp.color + '22\'"'
    + ' onmouseout="this.style.background=\'\'"'
    + ' onclick="setImpFilter(\'' + imp.name + '\',this)">' + imp.name + '</button>'
  ).join('');

  // No implantador alert
  const noImpChips = implantadoresData.noImplantador.map(t => {
    const label = t.name.length > 28 ? t.name.substring(0,28)+'…' : t.name;
    return '<a href="https://app.clickup.com/t/' + t.id + '" target="_blank"'
      + ' class="badge text-xs hover:border-slate-500 transition-all"'
      + ' style="background:#1e293b;color:#94a3b8;border:1px solid #334155"'
      + ' title="' + t.name + ' — ' + t.status + '">' + label + '</a>';
  }).join('');

  const noImpBlock = noImpLen > 0
    ? '<div class="mt-4 pt-4 border-t border-slate-700/50">'
      + '<div class="flex items-center gap-2 mb-2">'
        + '<span class="text-amber-400 text-xs font-semibold">⚠ ' + noImpLen + ' lojas sem implantador identificado</span>'
        + '<span class="text-slate-600 text-xs">(não constam como watcher no ClickUp)</span>'
      + '</div>'
      + '<div class="flex flex-wrap gap-1.5">' + noImpChips + '</div>'
      + '</div>'
    : '';

  return `
  <div class="grid grid-cols-3 gap-4 mb-5">${cardsHTML}</div>

  <div class="card p-5 mb-4">
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-semibold text-white text-sm">Distribuição de carga</h2>
      <span class="text-slate-500 text-xs">${total} lojas ativas · ${noImpLen} sem implantador atribuído</span>
    </div>
    <div class="space-y-2">${balanceRows}
      <div class="flex items-center gap-3">
        <span class="text-xs font-medium w-24 text-right text-slate-600">Sem atrib.</span>
        <div class="flex-1 h-7 rounded overflow-hidden bg-slate-800">
          <div class="h-full" style="background:#33415560;width:${Math.round(noImpLen/total*100)}%"></div>
        </div>
        <span class="text-xs font-mono text-slate-600 w-8 text-right">${noImpLen}</span>
      </div>
    </div>
    <div class="flex gap-4 mt-3 text-xs text-slate-500">
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-red-400 inline-block"></span> Bloqueadas</span>
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-blue-500 inline-block"></span> Em andamento</span>
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-slate-600 inline-block"></span> Backlog</span>
    </div>
  </div>

  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <h2 class="font-semibold text-white text-sm">Lojas por implantador</h2>
        <span id="imp-count" class="text-slate-500 text-xs"></span>
      </div>
      <div class="flex gap-1.5 flex-wrap">
        <button class="imp-filter-btn text-xs px-3 py-1 rounded-full border border-slate-600 bg-slate-700 text-white transition-all" onclick="setImpFilter('all',this)">Todos</button>
        ${filterBtns}
        <button class="imp-filter-btn text-xs px-3 py-1 rounded-full border border-slate-700 text-slate-400 transition-all" onclick="setImpFilter('none',this)">Sem atrib.</button>
      </div>
    </div>
    <div class="scrollable-tall">
      <table class="w-full text-left">
        <thead>
          <tr class="text-slate-400 border-b border-slate-700/50" style="font-size:11px">
            <th class="pr-3 pb-2">Loja</th>
            <th class="pr-3 pb-2">Status</th>
            <th class="pr-3 pb-2">ERP</th>
            <th class="pr-3 pb-2 text-right">Na fila</th>
            <th class="pr-3 pb-2 text-right">Últ. atualiz.</th>
            <th class="pr-3 pb-2 text-center">Implantador</th>
            <th class="pb-2 text-center">Engaj. Lojista</th>
          </tr>
        </thead>
        <tbody id="imp-tbody"></tbody>
      </table>
    </div>
    ${noImpBlock}
  </div>`;
})();

// ── HTML ──────────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard Integrações Ativas</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
  body { background:#0f172a; color:#e2e8f0; font-family:'Inter',sans-serif; min-height:100vh; }
  .tab-btn { transition:all .15s; border-bottom:2px solid transparent; }
  .tab-btn.active { color:#60a5fa; border-bottom-color:#3b82f6; }
  .tab-btn:not(.active) { color:#64748b; }
  .tab-btn:not(.active):hover { color:#94a3b8; }
  .card { background:#1e293b; border:1px solid #334155; border-radius:12px; }
  .kpi { background:linear-gradient(135deg,#1e293b,#162032); border:1px solid #334155; border-radius:12px; }
  .tab-content { display:none; }
  .tab-content.active { display:block; }
  .badge { display:inline-flex; align-items:center; padding:2px 8px; border-radius:99px; font-size:11px; font-weight:600; white-space:nowrap; }
  .scrollable { max-height:500px; overflow-y:auto; }
  .scrollable-tall { max-height:680px; overflow-y:auto; }
  ::-webkit-scrollbar { width:5px; }
  ::-webkit-scrollbar-track { background:#0f172a; }
  ::-webkit-scrollbar-thumb { background:#334155; border-radius:3px; }
  table th { background:#0f172a; position:sticky; top:0; z-index:10; padding:8px 12px 8px 0; }
  table td { padding:8px 12px 8px 0; }
  tr:hover td { background:#1e293b88; }
  .bar-bg { background:#0f172a; border-radius:4px; height:6px; overflow:hidden; }
  .bar-fill { height:6px; border-radius:4px; }
  input[type=text] { background:#1e293b; border:1px solid #334155; color:#e2e8f0; }
  input[type=text]:focus { outline:none; border-color:#3b82f6; }
  .kanban-col { background:#162032; border:1px solid #293548; border-radius:10px; min-width:180px; }
  .kanban-card { background:#1e293b; border:1px solid #334155; border-radius:8px; }
  .kanban-card:hover { border-color:#3b82f6; }
  .progress-bar { height:4px; background:#0f172a; border-radius:2px; }
  .progress-fill { height:4px; border-radius:2px; transition:width .3s; }
</style>
</head>
<body>

<!-- Header -->
<div class="border-b border-slate-700 px-6 py-4 flex items-center justify-between sticky top-0 bg-slate-900 z-50 backdrop-blur">
  <div>
    <h1 class="text-lg font-bold text-white">⚡ Integrações Ativas</h1>
    <p class="text-slate-500 text-xs mt-0.5">Atualizado ${generatedAt}</p>
  </div>
  <div class="flex gap-2 flex-wrap justify-end">
    <span class="badge bg-slate-700/60 text-slate-300">${kpis.total} lojas</span>
    <span class="badge bg-blue-900/40 text-blue-300 border border-blue-700/30">${kpis.inProgress} em andamento</span>
    <span class="badge bg-orange-900/40 text-orange-300 border border-orange-700/30">⚠ ${kpis.blocked} bloqueadas</span>
    <span class="badge bg-slate-700/40 text-slate-400">${kpis.backlog} backlog</span>
  </div>
</div>

<!-- KPIs -->
<div class="px-6 pt-5 grid grid-cols-5 gap-3">
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Total ativas</p>
    <p class="text-3xl font-bold text-white">${kpis.total}</p>
    <p class="text-slate-500 text-xs mt-1">${kpis.groups} redes/lojas</p>
  </div>
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Em andamento</p>
    <p class="text-3xl font-bold text-blue-400">${kpis.inProgress}</p>
    <p class="text-slate-500 text-xs mt-1">trabalhando agora</p>
  </div>
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Bloqueadas</p>
    <p class="text-3xl font-bold text-orange-400">${kpis.blocked}</p>
    <p class="text-slate-500 text-xs mt-1">${kpis.blockedPct}% das ativas</p>
  </div>
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Backlog</p>
    <p class="text-3xl font-bold text-slate-400">${kpis.backlog}</p>
    <p class="text-slate-500 text-xs mt-1">aguardando início</p>
  </div>
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Tempo médio</p>
    <p class="text-3xl font-bold text-purple-400">${kpis.avgDays}d</p>
    <p class="text-slate-500 text-xs mt-1">no pipeline</p>
  </div>
</div>

<!-- Tabs -->
<div class="px-6 pt-5 flex gap-0 border-b border-slate-700 overflow-x-auto">
  <button class="tab-btn active px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('kanban',this)">🗂 Kanban</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('table',this)">📋 Tabela</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('groups',this)">🏢 Por Rede</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('blocked',this)">🔴 Bloqueios</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('phases',this)">⏱ Fases</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('charts',this)">📊 Gráficos</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('implantadores',this)">👷 Implantadores</button>
</div>

<div class="p-6">

<!-- ═══════════════════ KANBAN ════════════════════════════════════════════ -->
<div id="tab-kanban" class="tab-content active">
  <div class="flex gap-3 overflow-x-auto pb-4">
    ${DATA.statusGroups.map(sg => `
    <div class="kanban-col flex-shrink-0 w-52 p-3">
      <div class="flex items-center gap-2 mb-3">
        <div class="w-2 h-2 rounded-full flex-shrink-0" style="background:${sg.color}"></div>
        <p class="text-xs font-semibold text-slate-300 leading-tight">${sg.status}</p>
        <span class="ml-auto text-xs font-bold" style="color:${sg.color}">${sg.count}</span>
      </div>
      <div class="flex flex-col gap-2">
        ${sg.tasks.map(t => `
        <a href="${t.url}" target="_blank" class="kanban-card block p-2.5 cursor-pointer">
          <p class="text-xs text-slate-300 font-medium leading-snug mb-1">${t.name.substring(0,40)}</p>
          <div class="flex items-center justify-between">
            <span class="text-slate-500 text-xs">${t.group !== "Individual" ? t.group.substring(0,15) : t.erp.substring(0,15)}</span>
            ${t.total_days > 0 ? `<span class="text-xs ${t.blocked_pct>30?'text-red-400':t.blocked_pct>0?'text-orange-400':'text-slate-400'}">${t.total_days}d${t.blocked_pct>0?' ⚠':''}</span>` : ''}
          </div>
        </a>`).join("")}
      </div>
    </div>`).join("")}
  </div>
</div>

<!-- ═══════════════════ TABLE ════════════════════════════════════════════ -->
<div id="tab-table" class="tab-content">
  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-semibold text-white text-sm">Todas as integrações ativas</h2>
      <div class="flex gap-3 items-center">
        <input type="text" id="tbl-search" placeholder="Filtrar..." class="text-sm px-3 py-1.5 rounded-lg w-52"
          oninput="renderTable()">
        <select id="tbl-status" class="bg-slate-700 text-slate-300 text-xs px-2 py-1.5 rounded-lg border border-slate-600"
          onchange="renderTable()">
          <option value="">Todos os status</option>
          ${Object.entries(STATUS_COLORS).map(([s])=>`<option value="${s}">${s}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="scrollable-tall">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-left text-slate-400 border-b border-slate-700/50 text-xs">
            <th class="pr-3 cursor-pointer hover:text-white" onclick="sortTable('name')">Loja</th>
            <th class="pr-3 cursor-pointer hover:text-white" onclick="sortTable('group')">Rede</th>
            <th class="pr-3 cursor-pointer hover:text-white" onclick="sortTable('erp')">ERP</th>
            <th class="pr-3 cursor-pointer hover:text-white" onclick="sortTable('status')">Status</th>
            <th class="pr-3 text-right cursor-pointer hover:text-white" onclick="sortTable('total_days')">Total</th>
            <th class="pr-3 text-right cursor-pointer hover:text-white" onclick="sortTable('blocked_days')">Bloq.</th>
            <th class="pr-3 text-right cursor-pointer hover:text-white" onclick="sortTable('blocked_pct')">% Bloq</th>
            <th class="pr-3 text-right cursor-pointer hover:text-white" onclick="sortTable('days_since_created')">No board</th>
          </tr>
        </thead>
        <tbody id="tbl-body" class="divide-y divide-slate-700/30"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- ═══════════════════ GROUPS ════════════════════════════════════════════ -->
<div id="tab-groups" class="tab-content">
  <div class="grid grid-cols-1 gap-4">
    ${DATA.groups.map(g => `
    <div class="card p-4">
      <div class="flex items-start justify-between mb-3">
        <div>
          <h3 class="font-semibold text-white">${g.group}</h3>
          <p class="text-slate-400 text-xs mt-0.5">${g.count} loja${g.count>1?'s':''} · ${g.inProgress} em andamento · ${g.blocked > 0 ? `<span class="text-orange-400">${g.blocked} bloqueada${g.blocked>1?'s':''}</span>` : '0 bloqueadas'} · ${g.backlog} backlog</p>
        </div>
        <div class="flex gap-2 flex-wrap justify-end">
          ${g.statuses.slice(0,3).map(s => `<span class="badge text-xs" style="background:${STATUS_COLORS[s]||'#475569'}22;color:${STATUS_COLORS[s]||'#475569'};border:1px solid ${STATUS_COLORS[s]||'#475569'}33">${s}</span>`).join("")}
          ${g.statuses.length > 3 ? `<span class="text-slate-500 text-xs">+${g.statuses.length-3}</span>` : ''}
        </div>
      </div>
      <div class="flex gap-2 flex-wrap">
        ${DATA.tasks.filter(t=>t.group===g.group).map(t => `
        <a href="${t.url}" target="_blank" class="bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-blue-500 rounded-lg px-3 py-2 text-xs transition-all inline-flex flex-col gap-0.5">
          <span class="text-slate-300 font-medium">${t.name.replace(g.group,'').replace('- ','').trim().substring(0,30)||t.name.substring(0,30)}</span>
          <span class="badge mt-0.5" style="background:${t.color}22;color:${t.color};border:1px solid ${t.color}33">${t.status}</span>
          ${t.total_days > 0 ? `<span class="text-slate-500">${t.total_days}d ${t.blocked_pct>0?'· <span class="text-orange-400">'+t.blocked_pct+'% bloq</span>':''}</span>` : ''}
        </a>`).join("")}
      </div>
    </div>`).join("")}
  </div>
</div>

<!-- ═══════════════════ BLOCKED ════════════════════════════════════════════ -->
<div id="tab-blocked" class="tab-content">
  <div class="grid grid-cols-3 gap-3 mb-5">
    <div class="kpi p-4">
      <p class="text-slate-400 text-xs">Bloqueadas agora</p>
      <p class="text-3xl font-bold text-orange-400 mt-1">${kpis.blocked}</p>
    </div>
    <div class="kpi p-4">
      <p class="text-slate-400 text-xs">Pedido bloqueado</p>
      <p class="text-3xl font-bold text-red-400 mt-1">${tasks.filter(t=>t.status==='bloqueado pedido').length}</p>
    </div>
    <div class="kpi p-4">
      <p class="text-slate-400 text-xs">Aguardando cliente</p>
      <p class="text-3xl font-bold text-yellow-400 mt-1">${tasks.filter(t=>t.status==='aguardando cliente').length}</p>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-4">
    <div class="card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Lojas com maior % bloqueado</h2>
      <div class="scrollable">
        ${DATA.sortedByBlocked.map(t => `
        <div class="mb-4">
          <div class="flex items-center justify-between mb-1.5">
            <div>
              <a href="${t.url}" target="_blank" class="text-xs text-slate-300 hover:text-blue-400 font-medium">${t.name.substring(0,38)}</a>
              <span class="badge ml-2 text-xs" style="background:${t.color}22;color:${t.color}">${t.status}</span>
            </div>
            <span class="text-xs text-red-400 font-bold ml-2">${t.blocked_pct}%</span>
          </div>
          <div class="relative">
            <div class="bar-bg w-full">
              <div class="bar-fill" style="width:${t.blocked_pct}%;background:${t.blocked_pct>50?'#ef4444':t.blocked_pct>25?'#f97316':'#f59e0b'}"></div>
            </div>
          </div>
          <p class="text-slate-600 text-xs mt-1">${t.blocked_days}d bloqueado de ${t.total_days}d total</p>
        </div>`).join("")}
      </div>
    </div>

    <div class="card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Status bloqueantes</h2>
      ${["bloqueado pedido","bloqueado produto","aguardando cliente"].map(s => {
        const sT = tasks.filter(t=>t.status===s);
        return sT.length ? `
        <div class="mb-5">
          <p class="text-xs font-semibold mb-2" style="color:${STATUS_COLORS[s]}">${s.toUpperCase()} (${sT.length})</p>
          ${sT.map(t => `
          <a href="${t.url}" target="_blank" class="flex items-center justify-between py-2 border-b border-slate-700/40 hover:bg-slate-700/20 px-2 rounded group">
            <div>
              <p class="text-xs text-slate-300 group-hover:text-white">${t.name.substring(0,40)}</p>
              <p class="text-slate-600 text-xs">${t.group !== 'Individual' ? t.group : t.erp}</p>
            </div>
            <div class="text-right ml-2">
              <p class="text-xs text-red-400">${t.blocked_days}d bloq</p>
              <p class="text-slate-600 text-xs">${t.total_days}d total</p>
            </div>
          </a>`).join("")}
        </div>` : '';
      }).join("")}
    </div>
  </div>
</div>

<!-- ═══════════════════ PHASES ════════════════════════════════════════════ -->
<div id="tab-phases" class="tab-content">
  <div class="grid grid-cols-4 gap-3 mb-5">
    ${DATA.phaseStats.map(p => `
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs mb-1 capitalize">${p.phase === 'preparacao' ? 'Preparação' : p.phase === 'produto' ? 'Produto' : p.phase === 'pedido' ? 'Pedido' : 'Revisão'}</p>
      <p class="text-3xl font-bold text-white">${p.avg}d</p>
      <p class="text-slate-500 text-xs mt-1">mediana ${p.median||0}d · n=${p.count}</p>
    </div>`).join("")}
  </div>

  <div class="grid grid-cols-2 gap-4">
    <div class="card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Tempo médio por fase</h2>
      <canvas id="phasesBarChart" height="180"></canvas>
    </div>
    <div class="card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Breakdown por loja (ativas)</h2>
      <div class="scrollable">
        <canvas id="phasesStoreChart" height="350"></canvas>
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════ CHARTS ════════════════════════════════════════════ -->
<div id="tab-charts" class="tab-content">
  <div class="grid grid-cols-2 gap-4">
    <div class="card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Distribuição por status</h2>
      <canvas id="statusDonutChart" height="200"></canvas>
    </div>
    <div class="card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Lojas por rede</h2>
      <canvas id="groupBarChart" height="200"></canvas>
    </div>
    <div class="card p-5 col-span-2">
      <h2 class="font-semibold text-white text-sm mb-4">Ativo vs Bloqueado por loja (em andamento)</h2>
      <div style="overflow-x:auto">
        <canvas id="activeBlockedChart" height="100"></canvas>
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════ IMPLANTADORES ════════════════════════════════════ -->
<div id="tab-implantadores" class="tab-content">
${implantadoresTabHTML}
</div>

</div><!-- /p-6 -->

<script>
const DATA = ${JSON.stringify(DATA)};
const STATUS_COLORS = ${JSON.stringify(STATUS_COLORS)};

// ── Tab switching ─────────────────────────────────────────────────────────────
const chartsInited = {};
function showTab(id, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
  btn.classList.add('active');
  if (!chartsInited[id]) { initTabContent(id); chartsInited[id] = true; }
}

// ── Table ─────────────────────────────────────────────────────────────────────
let tblSort = 'blocked_pct', tblAsc = false;
function sortTable(key) {
  if(tblSort===key) tblAsc=!tblAsc; else {tblSort=key;tblAsc=false;}
  renderTable();
}
function renderTable() {
  const q = (document.getElementById('tbl-search')?.value||'').toLowerCase();
  const sf = document.getElementById('tbl-status')?.value||'';
  let rows = DATA.tasks;
  if(q) rows = rows.filter(r=>r.name.toLowerCase().includes(q)||r.group.toLowerCase().includes(q)||r.erp.toLowerCase().includes(q)||r.status.toLowerCase().includes(q));
  if(sf) rows = rows.filter(r=>r.status===sf);
  rows = [...rows].sort((a,b)=>{
    const va=a[tblSort],vb=b[tblSort];
    if(typeof va==='string') return tblAsc?va.localeCompare(vb):vb.localeCompare(va);
    return tblAsc?(va||0)-(vb||0):(vb||0)-(va||0);
  });
  const tbody = document.getElementById('tbl-body');
  tbody.innerHTML = rows.map(r=>\`
    <tr class="border-b border-slate-700/30">
      <td class="pr-3 py-2"><a href="\${r.url}" target="_blank" class="text-blue-400 hover:underline text-xs">\${r.name.substring(0,40)}</a></td>
      <td class="pr-3 text-slate-400 text-xs">\${r.group!=='Individual'?r.group:'—'}</td>
      <td class="pr-3 text-slate-500 text-xs">\${r.erp}</td>
      <td class="pr-3"><span class="badge" style="background:\${r.color}22;color:\${r.color};border:1px solid \${r.color}33">\${r.status}</span></td>
      <td class="pr-3 text-right font-mono text-xs text-white">\${r.total_days||'—'}d</td>
      <td class="pr-3 text-right text-xs \${r.blocked_days>0?'text-red-400':'text-slate-600'}">\${r.blocked_days>0?r.blocked_days+'d':'—'}</td>
      <td class="pr-3 text-right text-xs">
        \${r.blocked_pct>0?\`<span class="\${r.blocked_pct>50?'text-red-400':r.blocked_pct>25?'text-orange-400':'text-yellow-400'}">\${r.blocked_pct}%</span>\`:'<span class="text-green-600">0%</span>'}
      </td>
      <td class="text-right text-xs text-slate-500">\${r.days_since_created!=null?r.days_since_created+'d':'—'}</td>
    </tr>\`).join('');
}

// ── Charts ────────────────────────────────────────────────────────────────────
function initTabContent(id) {
  if(id === 'table') { renderTable(); return; }
  if(id === 'phases') { initPhaseCharts(); return; }
  if(id === 'charts') { initAllCharts(); return; }
}

function initPhaseCharts() {
  const ps = DATA.phaseStats;
  const labels = ['Preparação','Produto','Pedido','Revisão'];
  const colors = ['#6366f1','#3b82f6','#10b981','#a855f7'];

  new Chart(document.getElementById('phasesBarChart').getContext('2d'), {
    type:'bar',
    data:{
      labels,
      datasets:[
        {label:'Média',data:ps.map(p=>p.avg),backgroundColor:colors.map(c=>c+'80'),borderColor:colors,borderWidth:1,borderRadius:4},
        {label:'Mediana',data:ps.map(p=>p.median||0),backgroundColor:'#94a3b820',borderColor:'#94a3b8',borderWidth:1,borderRadius:4,borderDash:[4,2]},
      ]
    },
    options:{responsive:true,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{x:{ticks:{color:'#64748b'},grid:{color:'#1e293b'}},y:{ticks:{color:'#64748b',callback:v=>v+'d'},grid:{color:'#334155'}}}}
  });

  const storeData = DATA.tasks.filter(t=>!t.isBacklog && (t.phases.preparacao+t.phases.produto+t.phases.pedido+t.phases.teste)>0).slice(0,20);
  if(storeData.length) {
    new Chart(document.getElementById('phasesStoreChart').getContext('2d'),{
      type:'bar',
      data:{
        labels:storeData.map(t=>t.name.substring(0,25)),
        datasets:[
          {label:'Prep',data:storeData.map(t=>t.phases.preparacao),backgroundColor:'#6366f180',borderRadius:2},
          {label:'Produto',data:storeData.map(t=>t.phases.produto),backgroundColor:'#3b82f680',borderRadius:2},
          {label:'Pedido',data:storeData.map(t=>t.phases.pedido),backgroundColor:'#10b98180',borderRadius:2},
          {label:'Revisão',data:storeData.map(t=>t.phases.teste),backgroundColor:'#a855f780',borderRadius:2},
        ]
      },
      options:{indexAxis:'y',responsive:true,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{x:{stacked:true,ticks:{color:'#64748b',callback:v=>v+'d'},grid:{color:'#334155'}},y:{stacked:true,ticks:{color:'#64748b',font:{size:9}},grid:{color:'#1e293b'}}}}
    });
  }
}

function initAllCharts() {
  // Donut
  const sg = DATA.statusGroups.filter(s=>s.count>0);
  new Chart(document.getElementById('statusDonutChart').getContext('2d'),{
    type:'doughnut',
    data:{labels:sg.map(s=>s.status),datasets:[{data:sg.map(s=>s.count),backgroundColor:sg.map(s=>s.color+'cc'),borderColor:sg.map(s=>s.color),borderWidth:1}]},
    options:{responsive:true,plugins:{legend:{position:'bottom',labels:{color:'#94a3b8',font:{size:10},padding:6}},tooltip:{callbacks:{label:c=>\` \${c.label}: \${c.raw}\`}}}}
  });

  // Groups bar
  const gr = DATA.groups.filter(g=>g.count>0);
  new Chart(document.getElementById('groupBarChart').getContext('2d'),{
    type:'bar',
    data:{
      labels:gr.map(g=>g.group.substring(0,20)),
      datasets:[
        {label:'Em andamento',data:gr.map(g=>g.inProgress),backgroundColor:'#3b82f680',borderColor:'#3b82f6',borderWidth:1,borderRadius:3},
        {label:'Bloqueadas',data:gr.map(g=>g.blocked),backgroundColor:'#f9731680',borderColor:'#f97316',borderWidth:1,borderRadius:3},
        {label:'Backlog',data:gr.map(g=>g.backlog),backgroundColor:'#47556980',borderColor:'#475569',borderWidth:1,borderRadius:3},
      ]
    },
    options:{responsive:true,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{x:{stacked:true,ticks:{color:'#64748b',font:{size:9},maxRotation:30},grid:{color:'#1e293b'}},y:{stacked:true,ticks:{color:'#64748b'},grid:{color:'#334155'}}}}
  });

  // Active vs Blocked horizontal bars
  const inProg = DATA.tasks.filter(t=>!t.isBacklog && t.total_days>0);
  if(inProg.length) {
    new Chart(document.getElementById('activeBlockedChart').getContext('2d'),{
      type:'bar',
      data:{
        labels:inProg.map(t=>t.name.substring(0,30)),
        datasets:[
          {label:'Ativo',data:inProg.map(t=>t.active_days),backgroundColor:'#22c55e60',borderColor:'#22c55e',borderWidth:1,borderRadius:2},
          {label:'Bloqueado',data:inProg.map(t=>t.blocked_days),backgroundColor:'#ef444460',borderColor:'#ef4444',borderWidth:1,borderRadius:2},
        ]
      },
      options:{
        indexAxis:'y',responsive:true,
        plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},
        scales:{
          x:{stacked:true,ticks:{color:'#64748b',callback:v=>v+'d'},grid:{color:'#334155'}},
          y:{stacked:true,ticks:{color:'#94a3b8',font:{size:9}},grid:{color:'#1e293b'}}
        }
      }
    });
  }
}

// Init table on load (tab-table might be first)
renderTable();

// ── Implantadores ─────────────────────────────────────────────────────────────
const IMP_DATA = ${JSON.stringify(implantadoresData)};
let impFilter = 'all';

function renderImplantadores() {
  const filterTasks = impFilter === 'none'
    ? IMP_DATA.noImplantador.map(t => ({ ...t, implantador: '—', color: '#475569', isBlocked: ['bloqueado pedido','bloqueado produto','aguardando cliente'].includes(t.status), daysSinceCreated: null, erp: 'N/A', engajamento: null, assignees: [], url: 'https://app.clickup.com/t/' + t.id }))
    : impFilter === 'all'
      ? IMP_DATA.implantadores.flatMap(imp => imp.tasks.map(t => ({ ...t, implantador: imp.name, color: imp.color })))
      : (IMP_DATA.implantadores.find(i => i.name === impFilter)?.tasks || []).map(t => ({ ...t, implantador: impFilter, color: IMP_COLORS_JS[impFilter] }));

  const sorted = [...filterTasks].sort((a,b) => {
    const ao = a.isBlocked?0:1, bo = b.isBlocked?0:1;
    if(ao!==bo) return ao-bo;
    return (b.daysSinceCreated||0) - (a.daysSinceCreated||0);
  });

  const tbody = document.getElementById('imp-tbody');
  if(!tbody) return;
  tbody.innerHTML = sorted.map(t => {
    const sc = STATUS_COLORS_JS[t.status] || '#475569';
    const eng = t.engajamento;
    const engColor = eng==='Alto '||eng==='Alto'?'#22c55e':eng==='Médio'?'#f59e0b':'#ef4444';
    const days = t.daysSinceCreated;
    const daysColor = days>90?'text-red-400':days>60?'text-orange-400':days>30?'text-yellow-400':'text-slate-300';
    return \`<tr class="border-b border-slate-700/30 hover:bg-slate-800/40">
      <td class="pr-3 py-2">
        <a href="\${t.url}" target="_blank" class="text-slate-200 hover:text-blue-400 text-xs font-medium leading-snug block">\${t.name.substring(0,45)}\${t.name.length>45?'…':''}</a>
      </td>
      <td class="pr-3 py-2 whitespace-nowrap">
        <span class="badge text-xs" style="background:\${sc}20;color:\${sc};border:1px solid \${sc}40">\${t.status}</span>
        \${t.isBlocked?'<span class="ml-1 text-xs text-red-400">⚠</span>':''}
      </td>
      <td class="pr-3 py-2 text-xs text-slate-400">\${t.erp||'N/A'}</td>
      <td class="pr-3 py-2 text-xs \${daysColor} font-mono text-right">\${days!=null?days+'d':'—'}</td>
      <td class="pr-3 py-2 text-xs text-slate-400 text-right">\${t.daysSinceUpdated!=null?t.daysSinceUpdated+'d':'—'}</td>
      <td class="pr-3 py-2 text-center">
        \${t.implantador!=='—'?\`<span class="badge text-xs font-bold" style="background:\${t.color}22;color:\${t.color};border:1px solid \${t.color}44">\${t.implantador}</span>\`:'<span class="text-slate-600 text-xs">—</span>'}
      </td>
      <td class="py-2 text-center">
        \${eng?\`<span class="badge text-xs" style="background:\${engColor}22;color:\${engColor};border:1px solid \${engColor}44">\${eng.trim()}</span>\`:'<span class="text-slate-600 text-xs">—</span>'}
      </td>
    </tr>\`;
  }).join('');

  document.getElementById('imp-count').textContent = sorted.length + ' loja' + (sorted.length!==1?'s':'');
}

function setImpFilter(f, btn) {
  impFilter = f;
  document.querySelectorAll('.imp-filter-btn').forEach(b => {
    b.classList.remove('bg-slate-700','text-white');
    b.classList.add('text-slate-400');
  });
  btn.classList.add('bg-slate-700','text-white');
  btn.classList.remove('text-slate-400');
  renderImplantadores();
}

const STATUS_COLORS_JS = ${JSON.stringify(STATUS_COLORS)};
const IMP_COLORS_JS = ${JSON.stringify(IMP_COLORS)};
<\/script>
</body>
</html>`;

writeFileSync("C:/Users/guilh/projetos/clickup-activity-mcp/dashboard.html", html);
console.log("Dashboard gerado!");
console.log("Arquivo: C:/Users/guilh/projetos/clickup-activity-mcp/dashboard.html");
console.log("Tamanho: " + (html.length/1024).toFixed(0) + "KB");
