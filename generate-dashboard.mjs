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

// ── Active tasks ──────────────────────────────────────────────────────────────
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
    days_since_created: t.date_created ? Math.round((Date.now() - t.date_created) / 86400000) : null,
  }));

console.log(`Active tasks: ${tasks.length}`);

const kpis = {
  total: tasks.length,
  inProgress: tasks.filter(t => t.isInProgress).length,
  blocked: tasks.filter(t => t.isBlocked).length,
  backlog: tasks.filter(t => t.isBacklog).length,
  blockedPct: Math.round(tasks.filter(t=>t.isBlocked).length / Math.max(tasks.filter(t=>!t.isBacklog).length, 1) * 100),
  avgDays: (() => {
    const w = tasks.filter(t=>t.total_days>0);
    return w.length ? Math.round(w.reduce((a,t)=>a+t.total_days,0)/w.length*10)/10 : 0;
  })(),
  groups: [...new Set(tasks.map(t=>t.group))].length,
};

const statusGroups = {};
for (const t of tasks) {
  if (!statusGroups[t.status]) statusGroups[t.status] = [];
  statusGroups[t.status].push(t);
}

const groups = {};
for (const t of tasks) {
  if (!groups[t.group]) groups[t.group] = [];
  groups[t.group].push(t);
}

const sortedByBlocked = [...tasks]
  .filter(t => t.blocked_days > 0 || t.isBlocked)
  .sort((a,b) => b.blocked_pct - a.blocked_pct);

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

// ── Completed tasks — historical analysis ─────────────────────────────────────
const completedTasks = raw.tasks
  .filter(t =>
    t.status === 'implantado'
    && t.total_days > 0
    && t.name.startsWith('[INTEGRACAO]')
    && !t.name.toLowerCase().includes('paradas')
    && t.date_done
    && new Date(t.date_done).getFullYear() >= 2025
    && t.total_days <= 200
  )
  .map(t => ({
    id: t.id,
    name: cleanName(t.name),
    erp: normalizeERP(t.tags),
    total_days: Math.round(t.total_days),
    blocked_pct: t.blocked_pct || 0,
    date_done: t.date_done,
    assignees: t.assignees || [],
    month_done: new Date(t.date_done).toISOString().substring(0, 7),
  }));

console.log(`Completed tasks: ${completedTasks.length}`);

// ERP performance (>= 3 completions)
const erpStatsMap = {};
completedTasks.forEach(t => {
  const e = t.erp;
  if (!erpStatsMap[e]) erpStatsMap[e] = { count: 0, days: [], blockedPcts: [], tasks: [] };
  erpStatsMap[e].count++;
  erpStatsMap[e].days.push(t.total_days);
  erpStatsMap[e].blockedPcts.push(t.blocked_pct);
  erpStatsMap[e].tasks.push({ id: t.id, name: t.name, total_days: t.total_days, month_done: t.month_done });
});
const erpStats = Object.entries(erpStatsMap)
  .filter(([e, v]) => v.count >= 3 && e !== 'N/A')
  .map(([erp, v]) => {
    v.days.sort((a,b) => a-b);
    const median = Math.round(v.days[Math.floor(v.days.length/2)]);
    const avg = Math.round(v.days.reduce((s,x) => s+x, 0) / v.days.length);
    const blockedAvg = Math.round(v.blockedPcts.reduce((s,x) => s+x, 0) / v.blockedPcts.length);
    const tasks = v.tasks.slice().sort((a,b) => a.total_days - b.total_days);
    return { erp, count: v.count, avg, median, blockedAvg, min: Math.round(v.days[0]), max: Math.round(v.days[v.days.length-1]), tasks };
  })
  .sort((a,b) => a.median - b.median);

// Monthly completion trend (mark Aug-2025 outlier — batch migration)
const monthlyTrendMap = {};
completedTasks.forEach(t => {
  if (!monthlyTrendMap[t.month_done]) monthlyTrendMap[t.month_done] = { count: 0, days: [] };
  monthlyTrendMap[t.month_done].count++;
  monthlyTrendMap[t.month_done].days.push(t.total_days);
});
const monthlyTrend = Object.entries(monthlyTrendMap).sort().map(([m, v]) => {
  v.days.sort((a,b) => a-b);
  return {
    month: m,
    count: v.count,
    avg: Math.round(v.days.reduce((s,x) => s+x, 0) / v.days.length),
    median: Math.round(v.days[Math.floor(v.days.length/2)]),
    isOutlier: m === '2025-08',
  };
});

