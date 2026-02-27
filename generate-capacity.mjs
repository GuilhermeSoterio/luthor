import { readFileSync, writeFileSync } from 'fs';

const cap = JSON.parse(readFileSync('capacity-data.json', 'utf8'));
const imp = JSON.parse(readFileSync('implantadores-data.json', 'utf8'));

const STATUS_COLORS = {
  'backlog':              '#64748b',
  'contato/comunicação':  '#8b5cf6',
  'todo/dados coletados': '#3b82f6',
  'progresso produto':    '#06b6d4',
  'produtos integrado':   '#10b981',
  'progresso pedido':     '#f59e0b',
  'bloqueado pedido':     '#ef4444',
  'bloqueado produto':    '#ef4444',
  'revisão':              '#a855f7',
  'aguardando cliente':   '#f97316',
};

const BUCKET_COLORS = {
  '0_30':    '#10b981',
  '31_60':   '#f59e0b',
  '61_90':   '#f97316',
  '90_plus': '#ef4444',
};
const BUCKET_LABELS = {
  '0_30': '0–30 dias', '31_60': '31–60 dias',
  '61_90': '61–90 dias', '90_plus': '90+ dias',
};

const IND = cap.indicators;
const LIM = cap.wip_limit;

const statusColor = { normal: '#10b981', atenção: '#f59e0b', crítico: '#ef4444' };
const statusIcon  = { normal: '✅', atenção: '⚠️', crítico: '🔴' };
const statusLabel = {
  normal:  'DENTRO DA CAPACIDADE',
  atenção: 'ATENÇÃO — PRÓXIMO DO LIMITE',
  crítico: 'PRESSÃO ELEVADA',
};

const overallColor = statusColor[IND.overall_status];
const overallIcon  = statusIcon[IND.overall_status];
const overallLabel = statusLabel[IND.overall_status];

// Monthly throughput — mark Aug/25 as migration outlier
const throughputMonthly = cap.throughput.monthly.map(m => ({
  ...m,
  isMigration: m.completed > 50,
  completedDisplay: m.completed > 50 ? null : m.completed,
}));

// ── Weekly throughput (derived from monthly data) ─────────────────────────────
const _now = new Date(cap.generated_at);
const weeklyThroughput = throughputMonthly
  .filter(m => !m.isMigration)
  .map(m => {
    const [y, mo] = m.month.split('-').map(Number);
    const isCurrentMonth = y === _now.getFullYear() && mo === (_now.getMonth() + 1);
    const daysInPeriod   = isCurrentMonth ? _now.getDate() : new Date(y, mo, 0).getDate();
    const weeksInPeriod  = daysInPeriod / 7;
    const weeklyRate     = Math.round(m.completed / weeksInPeriod * 10) / 10;
    return { ...m, weeksInPeriod: Math.round(weeksInPeriod * 10) / 10, weeklyRate, isCurrentMonth };
  });

// Current weekly pace = most recent month with completions
const _recentW = weeklyThroughput.filter(m => m.completed > 0);
const currentWeeklyRate = _recentW.length ? _recentW[_recentW.length - 1].weeklyRate : 0;

// Avg weekly (last 4 months, excluding holiday outliers Nov/Dec)
const _normalW = weeklyThroughput.filter(m => !['2025-11','2025-12'].includes(m.month) && m.completed > 0);
const avgWeeklyRate = _normalW.length >= 2
  ? Math.round(_normalW.slice(-4).reduce((s,m) => s + m.weeklyRate, 0) / Math.min(_normalW.length, 4) * 10) / 10
  : currentWeeklyRate;

// Trend: compare last 2 periods vs 2 before
const _last2 = weeklyThroughput.slice(-2).filter(m => m.completed > 0);
const _prev2 = weeklyThroughput.slice(-4, -2).filter(m => m.completed > 0);
const _l2avg = _last2.length ? _last2.reduce((s,m) => s + m.weeklyRate, 0) / _last2.length : 0;
const _p2avg = _prev2.length ? _prev2.reduce((s,m) => s + m.weeklyRate, 0) / _prev2.length : 0;
const weeklyTrend       = _l2avg > _p2avg * 1.15 ? 'up' : _l2avg < _p2avg * 0.85 ? 'down' : 'stable';
const weeklyTrendIcon   = weeklyTrend === 'up' ? '↑' : weeklyTrend === 'down' ? '↓' : '→';
const weeklyTrendColor  = weeklyTrend === 'up' ? '#10b981' : weeklyTrend === 'down' ? '#ef4444' : '#f59e0b';
const weeklyTrendLabel  = weeklyTrend === 'up' ? 'acelerando' : weeklyTrend === 'down' ? 'desacelerando' : 'estável';

// Meta mínima = só para não crescer o WIP (igualar entradas)
// Meta ideal  = histórico * 1.3 (melhoria razoável)
const WEEKLY_BREAKEVEN = Math.round(IND.flow.avg_in / 4.33 * 10) / 10;
const WEEKLY_TARGET    = Math.round(IND.flow.avg_out / 4.33 * 10) / 10; // referência histórica
const weeklyGap        = Math.round((WEEKLY_BREAKEVEN - avgWeeklyRate) * 10) / 10;
const weeksToGoal      = weeklyGap > 0 && avgWeeklyRate > WEEKLY_BREAKEVEN * 0.5
  ? Math.round(LIM.over_by / Math.max(0.1, avgWeeklyRate - (IND.flow.avg_in / 4.33))) : null;

// ── ERP enriched (phase data from wip tasks) ──────────────────────────────────
const _avgArr = arr => arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : null;
const erpEnriched = cap.erp_breakdown
  .filter(e => e.erp !== 'N/A')
  .map(e => {
    const tasks    = cap.wip.tasks.filter(t => t.erp === e.erp);
    const produto  = tasks.map(t => t.phaseDays?.produto || 0).filter(v => v > 0);
    const pedido   = tasks.map(t => t.phaseDays?.pedido  || 0).filter(v => v > 0);
    return { ...e, avgProduto: _avgArr(produto), avgPedido: _avgArr(pedido) };
  })
  .sort((a,b) => b.avgAge - a.avgAge);

// WIP status breakdown for donut
const wipByStatus = {};
cap.wip.tasks.forEach(t => {
  wipByStatus[t.status] = (wipByStatus[t.status] || 0) + 1;
});
const wipStatusEntries = Object.entries(wipByStatus).sort((a,b) => b[1]-a[1]);

// ── Cohort by entry month (derived from age) ──────────────────────────────────
const _nowTs = new Date(cap.generated_at).getTime();
const COHORT_MONTHS = ['2025-11','2025-12','2026-01','2026-02'];
const COHORT_LABELS = { '2025-11':'Nov/25','2025-12':'Dez/25','2026-01':'Jan/26','2026-02':'Fev/26' };
const COHORT_COLORS = { '2025-11':'#8b5cf6','2025-12':'#06b6d4','2026-01':'#f59e0b','2026-02':'#10b981' };
const COHORT_CONTEXT = {
  '2025-11': 'Mês com férias — parte da equipe afastada, ritmo reduzido de conclusões.',
  '2025-12': 'Recesso coletivo no final do mês. Muitas lojas entraram mas poucas foram concluídas.',
  '2026-01': 'Retomada pós-recesso. Janeiro foi o mês de maior throughput (25 concluídas).',
  '2026-02': 'Mês atual em andamento.',
};
const cohortTasks = {};
COHORT_MONTHS.forEach(m => { cohortTasks[m] = []; });
cap.wip.tasks.forEach(t => {
  const created = new Date(_nowTs - t.age * 86400000);
  const month   = created.toISOString().substring(0, 7);
  if (cohortTasks[month]) cohortTasks[month].push(t);
});
// Throughput monthly reference: how many were completed in each cohort month
const _thrMap = {};
cap.throughput.monthly.forEach(m => { _thrMap[m.month] = m; });

// Blocked tasks list
const blockedTasks = cap.wip.tasks.filter(t => t.isBlocked).sort((a,b) => b.age - a.age);

// Critical tasks (61+d) for highlight table
const criticalTasks = cap.wip.tasks_by_bucket['61_90'].concat(cap.wip.tasks_by_bucket['90_plus'])
  .sort((a,b) => b.age - a.age);

// Scenarios
const SC = cap.scenarios;
const critByScenario = { C1: 0, C2: 0, C3: 0 };
criticalTasks.forEach(t => { critByScenario[t.scenario] = (critByScenario[t.scenario] || 0) + 1; });
const totalWip = cap.wip.total;
const scenarioPct = {
  c1: Math.round(SC.c1.count / totalWip * 100),
  c2: Math.round(SC.c2.count / totalWip * 100),
  c3: Math.round(SC.c3.count / totalWip * 100),
};

// Phase-time buckets (each task can appear in multiple phases)
const bucketOf = d => d > 90 ? '90_plus' : d > 60 ? '61_90' : d > 30 ? '31_60' : d > 0 ? '0_30' : null;
const phaseBuckets = {
  fila:      { '0_30': [], '31_60': [], '61_90': [], '90_plus': [] },
  bloqueada: { '0_30': [], '31_60': [], '61_90': [], '90_plus': [] },
  ativa:     { '0_30': [], '31_60': [], '61_90': [], '90_plus': [] },
};
cap.wip.tasks.forEach(t => {
  const qb = bucketOf(t.queueDays);
  const bb = bucketOf(t.blockedDays);
  const wb = bucketOf(t.workDays);
  if (qb) phaseBuckets.fila[qb].push(t);
  if (bb) phaseBuckets.bloqueada[bb].push(t);
  if (wb) phaseBuckets.ativa[wb].push(t);
});
const phaseTotal = {
  fila:      Object.values(phaseBuckets.fila).reduce((s,a) => s + a.length, 0),
  bloqueada: Object.values(phaseBuckets.bloqueada).reduce((s,a) => s + a.length, 0),
  ativa:     Object.values(phaseBuckets.ativa).reduce((s,a) => s + a.length, 0),
};

// Projection
const avgIn  = IND.flow.avg_in;
const avgOut = IND.flow.avg_out;
const netPerMonth = avgOut - avgIn;
const projMsg = netPerMonth >= 0
  ? `Saem ${avgOut} e entram ${avgIn}/mês — pipeline estável ou reduzindo.`
  : `Entram ${avgIn} e saem ${avgOut}/mês — pipeline crescendo ${Math.abs(netPerMonth)}/mês.`;

// Implantadores summary for sidebar
const impSummary = imp.implantadores || [];

// ── Tooltip helper ────────────────────────────────────────────────────────────
const tip = (text, pos = 'top') => {
  const posStyle = pos === 'left'
    ? 'right:calc(100% + 8px);left:auto;top:50%;transform:translateY(-50%);bottom:auto'
    : 'bottom:calc(100% + 8px);left:50%;transform:translateX(-50%)';
  const arrowStyle = pos === 'left'
    ? 'top:50%;left:100%;transform:translateY(-50%);border-top-color:transparent;border-left-color:#475569'
    : 'top:100%;left:50%;transform:translateX(-50%);border-top-color:#475569';
  return `<span class="tip-wrap"><span class="tip-icon">i</span><span class="tip-box" style="${posStyle}">${text}<span class="tip-arrow" style="${arrowStyle}"></span></span></span>`;
};

// ── Contexto operacional dos meses ────────────────────────────────────────────
const monthContext = {
  '2025-08': { icon: '📦', label: 'Ago/25', color: '#64748b', title: 'Migração histórica', text: 'Importação em massa de integrações antigas ao configurar o ClickUp. Os 379 cards fechados não representam throughput real — são registros históricos inseridos de uma vez. Excluído de todas as médias.' },
  '2025-11': { icon: '🏖️', label: 'Nov/25', color: '#8b5cf6', title: 'Férias do integrador', text: 'Ritmo reduzido consistente com período de férias. Conclusões espaçadas (~1 por semana vs média de 3/semana). O setor não parou — manteve um nível mínimo de operação. Não reflete a capacidade real.' },
  '2025-12': { icon: '🎄', label: 'Dez/25', color: '#06b6d4', title: 'Recesso coletivo', text: 'Última conclusão em 18/12. Zero entregas nas duas semanas finais do ano. Recesso coletivo da empresa. As 3 conclusões de Fazendinha (10/12) foram operação em lote de uma mesma rede. Esperado e planejado.' },
  '2026-01': { icon: '🔄', label: 'Jan/26', color: '#10b981', title: 'Retomada + lotes', text: 'Retorno em 05/01. O número 25 é inflado por duas operações em lote: Supermercado Lagoa (5 lojas, 16/01) e Supermarket Torre (11 lojas, 30/01). Desconsiderando lotes: ~9 integrações individuais — acima da média, mas sem os lotes seria número normal.' },
};

const contextMonths = throughputMonthly.filter(m => monthContext[m.month]);

