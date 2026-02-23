import { readFileSync, writeFileSync } from "fs";

const raw = JSON.parse(readFileSync("C:/Users/guilh/projetos/clickup-activity-mcp/solicitacoes-data.json", "utf8"));
const ALL = raw.tasks;

// ── Team mapping ──────────────────────────────────────────────────────────────
const TEAMS = {
  integracoes: ["Guilherme Henrique Oliveira Sotério", "LUAN BISPO", "Gabriel Lima da Silva", "Welington"],
  frontend:    ["João Victor", "Johnny Lopes"],
  mobile:      ["Paulo Henrique"],
  backend:     ["Cayke Prudente"],
};

const TEAM_LABELS = { integracoes: "Integrações", frontend: "Frontend", mobile: "Mobile", backend: "Backend" };
const TEAM_COLORS = { integracoes: "#3b82f6", frontend: "#10b981", mobile: "#a855f7", backend: "#f59e0b" };

function getTeam(task) {
  for (const [team, members] of Object.entries(TEAMS)) {
    if (task.assignees.some(a => members.includes(a.username))) return team;
  }
  return "outros";
}

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function monthLabel(ms) {
  const d = new Date(ms);
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${months[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}
function weekKey(ms) {
  const d = new Date(ms);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2,"0")}`;
}
function weekLabel(key) {
  return key.replace("-W", " S");
}

function cleanStore(name) {
  const m = name.match(/^\[([^\]]+)\]/);
  return m ? m[1] : name.substring(0, 30);
}

// ── Tag each task with team ───────────────────────────────────────────────────
const tasks = ALL.map(t => ({ ...t, team: getTeam(t), store: cleanStore(t.name) }));

// ── INTEGRAÇÕES only ──────────────────────────────────────────────────────────
const INTEG_NAMES = TEAMS.integracoes;
const integTasks = tasks.filter(t => t.assignees.some(a => INTEG_NAMES.includes(a.username)));

console.log("Total tasks:", ALL.length);
console.log("Integrações tasks:", integTasks.length);

// ── D1: Volume por período ────────────────────────────────────────────────────
function buildVolume(taskList) {
  const byMonth = {}, byWeek = {};
  taskList.forEach(t => {
    const mk = monthKey(t.date_created);
    byMonth[mk] = (byMonth[mk] || 0) + 1;
    const wk = weekKey(t.date_created);
    byWeek[wk] = (byWeek[wk] || 0) + 1;
  });
  const months = Object.entries(byMonth).sort().map(([k,v]) => ({ key:k, label: monthLabel(new Date(k+"-01")), count:v }));
  const weeks  = Object.entries(byWeek).sort().slice(-16).map(([k,v]) => ({ key:k, label: weekLabel(k), count:v }));
  const now = monthKey(Date.now());
  const prev = (() => { const d=new Date(); d.setMonth(d.getMonth()-1); return monthKey(d); })();
  return { months, weeks,
    thisMonth: byMonth[now]||0,
    lastMonth: byMonth[prev]||0,
    total: taskList.length,
    avgPerMonth: Math.round(taskList.length / Math.max(months.length,1)),
  };
}

// ── D2: Resultado ─────────────────────────────────────────────────────────────
const RESULTADO_COLORS = {
  "Implantado":  "#22c55e",
  "Rejeitado":   "#ef4444",
  "Sem resultado": "#475569",
};

function buildResultado(taskList) {
  const counts = { "Implantado":0, "Rejeitado":0, "Sem resultado":0 };
  taskList.forEach(t => {
    if (!t.resultado) { counts["Sem resultado"]++; return; }
    const r = t.resultado.trim();
    if (counts[r] !== undefined) counts[r]++;
    else counts["Sem resultado"]++;
  });
  const total = taskList.length;
  const withResult = counts["Implantado"] + counts["Rejeitado"];
  return {
    counts,
    rows: Object.entries(counts).map(([label,count]) => ({
      label, count,
      pct: total > 0 ? Math.round(count/total*100) : 0,
      color: RESULTADO_COLORS[label] || "#475569",
    })).filter(r => r.count > 0),
    withResult,
    implantadoPct: withResult > 0 ? Math.round(counts["Implantado"]/withResult*100) : 0,
    rejeitadoPct:  withResult > 0 ? Math.round(counts["Rejeitado"]/withResult*100) : 0,
    // By month
    byMonth: (() => {
      const m = {};
      taskList.forEach(t => {
        if (!t.resultado) return;
        const k = monthKey(t.date_created);
        if (!m[k]) m[k] = { "Implantado":0, "Rejeitado":0 };
        const r = t.resultado.trim();
        if (m[k][r] !== undefined) m[k][r]++;
      });
      return Object.entries(m).sort().map(([k,v]) => ({ key:k, label: monthLabel(new Date(k+"-01")), ...v }));
    })(),
  };
}

// ── D3: Por Loja — detalhes individuais por loja ─────────────────────────────
function buildTasksByStore(taskList) {
  const stores = {};
  taskList.forEach(t => {
    const s = t.store;
    if (!stores[s]) stores[s] = [];
    const res = t.resultado && t.resultado.trim();
    stores[s].push({
      id: t.id,
      name: t.name,
      status: t.status,
      priority: t.priority || null,
      resultado: res || null,
      assignees: t.assignees.map(a => a.username.split(" ")[0]),
      date_created: new Date(t.date_created).toLocaleDateString("pt-BR"),
      date_done: t.date_done ? new Date(t.date_done).toLocaleDateString("pt-BR") : null,
      url: `https://app.clickup.com/t/${t.id}`,
    });
  });
  // Sort each store's tasks: open first, then by date_created desc
  const OPEN = ["triagem","aceito","em progresso","revisão","bloqueado"];
  for (const s of Object.keys(stores)) {
    stores[s].sort((a, b) => {
      const aOpen = OPEN.includes(a.status) ? 0 : 1;
      const bOpen = OPEN.includes(b.status) ? 0 : 1;
      return aOpen - bOpen;
    });
  }
  return stores;
}

// ── D3: Por Loja ──────────────────────────────────────────────────────────────
function buildLojas(taskList) {
  const stores = {};
  taskList.forEach(t => {
    const s = t.store;
    if (!stores[s]) stores[s] = { name:s, total:0, urgent:0, high:0, normal:0, low:0, rejeitado:0, implantado:0, open:0 };
    stores[s].total++;
    if (t.priority === "urgent") stores[s].urgent++;
    else if (t.priority === "high") stores[s].high++;
    else if (t.priority === "normal") stores[s].normal++;
    else stores[s].low++;
    const res = t.resultado && t.resultado.trim();
    if (res === "Rejeitado") stores[s].rejeitado++;
    else if (res === "Implantado") stores[s].implantado++;
    const OPEN = ["triagem","aceito","em progresso","revisão","bloqueado"];
    if (OPEN.includes(t.status)) stores[s].open++;
  });
  return Object.values(stores)
    .sort((a,b) => b.total - a.total)
    .map(s => {
      const withRes = s.implantado + s.rejeitado;
      return { ...s, rejeitadoPct: withRes > 0 ? Math.round(s.rejeitado/withRes*100) : 0 };
    });
}