// Per-implantador historical stats (>= 3 completions)
const impCompMap = {};
completedTasks.forEach(t => {
  (t.assignees||[]).forEach(a => {
    if (!impCompMap[a]) impCompMap[a] = { count: 0, days: [] };
    impCompMap[a].count++;
    impCompMap[a].days.push(t.total_days);
  });
});
const impStatsComp = Object.entries(impCompMap)
  .filter(([,v]) => v.count >= 3)
  .map(([name, v]) => {
    v.days.sort((a,b) => a-b);
    return {
      name,
      count: v.count,
      avg: Math.round(v.days.reduce((s,x) => s+x, 0) / v.days.length),
      median: Math.round(v.days[Math.floor(v.days.length/2)]),
      min: Math.round(v.days[0]),
      max: Math.round(v.days[v.days.length-1]),
    };
  })
  .sort((a,b) => a.median - b.median);

// Cycle time distribution
const ctBuckets = [
  { label: '0–30d', min: 0, max: 30 },
  { label: '31–60d', min: 31, max: 60 },
  { label: '61–90d', min: 61, max: 90 },
  { label: '91–120d', min: 91, max: 120 },
  { label: '121–180d', min: 121, max: 180 },
  { label: '181–270d', min: 181, max: 270 },
  { label: '271–365d', min: 271, max: 365 },
  { label: '365+d', min: 366, max: Infinity },
].map(b => ({
  label: b.label,
  count: completedTasks.filter(t => t.total_days >= b.min && t.total_days <= b.max).length,
}));

const allDaysSorted = completedTasks.map(t => t.total_days).sort((a,b) => a-b);
const ct_p50 = allDaysSorted[Math.floor(allDaysSorted.length * 0.50)];
const ct_p75 = allDaysSorted[Math.floor(allDaysSorted.length * 0.75)];
const ct_p85 = allDaysSorted[Math.floor(allDaysSorted.length * 0.85)];
const ct_p90 = allDaysSorted[Math.floor(allDaysSorted.length * 0.90)];
const ct_avg = Math.round(allDaysSorted.reduce((s,x) => s+x, 0) / allDaysSorted.length);

// ── Implantadores (active) ────────────────────────────────────────────────────
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