// ── Flow Efficiency ───────────────────────────────────────────────────────────
const flowEfficiencyByTask = cap.wip.tasks.map(t => ({
  name: t.name,
  efficiency: t.age > 0 ? Math.round(t.workDays    / t.age * 100) : 0,
  blockedPct: t.age > 0 ? Math.round(t.blockedDays / t.age * 100) : 0,
  queuePct:   t.age > 0 ? Math.round(t.queueDays   / t.age * 100) : 0,
}));
const _feLen = flowEfficiencyByTask.length || 1;
const avgFlowEfficiency = Math.round(flowEfficiencyByTask.reduce((s,t) => s + t.efficiency, 0) / _feLen);
const feStatus = avgFlowEfficiency >= 15 ? 'normal' : avgFlowEfficiency >= 5 ? 'atenção' : 'crítico';
const feColor  = avgFlowEfficiency >= 15 ? '#22c55e' : avgFlowEfficiency >= 5 ? '#f59e0b' : '#ef4444';
const feC1 = Math.round(SC.c1.avg_flow_efficiency || 0);
const feC2 = Math.round(SC.c2.avg_flow_efficiency || 0);
const feC3 = Math.round(SC.c3.avg_flow_efficiency || 0);
const avgAtiva     = Math.round(flowEfficiencyByTask.reduce((s,t) => s + t.efficiency, 0) / _feLen);
const avgBloqueada = Math.round(flowEfficiencyByTask.reduce((s,t) => s + t.blockedPct, 0) / _feLen);
const avgFila      = Math.round(flowEfficiencyByTask.reduce((s,t) => s + t.queuePct,   0) / _feLen);

// ── SLE (Service Level Expectation) ──────────────────────────────────────────
const avgCycle    = cap.throughput.avg_cycle_time_days;
const medianCycle = cap.throughput.median_cycle_time_days;
const sle85 = Math.round(medianCycle + 1.5 * (avgCycle - medianCycle));
const tasksBeyondSle    = cap.wip.tasks.filter(t => t.age > sle85).length;
const sleBeyondPct      = cap.wip.total > 0 ? Math.round(tasksBeyondSle / cap.wip.total * 100) : 0;
const sleBeyondColor    = sleBeyondPct > 30 ? '#ef4444' : sleBeyondPct > 15 ? '#f59e0b' : '#22c55e';
const tasksBeyondMedian = cap.wip.tasks.filter(t => t.age > medianCycle).length;

// ── Predictability (CV do Throughput) ────────────────────────────────────────
const tpValues = throughputMonthly.filter(m => !m.isMigration && m.completed > 0).map(m => m.completed);
const tpMean   = tpValues.length ? tpValues.reduce((s,v) => s + v, 0) / tpValues.length : 0;
const tpStdDev = tpValues.length > 1
  ? Math.sqrt(tpValues.reduce((s,v) => s + (v - tpMean) ** 2, 0) / tpValues.length)
  : 0;
const tpCV     = tpMean > 0 ? Math.round(tpStdDev / tpMean * 100) : 0;
const cvStatus = tpCV <= 30 ? 'previsível' : tpCV <= 50 ? 'variável' : 'imprevisível';
const cvColor  = tpCV <= 30 ? '#22c55e'    : tpCV <= 50 ? '#f59e0b'   : '#ef4444';
// Sparkline: map values to SVG points (width=180, height=40)
const _spMax = Math.max(...tpValues, 1);
const _spW   = 180;
const _spH   = 40;
const _spStep = tpValues.length > 1 ? _spW / (tpValues.length - 1) : _spW;
const sparklinePoints = tpValues.map((v, i) => {
  const x = Math.round(i * _spStep);
  const y = Math.round(_spH - (v / _spMax) * (_spH - 4) - 2);
  return `${x},${y}`;
}).join(' ');

// ── Blocking Analysis ─────────────────────────────────────────────────────────
const allWipTasks       = cap.wip.tasks;
const blockedNow        = allWipTasks.filter(t => t.isBlocked).sort((a,b) => b.blockedDays - a.blockedDays);
const neverWorkedBlocked = blockedNow.filter(t => t.workDays === 0);
const reblocked         = allWipTasks.filter(t => t.blockEpisodeCount > 1);

// Age at first block: quando o bloqueio ocorreu na vida da task
const ageAtBlockBuckets = {
  'Primeiros 10d': blockedNow.filter(t => (t.ageAtFirstBlock ?? 0) <= 10).length,
  '11–20d':        blockedNow.filter(t => { const a = t.ageAtFirstBlock ?? 0; return a > 10 && a <= 20; }).length,
  '21–40d':        blockedNow.filter(t => { const a = t.ageAtFirstBlock ?? 0; return a > 20 && a <= 40; }).length,
  'Após 40d':      blockedNow.filter(t => (t.ageAtFirstBlock ?? 0) > 40).length,
};
const blockAgeBucketColors = {
  'Primeiros 10d': '#22c55e',
  '11–20d':        '#f59e0b',
  '21–40d':        '#f97316',
  'Após 40d':      '#ef4444',
};
const maxBlockAgeBucket = Math.max(...Object.values(ageAtBlockBuckets), 1);
const avgAgeAtFirstBlock = blockedNow.length > 0
  ? Math.round(blockedNow.reduce((s,t) => s + (t.ageAtFirstBlock ?? 0), 0) / blockedNow.length)
  : 0;

// ERP × bloqueio
const erpBlockMap = {};
allWipTasks.forEach(t => {
  const e = t.erp || 'N/A';
  if (!erpBlockMap[e]) erpBlockMap[e] = { total:0, blocked:0, totalBlockedDays:0, neverWorked:0 };
  erpBlockMap[e].total++;
  if (t.isBlocked) erpBlockMap[e].blocked++;
  erpBlockMap[e].totalBlockedDays += t.blockedDays;
  if (t.blockedDays > 0 && t.workDays === 0) erpBlockMap[e].neverWorked++;
});
const erpBlockRanked = Object.entries(erpBlockMap)
  .map(([erp, v]) => ({
    erp,
    ...v,
    avgBlockedDays: v.blocked > 0 ? Math.round(v.totalBlockedDays / v.blocked) : 0,
    blockPct: Math.round(v.blocked / v.total * 100),
  }))
  .sort((a,b) => b.blocked - a.blocked || b.totalBlockedDays - a.totalBlockedDays);
const maxErpBlocked = Math.max(...erpBlockRanked.map(e => e.blocked), 1);

// Status breakdown das bloqueadas
const blockedByStatus = {};
blockedNow.forEach(t => { blockedByStatus[t.status] = (blockedByStatus[t.status] || 0) + 1; });
const maxBlockedStatus = Math.max(...Object.values(blockedByStatus), 1);
const BLOCKED_STATUS_COLORS = {
  'aguardando cliente': '#f97316',
  'bloqueado pedido':   '#ef4444',
  'bloqueado produto':  '#dc2626',
};