// ── D4: Por responsável ───────────────────────────────────────────────────────
function buildResponsaveis(taskList) {
  const people = {};
  INTEG_NAMES.forEach(n => {
    people[n] = { name: n.split(" ")[0], total:0, open:0, implantado:0, rejeitado:0 };
  });
  taskList.forEach(t => {
    t.assignees.forEach(a => {
      if (!people[a.username]) return;
      people[a.username].total++;
      const OPEN = ["triagem","aceito","em progresso","revisão","bloqueado"];
      if (OPEN.includes(t.status)) people[a.username].open++;
      const r = t.resultado && t.resultado.trim();
      if (r === "Implantado") people[a.username].implantado++;
      else if (r === "Rejeitado") people[a.username].rejeitado++;
    });
  });
  // By month per person
  const byMonth = {};
  taskList.forEach(t => {
    const mk = monthKey(t.date_created);
    t.assignees.forEach(a => {
      if (!people[a.username]) return;
      const key = a.username.split(" ")[0] + "|" + mk;
      byMonth[key] = (byMonth[key]||0)+1;
    });
  });
  const months = [...new Set(taskList.map(t=>monthKey(t.date_created)))].sort();
  const series = INTEG_NAMES.map(n => ({
    name: n.split(" ")[0],
    fullName: n,
    data: months.map(m => byMonth[n.split(" ")[0]+"|"+m] || 0),
  }));
  return { people: Object.values(people), months: months.map(m => monthLabel(new Date(m+"-01"))), series };
}

// ── D5: Pipeline atual ────────────────────────────────────────────────────────
const OPEN_STATUSES = ["triagem","aceito","em progresso","revisão","bloqueado"];
const STATUS_COLORS_SOLIC = {
  "triagem": "#64748b", "aceito": "#3b82f6", "em progresso": "#10b981",
  "revisão": "#a855f7", "bloqueado": "#ef4444", "implantado": "#22c55e",
  "rejeitado": "#94a3b8", "arquivado": "#1e293b",
};

function buildPipeline(taskList) {
  const open = taskList.filter(t => OPEN_STATUSES.includes(t.status));
  const byStatus = {};
  open.forEach(t => {
    if (!byStatus[t.status]) byStatus[t.status] = [];
    byStatus[t.status].push({
      id: t.id, name: t.name.substring(0,70), store: t.store,
      priority: t.priority, resultado: t.resultado,
      assignee: t.assignees[0]?.username.split(" ")[0] || "—",
      days: Math.round((Date.now() - t.date_created) / 86400000),
      url: `https://app.clickup.com/t/${t.id}`,
    });
  });
  return {
    total: open.length,
    urgent: open.filter(t=>t.priority==="urgent").length,
    high: open.filter(t=>t.priority==="high").length,
    byStatus: Object.entries(byStatus).map(([s,tasks]) => ({
      status: s, count: tasks.length,
      color: STATUS_COLORS_SOLIC[s]||"#475569",
      tasks: tasks.sort((a,b)=>{
        const po = {urgent:0,high:1,normal:2,low:3};
        return (po[a.priority]||2)-(po[b.priority]||2);
      }),
    })),
  };
}

// ── D6: Por prioridade ────────────────────────────────────────────────────────
function buildPrioridade(taskList) {
  const PRIO_ORDER = ["urgent","high","normal","low"];
  const PRIO_COLORS = { urgent:"#ef4444", high:"#f97316", normal:"#3b82f6", low:"#64748b" };
  const PRIO_LABELS = { urgent:"Urgente", high:"Alta", normal:"Normal", low:"Baixa" };
  const counts = {urgent:0,high:0,normal:0,low:0,none:0};
  taskList.forEach(t => { const p = t.priority||"none"; counts[p] = (counts[p]||0)+1; });
  const byMonth = {};
  taskList.forEach(t => {
    const k = monthKey(t.date_created);
    if (!byMonth[k]) byMonth[k] = {urgent:0,high:0,normal:0,low:0};
    const p = t.priority;
    if (byMonth[k][p] !== undefined) byMonth[k][p]++;
  });
  const months = Object.entries(byMonth).sort().map(([k,v]) => ({ key:k, label:monthLabel(new Date(k+"-01")), ...v }));
  return {
    rows: PRIO_ORDER.map(p => ({ label:PRIO_LABELS[p]||p, count:counts[p], color:PRIO_COLORS[p]||"#475569", pct: taskList.length>0?Math.round(counts[p]/taskList.length*100):0 })),
    months,
  };
}

// ── D7: Comparativo equipes ───────────────────────────────────────────────────
function buildComparativo() {
  const teamData = {};
  for (const [team, members] of Object.entries(TEAMS)) {
    const t = tasks.filter(tk => tk.assignees.some(a => members.includes(a.username)));
    const byMonth = {};
    t.forEach(tk => { const k=monthKey(tk.date_created); byMonth[k]=(byMonth[k]||0)+1; });
    const res = {Implantado:0,Rejeitado:0};
    t.forEach(tk => { const r=tk.resultado&&tk.resultado.trim(); if(res[r]!==undefined) res[r]++; });
    const withRes = res.Implantado + res.Rejeitado;
    const openCount = t.filter(tk=>OPEN_STATUSES.includes(tk.status)).length;
    teamData[team] = {
      label: TEAM_LABELS[team], color: TEAM_COLORS[team],
      total: t.length, open: openCount,
      implantadoPct: withRes>0 ? Math.round(res.Implantado/withRes*100):0,
      rejeitadoPct: withRes>0 ? Math.round(res.Rejeitado/withRes*100):0,
      resultado: res,
      byMonth: Object.entries(byMonth).sort().map(([k,v])=>({ key:k, label:monthLabel(new Date(k+"-01")), count:v })),
    };
  }
  // All months across all teams
  const allMonths = [...new Set(Object.values(teamData).flatMap(d=>d.byMonth.map(m=>m.key)))].sort();
  const series = Object.entries(teamData).map(([team,d]) => ({
    team, label:d.label, color:d.color,
    data: allMonths.map(m => { const found=d.byMonth.find(b=>b.key===m); return found?found.count:0; }),
  }));
  return { teams: Object.values(teamData), allMonths: allMonths.map(m=>monthLabel(new Date(m+"-01"))), series };
}

// ── Build all ────────────────────────────────────────────────────────────────
const volume     = buildVolume(integTasks);
const resultado  = buildResultado(integTasks);
const lojas      = buildLojas(integTasks);
const tasksByStore = buildTasksByStore(integTasks);
const responsaveis = buildResponsaveis(integTasks);
const pipeline   = buildPipeline(integTasks);
const prioridade = buildPrioridade(integTasks);
const comparativo = buildComparativo();

const generatedAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

// ── Totais rápidos ────────────────────────────────────────────────────────────
const kpis = {
  total: integTasks.length,
  open: pipeline.total,
  urgent: pipeline.urgent,
  high: pipeline.high,
  implantadoPct: resultado.implantadoPct,
  rejeitadoPct: resultado.rejeitadoPct,
  thisMonth: volume.thisMonth,
  lastMonth: volume.lastMonth,
  avgPerMonth: volume.avgPerMonth,
};