// ── DATA for HTML embedding ───────────────────────────────────────────────────
const DATA = {
  kpis,
  tasks: [...tasks].sort((a,b) => (STATUS_ORDER[a.status]||99)-(STATUS_ORDER[b.status]||99) || b.blocked_days-a.blocked_days)
    .map(t => ({
      id: t.id, name: t.name, status: t.status, color: t.color,
      isBlocked: t.isBlocked, isBacklog: t.isBacklog, erp: t.erp, group: t.group,
      total_days: t.total_days, active_days: t.active_days, blocked_days: t.blocked_days,
      blocked_pct: t.blocked_pct, url: t.url, created_label: t.created_label,
      days_since_created: t.days_since_created, phases: t.phases, status_breakdown: t.status_breakdown,
    })),
  statusGroups: Object.entries(statusGroups)
    .sort((a,b) => (STATUS_ORDER[a[0]]||99) - (STATUS_ORDER[b[0]]||99))
    .map(([status, ts]) => ({
      status, color: STATUS_COLORS[status]||"#475569",
      count: ts.length,
      blocked: BLOCKED_STATUSES.includes(status),
      tasks: ts.map(t => ({ id:t.id, name:t.name, group:t.group, erp:t.erp, total_days:t.total_days, blocked_days:t.blocked_days, blocked_pct:t.blocked_pct, url:t.url })),
    })),
  phaseStats,
  sortedByBlocked: sortedByBlocked.map(t => ({ name:t.name, status:t.status, color:t.color, blocked_days:t.blocked_days, blocked_pct:t.blocked_pct, total_days:t.total_days, url:t.url })),
  erpStats,
  monthlyTrend,
  impStatsComp,
  ctBuckets,
  ct: { p50: ct_p50, p75: ct_p75, p85: ct_p85, p90: ct_p90, avg: ct_avg, total: completedTasks.length },
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

  const filterBtns = implantadoresData.implantadores.map(imp =>
    '<button class="imp-filter-btn text-xs px-3 py-1 rounded-full border transition-all text-slate-400"'
    + ' style="border-color:' + imp.color + '44"'
    + ' onmouseover="this.style.background=\'' + imp.color + '22\'"'
    + ' onmouseout="this.style.background=\'\'"'
    + ' onclick="setImpFilter(\'' + imp.name + '\',this)">' + imp.name + '</button>'
  ).join('');

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
<title>Dashboard Integrações</title>
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
  .erp-bar { height:10px; border-radius:5px; transition:width .3s; }
  .rank-medal { width:24px; height:24px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; }
</style>
</head>
<body>

<!-- ERP Modal -->
<div id="erp-modal" class="fixed inset-0 z-[100] flex items-center justify-center hidden" onclick="if(event.target===this)closeErpModal()">
  <div class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
  <div class="relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl mx-4 shadow-2xl flex flex-col" style="max-height:85vh">
    <!-- Modal header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-slate-700 flex-shrink-0">
      <div>
        <h2 id="modal-erp-name" class="text-white font-bold text-base capitalize"></h2>
        <p id="modal-erp-stats" class="text-slate-500 text-xs mt-0.5"></p>
      </div>
      <button onclick="closeErpModal()" class="text-slate-500 hover:text-white transition-colors text-lg leading-none">✕</button>
    </div>
    <!-- Modal body -->
    <div class="overflow-y-auto flex-1 px-6 py-4">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-slate-500 border-b border-slate-700/50 text-left">
            <th class="pb-2 pr-4">#</th>
            <th class="pb-2 pr-4">Loja</th>
            <th class="pb-2 pr-4 text-right">Ciclo</th>
            <th class="pb-2 text-right">Concluído</th>
          </tr>
        </thead>
        <tbody id="modal-erp-tbody"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- Header -->
<div class="border-b border-slate-700 px-6 py-4 flex items-center justify-between sticky top-0 bg-slate-900 z-50 backdrop-blur">
  <div>
    <h1 class="text-lg font-bold text-white">⚡ Integrações</h1>
    <p class="text-slate-500 text-xs mt-0.5">Atualizado ${generatedAt}</p>
  </div>
  <div class="flex gap-2 flex-wrap justify-end">
    <span class="badge bg-slate-700/60 text-slate-300">${kpis.total} ativas</span>
    <span class="badge bg-blue-900/40 text-blue-300 border border-blue-700/30">${kpis.inProgress} em andamento</span>
    <span class="badge bg-orange-900/40 text-orange-300 border border-orange-700/30">⚠ ${kpis.blocked} bloqueadas</span>
    <span class="badge bg-purple-900/40 text-purple-300 border border-purple-700/30">📦 ${DATA.ct.total} concluídas</span>
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
    <p class="text-slate-400 text-xs mb-1">Ciclo mediano (hist.)</p>
    <p class="text-3xl font-bold text-green-400">${ct_p50}d</p>
    <p class="text-slate-500 text-xs mt-1">P50 — ${DATA.ct.total} lojas</p>
  </div>
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">SLE 85%</p>
    <p class="text-3xl font-bold text-purple-400">${ct_p85}d</p>
    <p class="text-slate-500 text-xs mt-1">85% entregues até</p>
  </div>
</div>

<!-- Tabs -->
<div class="px-6 pt-5 flex gap-0 border-b border-slate-700 overflow-x-auto">
  <button class="tab-btn active px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('phases',this)">⏱ Fases</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('charts',this)">📊 Gráficos</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('ciclo',this)">📈 Ciclo Histórico</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('evolucao',this)">📉 Evolução</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('erps',this)">🔧 ERPs</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('performance',this)">🏆 Performance</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('implantadores',this)">👷 Implantadores</button>
</div>

<div class="p-6">

<!-- ═══════════════════ PHASES ════════════════════════════════════════════ -->
<div id="tab-phases" class="tab-content active">
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
      <h2 class="font-semibold text-white text-sm mb-4">Lojas por rede/grupo</h2>
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

<!-- ═══════════════════ CICLO HISTÓRICO ══════════════════════════════════ -->
<div id="tab-ciclo" class="tab-content">
  <div class="grid grid-cols-4 gap-3 mb-5">
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs mb-1">P50 — Mediana</p>
      <p class="text-3xl font-bold text-green-400">${ct_p50}d</p>
      <p class="text-slate-500 text-xs mt-1">50% entregues até</p>
    </div>
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs mb-1">P75</p>
      <p class="text-3xl font-bold text-yellow-400">${ct_p75}d</p>
      <p class="text-slate-500 text-xs mt-1">75% entregues até</p>
    </div>
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs mb-1">P85 — SLE</p>
      <p class="text-3xl font-bold text-orange-400">${ct_p85}d</p>
      <p class="text-slate-500 text-xs mt-1">85% entregues até</p>
    </div>
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs mb-1">P90</p>
      <p class="text-3xl font-bold text-red-400">${ct_p90}d</p>
      <p class="text-slate-500 text-xs mt-1">90% entregues até</p>
    </div>
  </div>
  <div class="grid grid-cols-2 gap-4">
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-semibold text-white text-sm">Distribuição de ciclo (${DATA.ct.total} lojas)</h2>
        <span class="text-slate-500 text-xs">Média geral: ${ct_avg}d</span>
      </div>
      <canvas id="ctHistChart" height="220"></canvas>
    </div>
    <div class="card p-5">
      <h2 class="font-semibold text-white text-sm mb-1">Interpretação dos percentis</h2>
      <p class="text-slate-500 text-xs mb-4">Baseado em ${DATA.ct.total} integrações concluídas</p>
      <div class="space-y-3">
        ${[
          { label: 'P50 — Comprometimento confiante', days: ct_p50, color: '#22c55e', desc: 'Metade das lojas entregam até este prazo. Use para estimativas "provável".' },
          { label: 'P75 — Comprometimento seguro', days: ct_p75, color: '#f59e0b', desc: '3 de 4 lojas entregam até este prazo. Bom para comunicação com cliente.' },
          { label: 'P85 — SLE (Service Level)', days: ct_p85, color: '#f97316', desc: 'Nível de serviço: 85% das lojas entregam até aqui. Padrão de mercado.' },
          { label: 'P90 — Caso pessimista', days: ct_p90, color: '#ef4444', desc: 'Apenas 10% ultrapassam este prazo. Use para contratos de SLA.' },
        ].map(p => `
        <div class="flex items-start gap-3 p-3 rounded-lg bg-slate-800/60">
          <span class="text-lg font-bold mt-0.5" style="color:${p.color}">${p.days}d</span>
          <div>
            <p class="text-xs font-semibold text-slate-200">${p.label}</p>
            <p class="text-xs text-slate-500 mt-0.5">${p.desc}</p>
          </div>
        </div>`).join('')}
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════ EVOLUÇÃO ══════════════════════════════════════════ -->
<div id="tab-evolucao" class="tab-content">
  <div class="grid grid-cols-3 gap-3 mb-5">
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs mb-1">Ciclo inicial (2022)</p>
      <p class="text-3xl font-bold text-red-400">${monthlyTrend.find(m => m.month === '2022-10')?.median || '—'}d</p>
      <p class="text-slate-500 text-xs mt-1">mediana out/2022</p>
    </div>
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs mb-1">Ciclo atual (2026)</p>
      <p class="text-3xl font-bold text-green-400">${monthlyTrend.filter(m => m.month.startsWith('2026') && !m.isOutlier).slice(-1)[0]?.median || '—'}d</p>
      <p class="text-slate-500 text-xs mt-1">mediana recente</p>
    </div>
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs mb-1">Melhoria acumulada</p>
      <p class="text-3xl font-bold text-blue-400">${Math.round((1 - (monthlyTrend.filter(m => m.month.startsWith('2026') && !m.isOutlier).slice(-1)[0]?.median || 1) / (monthlyTrend.find(m => m.month === '2022-10')?.median || 1)) * 100)}%</p>
      <p class="text-slate-500 text-xs mt-1">redução no ciclo</p>
    </div>
  </div>
  <div class="grid grid-cols-1 gap-4">
    <div class="card p-5">
      <div class="flex items-center justify-between mb-2">
        <h2 class="font-semibold text-white text-sm">Evolução do ciclo de integração (mediana mensal)</h2>
        <span class="badge bg-yellow-900/40 text-yellow-300 text-xs border border-yellow-700/30">⚠ ago/25 = migração em lote</span>
      </div>
      <p class="text-slate-500 text-xs mb-4">Tempo mediano de integração por mês de conclusão — excluindo migrações em lote</p>
      <canvas id="evolucaoChart" height="140"></canvas>
    </div>
    <div class="card p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-white text-sm">Entregas e ciclo por mês</h2>
        <span class="text-slate-500 text-xs">${DATA.ct.total} lojas · ${monthlyTrend.length} meses</span>
      </div>
      <div class="scrollable">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-slate-400 border-b border-slate-700/50">
              <th class="pr-3 pb-2 text-left">Mês</th>
              <th class="pr-3 pb-2 text-right">Entregas</th>
              <th class="pr-3 pb-2 text-right">Mediana</th>
              <th class="pb-2 text-right">Média</th>
            </tr>
          </thead>
          <tbody>
            ${[...monthlyTrend].reverse().map(m => `
            <tr class="border-b border-slate-700/30 ${m.isOutlier ? 'opacity-50' : ''}">
              <td class="pr-3 py-2 font-mono text-slate-300">${m.month} ${m.isOutlier ? '<span class="text-yellow-500 ml-1 text-xs">⚠ migração</span>' : ''}</td>
              <td class="pr-3 py-2 text-right text-slate-300">${m.count}</td>
              <td class="pr-3 py-2 text-right font-bold ${m.median < 100 ? 'text-green-400' : m.median < 300 ? 'text-yellow-400' : m.median < 600 ? 'text-orange-400' : 'text-red-400'}">${m.median}d</td>
              <td class="py-2 text-right text-slate-500">${m.avg}d</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════ ERPs ══════════════════════════════════════════════ -->
<div id="tab-erps" class="tab-content">
  <div class="mb-5">
    <p class="text-slate-400 text-sm">Ranking de performance por ERP — baseado em <strong class="text-white">${DATA.ct.total}</strong> integrações concluídas. Apenas ERPs com ≥ 3 integrações.</p>
  </div>

  <!-- Top 5 fastest + Top 5 slowest -->
  <div class="grid grid-cols-2 gap-4 mb-5">
    <div class="card p-5">
      <h2 class="font-semibold text-green-400 text-sm mb-3">🚀 ERPs mais performáticos</h2>
      <div class="space-y-3">
        ${erpStats.slice(0, 5).map((e, i) => `
        <div class="flex items-center gap-3">
          <span class="rank-medal text-white font-bold" style="background:${['#ffd700','#c0c0c0','#cd7f32','#475569','#334155'][i]}">${i+1}</span>
          <div class="flex-1">
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm font-semibold text-slate-200 capitalize">${e.erp}</span>
              <span class="text-green-400 font-bold text-sm">${e.median}d</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex-1 bar-bg h-2">
                <div class="bar-fill bg-green-500" style="width:${Math.min(100, Math.round(e.median / (erpStats[erpStats.length-1]?.median||1) * 100))}%"></div>
              </div>
              <span class="text-slate-500 text-xs">${e.count} lojas</span>
            </div>
          </div>
        </div>`).join('')}
      </div>
    </div>
    <div class="card p-5">
      <h2 class="font-semibold text-red-400 text-sm mb-3">🐢 ERPs mais lentos</h2>
      <div class="space-y-3">
        ${erpStats.slice(-5).reverse().map((e, i) => `
        <div class="flex items-center gap-3">
          <span class="rank-medal text-white font-bold" style="background:${['#7f1d1d','#991b1b','#b91c1c','#dc2626','#ef4444'][i]}">${erpStats.length - i}</span>
          <div class="flex-1">
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm font-semibold text-slate-200 capitalize">${e.erp}</span>
              <span class="text-red-400 font-bold text-sm">${e.median}d</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex-1 bar-bg h-2">
                <div class="bar-fill" style="background:#ef4444;width:${Math.min(100, Math.round(e.median / (erpStats[erpStats.length-1]?.median||1) * 100))}%"></div>
              </div>
              <span class="text-slate-500 text-xs">${e.count} lojas</span>
            </div>
          </div>
        </div>`).join('')}
      </div>
    </div>
  </div>

  <!-- Full ranking table -->
  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-semibold text-white text-sm">Ranking completo — ${erpStats.length} ERPs (≥ 3 integrações)</h2>
      <div class="flex gap-3 text-xs text-slate-500">
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-green-400 inline-block"></span> ≤ 200d (rápido)</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-yellow-400 inline-block"></span> 200–400d</span>
        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-red-400 inline-block"></span> > 400d (lento)</span>
      </div>
    </div>
    <div class="scrollable-tall">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-slate-400 border-b border-slate-700/50">
            <th class="pr-3 pb-2 text-left">#</th>
            <th class="pr-3 pb-2 text-left">ERP</th>
            <th class="pr-3 pb-2 text-right">Lojas</th>
            <th class="pr-3 pb-2 text-right">Mediana</th>
            <th class="pr-3 pb-2 text-right">Média</th>
            <th class="pr-3 pb-2 text-right">Mín</th>
            <th class="pb-2 text-right">Máx</th>
          </tr>
        </thead>
        <tbody>
          ${erpStats.map((e, i) => {
            const col = e.median <= 200 ? '#22c55e' : e.median <= 400 ? '#f59e0b' : '#ef4444';
            const erpKey = e.erp.replace(/'/g, "\\'");
            return `
          <tr class="border-b border-slate-700/30 hover:bg-slate-800/50 cursor-pointer transition-colors" onclick="openErpModal('${erpKey}')">
            <td class="pr-3 py-2 text-slate-600 font-mono">${i+1}</td>
            <td class="pr-3 py-2">
              <div class="flex items-center gap-2">
                <div class="w-1.5 h-4 rounded-full" style="background:${col}"></div>
                <span class="text-slate-200 font-medium capitalize hover:text-blue-400">${e.erp}</span>
              </div>
            </td>
            <td class="pr-3 py-2 text-right text-slate-400">${e.count}</td>
            <td class="pr-3 py-2 text-right font-bold font-mono" style="color:${col}">${e.median}d</td>
            <td class="pr-3 py-2 text-right font-mono text-slate-400">${e.avg}d</td>
            <td class="pr-3 py-2 text-right font-mono text-green-600">${e.min}d</td>
            <td class="py-2 text-right font-mono text-red-600">${e.max}d</td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- ═══════════════════ PERFORMANCE ══════════════════════════════════════ -->
<div id="tab-performance" class="tab-content">
  <div class="mb-4">
    <p class="text-slate-400 text-sm">Performance histórica por implantador — baseado em integrações concluídas. Ciclo = tempo de criação até entrega.</p>
    <p class="text-slate-600 text-xs mt-1">Contexto: implantadores mais antigos trabalharam com ERPs mais complexos e processos menos maduros.</p>
  </div>

  <!-- Ranking visual cards -->
  <div class="grid grid-cols-4 gap-3 mb-5">
    ${impStatsComp.map((imp, i) => {
      const shortName = imp.name.split(' ').slice(0,2).join(' ');
      const col = imp.median <= 200 ? '#22c55e' : imp.median <= 500 ? '#f59e0b' : '#ef4444';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
      return `
    <div class="card p-4">
      <div class="flex items-start justify-between mb-2">
        <span class="text-lg">${medal}</span>
        <span class="text-xs font-bold font-mono" style="color:${col}">${imp.median}d</span>
      </div>
      <p class="text-sm font-semibold text-slate-200 leading-tight">${shortName}</p>
      <p class="text-xs text-slate-500 mt-0.5">${imp.count} integrações</p>
      <div class="mt-2 space-y-1 text-xs text-slate-500">
        <div class="flex justify-between"><span>Média</span><span class="text-slate-300">${imp.avg}d</span></div>
        <div class="flex justify-between"><span>Mín/Máx</span><span class="text-slate-300">${imp.min}d / ${imp.max}d</span></div>
      </div>
      <div class="mt-2 bar-bg">
        <div class="bar-fill" style="background:${col};width:${Math.min(100,Math.round(imp.median/impStatsComp[impStatsComp.length-1].median*100))}%"></div>
      </div>
    </div>`;
    }).join('')}
  </div>

  <!-- Full table -->
  <div class="card p-5 mb-5">
    <h2 class="font-semibold text-white text-sm mb-4">Tabela completa de performance</h2>
    <table class="w-full text-sm">
      <thead>
        <tr class="text-slate-400 border-b border-slate-700/50 text-xs">
          <th class="pr-4 pb-2 text-left">#</th>
          <th class="pr-4 pb-2 text-left">Implantador</th>
          <th class="pr-4 pb-2 text-right">Integrações</th>
          <th class="pr-4 pb-2 text-right">Mediana</th>
          <th class="pr-4 pb-2 text-right">Média</th>
          <th class="pr-4 pb-2 text-right">Mínimo</th>
          <th class="pb-2 text-right">Máximo</th>
        </tr>
      </thead>
      <tbody>
        ${impStatsComp.map((imp, i) => {
          const col = imp.median <= 200 ? '#22c55e' : imp.median <= 500 ? '#f59e0b' : '#ef4444';
          const shortName = imp.name.split(' ').slice(0,3).join(' ');
          return `
        <tr class="border-b border-slate-700/30">
          <td class="pr-4 py-3 text-slate-600 font-mono text-xs">${i+1}</td>
          <td class="pr-4 py-3 text-slate-200 font-medium">${shortName}</td>
          <td class="pr-4 py-3 text-right text-slate-400 font-mono">${imp.count}</td>
          <td class="pr-4 py-3 text-right font-bold font-mono" style="color:${col}">${imp.median}d</td>
          <td class="pr-4 py-3 text-right font-mono text-slate-400">${imp.avg}d</td>
          <td class="pr-4 py-3 text-right font-mono text-green-600 text-xs">${imp.min}d</td>
          <td class="py-3 text-right font-mono text-red-600 text-xs">${imp.max}d</td>
        </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <!-- Chart -->
  <div class="card p-5">
    <h2 class="font-semibold text-white text-sm mb-4">Ciclo mediano por implantador</h2>
    <canvas id="perfChart" height="160"></canvas>
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

function initTabContent(id) {
  if (id === 'phases')      { initPhaseCharts(); return; }
  if (id === 'charts')      { initAllCharts(); return; }
  if (id === 'ciclo')       { initCicloChart(); return; }
  if (id === 'evolucao')    { initEvolucaoChart(); return; }
  if (id === 'performance') { initPerfChart(); return; }
  if (id === 'implantadores') { renderImplantadores(); return; }
}

// ── Phases charts ─────────────────────────────────────────────────────────────
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
        {label:'Mediana',data:ps.map(p=>p.median||0),backgroundColor:'#94a3b820',borderColor:'#94a3b8',borderWidth:1,borderRadius:4},
      ]
    },
    options:{responsive:true,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{x:{ticks:{color:'#64748b'},grid:{color:'#1e293b'}},y:{ticks:{color:'#64748b',callback:v=>v+'d'},grid:{color:'#334155'}}}}
  });
  const storeData = DATA.tasks.filter(t=>!t.isBacklog && (t.phases.preparacao+t.phases.produto+t.phases.pedido+t.phases.teste)>0).slice(0,20);
  if (storeData.length) {
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

// ── Charts tab ────────────────────────────────────────────────────────────────
function initAllCharts() {
  const sg = DATA.statusGroups.filter(s=>s.count>0);
  new Chart(document.getElementById('statusDonutChart').getContext('2d'),{
    type:'doughnut',
    data:{labels:sg.map(s=>s.status),datasets:[{data:sg.map(s=>s.count),backgroundColor:sg.map(s=>s.color+'cc'),borderColor:sg.map(s=>s.color),borderWidth:1}]},
    options:{responsive:true,plugins:{legend:{position:'bottom',labels:{color:'#94a3b8',font:{size:10},padding:6}},tooltip:{callbacks:{label:c=>\` \${c.label}: \${c.raw}\`}}}}
  });
  const gr = DATA.statusGroups.filter(g=>g.count>0);
  const groupsAgg = {};
  DATA.tasks.forEach(t => { if(!groupsAgg[t.group]) groupsAgg[t.group]={total:0,blocked:0}; groupsAgg[t.group].total++; if(t.isBlocked) groupsAgg[t.group].blocked++; });
  const grArr = Object.entries(groupsAgg).sort((a,b)=>b[1].total-a[1].total).slice(0,15);
  new Chart(document.getElementById('groupBarChart').getContext('2d'),{
    type:'bar',
    data:{
      labels:grArr.map(([g])=>g.substring(0,20)),
      datasets:[
        {label:'Em andamento',data:grArr.map(([,v])=>v.total-v.blocked),backgroundColor:'#3b82f680',borderRadius:3},
        {label:'Bloqueadas',data:grArr.map(([,v])=>v.blocked),backgroundColor:'#ef444480',borderRadius:3},
      ]
    },
    options:{responsive:true,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{x:{stacked:true,ticks:{color:'#64748b',font:{size:9}},grid:{color:'#1e293b'}},y:{stacked:true,ticks:{color:'#64748b'},grid:{color:'#334155'}}}}
  });
  const activeTasks = DATA.tasks.filter(t=>!t.isBacklog && t.total_days>0).slice(0,30);
  if (activeTasks.length) {
    new Chart(document.getElementById('activeBlockedChart').getContext('2d'),{
      type:'bar',
      data:{
        labels:activeTasks.map(t=>t.name.substring(0,20)),
        datasets:[
          {label:'Ativo',data:activeTasks.map(t=>t.active_days||t.total_days-t.blocked_days),backgroundColor:'#3b82f660',borderRadius:2},
          {label:'Bloqueado',data:activeTasks.map(t=>t.blocked_days),backgroundColor:'#ef444460',borderRadius:2},
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

// ── Ciclo Histórico chart ─────────────────────────────────────────────────────
function initCicloChart() {
  const buckets = DATA.ctBuckets;
  const maxCount = Math.max(...buckets.map(b=>b.count));
  const colors = buckets.map(b => {
    const label = b.label;
    if (label.startsWith('0') || label.startsWith('31') || label.startsWith('61')) return '#22c55e';
    if (label.startsWith('91') || label.startsWith('121')) return '#f59e0b';
    if (label.startsWith('181') || label.startsWith('271')) return '#f97316';
    return '#ef4444';
  });
  new Chart(document.getElementById('ctHistChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: buckets.map(b => b.label),
      datasets: [{
        label: 'Integrações concluídas',
        data: buckets.map(b => b.count),
        backgroundColor: colors.map(c => c + '99'),
        borderColor: colors,
        borderWidth: 1,
        borderRadius: 5,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: c => \` \${c.raw} lojas (\${Math.round(c.raw / DATA.ct.total * 100)}%)\`
        }}
      },
      scales: {
        x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#64748b' }, grid: { color: '#334155' } },
      }
    }
  });
}

// ── Evolução chart ────────────────────────────────────────────────────────────
function initEvolucaoChart() {
  const trend = DATA.monthlyTrend;
  const labels = trend.map(m => {
    const [y, mo] = m.month.split('-');
    return \`\${mo}/\${y.slice(2)}\`;
  });
  const medianData = trend.map(m => m.isOutlier ? null : m.median);
  const countData  = trend.map(m => m.count);

  new Chart(document.getElementById('evolucaoChart').getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Mediana ciclo (dias)',
          data: medianData,
          borderColor: '#3b82f6',
          backgroundColor: '#3b82f620',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: trend.map(m => m.isOutlier ? '#f59e0b' : '#3b82f6'),
          yAxisID: 'y1',
          spanGaps: true,
        },
        {
          label: 'Entregas/mês',
          data: countData,
          borderColor: '#10b98180',
          backgroundColor: 'transparent',
          borderDash: [4, 3],
          tension: 0.3,
          pointRadius: 2,
          yAxisID: 'y2',
        },
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: c => {
              if (c.datasetIndex === 0) return \` Mediana: \${c.raw !== null ? c.raw + 'd' : 'N/A (migração)'}\`;
              return \` Entregas: \${c.raw}\`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 45 }, grid: { color: '#1e293b' } },
        y1: { position: 'left',  ticks: { color: '#64748b', callback: v => v + 'd' }, grid: { color: '#334155' } },
        y2: { position: 'right', ticks: { color: '#475569' }, grid: { display: false } },
      }
    }
  });
}

// ── Performance chart ─────────────────────────────────────────────────────────
function initPerfChart() {
  const imps = DATA.impStatsComp;
  const colors = imps.map(i => i.median <= 200 ? '#22c55e' : i.median <= 500 ? '#f59e0b' : '#ef4444');
  new Chart(document.getElementById('perfChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: imps.map(i => i.name.split(' ').slice(0,2).join(' ')),
      datasets: [
        {
          label: 'Mediana (dias)',
          data: imps.map(i => i.median),
          backgroundColor: colors.map(c => c + '99'),
          borderColor: colors,
          borderWidth: 1,
          borderRadius: 5,
        },
        {
          label: 'Média (dias)',
          data: imps.map(i => i.avg),
          backgroundColor: '#94a3b820',
          borderColor: '#94a3b8',
          borderWidth: 1,
          borderRadius: 3,
          borderDash: [3,2],
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 10 } } } },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#64748b', callback: v => v + 'd' }, grid: { color: '#334155' } },
      }
    }
  });
}

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
    const sc = STATUS_COLORS[t.status] || '#475569';
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

// ── ERP Modal ─────────────────────────────────────────────────────────────────
function openErpModal(erpName) {
  const entry = DATA.erpStats.find(e => e.erp === erpName);
  if (!entry) return;

  const col = entry.median <= 200 ? '#22c55e' : entry.median <= 400 ? '#f59e0b' : '#ef4444';

  document.getElementById('modal-erp-name').textContent = erpName;
  document.getElementById('modal-erp-stats').textContent =
    \`\${entry.count} lojas · mediana \${entry.median}d · média \${entry.avg}d · mín \${entry.min}d · máx \${entry.max}d\`;

  const tbody = document.getElementById('modal-erp-tbody');
  tbody.innerHTML = entry.tasks.map((t, i) => {
    const dayCol = t.total_days <= entry.median ? '#22c55e' : t.total_days <= entry.avg ? '#f59e0b' : '#ef4444';
    const [y, mo] = t.month_done.split('-');
    return \`<tr class="border-b border-slate-800 hover:bg-slate-800/40">
      <td class="pr-4 py-2.5 text-slate-600 font-mono text-xs">\${i+1}</td>
      <td class="pr-4 py-2.5">
        <a href="https://app.clickup.com/t/\${t.id}" target="_blank"
           class="text-slate-200 hover:text-blue-400 font-medium text-xs transition-colors">\${t.name}</a>
      </td>
      <td class="pr-4 py-2.5 text-right font-bold font-mono text-sm" style="color:\${dayCol}">\${t.total_days}d</td>
      <td class="py-2.5 text-right text-slate-500 text-xs font-mono">\${mo}/\${y.slice(2)}</td>
    </tr>\`;
  }).join('');

  document.getElementById('erp-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeErpModal() {
  document.getElementById('erp-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeErpModal(); });

// Initialize first tab
initPhaseCharts();
chartsInited['phases'] = true;
<\/script>
</body>
</html>`;

writeFileSync("C:/Users/guilh/projetos/clickup-activity-mcp/dashboard.html", html);
console.log("Dashboard gerado!");
console.log("Arquivo: C:/Users/guilh/projetos/clickup-activity-mcp/dashboard.html");
console.log("Tamanho: " + (html.length/1024).toFixed(0) + "KB");