// ── HTML ────────────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gestão de Capacidade — Integrações</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f172a;color:#f1f5f9;font-family:'Inter',system-ui,sans-serif;font-size:14px;min-height:100vh}
  a{color:inherit;text-decoration:none}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:#1e293b}
  ::-webkit-scrollbar-thumb{background:#475569;border-radius:3px}

  .page{max-width:1200px;margin:0 auto;padding:24px}

  /* Header */
  .hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px}
  .hdr-left h1{font-size:20px;font-weight:700;letter-spacing:-0.3px}
  .hdr-left p{color:#94a3b8;font-size:12px;margin-top:3px}
  .status-badge{display:flex;align-items:center;gap:8px;padding:8px 16px;border-radius:99px;font-weight:700;font-size:13px;border:2px solid}

  /* KPI row */
  .kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}
  .kpi{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;position:relative}
  .kpi-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:8px}
  .kpi-value{font-size:30px;font-weight:800;letter-spacing:-1px;line-height:1}
  .kpi-sub{font-size:11px;color:#94a3b8;margin-top:6px}
  .kpi-accent{position:absolute;top:0;left:0;width:3px;height:100%;border-radius:12px 0 0 12px}

  /* Grid 2 cols */
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .grid3{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px}

  /* Cards */
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px}
  .card-title{font-size:13px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
  .chart-wrap{position:relative;width:100%}

  /* Pressure gauge */
  .gauge-wrap{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 0}
  .gauge-ring{position:relative;width:140px;height:140px}
  .gauge-ring svg{transform:rotate(-90deg)}
  .gauge-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
  .gauge-pct{font-size:28px;font-weight:800;letter-spacing:-1px}
  .gauge-sub{font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase}

  /* WIP age bars (visual) */
  .age-bars{display:flex;flex-direction:column;gap:8px}
  .age-row{display:flex;align-items:center;gap:10px}
  .age-label{width:80px;font-size:12px;color:#94a3b8;flex-shrink:0}
  .age-bar-wrap{flex:1;background:#0f172a;border-radius:4px;height:20px;overflow:hidden}
  .age-bar{height:100%;border-radius:4px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;font-size:11px;font-weight:700;color:#fff;min-width:28px;transition:width .5s}
  .age-count{width:28px;text-align:right;font-size:13px;font-weight:700;flex-shrink:0}

  /* Table */
  .tbl{width:100%;border-collapse:collapse}
  .tbl th{padding:8px 10px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#475569;border-bottom:1px solid #334155}
  .tbl td{padding:9px 10px;border-bottom:1px solid #1e2d3d;font-size:12px;vertical-align:middle}
  .tbl tr:last-child td{border-bottom:none}
  .tbl tr:hover td{background:#1a2535}

  /* Badges */
  .badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap}
  .badge-red{background:#ef444422;color:#ef4444;border:1px solid #ef444444}
  .badge-amber{background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44}
  .badge-green{background:#10b98122;color:#10b981;border:1px solid #10b98144}
  .badge-blue{background:#3b82f622;color:#3b82f6;border:1px solid #3b82f644}
  .badge-gray{background:#64748b22;color:#64748b;border:1px solid #64748b44}

  /* Age badge */
  .age-pill{display:inline-block;padding:1px 7px;border-radius:99px;font-size:11px;font-weight:700}

  /* Projection banner */
  .proj-banner{background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px}
  .proj-banner .icon{font-size:20px;flex-shrink:0}
  .proj-banner .text{font-size:13px;color:#cbd5e1}
  .proj-banner .text strong{color:#f1f5f9}

  /* Status dot */
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}

  /* IMP mini cards */
  .imp-mini{display:flex;flex-direction:column;gap:8px}
  .imp-row{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#0f172a;border-radius:8px;border-left:3px solid}
  .imp-name{font-size:12px;font-weight:600}
  .imp-stats{display:flex;gap:10px;font-size:11px;color:#94a3b8}
  .imp-stats span{display:flex;align-items:center;gap:3px}

  /* scrollable table */
  .tbl-wrap{overflow-x:auto;max-height:320px;overflow-y:auto}

  /* Tooltip */
  .tip-wrap{position:relative;display:inline-flex;align-items:center;cursor:help;vertical-align:middle;margin-left:5px}
  .tip-icon{width:14px;height:14px;border-radius:50%;background:#1e293b;color:#64748b;font-size:9px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-style:italic;border:1px solid #475569;line-height:1;transition:background .15s,color .15s}
  .tip-wrap:hover .tip-icon{background:#334155;color:#94a3b8}
  .tip-box{position:absolute;background:#1e293b;border:1px solid #475569;border-radius:10px;padding:11px 13px;width:270px;font-size:12px;color:#cbd5e1;line-height:1.6;z-index:200;pointer-events:none;opacity:0;transition:opacity .15s;font-weight:400;text-transform:none;letter-spacing:0;white-space:normal;box-shadow:0 8px 24px rgba(0,0,0,.6)}
  .tip-box strong{color:#f1f5f9;font-weight:700}
  .tip-box code{background:#0f172a;padding:1px 5px;border-radius:4px;font-size:11px;color:#a5f3fc}
  .tip-wrap:hover .tip-box{opacity:1}
  .tip-arrow{content:'';position:absolute;border:5px solid transparent;pointer-events:none}

  /* Tabs */
  .tab-nav{display:flex;gap:2px;border-bottom:2px solid #1e293b;margin-bottom:20px}
  .tab-btn{padding:10px 20px;font-size:13px;font-weight:600;color:#64748b;background:none;border:none;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .15s;border-radius:6px 6px 0 0}
  .tab-btn.active{color:#f1f5f9;border-bottom-color:#3b82f6;background:#1e293b}
  .tab-btn:hover:not(.active){color:#94a3b8;background:#1e293b55}
  .tab-pane{display:none}
  .tab-pane.active{display:block}

  /* Block age bar */
  .blk-bar-wrap{flex:1;background:#0f172a;border-radius:4px;height:22px;overflow:hidden}
  .blk-bar{height:100%;border-radius:4px;display:flex;align-items:center;padding-left:8px;font-size:11px;font-weight:700;color:#fff;min-width:28px}

  @media(max-width:768px){
    .kpi-row{grid-template-columns:repeat(2,1fr)}
    .grid2,.grid3{grid-template-columns:1fr}
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="hdr">
    <div class="hdr-left">
      <h1>📊 Gestão de Capacidade — Integrações</h1>
      <p>Atualizado em ${new Date(cap.generated_at).toLocaleString('pt-BR')} · ${cap.throughput.total_completed} integrações concluídas no histórico</p>
    </div>
    <div class="status-badge" style="color:${overallColor};border-color:${overallColor};background:${overallColor}18">
      ${overallIcon} ${overallLabel}
    </div>
  </div>

  <!-- Tab navigation -->
  <div class="tab-nav">
    <button class="tab-btn active" onclick="switchTab('tab-cap',this)">📊 Capacidade & Fluxo</button>
    <button class="tab-btn" onclick="switchTab('tab-bloq',this)">🚧 Gestão de Bloqueios <span style="background:#ef444422;color:#ef4444;border:1px solid #ef444444;border-radius:99px;padding:1px 7px;font-size:11px;font-weight:700;margin-left:4px">${blockedNow.length}</span></button>
  </div>

  <!-- Tab: Capacidade & Fluxo -->
  <div id="tab-cap" class="tab-pane active">

  <!-- KPIs -->
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-accent" style="background:#ef4444"></div>
      <div class="kpi-label">WIP Ativo ${tip('Work In Progress — total de integrações abertas agora, em qualquer estágio: backlog, em progresso ou bloqueado. <strong>Não inclui</strong> concluídas nem descartadas. É a "fila viva" do setor — tudo que a equipe precisa tocar até o final.<br><br>O limite saudável foi calculado pela Lei de Little com base no histórico real: <strong>throughput de 11/mês × ciclo alvo de 60d = 22 integrações</strong>. Acima disso o ciclo começa a se alongar progressivamente.')}</div>
      <div class="kpi-value" style="color:#ef4444">${cap.wip.total}</div>
      <div style="margin:8px 0 4px">
        <div style="position:relative;height:8px;background:#0f172a;border-radius:4px;overflow:visible">
          <!-- zona ideal: 0 até ideal/max*100% -->
          <div style="position:absolute;left:0;top:0;height:100%;width:${Math.round(LIM.ideal/LIM.current*100)}%;background:#10b98133;border-radius:4px 0 0 4px"></div>
          <!-- zona tolerável: ideal até max -->
          <div style="position:absolute;left:${Math.round(LIM.ideal/LIM.current*100)}%;top:0;height:100%;width:${Math.round((LIM.max-LIM.ideal)/LIM.current*100)}%;background:#f59e0b33"></div>
          <!-- zona crítica: max até current (barra cheia) -->
          <div style="position:absolute;left:${Math.round(LIM.max/LIM.current*100)}%;top:0;height:100%;width:${Math.round((LIM.current-LIM.max)/LIM.current*100)}%;background:#ef444433;border-radius:0 4px 4px 0"></div>
          <!-- linha do limite máximo -->
          <div style="position:absolute;left:${Math.round(LIM.max/LIM.current*100)}%;top:-3px;height:14px;width:2px;background:#f59e0b;border-radius:1px"></div>
          <!-- marcador atual (fim da barra) -->
          <div style="position:absolute;right:0;top:-3px;height:14px;width:2px;background:#ef4444;border-radius:1px"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;margin-top:4px;color:#475569">
          <span style="color:#10b981">0</span>
          <span style="color:#f59e0b">limite ${LIM.max}</span>
          <span style="color:#ef4444">atual ${LIM.current}</span>
        </div>
      </div>
      <div class="kpi-sub" style="color:#ef4444">${LIM.over_by} acima do limite · ${LIM.current_vs_max_pct}% do máximo saudável</div>
    </div>
    <div class="kpi">
      <div class="kpi-accent" style="background:#ef4444"></div>
      <div class="kpi-label">Bloqueadas ${tip('Integrações paradas por fator <strong>externo</strong> — fora do controle da equipe: cliente sem responder, ERP com problema, ou dados pendentes do lojista. O tempo parado <strong>não é trabalho ativo</strong>, mas a integração envelhece e pesa no pipeline. Statuses: <code>aguardando cliente</code>, <code>bloqueado pedido</code>, <code>bloqueado produto</code>.')}</div>
      <div class="kpi-value" style="color:#ef4444">${cap.wip.blocked}</div>
      <div class="kpi-sub">${cap.wip.blocked_pct}% do pipeline parado externamente</div>
    </div>
    <div class="kpi">
      <div class="kpi-accent" style="background:#10b981"></div>
      <div class="kpi-label">Throughput / mês ${tip('Quantas integrações chegaram ao status <code>implantado</code> por mês, em média dos últimos 6 meses. É a velocidade de saída do pipeline. Se entram mais lojas do que saem, o WIP cresce.')}</div>
      <div class="kpi-value" style="color:#10b981">${cap.throughput.avg_monthly_completions}</div>
      <div class="kpi-sub">média últimos 6 meses · entradas ${IND.flow.avg_in}/mês</div>
    </div>
    <div class="kpi">
      <div class="kpi-accent" style="background:#06b6d4"></div>
      <div class="kpi-label">Throughput / semana ${tip('Quantas integrações chegam ao status <code>implantado</code> por semana. Derivado do histórico mensal real. É a métrica mais granular de velocidade de entrega.<br><br>Equilíbrio mínimo: <strong>${WEEKLY_BREAKEVEN}/semana</strong> para não crescer o WIP.<br>Média recente (excl. férias/recesso): <strong>${avgWeeklyRate}/sem</strong>.')}</div>
      <div class="kpi-value" style="color:#06b6d4">${currentWeeklyRate}</div>
      <div class="kpi-sub" style="display:flex;align-items:center;gap:6px">
        <span style="color:${weeklyTrendColor};font-weight:700">${weeklyTrendIcon} ${weeklyTrendLabel}</span>
        <span style="color:#475569">· equilíbrio ${WEEKLY_BREAKEVEN}/sem</span>
      </div>
    </div>
    <div class="kpi">
      <div class="kpi-accent" style="background:#a855f7"></div>
      <div class="kpi-label">Ciclo Médio ${tip('Tempo do início (criação do card) até a conclusão (status <code>implantado</code>) de cada integração. A <strong>mediana</strong> é mais confiável que a média — ela ignora outliers como lojas que ficaram meses paradas por bloqueio externo.<br><br>Média: <strong>${cap.throughput.avg_cycle_time_days}d</strong> &nbsp;|&nbsp; Mediana: <strong>${cap.throughput.median_cycle_time_days}d</strong>')}</div>
      <div class="kpi-value" style="color:#a855f7">${cap.throughput.median_cycle_time_days}d</div>
      <div class="kpi-sub">mediana para concluir (avg ${cap.throughput.avg_cycle_time_days}d)</div>
    </div>
  </div>

  <!-- ⚡ Métricas Avançadas de Fluxo -->
  <div style="margin-bottom:16px">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#475569;margin-bottom:10px;display:flex;align-items:center;gap:8px">
      <span>⚡</span> Métricas Avançadas de Fluxo
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">

      <!-- Card 1: Flow Efficiency -->
      <div class="card">
        <div class="card-title" style="margin-bottom:12px">
          Flow Efficiency
          ${tip('<strong>Flow Efficiency</strong> = tempo de trabalho ativo ÷ tempo total no pipeline.<br><br>Mede quanto do tempo a integração ficou em trabalho real vs esperando (fila) ou parada (bloqueio externo).<br><br>🟢 ≥ 15% — saudável<br>🟡 5–15% — atenção<br>🔴 &lt; 5% — crítico<br><br>Valores baixos indicam excesso de espera ou bloqueios externos.')}
        </div>
        <div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:10px">
          <div style="font-size:2.5rem;font-weight:700;letter-spacing:-2px;line-height:1;color:${feColor}">${avgFlowEfficiency}%</div>
          <div style="padding-bottom:4px">
            <div style="font-size:11px;font-weight:700;color:${feColor};text-transform:uppercase">${feStatus}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">média das tasks ativas</div>
          </div>
        </div>
        <!-- Stacked bar -->
        <div style="margin-bottom:10px">
          <div style="height:12px;border-radius:6px;overflow:hidden;display:flex;background:#0f172a">
            <div style="width:${Math.min(avgAtiva,100)}%;background:#22c55e" title="Ativo ${avgAtiva}%"></div>
            <div style="width:${Math.min(avgBloqueada,100-Math.min(avgAtiva,100))}%;background:#ef4444" title="Bloqueado ${avgBloqueada}%"></div>
            <div style="flex:1;background:#334155" title="Fila ${avgFila}%"></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:5px;font-size:10px;color:#64748b">
            <span style="color:#22c55e">● Ativo ${avgAtiva}%</span>
            <span style="color:#ef4444">● Bloqueado ${avgBloqueada}%</span>
            <span style="color:#64748b">● Fila ${avgFila}%</span>
          </div>
        </div>
        <!-- C1/C2/C3 breakdown -->
        <div style="border-top:1px solid #334155;padding-top:8px;display:flex;gap:0">
          ${[
            { label: 'C1 Aguardando', val: feC1, color: '#94a3b8' },
            { label: 'C2 Bloqueada',  val: feC2, color: '#f97316' },
            { label: 'C3 Ativa',      val: feC3, color: '#3b82f6' },
          ].map((s,i) => `
            <div style="flex:1;text-align:center;${i > 0 ? 'border-left:1px solid #334155' : ''}">
              <div style="font-size:15px;font-weight:800;color:${s.color}">${s.val}%</div>
              <div style="font-size:9px;color:#64748b;margin-top:1px">${s.label}</div>
            </div>`).join('')}
        </div>
        <div style="font-size:9px;color:#475569;margin-top:8px;text-align:center">benchmark: ≥15% saudável · 5–15% atenção · &lt;5% crítico</div>
      </div>

      <!-- Card 2: SLE -->
      <div class="card">
        <div class="card-title" style="margin-bottom:12px">
          SLE — Service Level Expectation
          ${tip('<strong>SLE 85%</strong> é o prazo em que 85% das integrações históricas foram concluídas.<br><br>Estimado como: mediana + 1,5 × (média − mediana), que aproxima o percentil 85 em distribuições com cauda longa.<br><br>Use para definir compromissos de prazo com confiança estatística.')}
        </div>
        <div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:12px">
          <div style="font-size:2.5rem;font-weight:700;letter-spacing:-2px;line-height:1;color:#a855f7">${sle85} dias</div>
          <div style="padding-bottom:4px">
            <div style="font-size:11px;font-weight:700;color:#a855f7">SLE 85%</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">prazo de referência</div>
          </div>
        </div>
        <!-- P50 / P85 -->
        <div style="display:flex;gap:0;margin-bottom:12px">
          <div style="flex:1;text-align:center;border-right:1px solid #334155">
            <div style="font-size:18px;font-weight:800;color:#94a3b8">${medianCycle}d</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">P50 — mediana</div>
          </div>
          <div style="flex:1;text-align:center">
            <div style="font-size:18px;font-weight:800;color:#a855f7">${sle85}d</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">P85 — estimado</div>
          </div>
        </div>
        <!-- Alerta de tasks além do SLE -->
        <div style="background:${sleBeyondColor}12;border:1px solid ${sleBeyondColor}33;border-radius:8px;padding:8px 10px;margin-bottom:8px">
          <div style="font-size:12px;font-weight:700;color:${sleBeyondColor}">${tasksBeyondSle} lojas (${sleBeyondPct}%) já ultrapassaram o SLE</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:2px">${tasksBeyondMedian} ultrapassaram a mediana (${medianCycle}d)</div>
        </div>
        <div style="font-size:9px;color:#475569;text-align:center">85% das integrações históricas concluíram em até ${sle85} dias</div>
      </div>

      <!-- Card 3: Predictability (CV) -->
      <div class="card">
        <div class="card-title" style="margin-bottom:12px">
          Previsibilidade — CV Throughput
          ${tip('<strong>Coeficiente de Variação (CV)</strong> = desvio padrão ÷ média do throughput mensal.<br><br>Mede o quão estável é a velocidade de entrega ao longo dos meses.<br><br>🟢 ≤ 30% — previsível<br>🟡 30–50% — variável<br>🔴 &gt; 50% — imprevisível<br><br>Alta variabilidade torna difícil comprometer datas de entrega.')}
        </div>
        <div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:10px">
          <div style="font-size:2.5rem;font-weight:700;letter-spacing:-2px;line-height:1;color:${cvColor}">${tpCV}%</div>
          <div style="padding-bottom:4px">
            <div style="font-size:11px;font-weight:700;color:${cvColor};text-transform:uppercase">${cvStatus}</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">coef. de variação</div>
          </div>
        </div>
        <!-- Sparkline -->
        <div style="margin-bottom:8px">
          <svg width="100%" viewBox="0 0 180 44" style="display:block;overflow:visible">
            <polyline points="${sparklinePoints}" fill="none" stroke="${cvColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${tpValues.map((v,i) => {
              const x = Math.round(i * (tpValues.length > 1 ? _spW / (tpValues.length - 1) : _spW));
              const y = Math.round(_spH - (v / _spMax) * (_spH - 4) - 2);
              return `<circle cx="${x}" cy="${y}" r="3" fill="${cvColor}"/>`;
            }).join('')}
          </svg>
          <div style="display:flex;justify-content:space-between;font-size:9px;color:#475569;margin-top:2px">
            <span>${throughputMonthly.filter(m => !m.isMigration && m.completed > 0)[0]?.month?.replace('-','/')}</span>
            <span>${throughputMonthly.filter(m => !m.isMigration && m.completed > 0).slice(-1)[0]?.month?.replace('-','/')}</span>
          </div>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin-bottom:6px">
          σ = ${Math.round(tpStdDev * 10) / 10} &nbsp;·&nbsp; μ = ${Math.round(tpMean * 10) / 10} entregas/mês
        </div>
        <div style="font-size:9px;color:#475569;text-align:center">benchmark: ≤30% previsível · 30–50% variável · &gt;50% imprevisível</div>
      </div>

    </div>
  </div>

  <!-- Projection banner -->
  <div class="proj-banner">
    <div class="icon">${netPerMonth >= 0 ? '📈' : '📉'}</div>
    <div class="text">
      <strong>Projeção</strong>${tip('Baseado na média de entradas dos últimos 3 meses vs a média de saídas dos últimos 6 meses. Se entradas > saídas de forma consistente, o WIP cresce e em algum momento o setor não consegue mais absorver a demanda sem aumentar o ciclo médio ou sacrificar qualidade.')}: ${projMsg}
      ${netPerMonth < 0
        ? ` Com o ritmo atual, o pipeline adiciona <strong>${Math.abs(netPerMonth)} lojas/mês</strong>. Para voltar ao limite saudável de ${LIM.max} integrações, seria necessário <strong>zerar as entradas por ~${Math.round((LIM.current - LIM.max) / avgOut)} meses</strong> ou dobrar o throughput.`
        : ` O WIP tende a estabilizar ou reduzir. Para chegar ao limite saudável de ${LIM.max} integrações, faltam drenar <strong>${LIM.over_by} lojas</strong>.`}
    </div>
  </div>

  <!-- Row 1: Pressure gauge + WIP age + implantadores -->
  <div style="display:grid;grid-template-columns:200px 1fr 220px;gap:16px;margin-bottom:16px">

    <!-- Dois indicadores empilhados -->
    <div style="display:flex;flex-direction:column;gap:12px">

      <!-- Indicador 1: Ratio de fluxo -->
      <div class="card" style="flex:1">
        <div class="card-title" style="margin-bottom:10px">
          Ratio de Fluxo
          ${tip('Mede se o pipeline está crescendo ou drenando.<br><br><strong>Cálculo:</strong> média de entradas dos últimos 3 meses ÷ média de saídas dos últimos 6 meses.<br><br>Quando entram mais lojas do que saem consistentemente, o WIP cresce até o sistema não conseguir mais absorver a demanda.<br><br>🟢 &lt; 110% — equilibrado<br>🟡 110–140% — crescendo<br>🔴 &gt; 140% — crescendo rápido')}
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:36px;font-weight:800;letter-spacing:-2px;color:${statusColor[IND.flow.status]}">${IND.flow.ratio}%</div>
          <div style="text-align:right;font-size:11px;color:#64748b;line-height:1.8">
            <div>${IND.flow.avg_in} entradas/mês</div>
            <div>${IND.flow.avg_out} saídas/mês</div>
          </div>
        </div>
        <div style="height:6px;background:#0f172a;border-radius:3px;overflow:hidden;position:relative">
          <div style="position:absolute;inset:0;background:linear-gradient(to right,#10b981 0%,#10b981 45%,#f59e0b 45%,#f59e0b 63%,#ef4444 63%,#ef4444 100%);opacity:.35"></div>
          <div style="position:absolute;top:0;left:0;height:100%;width:3px;background:#fff;border-radius:2px;margin-left:${Math.min(IND.flow.ratio / 3, 100)}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:#475569;margin-top:3px">
          <span>0%</span><span style="color:#f59e0b">110</span><span style="color:#ef4444">140</span><span>300+</span>
        </div>
      </div>

      <!-- Indicador 2: WIP crítico -->
      <div class="card" style="flex:1">
        <div class="card-title" style="margin-bottom:10px">
          WIP Crítico 61+d
          ${tip('Percentual das integrações ativas com mais de 61 dias sem concluir. Mede a saúde do que já está dentro do pipeline — independente de quantas entram ou saem.<br><br>Uma integração com 61+ dias está provavelmente travada por bloqueio externo, complexidade ou falta de priorização ativa.<br><br>🟢 &lt; 20% — pipeline saudável<br>🟡 20–35% — atenção<br>🔴 &gt; 35% — represamento')}
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:36px;font-weight:800;letter-spacing:-2px;color:${statusColor[IND.wip_critical.status]}">${IND.wip_critical.pct}%</div>
          <div style="text-align:right;font-size:11px;color:#64748b;line-height:1.8">
            <div>${IND.wip_critical.count} integ. críticas</div>
            <div>de ${IND.wip_critical.total} no WIP</div>
          </div>
        </div>
        <div style="height:6px;background:#0f172a;border-radius:3px;overflow:hidden;position:relative">
          <div style="position:absolute;inset:0;background:linear-gradient(to right,#10b981 0%,#10b981 45%,#f59e0b 45%,#f59e0b 78%,#ef4444 78%,#ef4444 100%);opacity:.35"></div>
          <div style="position:absolute;top:0;left:0;height:100%;width:3px;background:#fff;border-radius:2px;margin-left:${Math.min(IND.wip_critical.pct * 2, 97)}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:#475569;margin-top:3px">
          <span>0%</span><span style="color:#f59e0b">20</span><span style="color:#ef4444">35</span><span>50%</span>
        </div>
      </div>

    </div>

    <!-- WIP phase-time bars -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="card-title" style="margin-bottom:0">⏳ Tempo por Fase ${tip('Cada integração é decomposta em 3 fases com base no histórico de statuses. A mesma loja pode aparecer em múltiplas faixas — por exemplo, Rota da Economia tem 87d total, mas apenas 33d de trabalho ativo (faixa 31–60d em "Ativa").<br><br><strong>Fila</strong>: tempo em statuses de espera (contato, todo, backlog)<br><strong>Bloqueada</strong>: tempo parada por fator externo (aguardando cliente, bloqueado produto/pedido)<br><strong>Ativa</strong>: tempo em trabalho real (progresso produto/pedido, revisão)<br><br>As barras mostram quantas integrações acumularam X dias <em>nessa fase específica</em>.')}</div>
        <div style="font-size:10px;color:#475569">${cap.wip.total} integ. ativas</div>
      </div>

      ${[
        { key: 'fila',      label: 'Fila — aguardando',  color: '#64748b', icon: '⏸' },
        { key: 'bloqueada', label: 'Bloqueada — ext.',    color: '#f97316', icon: '⚑' },
        { key: 'ativa',     label: 'Ativa — equipe',      color: '#3b82f6', icon: '▶' },
      ].map(phase => {
        const buckets  = phaseBuckets[phase.key];
        const total    = phaseTotal[phase.key];
        const maxCount = Math.max(...Object.values(buckets).map(a => a.length), 1);
        return `
        <div style="margin-bottom:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${phase.color}">${phase.icon} ${phase.label}</div>
            <div style="font-size:10px;color:#475569">${total} tasks</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:3px">
            ${['0_30','31_60','61_90','90_plus'].map(b => {
              const count = buckets[b].length;
              const barW  = count === 0 ? 0 : Math.max(Math.round(count / maxCount * 100), 8);
              return `
              <div class="age-row" style="gap:6px">
                <div class="age-label" style="width:62px;font-size:10px;color:#64748b">${BUCKET_LABELS[b]}</div>
                <div class="age-bar-wrap" style="height:16px">
                  ${count > 0
                    ? `<div class="age-bar" style="width:${barW}%;background:${phase.color};font-size:10px;padding-right:6px">${count}</div>`
                    : `<div style="height:100%;width:100%;background:#0f172a;border-radius:4px"></div>`}
                </div>
                <div style="width:18px;text-align:right;font-size:11px;font-weight:700;color:${count > 0 ? BUCKET_COLORS[b] : '#1e293b'};flex-shrink:0">${count}</div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}

      <div style="display:flex;gap:16px;padding-top:10px;border-top:1px solid #334155">
        <div>
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600">Idade média</div>
          <div style="font-size:20px;font-weight:800;color:#f59e0b">${cap.wip.avg_age}d</div>
        </div>
        <div>
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600">Mais antiga</div>
          <div style="font-size:20px;font-weight:800;color:#ef4444">${cap.wip.oldest_age}d</div>
        </div>
        <div>
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600">Críticas 61+d</div>
          <div style="font-size:20px;font-weight:800;color:#f97316">${cap.wip.by_bucket['61_90'] + cap.wip.by_bucket['90_plus']}</div>
        </div>
      </div>
    </div>

    <!-- Implantadores mini -->
    <div class="card">
      <div class="card-title">👷 Implantadores</div>
      <div class="imp-mini">
        ${['Derik','Ana Débora','Laissa'].map(name => {
          const colors = { 'Derik':'#8b5cf6','Ana Débora':'#f59e0b','Laissa':'#10b981' };
          const s = imp.summary?.[name] || {};
          return `
          <div class="imp-row" style="border-color:${colors[name]}">
            <div>
              <div class="imp-name">${name}</div>
              <div class="imp-stats">
                <span>${s.total||0} lojas</span>
                ${s.blocked ? `<span style="color:#ef4444">⚑ ${s.blocked} bloq</span>` : ''}
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-size:11px;color:#64748b">méd</div>
              <div style="font-size:14px;font-weight:700;color:${colors[name]}">${s.avgDaysSinceCreated||0}d</div>
            </div>
          </div>`;
        }).join('')}
        <div style="font-size:11px;color:#475569;margin-top:4px;text-align:center">
          Dados de integrações ativas
        </div>
      </div>
    </div>
  </div>

  <!-- 3 Cenários de Pipeline -->
  <div style="margin-bottom:16px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin-bottom:10px;display:flex;align-items:center;gap:8px">
      🎯 Diagnóstico do Pipeline — 3 Cenários
      ${tip('As 50 integrações ativas foram classificadas em 3 cenários com base no histórico de tempo por status:<br><br><strong>C1</strong> — nunca entraram em work status. O trabalho da equipe ainda não começou.<br><strong>C2</strong> — iniciaram, mas estão hoje em status bloqueado (fator externo).<br><strong>C3</strong> — iniciaram e estão em progresso ativo. Responsabilidade direta da equipe.<br><br>A <strong>flow efficiency</strong> mede quanto do tempo total a integração ficou em trabalho ativo vs. bloqueada.')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">

      <!-- C1 -->
      <div class="card" style="border-top:3px solid #64748b">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b">C1 — Aguardando Início</div>
            <div style="font-size:36px;font-weight:800;color:#94a3b8;letter-spacing:-1px;line-height:1.1;margin-top:4px">${SC.c1.count}</div>
            <div style="font-size:11px;color:#475569">${scenarioPct.c1}% do WIP</div>
          </div>
          <div style="background:#64748b18;border:1px solid #64748b33;border-radius:8px;padding:6px 10px;text-align:center">
            <div style="font-size:9px;color:#64748b;text-transform:uppercase;font-weight:600">Flow eff.</div>
            <div style="font-size:16px;font-weight:800;color:#64748b">—</div>
          </div>
        </div>
        <div style="font-size:11px;color:#64748b;line-height:1.6;margin-bottom:10px">
          Nunca iniciaram trabalho ativo. Aguardam gate do lojista, aprovação comercial ou início programado (ex: março).
        </div>
        <div style="background:#0f172a;border-radius:6px;padding:8px 10px;border:1px solid #334155;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:9px;color:#475569;text-transform:uppercase;font-weight:600">Críticas (61+d)</div>
            <div style="font-size:20px;font-weight:800;color:#64748b">${critByScenario.C1}</div>
          </div>
          <div style="font-size:10px;color:#475569;text-align:right;line-height:1.5">Aguardam gate<br>fora do controle</div>
        </div>
      </div>

      <!-- C2 -->
      <div class="card" style="border-top:3px solid #f97316">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#f97316">C2 — Em Integração, Bloqueada</div>
            <div style="font-size:36px;font-weight:800;color:#f97316;letter-spacing:-1px;line-height:1.1;margin-top:4px">${SC.c2.count}</div>
            <div style="font-size:11px;color:#475569">${scenarioPct.c2}% do WIP</div>
          </div>
          <div style="background:#f9741618;border:1px solid #f9741633;border-radius:8px;padding:6px 10px;text-align:center">
            <div style="font-size:9px;color:#f97316;text-transform:uppercase;font-weight:600">Flow eff.</div>
            <div style="font-size:16px;font-weight:800;color:#f97316">${SC.c2.avg_flow_efficiency || '—'}%</div>
          </div>
        </div>
        <div style="font-size:11px;color:#94a3b8;line-height:1.6;margin-bottom:10px">
          Iniciaram integração mas estão paradas por fator externo. O trabalho começou — mas está represado por bloqueio.
        </div>
        <div style="background:#0f172a;border-radius:6px;padding:8px 10px;border:1px solid #334155;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:9px;color:#475569;text-transform:uppercase;font-weight:600">Críticas (61+d)</div>
            <div style="font-size:20px;font-weight:800;color:#f97316">${critByScenario.C2}</div>
          </div>
          <div style="font-size:10px;color:#475569;text-align:right;line-height:1.5">Bloqueio externo<br>acompanhar ativamente</div>
        </div>
      </div>

      <!-- C3 -->
      <div class="card" style="border-top:3px solid #3b82f6">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#3b82f6">C3 — Em Integração, Ativa</div>
            <div style="font-size:36px;font-weight:800;color:#3b82f6;letter-spacing:-1px;line-height:1.1;margin-top:4px">${SC.c3.count}</div>
            <div style="font-size:11px;color:#475569">${scenarioPct.c3}% do WIP</div>
          </div>
          <div style="background:#3b82f618;border:1px solid #3b82f633;border-radius:8px;padding:6px 10px;text-align:center">
            <div style="font-size:9px;color:#3b82f6;text-transform:uppercase;font-weight:600">Flow eff.</div>
            <div style="font-size:16px;font-weight:800;color:#3b82f6">${SC.c3.avg_flow_efficiency || '—'}%</div>
          </div>
        </div>
        <div style="font-size:11px;color:#cbd5e1;line-height:1.6;margin-bottom:10px">
          Em progresso ativo — sem bloqueio externo. São a <strong style="color:#f1f5f9">responsabilidade direta da equipe</strong>. Aqui está o real termômetro de performance.
        </div>
        <div style="background:#0f172a;border-radius:6px;padding:8px 10px;border:1px solid #3b82f644;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:9px;color:#475569;text-transform:uppercase;font-weight:600">Críticas (61+d)</div>
            <div style="font-size:20px;font-weight:800;color:#ef4444">${critByScenario.C3}</div>
          </div>
          <div style="font-size:10px;color:#ef4444;text-align:right;line-height:1.5;font-weight:600">Prioridade máxima<br>ação imediata</div>
        </div>
      </div>

    </div>
  </div>

  <!-- Explicações dos indicadores -->
  <div class="grid2" style="margin-bottom:16px">

    <!-- Ratio de Fluxo: por que 209% -->
    <div class="card">
      <div class="card-title" style="margin-bottom:12px">📉 Por que o Ratio de Fluxo está em ${IND.flow.ratio}%?</div>
      <div style="font-size:12px;color:#94a3b8;line-height:1.7;margin-bottom:12px">
        Nos últimos 6 meses, <strong style="color:#f1f5f9">110 integrações entraram</strong> e apenas
        <strong style="color:#f1f5f9">67 saíram</strong> — acúmulo de <strong style="color:#ef4444">43 no pipeline</strong>.
        Dois meses concentram <strong style="color:#f1f5f9">91% do desequilíbrio</strong>:
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        ${[
          { label: 'Dez/25', icon: '🎄', desc: 'Recesso coletivo', in: 31, out: 7,  color: '#ef4444', note: 'maior mês de entrada, menor de saída' },
          { label: 'Nov/25', icon: '🏖️', desc: 'Férias',           in: 21, out: 6,  color: '#f97316', note: 'ritmo reduzido, contratos continuaram' },
          { label: 'Jan/26', icon: '🔄', desc: 'Retomada',         in: 17, out: 25, color: '#10b981', note: 'único mês positivo — lotes Lagoa + Torre' },
          { label: 'Fev/26', icon: '📌', desc: 'Atual',            in: 20, out: 11, color: '#f59e0b', note: 'voltou negativo sem lotes de migração' },
        ].map(m => `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#0f172a;border-radius:7px;border-left:3px solid ${m.color}">
          <span style="font-size:14px">${m.icon}</span>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;font-weight:700;color:#f1f5f9">${m.label}</span>
              <span style="font-size:10px;color:#64748b">${m.desc}</span>
            </div>
            <div style="font-size:10px;color:#64748b;margin-top:1px">${m.note}</div>
          </div>
          <div style="text-align:right;font-size:11px;white-space:nowrap">
            <span style="color:#3b82f6">↑${m.in}</span>
            <span style="color:#475569;margin:0 3px">/</span>
            <span style="color:#10b981">↓${m.out}</span>
            <span style="font-weight:700;margin-left:6px;color:${m.out >= m.in ? '#10b981' : '#ef4444'}">${m.out >= m.in ? '+' : ''}${m.out - m.in}</span>
          </div>
        </div>`).join('')}
      </div>
      <div style="font-size:11px;color:#475569;padding-top:10px;border-top:1px solid #334155">
        💡 O comercial manteve o ritmo de novos contratos durante os períodos de baixa capacidade. O pipeline só vai equilibrar quando throughput superar as entradas de forma consistente.
      </div>
    </div>

    <!-- WIP Crítico: por que 36% -->
    <div class="card">
      <div class="card-title" style="margin-bottom:12px">⏳ Por que o WIP Crítico está em ${IND.wip_critical.pct}%?</div>
      <div style="font-size:12px;color:#94a3b8;line-height:1.7;margin-bottom:12px">
        As <strong style="color:#f1f5f9">${IND.wip_critical.count} integrações críticas</strong> (61+ dias) entraram
        quase todas em <strong style="color:#f1f5f9">Nov/25</strong> e <strong style="color:#f1f5f9">Dez/25</strong> —
        exatamente o período de férias e recesso. Nunca conseguiram avançar e seguem envelhecendo.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:#0f172a;border-radius:8px;padding:10px 12px;border:1px solid #334155">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600;margin-bottom:6px">Bloqueio externo</div>
          <div style="font-size:22px;font-weight:800;color:#ef4444">9</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.5">7 aguardando cliente<br>2 bloqueado pedido</div>
          <div style="font-size:10px;color:#475569;margin-top:4px">Fora do controle da equipe</div>
        </div>
        <div style="background:#0f172a;border-radius:8px;padding:10px 12px;border:1px solid #334155">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600;margin-bottom:6px">Trabalho interno</div>
          <div style="font-size:22px;font-weight:800;color:#f97316">9</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.5">4 em revisão<br>2 em backlog · 3 outros</div>
          <div style="font-size:10px;color:#475569;margin-top:4px">Pode ser priorizado agora</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.4px">Quando entraram</div>
        <div style="display:flex;gap:8px">
          <div style="flex:1;background:#0f172a;border-radius:6px;padding:8px 10px;border-left:3px solid #8b5cf6">
            <div style="font-size:18px;font-weight:800;color:#8b5cf6">8</div>
            <div style="font-size:10px;color:#64748b">Nov/25 — férias</div>
          </div>
          <div style="flex:1;background:#0f172a;border-radius:6px;padding:8px 10px;border-left:3px solid #06b6d4">
            <div style="font-size:18px;font-weight:800;color:#06b6d4">10</div>
            <div style="font-size:10px;color:#64748b">Dez/25 — recesso</div>
          </div>
        </div>
      </div>
      <div style="font-size:11px;color:#475569;padding-top:10px;border-top:1px solid #334155">
        💡 As 9 bloqueadas precisam de acompanhamento ativo para não continuarem envelhecendo. As 9 internas — especialmente as 4 em revisão — podem ser priorizadas imediatamente.
      </div>
    </div>

  </div>

  <!-- Throughput Mensal card -->
  <div class="card" style="margin-bottom:16px">
    <div class="card-title">📦 Throughput Mensal — Implantações por Mês ${tip('Quantas integrações chegaram ao status <code>implantado</code> por mês. Barras <strong>verdes</strong> = mês acima da média histórica de saídas. Barras <strong>amarelas</strong> = abaixo. Cinza = meses com férias ou recesso (não refletem capacidade real).<br><br>🔴 Linha pontilhada vermelha = entradas médias/mês (${IND.flow.avg_in}) — equilíbrio mínimo.<br>⬜ Linha cinza = média histórica de saídas (${IND.flow.avg_out}/mês).')}</div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start">
      <div class="chart-wrap" style="height:180px">
        <canvas id="chartMonthly"></canvas>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;min-width:180px;padding-top:4px">
        <div style="background:#0f172a;border-radius:10px;padding:12px 14px;border:1px solid #334155">
          <div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Último mês completo</div>
          <div style="font-size:26px;font-weight:800;color:#10b981;letter-spacing:-1px;line-height:1">${throughputMonthly.filter(m=>!m.isMigration).slice(-2,-1)[0]?.completed ?? '—'}<span style="font-size:13px;font-weight:600;color:#475569">/mês</span></div>
          <div style="font-size:11px;color:#475569;margin-top:4px">Jan/26</div>
        </div>
        <div style="background:#0f172a;border-radius:10px;padding:12px 14px;border:1px solid ${IND.flow.avg_out >= IND.flow.avg_in ? '#10b98140' : '#ef444440'}">
          <div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Média saídas vs entradas</div>
          <div style="display:flex;align-items:baseline;gap:6px">
            <span style="font-size:22px;font-weight:800;color:#10b981;letter-spacing:-1px">${IND.flow.avg_out}</span>
            <span style="font-size:12px;color:#64748b">vs</span>
            <span style="font-size:22px;font-weight:800;color:#ef4444;letter-spacing:-1px">${IND.flow.avg_in}</span>
          </div>
          <div style="font-size:11px;margin-top:4px;color:${IND.flow.avg_out >= IND.flow.avg_in ? '#10b981' : '#ef4444'}">
            ${IND.flow.avg_out >= IND.flow.avg_in ? '✓ saindo mais do que entra' : `deficit de ${IND.flow.avg_in - IND.flow.avg_out}/mês`}
          </div>
        </div>
        <div style="background:#0f172a;border-radius:10px;padding:12px 14px;border:1px solid #334155">
          <div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Total histórico</div>
          <div style="font-size:22px;font-weight:800;color:#94a3b8;letter-spacing:-1px;line-height:1">${cap.throughput.total_completed}<span style="font-size:13px;font-weight:600;color:#475569"> implant.</span></div>
          <div style="font-size:11px;color:#475569;margin-top:4px">ciclo mediano ${cap.throughput.median_cycle_time_days}d</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Throughput Semanal card -->
  <div class="card" style="margin-bottom:16px">
    <div class="card-title">⚡ Throughput Semanal — Taxa de Entrega ${tip('Quantas integrações são concluídas por semana em cada mês. Derivado do total mensal dividido pelas semanas do período. Meses com férias (Nov) e recesso (Dez) estão marcados em cinza.<br><br>🔴 Linha pontilhada = <strong>mínimo para não crescer o WIP</strong> (${WEEKLY_BREAKEVEN}/sem = entrada média de ${IND.flow.avg_in} lojas/mês ÷ 4,33 semanas).<br>Abaixo dessa linha o backlog aumenta todo mês.')}</div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start">
      <div class="chart-wrap" style="height:180px">
        <canvas id="chartWeekly"></canvas>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;min-width:180px;padding-top:4px">
        <div style="background:#0f172a;border-radius:10px;padding:12px 14px;border:1px solid #334155">
          <div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Ritmo atual</div>
          <div style="font-size:26px;font-weight:800;color:#10b981;letter-spacing:-1px;line-height:1">${currentWeeklyRate}<span style="font-size:13px;font-weight:600;color:#475569">/sem</span></div>
          <div style="font-size:11px;margin-top:4px;color:${weeklyTrendColor};font-weight:600">${weeklyTrendIcon} ${weeklyTrendLabel}</div>
        </div>
        <div style="background:#0f172a;border-radius:10px;padding:12px 14px;border:1px solid ${weeklyGap > 0 ? '#ef444440' : '#10b98140'}">
          <div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Mínimo para equilibrar</div>
          <div style="font-size:22px;font-weight:800;color:${weeklyGap > 0 ? '#ef4444' : '#10b981'};letter-spacing:-1px;line-height:1">${WEEKLY_BREAKEVEN}<span style="font-size:13px;font-weight:600;color:#475569">/sem</span></div>
          <div style="font-size:11px;margin-top:4px;color:${weeklyGap > 0 ? '#ef4444' : '#10b981'}">
            ${weeklyGap > 0
              ? `deficit de ${weeklyGap}/sem — WIP cresce`
              : `✓ acima do ponto de equilíbrio`}
          </div>
        </div>
        <div style="background:#0f172a;border-radius:10px;padding:12px 14px;border:1px solid #334155">
          <div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Média histórica</div>
          <div style="font-size:22px;font-weight:800;color:#94a3b8;letter-spacing:-1px;line-height:1">${avgWeeklyRate}<span style="font-size:13px;font-weight:600;color:#475569">/sem</span></div>
          <div style="font-size:11px;color:#475569;margin-top:4px">excl. férias e recesso</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Row 2: Throughput chart + WIP status donut -->
  <div class="grid3" style="margin-bottom:16px">
    <div class="card">
      <div class="card-title">📦 Throughput — Entradas vs Saídas ${tip('Entradas = novos cards de integração criados no mês.<br>Saídas = integrações concluídas (<code>implantado</code>) no mês.<br><br>Quando <strong>entradas > saídas</strong>, o WIP cresce — o setor está aceitando mais do que entrega. Quando <strong>saídas > entradas</strong>, o pipeline está sendo drenado.<br><br>Meses com férias ou recesso aparecem com baixas saídas, mas isso <strong>não indica problema estrutural</strong> — apenas capacidade reduzida naquele período.')}</div>
      <div class="chart-wrap" style="height:200px">
        <canvas id="chartThroughput"></canvas>
      </div>
      <!-- Contexto operacional dos meses -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #334155">
        ${contextMonths.map(m => {
          const ctx = monthContext[m.month];
          return `<div style="display:flex;align-items:flex-start;gap:8px;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 10px;flex:1;min-width:180px">
            <span style="font-size:16px;flex-shrink:0">${ctx.icon}</span>
            <div>
              <div style="font-size:11px;font-weight:700;color:#f1f5f9">${ctx.label} — ${ctx.title}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px;line-height:1.5">${ctx.text}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-title">🔵 WIP por Cenário ${tip('Distribuição dos 50 cards ativos pelos 3 cenários de pipeline. O donut mostra a proporção de cada cenário — quanto maior o C3 (azul), maior a demanda real sobre a equipe. O C1 (cinza) representa integrações que ainda aguardam liberação e não consomem capacidade ativa agora.')}</div>
      <div class="chart-wrap" style="height:160px">
        <canvas id="chartWipStatus"></canvas>
      </div>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
        ${[
          { label: 'C1 — Aguardando início', count: SC.c1.count, color: '#64748b' },
          { label: 'C3 — Ativa (equipe)',     count: SC.c3.count, color: '#3b82f6' },
          { label: 'C2 — Bloqueada (ext.)',   count: SC.c2.count, color: '#f97316' },
        ].map(row => `
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:6px">
            <div class="dot" style="background:${row.color}"></div>
            <span style="font-size:11px;color:#cbd5e1">${row.label}</span>
          </div>
          <span style="font-size:12px;font-weight:700">${row.count}</span>
        </div>`).join('')}
      </div>
    </div>
  </div>

  <!-- Row 3: Tickets load chart -->
  <div class="card" style="margin-bottom:16px">
    <div class="card-title">🎫 Volume de Solicitações — Últimos 12 meses ${tip('Total de tickets de suporte abertos por mês — lojistas reportando problemas, pedindo configurações, etc. Esse volume <strong>compete diretamente</strong> com as integrações ativas pela atenção da equipe: um mês com muitos tickets reduz o throughput de novas integrações.<br><br>Barras em vermelho = meses acima de 130% da média histórica. A linha tracejada mostra a média do período.')}</div>
    <div class="chart-wrap" style="height:160px">
      <canvas id="chartTickets"></canvas>
    </div>
  </div>

  <!-- Row 4: Critical tasks + Blocked tasks -->
  <div class="grid2">
    <div class="card">
      <div class="card-title">🔴 Integrações Críticas (61+ dias) ${tip('Integrações com mais de 61 dias desde a criação do card, ainda sem concluir. Podem estar paradas por bloqueio externo (cliente, ERP) ou por falta de priorização interna. São as que mais pesam no índice de pressão e no ciclo médio. "Últ. mov." mostra há quantos dias o status foi alterado pela última vez.')}</div>
      ${criticalTasks.length === 0
        ? '<div style="color:#475569;font-size:13px;text-align:center;padding:20px">Nenhuma integração crítica</div>'
        : `<div class="tbl-wrap">
          <table class="tbl">
            <thead><tr>
              <th>Loja</th><th>Cenário</th><th>Status</th><th>Idade</th><th>Últ. mov.</th>
            </tr></thead>
            <tbody>
              ${criticalTasks.map(t => {
                const ageColor = t.age > 90 ? '#ef4444' : '#f97316';
                const scenColor = { C1: '#64748b', C2: '#f97316', C3: '#3b82f6' };
                const scenLabel = { C1: 'C1 gate', C2: 'C2 blq', C3: 'C3 ativa' };
                const sc = t.scenario || 'C1';
                return `<tr>
                  <td>
                    <a href="${t.url}" target="_blank" style="color:#f1f5f9;hover:underline">
                      ${t.name.substring(0,38)}${t.name.length>38?'…':''}
                    </a>
                  </td>
                  <td><span class="badge" style="background:${scenColor[sc]}22;color:${scenColor[sc]};border:1px solid ${scenColor[sc]}44">${scenLabel[sc]}</span></td>
                  <td><span class="badge" style="background:${STATUS_COLORS[t.status]||'#64748b'}22;color:${STATUS_COLORS[t.status]||'#64748b'};border:1px solid ${STATUS_COLORS[t.status]||'#64748b'}44">${t.status}</span></td>
                  <td><span class="age-pill" style="background:${ageColor}22;color:${ageColor}">${t.age}d</span></td>
                  <td style="color:#64748b">${t.daysSinceUpdated}d atrás</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
    </div>

    <div class="card">
      <div class="card-title">⚑ Integrações Bloqueadas (${blockedTasks.length}) ${tip('Integrações cujo avanço depende de um fator externo no momento. A <strong>responsabilidade não é da equipe</strong>, mas o card segue envelhecendo. O ideal é ter contato ativo de acompanhamento mesmo nesses casos para não perder o lojista.<br><br><code>aguardando cliente</code> = lojista precisa agir<br><code>bloqueado pedido/produto</code> = problema no ERP ou na API do parceiro')}</div>
      ${blockedTasks.length === 0
        ? '<div style="color:#475569;font-size:13px;text-align:center;padding:20px">Nenhuma bloqueada</div>'
        : `<div class="tbl-wrap">
          <table class="tbl">
            <thead><tr>
              <th>Loja</th><th>Motivo</th><th>Há</th>
            </tr></thead>
            <tbody>
              ${blockedTasks.map(t => `
              <tr>
                <td>
                  <a href="${t.url}" target="_blank" style="color:#f1f5f9">
                    ${t.name.substring(0,35)}${t.name.length>35?'…':''}
                  </a>
                </td>
                <td><span class="badge badge-red">${t.status.replace('bloqueado ','blq. ')}</span></td>
                <td style="color:#ef4444;font-weight:700">${t.age}d</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>
  </div>

  <!-- Cohort: lojas por mês de entrada -->
  <div class="card" style="margin-top:16px">
    <div class="card-title">📅 Coorte — Lojas por Mês de Entrada ${tip('Mostra as integrações ativas agrupadas pelo mês em que foram criadas no ClickUp. Permite entender o que aconteceu com cada "leva" de lojas — quantas continuam travadas, quantas avançaram, e quais estão críticas.<br><br>As lojas que já foram concluídas (<code>implantado</code>) <strong>não aparecem aqui</strong> — apenas as que ainda estão ativas no pipeline.')}</div>

    <!-- Cabeçalho com resumo por mês -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${COHORT_MONTHS.map(m => {
        const tasks    = cohortTasks[m];
        const thr      = _thrMap[m];
        const color    = COHORT_COLORS[m];
        const entered  = thr?.started ?? '?';
        const concluded = thr?.isMigration ? 0 : (thr?.completed ?? 0);
        const stillActive = tasks.length;
        const blocked  = tasks.filter(t => t.isBlocked).length;
        const critical = tasks.filter(t => t.age > 60).length;
        return `
        <div style="background:#0f172a;border:1px solid ${color}44;border-top:3px solid ${color};border-radius:10px;padding:12px 14px">
          <div style="font-size:13px;font-weight:800;color:${color};margin-bottom:8px">${COHORT_LABELS[m]}</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <div style="display:flex;justify-content:space-between;font-size:11px">
              <span style="color:#64748b">Entraram</span>
              <span style="color:#f1f5f9;font-weight:700">${entered}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px">
              <span style="color:#64748b">Concluídas</span>
              <span style="color:#10b981;font-weight:700">${concluded}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px">
              <span style="color:#64748b">Ainda ativas</span>
              <span style="color:${color};font-weight:700">${stillActive}</span>
            </div>
            ${blocked > 0 ? `
            <div style="display:flex;justify-content:space-between;font-size:11px">
              <span style="color:#64748b">Bloqueadas</span>
              <span style="color:#f97316;font-weight:700">${blocked}</span>
            </div>` : ''}
            ${critical > 0 ? `
            <div style="display:flex;justify-content:space-between;font-size:11px">
              <span style="color:#64748b">Críticas (60+d)</span>
              <span style="color:#ef4444;font-weight:700">${critical}</span>
            </div>` : ''}
          </div>
          <div style="font-size:10px;color:#475569;margin-top:8px;padding-top:8px;border-top:1px solid #1e293b;line-height:1.5">${COHORT_CONTEXT[m]}</div>
        </div>`;
      }).join('')}
    </div>

    <!-- Cards de lojas por mês -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;align-items:start">
      ${COHORT_MONTHS.map(m => {
        const tasks = cohortTasks[m].sort((a,b) => {
          const urgOrd = { C2: 0, C1: 1, C3: 2 };
          return (urgOrd[a.scenario]??3) - (urgOrd[b.scenario]??3) || b.age - a.age;
        });
        const color = COHORT_COLORS[m];
        if (tasks.length === 0) {
          return `<div style="color:#475569;font-size:12px;text-align:center;padding:20px;background:#0f172a;border-radius:8px;border:1px dashed #334155">
            Nenhuma loja ativa desta coorte
          </div>`;
        }
        return `<div style="display:flex;flex-direction:column;gap:6px">
          ${tasks.map(t => {
            const statusColor = STATUS_COLORS[t.status] || '#64748b';
            const scenColor   = { C1:'#64748b', C2:'#f97316', C3:'#3b82f6' };
            const scenIcon    = { C1:'⏸', C2:'⚑', C3:'▶' };
            const ageColor    = t.age > 90 ? '#ef4444' : t.age > 60 ? '#f97316' : t.age > 30 ? '#f59e0b' : '#94a3b8';
            const cardBorder  = t.isBlocked ? '1px solid #f9741640' : t.age > 60 ? '1px solid #ef444430' : '1px solid #1e293b';
            const cardBg      = t.isBlocked ? '#f9741608' : t.age > 60 ? '#ef444408' : '#0f172a';
            return `
            <div style="background:${cardBg};border:${cardBorder};border-radius:8px;padding:9px 11px">
              <div style="font-size:11px;font-weight:700;color:#e2e8f0;margin-bottom:5px;line-height:1.3">
                ${t.name.substring(0,36)}${t.name.length > 36 ? '…' : ''}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px">
                <span style="font-size:9px;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}33;border-radius:99px;padding:1px 6px;font-weight:600">${t.status}</span>
                ${t.erp ? `<span style="font-size:9px;background:#1e293b;color:#64748b;border:1px solid #334155;border-radius:99px;padding:1px 6px">${t.erp}</span>` : ''}
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:9px;color:${scenColor[t.scenario]};font-weight:700">${scenIcon[t.scenario]} ${t.scenario === 'C1' ? 'aguardando' : t.scenario === 'C2' ? 'bloqueada' : 'ativa'}</span>
                <span style="font-size:11px;font-weight:800;color:${ageColor}">${t.age}d</span>
              </div>
              ${t.workDays > 0 || t.blockedDays > 0 ? `
              <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
                ${t.workDays    > 0 ? `<span style="font-size:9px;color:#3b82f6">▶ ${t.workDays}d ativo</span>` : ''}
                ${t.blockedDays > 0 ? `<span style="font-size:9px;color:#f97316">⚑ ${t.blockedDays}d bloq.</span>` : ''}
              </div>` : ''}
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}
    </div>
  </div>

  <!-- ERP Breakdown -->
  <div class="card" style="margin-top:16px">
    <div class="card-title">🔧 ERPs em Integração ${tip('ERPs presentes nas integrações ativas. <strong>Tempo médio no pipeline</strong> = idade média das integrações ativas com esse ERP. Quanto mais alto, mais complexas ou mais antigas são essas integrações.<br><br>As colunas de fase mostram quantos dias as integrações com esse ERP passaram em produto e pedido — útil para estimar quanto tempo vai sobrar para lojas que ainda não chegaram nessas fases.')}</div>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr>
          <th>ERP</th>
          <th style="text-align:center">Integrações</th>
          <th style="text-align:center">Bloqueadas</th>
          <th style="text-align:center">Tempo médio</th>
          <th style="text-align:center">Fase Produto</th>
          <th style="text-align:center">Fase Pedido</th>
          <th>Barra</th>
        </tr></thead>
        <tbody>
          ${(() => {
            const maxAge = Math.max(...erpEnriched.map(e => e.avgAge), 1);
            return erpEnriched.map(e => {
              const pct        = Math.round(e.avgAge / maxAge * 100);
              const ageColor   = e.avgAge > 90 ? '#ef4444' : e.avgAge > 60 ? '#f97316' : e.avgAge > 30 ? '#f59e0b' : '#10b981';
              const blkColor   = e.blocked > 0 ? '#ef4444' : '#475569';
              const blkPct     = Math.round(e.blocked / e.total * 100);
              return `<tr>
                <td style="font-weight:700;color:#f1f5f9">${e.erp}</td>
                <td style="text-align:center">${e.total}</td>
                <td style="text-align:center;color:${blkColor}">${e.blocked}${e.blocked > 0 ? ` <span style="color:#64748b;font-size:10px">(${blkPct}%)</span>` : ''}</td>
                <td style="text-align:center">
                  <span class="age-pill" style="background:${ageColor}22;color:${ageColor}">${e.avgAge}d</span>
                </td>
                <td style="text-align:center;color:#06b6d4">${e.avgProduto != null ? e.avgProduto + 'd' : '<span style="color:#334155">—</span>'}</td>
                <td style="text-align:center;color:#f59e0b">${e.avgPedido  != null ? e.avgPedido  + 'd' : '<span style="color:#334155">—</span>'}</td>
                <td style="min-width:100px">
                  <div style="background:#0f172a;border-radius:3px;height:14px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${ageColor}88;border-radius:3px"></div>
                  </div>
                </td>
              </tr>`;
            }).join('');
          })()}
        </tbody>
      </table>
    </div>
    ${cap.erp_breakdown.find(e => e.erp === 'N/A')
      ? `<div style="font-size:11px;color:#475569;margin-top:8px;padding-top:8px;border-top:1px solid #1e293b">
          ⚠ ${cap.erp_breakdown.find(e => e.erp === 'N/A').total} integrações sem tag de ERP no ClickUp — não listadas acima.
          Para aparecerem aqui, adicione a tag <code style="background:#1e293b;padding:1px 5px;border-radius:3px">erp: nome</code> nos cards.
        </div>`
      : ''}
  </div>

  <!-- Footer -->
  <div style="text-align:center;color:#1e293b;font-size:11px;margin-top:24px;padding-top:12px;border-top:1px solid #1e293b">
    Instabuy · Setor de Integrações · ${new Date().toLocaleDateString('pt-BR')}
  </div>

  </div><!-- /tab-cap -->

  <!-- Tab: Gestão de Bloqueios -->
  <div id="tab-bloq" class="tab-pane">

    <!-- KPI row de bloqueios -->
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi">
        <div class="kpi-accent" style="background:#ef4444"></div>
        <div class="kpi-label">Bloqueadas agora ${tip('Total de integrações em status de bloqueio: <code>aguardando cliente</code>, <code>bloqueado pedido</code> ou <code>bloqueado produto</code>. Cada uma representa receita e tempo de ciclo congelados.')}</div>
        <div class="kpi-value" style="color:#ef4444">${blockedNow.length}</div>
        <div class="kpi-sub">${cap.wip.blocked_pct}% do pipeline parado</div>
      </div>
      <div class="kpi">
        <div class="kpi-accent" style="background:#f97316"></div>
        <div class="kpi-label">Bloqueiam com ${tip('Idade média das tasks no momento em que entraram no primeiro bloqueio. Valores altos (> 30d) indicam que o bloqueio ocorre no meio do processo — trabalho foi iniciado mas dependência externa surgiu tarde.')}</div>
        <div class="kpi-value" style="color:#f97316">${avgAgeAtFirstBlock}d</div>
        <div class="kpi-sub">de vida ao primeiro bloqueio</div>
      </div>
      <div class="kpi">
        <div class="kpi-accent" style="background:#f59e0b"></div>
        <div class="kpi-label">Nunca trabalharam ${tip('Integrações que estão bloqueadas mas nunca tiveram nenhum dia de trabalho ativo. O bloqueio aconteceu antes mesmo de qualquer progresso — o cliente não estava pronto desde a entrada.')}</div>
        <div class="kpi-value" style="color:#f59e0b">${neverWorkedBlocked.length}</div>
        <div class="kpi-sub">${Math.round(neverWorkedBlocked.length / Math.max(blockedNow.length,1)*100)}% das bloqueadas sem 1 dia de trabalho</div>
      </div>
      <div class="kpi">
        <div class="kpi-accent" style="background:#a855f7"></div>
        <div class="kpi-label">Multibloqueio ${tip('Tasks que passaram por mais de um episódio de bloqueio distinto — bloquearam, desbloquearam e bloquearam novamente. Sinal de dependências externas não resolvidas ou problema recorrente com o cliente/ERP.')}</div>
        <div class="kpi-value" style="color:#a855f7">${reblocked.length}</div>
        <div class="kpi-sub">bloquearam 2+ vezes no histórico</div>
      </div>
      <div class="kpi">
        <div class="kpi-accent" style="background:#64748b"></div>
        <div class="kpi-label">Dias congelados ${tip('Soma de todos os dias de bloqueio acumulados em todo o WIP ativo. Representa o tempo total que o pipeline passou parado por fatores externos — equivalente em throughput perdido.')}</div>
        <div class="kpi-value" style="color:#64748b">${allWipTasks.reduce((s,t)=>s+t.blockedDays,0)}</div>
        <div class="kpi-sub">dias de bloqueio acumulados no WIP</div>
      </div>
    </div>

    <!-- Row 1: Age at Block + Status breakdown -->
    <div class="grid2" style="margin-bottom:16px">

      <!-- Age at First Block -->
      <div class="card">
        <div class="card-title">⏱ Quando o Bloqueio Ocorre ${tip('Distribuição da idade das tasks no momento do primeiro bloqueio. Responde: o problema é na entrada (cliente não estava pronto) ou no meio do processo (surgiu uma dependência após trabalho iniciado)?<br><br>🟢 ≤10d — bloqueio na entrada (cliente impreparado)<br>🟡 11–40d — bloqueio no processo (surgiu dependência)<br>🔴 >40d — bloqueio tardio (problema identificado tarde)')}</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
          ${Object.entries(ageAtBlockBuckets).map(([label, count]) => {
            const barW = count === 0 ? 0 : Math.max(Math.round(count / maxBlockAgeBucket * 100), 10);
            const color = blockAgeBucketColors[label];
            return `
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:100px;font-size:11px;color:#94a3b8;flex-shrink:0">${label}</div>
              <div class="blk-bar-wrap">
                ${count > 0
                  ? `<div class="blk-bar" style="width:${barW}%;background:${color}">${count} loja${count>1?'s':''}</div>`
                  : `<div style="height:100%;background:#0f172a"></div>`}
              </div>
              <div style="width:20px;text-align:right;font-size:12px;font-weight:700;color:${count>0?color:'#334155'}">${count}</div>
            </div>`;
          }).join('')}
        </div>
        <div style="background:#0f172a;border-radius:8px;padding:10px 12px;font-size:11px;color:#94a3b8;line-height:1.7">
          ${ageAtBlockBuckets['21–40d'] >= ageAtBlockBuckets['Primeiros 10d'] + ageAtBlockBuckets['11–20d']
            ? `<span style="color:#f97316;font-weight:700">⚠ Maioria bloqueia entre 21–40 dias</span> — o trabalho foi iniciado mas surgiu dependência externa no meio do processo. Revisar checklist de pré-requisitos.`
            : ageAtBlockBuckets['Primeiros 10d'] > blockedNow.length * 0.3
            ? `<span style="color:#22c55e;font-weight:700">📋 Maioria bloqueia nos primeiros 10 dias</span> — o cliente não estava pronto na entrada. Considerar critério de aceite antes de abrir o card.`
            : `Bloqueios distribuídos ao longo do ciclo. Média: <strong>${avgAgeAtFirstBlock}d</strong> de vida ao primeiro bloqueio.`}
        </div>
      </div>

      <!-- Bloqueios por status -->
      <div class="card">
        <div class="card-title">🔒 Bloqueios por Tipo ${tip('Distribuição das integrações bloqueadas por status atual. Cada tipo representa uma causa diferente:<br><br><strong>Aguardando cliente</strong>: cliente sem responder ou dados pendentes do lojista<br><strong>Bloqueado pedido</strong>: módulo de pedidos travado (ERP, API, configuração)<br><strong>Bloqueado produto</strong>: módulo de produtos travado')}</div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
          ${Object.entries(blockedByStatus).sort((a,b)=>b[1]-a[1]).map(([status, count]) => {
            const color   = BLOCKED_STATUS_COLORS[status] || '#64748b';
            const barW    = Math.max(Math.round(count / maxBlockedStatus * 100), 8);
            const avgBlkD = Math.round(blockedNow.filter(t=>t.status===status).reduce((s,t)=>s+t.blockedDays,0) / count);
            return `
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-size:11px;font-weight:700;color:${color}">${status}</span>
                <span style="font-size:10px;color:#64748b">avg ${avgBlkD}d bloqueado</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <div class="blk-bar-wrap">
                  <div class="blk-bar" style="width:${barW}%;background:${color}">${count}</div>
                </div>
                <div style="font-size:13px;font-weight:800;color:${color};width:24px;text-align:right">${count}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
        <!-- Tempo total congelado por tipo -->
        <div style="border-top:1px solid #334155;padding-top:10px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#475569;margin-bottom:6px">Dias totais congelados por tipo</div>
          ${Object.entries(blockedByStatus).sort((a,b)=>b[1]-a[1]).map(([status, count]) => {
            const color    = BLOCKED_STATUS_COLORS[status] || '#64748b';
            const totalDays = blockedNow.filter(t=>t.status===status).reduce((s,t)=>s+t.blockedDays,0);
            return `<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
              <span style="color:#94a3b8">${status}</span>
              <span style="color:${color};font-weight:700">${totalDays}d</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Row 2: ERP × Bloqueio -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">🔧 Bloqueios por ERP ${tip('Qual ERP concentra mais bloqueios e mais tempo parado. ERPs com alta % de bloqueio e dias médios altos são os candidatos a investigação técnica ou protocolo específico de integração.')}</div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr>
            <th>ERP</th>
            <th style="text-align:center">WIP</th>
            <th style="text-align:center">Bloqueadas</th>
            <th style="text-align:center">% bloqueio</th>
            <th style="text-align:center">Dias médios bloq.</th>
            <th style="text-align:center">Nunca trabalharam</th>
            <th>Barra</th>
          </tr></thead>
          <tbody>
            ${erpBlockRanked.map(e => {
              const blkColor  = e.blocked > 0 ? (e.blockPct >= 80 ? '#ef4444' : e.blockPct >= 50 ? '#f97316' : '#f59e0b') : '#10b981';
              const barW      = Math.round(e.blocked / maxErpBlocked * 100);
              return `<tr>
                <td style="font-weight:700;color:#e2e8f0">${e.erp}</td>
                <td style="text-align:center;color:#94a3b8">${e.total}</td>
                <td style="text-align:center;font-weight:700;color:${blkColor}">${e.blocked}</td>
                <td style="text-align:center">
                  <span class="badge ${e.blockPct>=80?'badge-red':e.blockPct>=50?'badge-amber':'badge-gray'}">${e.blockPct}%</span>
                </td>
                <td style="text-align:center;color:${e.avgBlockedDays>30?'#ef4444':e.avgBlockedDays>10?'#f59e0b':'#64748b'};font-weight:700">${e.avgBlockedDays}d</td>
                <td style="text-align:center;color:${e.neverWorked>0?'#f97316':'#475569'}">${e.neverWorked}</td>
                <td style="width:120px">
                  <div style="background:#0f172a;border-radius:3px;height:8px;overflow:hidden">
                    <div style="height:100%;width:${barW}%;background:${blkColor};border-radius:3px"></div>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${erpBlockMap['N/A']?.blocked > 0
        ? `<div style="font-size:11px;color:#475569;margin-top:8px;padding-top:8px;border-top:1px solid #1e293b">
            ⚠ ${erpBlockMap['N/A'].blocked} bloqueadas sem tag de ERP — adicione <code style="background:#0f172a;padding:1px 5px;border-radius:3px">erp: nome</code> para aparecerem na análise acima.
          </div>`
        : ''}
    </div>

    <!-- Row 3: Tabela detalhada de tasks bloqueadas -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">📋 Integrações Bloqueadas Agora ${tip('Lista completa das integrações em status de bloqueio, ordenadas pelo tempo total bloqueado. <strong>Bloqueou com Xd</strong> = quantos dias de vida tinha quando entrou no primeiro bloqueio.')}</div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr>
            <th>Loja</th>
            <th>ERP</th>
            <th>Status</th>
            <th style="text-align:center">Idade</th>
            <th style="text-align:center">Bloq. há</th>
            <th style="text-align:center">Bloqueou com</th>
            <th style="text-align:center">Trabalho feito</th>
            <th style="text-align:center">Episódios</th>
          </tr></thead>
          <tbody>
            ${blockedNow.map(t => {
              const ageColor   = t.age > 90 ? '#ef4444' : t.age > 60 ? '#f97316' : t.age > 30 ? '#f59e0b' : '#94a3b8';
              const blkColor   = BLOCKED_STATUS_COLORS[t.status] || '#64748b';
              const ageAtBlk   = t.ageAtFirstBlock ?? (t.age - (t.currentStatusDays || 0));
              const ageAtBlkColor = ageAtBlk <= 10 ? '#22c55e' : ageAtBlk <= 20 ? '#f59e0b' : ageAtBlk <= 40 ? '#f97316' : '#ef4444';
              const multiBlk   = t.blockEpisodeCount > 1;
              return `<tr>
                <td>
                  <a href="${t.url}" target="_blank" style="color:#e2e8f0;font-weight:600;text-decoration:none;font-size:12px"
                     onmouseover="this.style.color='#3b82f6'" onmouseout="this.style.color='#e2e8f0'">
                    ${t.name.substring(0,32)}${t.name.length>32?'…':''}
                  </a>
                </td>
                <td><span style="font-size:10px;color:#64748b">${t.erp || '—'}</span></td>
                <td><span style="font-size:10px;background:${blkColor}22;color:${blkColor};border:1px solid ${blkColor}33;border-radius:99px;padding:1px 7px;font-weight:600;white-space:nowrap">${t.status}</span></td>
                <td style="text-align:center"><span class="age-pill" style="background:${ageColor}22;color:${ageColor}">${t.age}d</span></td>
                <td style="text-align:center;font-weight:700;color:${blkColor}">${t.currentStatusDays ?? t.blockedDays}d</td>
                <td style="text-align:center;font-weight:700;color:${ageAtBlkColor}">${ageAtBlk}d</td>
                <td style="text-align:center;color:${t.workDays>0?'#3b82f6':'#475569'}">${t.workDays > 0 ? t.workDays+'d' : '—'}</td>
                <td style="text-align:center">
                  ${multiBlk
                    ? `<span class="badge badge-amber">⚠ ${t.blockEpisodeCount}×</span>`
                    : `<span style="color:#475569;font-size:11px">1×</span>`}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Row 4: Multibloqueio + Time to First Work -->
    <div class="grid2" style="margin-bottom:16px">

      <!-- Multibloqueio -->
      <div class="card">
        <div class="card-title">🔁 Reentrada em Bloqueio ${tip('Tasks que bloquearam em mais de um status distinto no histórico — sinal de que o problema não foi resolvido na primeira desbloqueio, ou que surgiram novas dependências ao longo do processo.')}</div>
        ${reblocked.length === 0
          ? `<div style="color:#475569;font-size:12px;text-align:center;padding:20px">Nenhuma task com multibloqueio identificada</div>`
          : `<div style="display:flex;flex-direction:column;gap:6px">
              ${reblocked.sort((a,b) => b.blockEpisodeCount - a.blockEpisodeCount).map(t => {
                const ageColor = t.age > 90 ? '#ef4444' : t.age > 60 ? '#f97316' : '#f59e0b';
                return `
                <div style="background:#0f172a;border:1px solid #f59e0b33;border-radius:8px;padding:9px 12px">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                    <a href="${t.url}" target="_blank" style="font-size:12px;font-weight:700;color:#e2e8f0;text-decoration:none"
                       onmouseover="this.style.color='#3b82f6'" onmouseout="this.style.color='#e2e8f0'">
                      ${t.name.substring(0,34)}${t.name.length>34?'…':''}
                    </a>
                    <span class="badge badge-amber">${t.blockEpisodeCount}× bloqueios</span>
                  </div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <span style="font-size:10px;color:#64748b">Idade: <strong style="color:${ageColor}">${t.age}d</strong></span>
                    <span style="font-size:10px;color:#64748b">ERP: <strong style="color:#94a3b8">${t.erp || 'N/A'}</strong></span>
                    <span style="font-size:10px;color:#64748b">Status: <strong style="color:#f59e0b">${t.status}</strong></span>
                  </div>
                  ${t.blockHistory?.length > 0 ? `
                  <div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">
                    ${t.blockHistory.map(b => `<span style="font-size:9px;background:#ef444420;color:#ef4444;border:1px solid #ef444430;border-radius:4px;padding:1px 6px">${b.status} ${b.days}d</span>`).join('')}
                  </div>` : ''}
                </div>`;
              }).join('')}
            </div>`}
      </div>

      <!-- Time to First Work -->
      <div class="card">
        <div class="card-title">⚡ Tempo até Primeiro Trabalho ${tip('Quantos dias após a entrada no pipeline a equipe realizou o primeiro trabalho ativo. Alto tempo indica que lojas ficam na fila sem serem priorizadas. Zero ou próximo de zero é o ideal.')}</div>
        ${(() => {
          const tasksWithWork = allWipTasks.filter(t => t.ageAtFirstWork !== null && t.ageAtFirstWork !== undefined);
          if (tasksWithWork.length === 0) return `<div style="color:#475569;font-size:12px;text-align:center;padding:20px">Dados insuficientes</div>`;
          const avgFirst = Math.round(tasksWithWork.reduce((s,t) => s + t.ageAtFirstWork, 0) / tasksWithWork.length);
          const buckets = {
            '≤3d':  tasksWithWork.filter(t => t.ageAtFirstWork <= 3).length,
            '4–7d': tasksWithWork.filter(t => t.ageAtFirstWork > 3 && t.ageAtFirstWork <= 7).length,
            '8–14d':tasksWithWork.filter(t => t.ageAtFirstWork > 7 && t.ageAtFirstWork <= 14).length,
            '>14d': tasksWithWork.filter(t => t.ageAtFirstWork > 14).length,
          };
          const maxB = Math.max(...Object.values(buckets), 1);
          const bColors = { '≤3d':'#22c55e','4–7d':'#f59e0b','8–14d':'#f97316','>14d':'#ef4444' };
          return `
          <div style="text-align:center;margin-bottom:14px">
            <div style="font-size:2rem;font-weight:800;color:${avgFirst<=7?'#22c55e':avgFirst<=14?'#f59e0b':'#ef4444'};letter-spacing:-1px">${avgFirst}d</div>
            <div style="font-size:11px;color:#64748b">média até o 1º trabalho (${tasksWithWork.length} tasks)</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:7px">
            ${Object.entries(buckets).map(([label, count]) => {
              const barW = count === 0 ? 0 : Math.max(Math.round(count/maxB*100), 8);
              const color = bColors[label];
              return `
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:50px;font-size:11px;color:#94a3b8;flex-shrink:0">${label}</div>
                <div class="blk-bar-wrap">
                  ${count > 0 ? `<div class="blk-bar" style="width:${barW}%;background:${color}">${count}</div>`
                               : `<div style="height:100%;background:#0f172a"></div>`}
                </div>
                <div style="width:18px;font-size:12px;font-weight:700;color:${count>0?color:'#334155'}">${count}</div>
              </div>`;
            }).join('')}
          </div>`;
        })()}
      </div>
    </div>

    <!-- Footer da aba bloqueios -->
    <div style="text-align:center;color:#1e293b;font-size:11px;margin-top:24px;padding-top:12px;border-top:1px solid #1e293b">
      Instabuy · Setor de Integrações · ${new Date().toLocaleDateString('pt-BR')}
    </div>

  </div><!-- /tab-bloq -->

</div>

<script>
// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');
}

const THROUGHPUT = ${JSON.stringify(throughputMonthly)};
const TICKETS    = ${JSON.stringify(cap.tickets.monthly)};
const WIP_SCENARIOS = {
  labels: ['C1 — Aguardando início', 'C3 — Ativa (equipe)', 'C2 — Bloqueada (ext.)'],
  values: [${SC.c1.count}, ${SC.c3.count}, ${SC.c2.count}],
  colors: ['#64748b', '#3b82f6', '#f97316'],
};
const STATUS_COLORS_JS = ${JSON.stringify(STATUS_COLORS)};

// ── Monthly throughput chart ──────────────────────────────────────────────────
(function() {
  const data    = ${JSON.stringify(throughputMonthly.filter(m => !m.isMigration))};
  const avgOut  = ${IND.flow.avg_out};
  const avgIn   = ${IND.flow.avg_in};
  const holiday = ['2025-11','2025-12'];
  const labels  = data.map(m => m.label);
  const values  = data.map(m => m.completed);
  const colors  = data.map(m =>
    holiday.includes(m.month) ? '#47556988' :
    m.completed >= avgOut ? '#10b98188' : '#f59e0b88'
  );
  const borders = data.map(m =>
    holiday.includes(m.month) ? '#64748b' :
    m.completed >= avgOut ? '#10b981' : '#f59e0b'
  );
  new Chart(document.getElementById('chartMonthly'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Implantadas', data: values, backgroundColor: colors, borderColor: borders, borderWidth: 1, borderRadius: 5 },
        { label: 'Equilíbrio (entradas ' + avgIn + '/mês)', data: data.map(() => avgIn), type: 'line', borderColor: '#ef4444', borderWidth: 1.5, borderDash: [5,4], pointRadius: 0, fill: false, tension: 0 },
        { label: 'Histórico (' + avgOut + '/mês)', data: data.map(() => avgOut), type: 'line', borderColor: '#64748b', borderWidth: 1, borderDash: [3,3], pointRadius: 0, fill: false, tension: 0 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
        tooltip: { callbacks: { afterLabel: ctx => holiday.includes(data[ctx.dataIndex]?.month) ? '⚠ Férias/recesso — excluído da média' : null } }
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: '#1e293b' }, beginAtZero: true }
      }
    }
  });
})();

// ── Weekly throughput chart ───────────────────────────────────────────────────
(function() {
  const data      = ${JSON.stringify(weeklyThroughput)};
  const target    = ${WEEKLY_BREAKEVEN};
  const histAvg   = ${WEEKLY_TARGET};
  const labels = data.map(m => m.isCurrentMonth ? m.label + '*' : m.label);
  const rates  = data.map(m => m.weeklyRate);
  const isHoliday = m => ['2025-11','2025-12'].includes(m.month);
  const colors = data.map(m =>
    isHoliday(m) ? '#475569' : m.weeklyRate >= target ? '#10b981cc' : '#f59e0bcc'
  );
  const borders = data.map(m =>
    isHoliday(m) ? '#64748b' : m.weeklyRate >= target ? '#10b981' : '#f59e0b'
  );
  new Chart(document.getElementById('chartWeekly'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Taxa semanal',
          data: rates,
          backgroundColor: colors,
          borderColor: borders,
          borderWidth: 1,
          borderRadius: 5,
        },
        {
          label: 'Equilíbrio (' + target + '/sem)',
          data: data.map(() => target),
          type: 'line',
          borderColor: '#ef4444',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
        {
          label: 'Histórico (' + histAvg + '/sem)',
          data: data.map(() => histAvg),
          type: 'line',
          borderColor: '#64748b',
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          tension: 0,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 1) return 'Meta: ' + target + '/sem';
              const m = data[ctx.dataIndex];
              return ctx.raw + '/sem  (' + m.completed + ' concluídas em ' + m.weeksInPeriod + ' sem' + (m.isCurrentMonth ? ', mês parcial' : '') + ')';
            },
            afterLabel: ctx => {
              if (ctx.datasetIndex !== 0) return null;
              const m = data[ctx.dataIndex];
              return isHoliday(m) ? '⚠ Mês com férias/recesso — excluído da média' : null;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: '#1e293b' }, beginAtZero: true },
      }
    }
  });
})();

// ── Throughput chart ──────────────────────────────────────────────────────────
(function() {
  const labels    = THROUGHPUT.map(m => m.label);
  const started   = THROUGHPUT.map(m => m.started);
  const completed = THROUGHPUT.map(m => m.isMigration ? 0 : (m.completed || 0));
  const migIdx    = THROUGHPUT.findIndex(m => m.isMigration);

  new Chart(document.getElementById('chartThroughput'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Entradas',
          data: started,
          backgroundColor: '#3b82f655',
          borderColor: '#3b82f6',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Concluídas',
          data: completed,
          backgroundColor: '#10b98155',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 4,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color:'#94a3b8', font:{size:11} } },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items[0]?.dataIndex;
              if (THROUGHPUT[idx]?.isMigration) return ['⚠️ Migração histórica — excluído da média'];
              return [];
            }
          }
        }
      },
      scales: {
        x: { ticks:{color:'#64748b',font:{size:11}}, grid:{color:'#1e293b'} },
        y: { ticks:{color:'#64748b',font:{size:11}}, grid:{color:'#1e293b'}, beginAtZero:true },
      }
    }
  });
})();

// ── WIP scenarios donut ───────────────────────────────────────────────────────
(function() {
  new Chart(document.getElementById('chartWipStatus'), {
    type: 'doughnut',
    data: {
      labels: WIP_SCENARIOS.labels,
      datasets: [{ data: WIP_SCENARIOS.values, backgroundColor: WIP_SCENARIOS.colors, borderColor: '#0f172a', borderWidth: 2 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.raw + ' integ.' } }
      }
    }
  });
})();

// ── Tickets trend ─────────────────────────────────────────────────────────────
(function() {
  const labels = TICKETS.map(m => m.label);
  const values = TICKETS.map(m => m.total);
  const avg    = Math.round(values.reduce((s,v)=>s+v,0)/values.length);

  new Chart(document.getElementById('chartTickets'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Solicitações',
          data: values,
          backgroundColor: values.map(v => v > avg * 1.3 ? '#ef444455' : '#6366f155'),
          borderColor:     values.map(v => v > avg * 1.3 ? '#ef4444' : '#6366f1'),
          borderWidth: 1,
          borderRadius: 4,
          order: 2,
        },
        {
          label: 'Média',
          data: values.map(() => avg),
          type: 'line',
          borderColor: '#475569',
          borderDash: [4,4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          order: 1,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color:'#94a3b8', font:{size:11} } },
        tooltip: { callbacks: { afterBody: (items) => {
          const v = items[0]?.raw;
          if (v > avg * 1.3) return ['⚠️ Acima da média — mês de alta pressão'];
          return [];
        }}}
      },
      scales: {
        x: { ticks:{color:'#64748b',font:{size:11}}, grid:{color:'#1e293b'} },
        y: { ticks:{color:'#64748b',font:{size:11}}, grid:{color:'#1e293b'}, beginAtZero:true },
      }
    }
  });
})();
</script>
</body>
</html>`;

writeFileSync('C:/Users/guilh/projetos/clickup-activity-mcp/dashboard-capacity.html', html);
const kb = Math.round(html.length / 1024);
console.log(`Dashboard gerado!`);
console.log(`Arquivo: C:/Users/guilh/projetos/clickup-activity-mcp/dashboard-capacity.html`);
console.log(`Tamanho: ${kb}KB`);