const PRIO_COLORS = { urgent:"#ef4444", high:"#f97316", normal:"#3b82f6", low:"#64748b" };
const PRIO_LABELS = { urgent:"Urgente", high:"Alta", normal:"Normal", low:"Baixa" };

// ── HTML ──────────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Solicitações — Integrações</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
  body{background:#0f172a;color:#e2e8f0;font-family:'Inter',sans-serif;min-height:100vh}
  .tab-btn{transition:all .15s;border-bottom:2px solid transparent}
  .tab-btn.active{color:#60a5fa;border-bottom-color:#3b82f6}
  .tab-btn:not(.active){color:#64748b}
  .tab-btn:not(.active):hover{color:#94a3b8}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px}
  .kpi{background:linear-gradient(135deg,#1e293b,#162032);border:1px solid #334155;border-radius:12px}
  .tab-content{display:none}
  .tab-content.active{display:block}
  .badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap}
  .scrollable{max-height:480px;overflow-y:auto}
  .scrollable-tall{max-height:640px;overflow-y:auto}
  ::-webkit-scrollbar{width:5px}
  ::-webkit-scrollbar-track{background:#0f172a}
  ::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}
  table th{background:#0f172a;position:sticky;top:0;z-index:10;padding:8px 12px 8px 0;font-size:11px}
  table td{padding:7px 12px 7px 0;font-size:12px}
  tr:hover td{background:#1e293b55}
  .bar-bg{background:#0f172a;border-radius:4px;height:6px;overflow:hidden}
  .bar-fill{height:6px;border-radius:4px}
  input[type=text]{background:#1e293b;border:1px solid #334155;color:#e2e8f0;outline:none}
  input[type=text]:focus{border-color:#3b82f6}
  select{background:#1e293b;border:1px solid #334155;color:#94a3b8;outline:none}
</style>
</head>
<body>

<!-- Header -->
<div class="border-b border-slate-700 px-6 py-3 flex items-center justify-between sticky top-0 bg-slate-900/95 backdrop-blur z-50">
  <div class="flex items-center gap-3">
    <div>
      <h1 class="text-base font-bold text-white">🎫 Solicitações — Equipe Integrações</h1>
      <p class="text-slate-500 text-xs">Atualizado ${generatedAt} · Guilherme · Luan · Gabriel · Welington</p>
    </div>
  </div>
  <div class="flex gap-2 flex-wrap justify-end">
    <span class="badge bg-slate-700/60 text-slate-300">${kpis.total} total</span>
    <span class="badge bg-red-900/40 text-red-300 border border-red-700/30">🔴 ${kpis.urgent} urgente${kpis.urgent!==1?'s':''}</span>
    <span class="badge bg-orange-900/40 text-orange-300 border border-orange-700/30">${kpis.high} alta prioridade</span>
    <span class="badge bg-blue-900/40 text-blue-300 border border-blue-700/30">${kpis.open} em aberto</span>
  </div>
</div>

<!-- KPIs -->
<div class="px-6 pt-5 grid grid-cols-6 gap-3">
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Total histórico</p>
    <p class="text-2xl font-bold text-white">${kpis.total}</p>
    <p class="text-slate-500 text-xs mt-1">~${kpis.avgPerMonth}/mês</p>
  </div>
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Este mês</p>
    <p class="text-2xl font-bold text-blue-400">${kpis.thisMonth}</p>
    <p class="text-slate-500 text-xs mt-1">mês anterior: ${kpis.lastMonth}</p>
  </div>
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Em aberto</p>
    <p class="text-2xl font-bold text-yellow-400">${kpis.open}</p>
    <p class="text-slate-500 text-xs mt-1">aguardando ação</p>
  </div>
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Urgentes</p>
    <p class="text-2xl font-bold text-red-400">${kpis.urgent}</p>
    <p class="text-slate-500 text-xs mt-1">${kpis.high} alta prioridade</p>
  </div>
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Taxa de aceite</p>
    <p class="text-2xl font-bold text-green-400">${kpis.implantadoPct}%</p>
    <p class="text-slate-500 text-xs mt-1">implantado vs rejeitado</p>
  </div>
  <div class="kpi p-4 text-center">
    <p class="text-slate-400 text-xs mb-1">Rejeitadas</p>
    <p class="text-2xl font-bold ${kpis.rejeitadoPct > 40 ? 'text-red-400' : 'text-orange-400'}">${kpis.rejeitadoPct}%</p>
    <p class="text-slate-500 text-xs mt-1">das resolvidas</p>
  </div>
</div>

<!-- Tabs -->
<div class="px-6 pt-5 flex gap-0 border-b border-slate-700 overflow-x-auto">
  <button class="tab-btn active px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('volume',this)">📈 Volume</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('resultado',this)">🎯 Resultado</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('lojas',this)">🏪 Por Loja</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('responsaveis',this)">👤 Por Responsável</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('pipeline',this)">📋 Pipeline Atual</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('prioridade',this)">🚨 Prioridade</button>
  <button class="tab-btn px-5 py-2.5 text-sm font-medium whitespace-nowrap" onclick="showTab('comparativo',this)">⚖️ Comparativo</button>
</div>

<div class="p-6">

<!-- VOLUME -->
<div id="tab-volume" class="tab-content active">
  <div class="card p-5 mb-4">
    <div class="flex items-center justify-between mb-1">
      <div>
        <h2 class="font-semibold text-white text-sm">Solicitações ao longo do tempo</h2>
        <p class="text-slate-500 text-xs mt-0.5">Clique em uma barra para ver o contexto do mês</p>
      </div>
      <div class="flex gap-2">
        <button id="vol-week-btn" class="text-xs px-3 py-1 rounded-full bg-slate-700 text-slate-300 hover:bg-slate-600" onclick="switchVol('week')">Semanal</button>
        <button id="vol-month-btn" class="text-xs px-3 py-1 rounded-full bg-blue-600 text-white" onclick="switchVol('month')">Mensal</button>
      </div>
    </div>
    <canvas id="volChart" height="85"></canvas>
  </div>

  <!-- Insights do período -->
  <div id="vol-insights">
    <div class="flex items-center gap-3 mb-3">
      <span class="text-xs font-semibold text-slate-500 uppercase tracking-widest whitespace-nowrap">Contexto do período</span>
      <div class="flex-1 h-px bg-slate-700/50"></div>
      <span class="text-slate-600 text-xs">Out — Dez/2025</span>
    </div>

    <div class="grid grid-cols-3 gap-3">

      <!-- OUT/2025 - PICO -->
      <div id="insight-2025-10" class="card p-4 cursor-pointer transition-all duration-200 border-slate-700 hover:border-amber-500/50" onclick="toggleInsight('2025-10')">
        <div class="flex items-start justify-between mb-2">
          <div>
            <span class="badge text-xs font-bold mb-1" style="background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44">⚠️ Pico — Out/25</span>
            <p class="text-white font-semibold text-sm mt-1.5">Onda de falhas em ERPs</p>
          </div>
          <span class="text-2xl font-bold text-amber-400">60</span>
        </div>
        <p class="text-slate-400 text-xs leading-relaxed">13 ERPs diferentes afetados simultaneamente. Predominância de falhas de envio de pedidos ao ERP e instabilidade em sincronização de produtos.</p>
        <div class="flex flex-wrap gap-1 mt-2.5">
          <span class="badge text-xs" style="background:#ef444420;color:#ef4444;border:1px solid #ef444430">15 pedidos parados</span>
          <span class="badge text-xs" style="background:#f5930b20;color:#f59e0b;border:1px solid #f59e0b30">+107% vs Set</span>
          <span class="badge text-xs" style="background:#3b82f620;color:#3b82f6;border:1px solid #3b82f630">87% aceite</span>
        </div>
        <!-- Expandable detail -->
        <div id="insight-detail-2025-10" class="hidden mt-3 pt-3 border-t border-slate-700/50 space-y-2">
          <p class="text-slate-300 text-xs font-semibold mb-1.5">Principais ERPs afetados:</p>
          <div class="grid grid-cols-2 gap-1 text-xs">
            <span class="text-slate-400">Intersolid / Winthor</span><span class="text-white font-mono">5 tickets</span>
            <span class="text-slate-400">Linear</span><span class="text-white font-mono">3 tickets</span>
            <span class="text-slate-400">SQL</span><span class="text-white font-mono">3 tickets</span>
            <span class="text-slate-400">BLING, Arius, CISS, RPInfo...</span><span class="text-white font-mono">+7 ERPs</span>
          </div>
          <p class="text-slate-300 text-xs font-semibold mt-2 mb-1.5">Lojas com múltiplos tickets:</p>
          <div class="grid grid-cols-2 gap-1 text-xs">
            <span class="text-slate-400">Casa do Sabão</span><span class="text-white font-mono">4 tickets</span>
            <span class="text-slate-400">Mix Atacadão</span><span class="text-white font-mono">3 tickets</span>
            <span class="text-slate-400">Frirocha</span><span class="text-white font-mono">3 tickets</span>
            <span class="text-slate-400">Redestore</span><span class="text-white font-mono">2 tickets</span>
          </div>
          <div class="mt-2 p-2 rounded-lg bg-amber-900/20 border border-amber-700/30">
            <p class="text-amber-300 text-xs">🔑 Guilherme absorveu 90% dos cards (54/60). Volume distribuído uniformemente nas 4 semanas — não foi um rush pontual.</p>
          </div>
        </div>
        <p id="insight-toggle-2025-10" class="text-slate-600 text-xs mt-2 hover:text-slate-400">▼ ver detalhes</p>
      </div>

      <!-- NOV/2025 - NORMALIZAÇÃO -->
      <div id="insight-2025-11" class="card p-4 cursor-pointer transition-all duration-200 border-slate-700 hover:border-blue-500/50" onclick="toggleInsight('2025-11')">
        <div class="flex items-start justify-between mb-2">
          <div>
            <span class="badge text-xs font-bold mb-1" style="background:#3b82f622;color:#3b82f6;border:1px solid #3b82f644">📉 Normalização — Nov/25</span>
            <p class="text-white font-semibold text-sm mt-1.5">Retorno ao ritmo normal</p>
          </div>
          <span class="text-2xl font-bold text-blue-400">32</span>
        </div>
        <p class="text-slate-400 text-xs leading-relaxed">Queda de 47% após o pico. Perfil mudou de emergências para configurações (ClearSale, migração de adquirente, ajustes de Pix).</p>
        <div class="flex flex-wrap gap-1 mt-2.5">
          <span class="badge text-xs" style="background:#22c55e20;color:#22c55e;border:1px solid #22c55e30">-47% vs Out</span>
          <span class="badge text-xs" style="background:#a855f720;color:#a855f7;border:1px solid #a855f730">mais configurações</span>
          <span class="badge text-xs" style="background:#22c55e20;color:#22c55e;border:1px solid #22c55e30">75% aceite</span>
        </div>
        <div id="insight-detail-2025-11" class="hidden mt-3 pt-3 border-t border-slate-700/50 space-y-2">
          <p class="text-slate-300 text-xs font-semibold mb-1.5">Destaques de novembro:</p>
          <ul class="text-xs text-slate-400 space-y-1 list-none">
            <li>→ <span class="text-slate-300">Zero Hora</span>: 2 tickets (produtos duplicados + integração parada)</li>
            <li>→ <span class="text-slate-300">ClearSale</span>: configurações em múltiplas lojas</li>
            <li>→ <span class="text-slate-300">Batel Gourmet</span>: site fora do ar (urgência pontual)</li>
            <li>→ <span class="text-slate-300">Malunga</span>: Winthor com pedido não subindo</li>
          </ul>
          <div class="mt-2 p-2 rounded-lg bg-blue-900/20 border border-blue-700/30">
            <p class="text-blue-300 text-xs">💡 Outubro "queimou" a fila acumulada. Novembro reflete o ritmo operacional sustentável da equipe.</p>
          </div>
        </div>
        <p id="insight-toggle-2025-11" class="text-slate-600 text-xs mt-2 hover:text-slate-400">▼ ver detalhes</p>
      </div>

      <!-- DEZ/2025 - RECESSO -->
      <div id="insight-2025-12" class="card p-4 cursor-pointer transition-all duration-200 border-slate-700 hover:border-slate-500/50" onclick="toggleInsight('2025-12')">
        <div class="flex items-start justify-between mb-2">
          <div>
            <span class="badge text-xs font-bold mb-1" style="background:#64748b22;color:#94a3b8;border:1px solid #64748b44">❄️ Recesso — Dez/25</span>
            <p class="text-white font-semibold text-sm mt-1.5">Menor volume do semestre</p>
          </div>
          <span class="text-2xl font-bold text-slate-400">21</span>
        </div>
        <p class="text-slate-400 text-xs leading-relaxed">Desaceleração de fim de ano. Recesso e menor demanda de clientes nas duas últimas semanas comprimem o volume natural.</p>
        <div class="flex flex-wrap gap-1 mt-2.5">
          <span class="badge text-xs" style="background:#64748b20;color:#94a3b8;border:1px solid #64748b30">-34% vs Nov</span>
          <span class="badge text-xs" style="background:#f59e0b20;color:#f59e0b;border:1px solid #f59e0b30">Consinco atenção</span>
          <span class="badge text-xs" style="background:#22c55e20;color:#22c55e;border:1px solid #22c55e30">76% aceite</span>
        </div>
        <div id="insight-detail-2025-12" class="hidden mt-3 pt-3 border-t border-slate-700/50 space-y-2">
          <p class="text-slate-300 text-xs font-semibold mb-1.5">Destaques de dezembro:</p>
          <ul class="text-xs text-slate-400 space-y-1 list-none">
            <li>→ <span class="text-slate-300">Casa do Sabão</span>: recorrência (3ª vez) — erro ERP não resolvido de forma definitiva</li>
            <li>→ <span class="text-slate-300">Consinco</span>: BigBox (urgente) e Dona Sudoeste com falhas na pré-venda</li>
            <li>→ <span class="text-slate-300">Mix Atacadão</span>: reintegração completa da loja (29/12)</li>
          </ul>
          <div class="mt-2 p-2 rounded-lg bg-slate-800/60 border border-slate-600/30">
            <p class="text-slate-300 text-xs">⚠️ Casa do Sabão com recorrências em Out, Nov e Dez sugere problema crônico na integração — ponto de atenção para Q1/2026.</p>
          </div>
        </div>
        <p id="insight-toggle-2025-12" class="text-slate-600 text-xs mt-2 hover:text-slate-400">▼ ver detalhes</p>
      </div>

    </div>
  </div>
</div>

<!-- RESULTADO -->
<div id="tab-resultado" class="tab-content">
  <div class="grid grid-cols-12 gap-4">
    <div class="col-span-4 card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Distribuição de resultado</h2>
      <canvas id="resultDonut" height="220"></canvas>
      <div class="mt-4 space-y-2">
        ${resultado.rows.map(r=>`
        <div class="flex items-center justify-between text-xs">
          <span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full inline-block" style="background:${r.color}"></span><span class="text-slate-300">${r.label}</span></span>
          <span class="font-mono text-white">${r.count} <span class="text-slate-500">(${r.pct}%)</span></span>
        </div>`).join("")}
      </div>
    </div>
    <div class="col-span-8 card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Resultado por mês</h2>
      <canvas id="resultMonthChart" height="200"></canvas>
    </div>
  </div>
</div>

<!-- LOJAS -->
<div id="tab-lojas" class="tab-content">
  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-semibold text-white text-sm">Solicitações por loja</h2>
      <input type="text" id="loja-search" placeholder="Filtrar loja..." class="text-xs px-3 py-1.5 rounded-lg w-48" oninput="renderLojas()">
    </div>
    <div class="scrollable-tall">
      <table class="w-full">
        <thead>
          <tr class="text-left text-slate-400 border-b border-slate-700/50">
            <th class="pr-3 cursor-pointer hover:text-white" onclick="sortLojas('name')">Loja</th>
            <th class="pr-3 text-right cursor-pointer hover:text-white" onclick="sortLojas('total')">Total</th>
            <th class="pr-3 text-right cursor-pointer hover:text-white" onclick="sortLojas('open')">Abertos</th>
            <th class="pr-3 text-right cursor-pointer hover:text-white" onclick="sortLojas('urgent')">🔴</th>
            <th class="pr-3 text-right cursor-pointer hover:text-white" onclick="sortLojas('high')">🟠</th>
            <th class="pr-3 text-right cursor-pointer hover:text-white" onclick="sortLojas('rejeitado')">Rejeitadas</th>
            <th class="text-right cursor-pointer hover:text-white" onclick="sortLojas('rejeitadoPct')">% Rejeit.</th>
          </tr>
        </thead>
        <tbody id="lojas-tbody" class="divide-y divide-slate-700/30"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- RESPONSÁVEIS -->
<div id="tab-responsaveis" class="tab-content">
  <div class="grid grid-cols-12 gap-4">
    <div class="col-span-5">
      <div class="grid grid-cols-2 gap-3 mb-3">
        ${responsaveis.people.map(p=>`
        <div class="kpi p-4">
          <p class="text-slate-400 text-xs mb-1">${p.name}</p>
          <p class="text-2xl font-bold text-white">${p.total}</p>
          <p class="text-slate-500 text-xs mt-1">${p.open} em aberto</p>
          <div class="mt-2 flex gap-1 flex-wrap">
            ${p.implantado>0?`<span class="badge bg-green-900/30 text-green-400" style="font-size:10px">${p.implantado} impl.</span>`:''}
            ${p.rejeitado>0?`<span class="badge bg-red-900/30 text-red-400" style="font-size:10px">${p.rejeitado} rejeit.</span>`:''}
          </div>
        </div>`).join("")}
      </div>
    </div>
    <div class="col-span-7 card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Evolução mensal por responsável</h2>
      <canvas id="respMonthChart" height="230"></canvas>
    </div>
  </div>
</div>

<!-- PIPELINE -->
<div id="tab-pipeline" class="tab-content">
  <div class="grid grid-cols-3 gap-3 mb-5">
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs">Total em aberto</p>
      <p class="text-3xl font-bold text-white mt-1">${pipeline.total}</p>
    </div>
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs">Urgentes</p>
      <p class="text-3xl font-bold text-red-400 mt-1">${pipeline.urgent}</p>
    </div>
    <div class="kpi p-4 text-center">
      <p class="text-slate-400 text-xs">Alta prioridade</p>
      <p class="text-3xl font-bold text-orange-400 mt-1">${pipeline.high}</p>
    </div>
  </div>
  ${pipeline.byStatus.map(sg=>`
  <div class="card p-4 mb-3">
    <div class="flex items-center gap-2 mb-3">
      <span class="w-2 h-2 rounded-full" style="background:${sg.color}"></span>
      <h3 class="font-semibold text-sm" style="color:${sg.color}">${sg.status.toUpperCase()}</h3>
      <span class="text-slate-400 text-xs">${sg.count} ticket${sg.count!==1?'s':''}</span>
    </div>
    <div class="space-y-2">
      ${sg.tasks.slice(0,15).map(t=>`
      <a href="${t.url}" target="_blank" class="flex items-start justify-between py-2 px-2 rounded hover:bg-slate-700/30 border border-slate-700/30 hover:border-slate-500/50 transition-all">
        <div class="flex-1 min-w-0">
          <p class="text-xs text-slate-300 truncate">${t.name}</p>
          <p class="text-slate-500 text-xs mt-0.5">${t.store} · ${t.assignee} · ${t.days}d atrás</p>
        </div>
        <div class="flex items-center gap-2 ml-3 flex-shrink-0">
          ${t.priority&&t.priority!=='normal'?`<span class="badge" style="background:${PRIO_COLORS[t.priority]||'#475569'}22;color:${PRIO_COLORS[t.priority]||'#475569'};border:1px solid ${PRIO_COLORS[t.priority]||'#475569'}33;font-size:10px">${PRIO_LABELS[t.priority]||t.priority}</span>`:''}
        </div>
      </a>`).join("")}
      ${sg.tasks.length>15?`<p class="text-slate-600 text-xs pl-2">+${sg.tasks.length-15} mais...</p>`:''}
    </div>
  </div>`).join("")}
</div>

<!-- PRIORIDADE -->
<div id="tab-prioridade" class="tab-content">
  <div class="grid grid-cols-12 gap-4">
    <div class="col-span-4 card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Distribuição por prioridade</h2>
      <canvas id="prioDonut" height="200"></canvas>
      <div class="mt-4 space-y-2">
        ${prioridade.rows.map(r=>`
        <div class="flex items-center justify-between text-xs">
          <span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full inline-block" style="background:${r.color}"></span><span class="text-slate-300">${r.label}</span></span>
          <span class="font-mono text-white">${r.count} <span class="text-slate-500">(${r.pct}%)</span></span>
        </div>`).join("")}
      </div>
    </div>
    <div class="col-span-8 card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Prioridade por mês</h2>
      <canvas id="prioMonthChart" height="200"></canvas>
    </div>
  </div>
</div>

<!-- COMPARATIVO -->
<div id="tab-comparativo" class="tab-content">
  <div class="grid grid-cols-4 gap-3 mb-5">
    ${comparativo.teams.map(t=>`
    <div class="kpi p-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="w-2.5 h-2.5 rounded-full" style="background:${t.color}"></span>
        <p class="text-xs font-semibold" style="color:${t.color}">${t.label}</p>
      </div>
      <p class="text-2xl font-bold text-white">${t.total}</p>
      <p class="text-slate-500 text-xs mt-1">${t.open} em aberto</p>
      <div class="mt-2 flex gap-1">
        <span class="badge text-xs" style="background:#22c55e20;color:#22c55e">${t.implantadoPct}% aceito</span>
      </div>
    </div>`).join("")}
  </div>
  <div class="grid grid-cols-2 gap-4">
    <div class="card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Volume mensal por equipe</h2>
      <canvas id="compLineChart" height="200"></canvas>
    </div>
    <div class="card p-5">
      <h2 class="font-semibold text-white text-sm mb-4">Total de solicitações por equipe</h2>
      <canvas id="compBarChart" height="200"></canvas>
    </div>
  </div>
  <div class="card p-5 mt-4">
    <h2 class="font-semibold text-white text-sm mb-4">% Aceito (Implantado) por equipe</h2>
    <canvas id="compEvitavelChart" height="80"></canvas>
  </div>
</div>

</div><!-- /p-6 -->

<!-- MODAL LOJA -->
<div id="store-modal" class="fixed inset-0 z-[100] flex items-start justify-center pt-16 px-4 pb-8" style="display:none!important">
  <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onclick="closeStoreModal()"></div>
  <div class="relative w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col" style="max-height:80vh">
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-slate-700 flex-shrink-0">
      <div>
        <h2 id="modal-store-name" class="font-bold text-white text-base"></h2>
        <p id="modal-store-sub" class="text-slate-400 text-xs mt-0.5"></p>
      </div>
      <button onclick="closeStoreModal()" class="text-slate-500 hover:text-white transition-colors text-xl leading-none px-2">✕</button>
    </div>
    <!-- Cards -->
    <div id="modal-cards" class="overflow-y-auto px-6 py-4 space-y-3 flex-1"></div>
  </div>
</div>

<script>
const VOLUME_DATA     = ${JSON.stringify({ months: volume.months, weeks: volume.weeks })};
const RESULTADO_DATA  = ${JSON.stringify(resultado)};
const LOJAS_DATA      = ${JSON.stringify(lojas)};
const TASKS_BY_STORE  = ${JSON.stringify(tasksByStore)};
const RESP_DATA       = ${JSON.stringify(responsaveis)};
const PRIORIDADE_DATA = ${JSON.stringify(prioridade)};
const COMPARATIVO_DATA= ${JSON.stringify(comparativo)};
const RESULTADO_COLORS= ${JSON.stringify(Object.fromEntries(resultado.rows.map(r=>[r.label,r.color])))};
const PRIO_COLORS_MAP = {urgent:"#ef4444",high:"#f97316",normal:"#3b82f6",low:"#64748b"};
const PRIO_LABELS_MAP = {urgent:"Urgente",high:"Alta",normal:"Normal",low:"Baixa"};

const chartsInited = {};
function showTab(id, btn) {
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
  btn.classList.add('active');
  if (!chartsInited[id]) { initTab(id); chartsInited[id]=true; }
}

// ── Volume ────────────────────────────────────────────────────────────────────
const INSIGHT_KEYS = ['2025-10','2025-11','2025-12'];
let volChart=null, volMode='month';

function getBarColors(src) {
  if(volMode!=='month') return { bg: src.map(()=>'#3b82f660'), border: src.map(()=>'#3b82f6') };
  const maxVal = Math.max(...src.map(d=>d.count));
  return {
    bg: src.map(d => {
      if(d.key==='2025-10') return '#f59e0b90'; // amber - pico
      if(d.key==='2025-11') return '#3b82f650';
      if(d.key==='2025-12') return '#64748b50';
      if(d.count === maxVal) return '#f59e0b70';
      return '#3b82f650';
    }),
    border: src.map(d => {
      if(d.key==='2025-10') return '#f59e0b';
      if(d.key==='2025-11') return '#3b82f6';
      if(d.key==='2025-12') return '#64748b';
      return '#3b82f6';
    }),
  };
}

function initVolume() {
  const src = volMode==='month' ? VOLUME_DATA.months : VOLUME_DATA.weeks;
  const ctx = document.getElementById('volChart').getContext('2d');
  if(volChart) volChart.destroy();
  const colors = getBarColors(src);
  volChart = new Chart(ctx, {
    type:'bar',
    data:{labels:src.map(d=>d.label),datasets:[{
      label:'Solicitações',data:src.map(d=>d.count),
      backgroundColor:colors.bg,borderColor:colors.border,borderWidth:1.5,borderRadius:4,
    }]},
    options:{
      responsive:true,
      onClick:(e,elements)=>{
        if(volMode!=='month'||!elements.length) return;
        const idx=elements[0].index;
        const key=VOLUME_DATA.months[idx]?.key;
        if(key&&INSIGHT_KEYS.includes(key)) scrollToInsight(key);
      },
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          title: items => src[items[0].dataIndex].label,
          label: item => ' ' + item.raw + ' solicitações',
          afterLabel: item => {
            const key = src[item.dataIndex]?.key;
            if(key==='2025-10') return ' ⚠️ Pico histórico — clique para detalhes';
            if(INSIGHT_KEYS.includes(key)) return ' 💡 Clique para ver contexto';
            return '';
          }
        }}
      },
      scales:{
        x:{ticks:{color:'#64748b',font:{size:10},maxRotation:45},grid:{color:'#1e293b'}},
        y:{ticks:{color:'#64748b',font:{size:10}},grid:{color:'#334155'}},
      },
      cursor:'pointer',
    }
  });
  // Show/hide insights section
  document.getElementById('vol-insights').style.display = volMode==='month' ? 'block' : 'none';
}
function switchVol(mode) {
  volMode=mode;
  initVolume();
  document.getElementById('vol-month-btn').className=mode==='month'
    ?'text-xs px-3 py-1 rounded-full bg-blue-600 text-white'
    :'text-xs px-3 py-1 rounded-full bg-slate-700 text-slate-300 hover:bg-slate-600';
  document.getElementById('vol-week-btn').className=mode==='week'
    ?'text-xs px-3 py-1 rounded-full bg-blue-600 text-white'
    :'text-xs px-3 py-1 rounded-full bg-slate-700 text-slate-300 hover:bg-slate-600';
}

function toggleInsight(key) {
  const detail = document.getElementById('insight-detail-'+key);
  const toggle = document.getElementById('insight-toggle-'+key);
  const card   = document.getElementById('insight-'+key);
  const isOpen = !detail.classList.contains('hidden');
  detail.classList.toggle('hidden');
  toggle.textContent = isOpen ? '▼ ver detalhes' : '▲ fechar';
  card.style.borderColor = isOpen ? '' : (key==='2025-10'?'#f59e0b88':key==='2025-11'?'#3b82f688':'#64748b88');
}

function scrollToInsight(key) {
  const card = document.getElementById('insight-'+key);
  if(!card) return;
  card.scrollIntoView({behavior:'smooth', block:'center'});
  // Open detail if closed
  const detail = document.getElementById('insight-detail-'+key);
  if(detail.classList.contains('hidden')) toggleInsight(key);
  // Flash highlight
  card.style.transition='box-shadow 0.3s';
  card.style.boxShadow='0 0 0 2px '+(key==='2025-10'?'#f59e0b':key==='2025-11'?'#3b82f6':'#64748b');
  setTimeout(()=>{ card.style.boxShadow=''; }, 1800);
}

// ── Resultado ─────────────────────────────────────────────────────────────────
function initResultado() {
  const rows = RESULTADO_DATA.rows.filter(r=>r.label!=='Sem resultado'&&r.count>0);
  new Chart(document.getElementById('resultDonut').getContext('2d'),{
    type:'doughnut',
    data:{labels:rows.map(r=>r.label),datasets:[{data:rows.map(r=>r.count),backgroundColor:rows.map(r=>r.color+'cc'),borderColor:rows.map(r=>r.color),borderWidth:1}]},
    options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>\` \${c.label}: \${c.raw}\`}}}}
  });
  const months = RESULTADO_DATA.byMonth;
  new Chart(document.getElementById('resultMonthChart').getContext('2d'),{
    type:'bar',
    data:{
      labels:months.map(m=>m.label),
      datasets:[
        {label:'Implantado',data:months.map(m=>m['Implantado']||0),backgroundColor:'#22c55e70',borderColor:'#22c55e',borderWidth:1,borderRadius:2},
        {label:'Rejeitado',data:months.map(m=>m['Rejeitado']||0),backgroundColor:'#ef444470',borderColor:'#ef4444',borderWidth:1,borderRadius:2},
      ]
    },
    options:{responsive:true,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{
      x:{stacked:true,ticks:{color:'#64748b',font:{size:9},maxRotation:30},grid:{color:'#1e293b'}},
      y:{stacked:true,ticks:{color:'#64748b',font:{size:10}},grid:{color:'#334155'}},
    }}
  });
}

// ── Lojas ─────────────────────────────────────────────────────────────────────
let lojasSort='total', lojasAsc=false;
function sortLojas(k){if(lojasSort===k)lojasAsc=!lojasAsc;else{lojasSort=k;lojasAsc=false;}renderLojas();}
function renderLojas() {
  const q=(document.getElementById('loja-search')?.value||'').toLowerCase();
  let rows=[...LOJAS_DATA];
  if(q)rows=rows.filter(r=>r.name.toLowerCase().includes(q));
  rows.sort((a,b)=>{const va=a[lojasSort],vb=b[lojasSort];return typeof va==='string'?(lojasAsc?va.localeCompare(vb):vb.localeCompare(va)):(lojasAsc?va-vb:vb-va);});
  document.getElementById('lojas-tbody').innerHTML=rows.map(r=>\`
  <tr class="border-b border-slate-700/30 cursor-pointer hover:bg-slate-800/60 transition-colors" onclick="openStoreModal('\${r.name.replace(/'/g,"\\\\'")}')" title="Ver detalhes de \${r.name}">
    <td class="pr-3">
      <span class="text-slate-300 font-medium">\${r.name.substring(0,35)}</span>
      <span class="ml-2 text-slate-600 text-xs hover:text-blue-400">↗ detalhes</span>
    </td>
    <td class="pr-3 text-right font-mono text-white">\${r.total}</td>
    <td class="pr-3 text-right \${r.open>0?'text-yellow-400':'text-slate-600'}">\${r.open||'—'}</td>
    <td class="pr-3 text-right \${r.urgent>0?'text-red-400':'text-slate-600'}">\${r.urgent||'—'}</td>
    <td class="pr-3 text-right \${r.high>0?'text-orange-400':'text-slate-600'}">\${r.high||'—'}</td>
    <td class="pr-3 text-right \${r.rejeitado>0?'text-red-400':'text-slate-600'}">\${r.rejeitado||'—'}</td>
    <td class="text-right"><span class="\${r.rejeitadoPct>40?'text-red-400':r.rejeitadoPct>20?'text-orange-400':'text-green-500'}">\${r.rejeitadoPct}%</span></td>
  </tr>\`).join('');
}

// ── Responsáveis ──────────────────────────────────────────────────────────────
function initResponsaveis() {
  const COLORS=['#3b82f6','#a855f7','#10b981','#f59e0b'];
  new Chart(document.getElementById('respMonthChart').getContext('2d'),{
    type:'line',
    data:{
      labels:RESP_DATA.months,
      datasets:RESP_DATA.series.map((s,i)=>({
        label:s.name,data:s.data,
        borderColor:COLORS[i%COLORS.length],backgroundColor:COLORS[i%COLORS.length]+'20',
        borderWidth:2,pointRadius:3,tension:0.3,fill:false,
      })),
    },
    options:{responsive:true,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{
      x:{ticks:{color:'#64748b',font:{size:9},maxRotation:30},grid:{color:'#1e293b'}},
      y:{ticks:{color:'#64748b',font:{size:10}},grid:{color:'#334155'}},
    }}
  });
}

// ── Prioridade ────────────────────────────────────────────────────────────────
function initPrioridade() {
  const rows=PRIORIDADE_DATA.rows.filter(r=>r.count>0);
  new Chart(document.getElementById('prioDonut').getContext('2d'),{
    type:'doughnut',
    data:{labels:rows.map(r=>r.label),datasets:[{data:rows.map(r=>r.count),backgroundColor:rows.map(r=>r.color+'cc'),borderColor:rows.map(r=>r.color),borderWidth:1}]},
    options:{responsive:true,plugins:{legend:{display:false}}}
  });
  const months=PRIORIDADE_DATA.months;
  new Chart(document.getElementById('prioMonthChart').getContext('2d'),{
    type:'bar',
    data:{
      labels:months.map(m=>m.label),
      datasets:[
        {label:'Urgente',data:months.map(m=>m.urgent),backgroundColor:'#ef444470',borderColor:'#ef4444',borderWidth:1,borderRadius:2},
        {label:'Alta',data:months.map(m=>m.high),backgroundColor:'#f9731670',borderColor:'#f97316',borderWidth:1,borderRadius:2},
        {label:'Normal',data:months.map(m=>m.normal),backgroundColor:'#3b82f670',borderColor:'#3b82f6',borderWidth:1,borderRadius:2},
        {label:'Baixa',data:months.map(m=>m.low),backgroundColor:'#64748b70',borderColor:'#64748b',borderWidth:1,borderRadius:2},
      ]
    },
    options:{responsive:true,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{
      x:{stacked:true,ticks:{color:'#64748b',font:{size:9},maxRotation:30},grid:{color:'#1e293b'}},
      y:{stacked:true,ticks:{color:'#64748b'},grid:{color:'#334155'}},
    }}
  });
}

// ── Comparativo ───────────────────────────────────────────────────────────────
function initComparativo() {
  const TCOLORS=['#3b82f6','#10b981','#a855f7','#f59e0b'];
  new Chart(document.getElementById('compLineChart').getContext('2d'),{
    type:'line',
    data:{
      labels:COMPARATIVO_DATA.allMonths,
      datasets:COMPARATIVO_DATA.series.map((s,i)=>({
        label:s.label,data:s.data,
        borderColor:TCOLORS[i],backgroundColor:TCOLORS[i]+'20',
        borderWidth:2,pointRadius:3,tension:0.3,fill:false,
      })),
    },
    options:{responsive:true,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{
      x:{ticks:{color:'#64748b',font:{size:9},maxRotation:30},grid:{color:'#1e293b'}},
      y:{ticks:{color:'#64748b'},grid:{color:'#334155'}},
    }}
  });
  new Chart(document.getElementById('compBarChart').getContext('2d'),{
    type:'bar',
    data:{
      labels:COMPARATIVO_DATA.teams.map(t=>t.label),
      datasets:[
        {label:'Total',data:COMPARATIVO_DATA.teams.map(t=>t.total),backgroundColor:TCOLORS.map(c=>c+'70'),borderColor:TCOLORS,borderWidth:1,borderRadius:4},
      ]
    },
    options:{responsive:true,plugins:{legend:{display:false}},scales:{
      x:{ticks:{color:'#64748b',font:{size:11}},grid:{color:'#1e293b'}},
      y:{ticks:{color:'#64748b'},grid:{color:'#334155'}},
    }}
  });
  new Chart(document.getElementById('compEvitavelChart').getContext('2d'),{
    type:'bar',
    data:{
      labels:COMPARATIVO_DATA.teams.map(t=>t.label),
      datasets:[{
        label:'% Aceito',
        data:COMPARATIVO_DATA.teams.map(t=>t.implantadoPct),
        backgroundColor:COMPARATIVO_DATA.teams.map(t=>t.implantadoPct>70?'#22c55e70':t.implantadoPct>50?'#f9731670':'#ef444470'),
        borderColor:COMPARATIVO_DATA.teams.map(t=>t.implantadoPct>70?'#22c55e':t.implantadoPct>50?'#f97316':'#ef4444'),
        borderWidth:1,borderRadius:4,
      }]
    },
    options:{responsive:true,plugins:{legend:{display:false}},scales:{
      x:{ticks:{color:'#64748b',font:{size:11}},grid:{color:'#1e293b'}},
      y:{ticks:{color:'#64748b',callback:v=>v+'%'},grid:{color:'#334155'},max:60},
    }}
  });
}

function initTab(id) {
  const fns={volume:initVolume,resultado:initResultado,lojas:renderLojas,responsaveis:initResponsaveis,pipeline:null,prioridade:initPrioridade,comparativo:initComparativo};
  fns[id]&&fns[id]();
}

// ── Modal loja ─────────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  "triagem":"#64748b","aceito":"#3b82f6","em progresso":"#10b981",
  "revisão":"#a855f7","bloqueado":"#ef4444","implantado":"#22c55e",
  "rejeitado":"#94a3b8","arquivado":"#1e293b",
};
const PRIO_C = {urgent:"#ef4444",high:"#f97316",normal:"#3b82f6",low:"#64748b"};
const PRIO_L = {urgent:"Urgente",high:"Alta",normal:"Normal",low:"Baixa"};
const RESULT_C = {"Implantado":"#22c55e","Rejeitado":"#ef4444"};

function openStoreModal(storeName) {
  const tasks = TASKS_BY_STORE[storeName] || [];
  const open = tasks.filter(t => ["triagem","aceito","em progresso","revisão","bloqueado"].includes(t.status));
  const impl = tasks.filter(t => t.resultado === "Implantado").length;
  const rejt = tasks.filter(t => t.resultado === "Rejeitado").length;

  document.getElementById('modal-store-name').textContent = storeName;
  document.getElementById('modal-store-sub').textContent =
    tasks.length + ' card' + (tasks.length!==1?'s':'') +
    (open.length ? ' · ' + open.length + ' em aberto' : '') +
    (impl ? ' · ' + impl + ' implantado' + (impl!==1?'s':'') : '') +
    (rejt ? ' · ' + rejt + ' rejeitado' + (rejt!==1?'s':'') : '');

  document.getElementById('modal-cards').innerHTML = tasks.map(t => {
    const sc = STATUS_COLORS[t.status] || '#64748b';
    const pc = t.priority ? PRIO_C[t.priority] : null;
    const rc = t.resultado ? RESULT_C[t.resultado] : null;
    const shortName = t.name.replace(/^\\[[^\\]]+\\]\\s*/, '').substring(0,80);
    return \`
    <a href="\${t.url}" target="_blank" class="block p-4 rounded-xl border border-slate-700/50 hover:border-slate-500/70 bg-slate-800/50 hover:bg-slate-800 transition-all group">
      <div class="flex items-start justify-between gap-3">
        <p class="text-sm text-slate-200 font-medium group-hover:text-white leading-snug flex-1">\${shortName}</p>
        <svg class="w-3.5 h-3.5 text-slate-600 group-hover:text-blue-400 flex-shrink-0 mt-0.5 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 mt-2.5">
        <span class="badge text-xs font-semibold" style="background:\${sc}22;color:\${sc};border:1px solid \${sc}44">\${t.status}</span>
        \${pc ? \`<span class="badge text-xs" style="background:\${pc}22;color:\${pc};border:1px solid \${pc}44">\${PRIO_L[t.priority]||t.priority}</span>\` : ''}
        \${rc ? \`<span class="badge text-xs font-semibold" style="background:\${rc}22;color:\${rc};border:1px solid \${rc}44">\${t.resultado}</span>\` : '<span class="badge text-xs" style="background:#47556922;color:#64748b;border:1px solid #33415544">Sem resultado</span>'}
        \${t.assignees.map(a=>\`<span class="badge text-xs" style="background:#1e40af22;color:#93c5fd;border:1px solid #1d4ed844">👤 \${a}</span>\`).join('')}
        <span class="text-xs text-slate-600 ml-auto">\${t.date_done ? '✅ ' + t.date_done : '📅 ' + t.date_created}</span>
      </div>
    </a>\`;
  }).join('');

  const modal = document.getElementById('store-modal');
  modal.style.cssText = 'display:flex!important';
  document.body.style.overflow = 'hidden';
}

function closeStoreModal() {
  document.getElementById('store-modal').style.cssText = 'display:none!important';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if(e.key==='Escape') closeStoreModal(); });

// Init first tab
initVolume();
chartsInited['volume']=true;
<\/script>
</body>
</html>`;

writeFileSync("C:/Users/guilh/projetos/clickup-activity-mcp/dashboard-solicitacoes.html", html);
console.log("Dashboard solicitações gerado!");
console.log("Tamanho:", (html.length/1024).toFixed(0)+"KB");
console.log("\nResumo Integrações:");
console.log("  Total tasks:", integTasks.length);
console.log("  Em aberto:", pipeline.total);
console.log("  % Implantado:", resultado.implantadoPct+"%");
console.log("  % Rejeitado:", resultado.rejeitadoPct+"%");
console.log("  Comparativo teams:", comparativo.teams.map(t=>t.label+":"+t.total).join(", "));
