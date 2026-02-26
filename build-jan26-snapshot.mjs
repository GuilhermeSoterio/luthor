/**
 * build-jan26-snapshot.mjs
 *
 * Reconstrói o estado do pipeline em 31/jan/2026 a partir do
 * capacity-data.json atual (gerado em 22/fev/2026).
 *
 * Lógica:
 *  - Exclui as 19 tasks que entraram em fevereiro (age <= 22)
 *  - Reduz a idade de cada task em 22 dias
 *  - Escala workDays/blockedDays/queueDays proporcionalmente
 *  - Remove throughput de fev/26 do histórico
 *  - Recalcula todos os indicadores derivados (WIP, buckets, cenários, etc.)
 */

import { readFileSync, writeFileSync } from 'fs';

const DAYS_BACK  = 22;   // dias entre 31/jan e 22/fev (data de geração)
const SNAPSHOT_AT = '2026-01-31T23:59:59.000Z';

const cap = JSON.parse(readFileSync('capacity-data.json', 'utf8'));

// ── 1. Ajusta tasks ───────────────────────────────────────────────────────────
const janTasks = cap.wip.tasks
  .filter(t => t.age > DAYS_BACK)
  .map(t => {
    const ratio    = (t.age - DAYS_BACK) / t.age;
    const newAge   = t.age - DAYS_BACK;
    return {
      ...t,
      age:         newAge,
      workDays:    Math.round(t.workDays    * ratio),
      blockedDays: Math.round(t.blockedDays * ratio),
      queueDays:   Math.round(t.queueDays   * ratio),
      flowEfficiency: newAge > 0
        ? Math.round(Math.round(t.workDays * ratio) / newAge * 100)
        : 0,
    };
  });

// ── 2. Buckets de idade ───────────────────────────────────────────────────────
const bucketOf = age =>
  age > 90 ? '90_plus' : age > 60 ? '61_90' : age > 30 ? '31_60' : '0_30';

const wipByBucket = { '0_30': [], '31_60': [], '61_90': [], '90_plus': [] };
janTasks.forEach(t => wipByBucket[bucketOf(t.age)].push(t));

// ── 3. Cenários ───────────────────────────────────────────────────────────────
const c1Tasks = janTasks.filter(t => t.scenario === 'C1');
const c2Tasks = janTasks.filter(t => t.scenario === 'C2');
const c3Tasks = janTasks.filter(t => t.scenario === 'C3');

const avgFlow = arr => {
  const valid = arr.filter(t => t.flowEfficiency !== null && t.flowEfficiency !== undefined);
  return valid.length ? Math.round(valid.reduce((s,t) => s + t.flowEfficiency, 0) / valid.length) : null;
};

// ── 4. Throughput mensal (remove fev/26) ─────────────────────────────────────
const janMonthly = cap.throughput.monthly.map(m =>
  m.month === '2026-02' ? { ...m, completed: 0, started: 0 } : m
);

// Avg mensal (últimas 6 não-migração): set, out, nov, dez, jan
const nonMig = janMonthly.filter(m => m.completed > 0 && m.completed <= 50);
const last6  = nonMig.slice(-6);
const avgMonthly = last6.length
  ? Math.round(last6.reduce((s,m) => s + m.completed, 0) / last6.length)
  : 0;

// ── 5. Indicadores de fluxo (avg_in / avg_out) ───────────────────────────────
// avg_out: média das saídas dos últimos 6 meses não-migração até jan
// avg_in:  média das entradas dos últimos 3 meses não-migração até jan
const last6Keys = last6.map(m => m.month);
const last3Keys = last6.slice(-3).map(m => m.month);
const avgOut = last6.length
  ? Math.round(last6.reduce((s,m) => s + m.completed, 0) / last6.length)
  : 1;
const avgIn = last3Keys.length
  ? Math.round(
      janMonthly
        .filter(m => last3Keys.includes(m.month))
        .reduce((s,m) => s + (m.started || 0), 0) / last3Keys.length
    )
  : 0;

const flowRatio  = avgOut > 0 ? Math.round((avgIn / avgOut) * 100) : 999;
const flowStatus = flowRatio <= 110 ? 'normal' : flowRatio <= 140 ? 'atenção' : 'crítico';

// ── 6. WIP limit e indicadores ────────────────────────────────────────────────
const WIP_LIMIT_MAX   = 22;
const WIP_LIMIT_IDEAL = 15;
const total      = janTasks.length;
const blocked    = janTasks.filter(t => t.isBlocked).length;
const ages       = janTasks.map(t => t.age).sort((a,b) => a-b);
const avgAge     = total ? Math.round(ages.reduce((s,v) => s+v, 0) / total) : 0;
const oldestAge  = ages[ages.length - 1] || 0;

const criticalCount   = wipByBucket['61_90'].length + wipByBucket['90_plus'].length;
const wipCriticalPct  = total ? Math.round(criticalCount / total * 100) : 0;
const wipCriticalStatus = wipCriticalPct < 20 ? 'normal' : wipCriticalPct < 35 ? 'atenção' : 'crítico';

const statusRank    = { normal: 0, atenção: 1, crítico: 2 };
const overallStatus = statusRank[flowStatus] >= statusRank[wipCriticalStatus]
  ? flowStatus : wipCriticalStatus;

// ── 7. ERP breakdown ─────────────────────────────────────────────────────────
const erpMap = {};
janTasks.forEach(t => {
  const e = t.erp || 'N/A';
  if (!erpMap[e]) erpMap[e] = { total: 0, blocked: 0, ages: [] };
  erpMap[e].total++;
  if (t.isBlocked) erpMap[e].blocked++;
  erpMap[e].ages.push(t.age);
});
const erpBreakdown = Object.entries(erpMap)
  .map(([erp, v]) => ({
    erp,
    total:   v.total,
    blocked: v.blocked,
    avgAge:  Math.round(v.ages.reduce((s,a) => s+a, 0) / v.ages.length),
  }))
  .sort((a,b) => b.total - a.total);

// ── 8. Monta o JSON final ─────────────────────────────────────────────────────
const snapshot = {
  generated_at: SNAPSHOT_AT,
  _snapshot_note: 'Snapshot retroativo de 31/jan/2026 — gerado a partir dos dados de 22/fev/2026',
  wip: {
    total:       total,
    blocked:     blocked,
    blocked_pct: total ? Math.round(blocked / total * 100) : 0,
    avg_age:     avgAge,
    oldest_age:  oldestAge,
    by_bucket: {
      '0_30':    wipByBucket['0_30'].length,
      '31_60':   wipByBucket['31_60'].length,
      '61_90':   wipByBucket['61_90'].length,
      '90_plus': wipByBucket['90_plus'].length,
    },
    tasks:           janTasks,
    tasks_by_bucket: wipByBucket,
  },
  throughput: {
    avg_monthly_completions: avgMonthly,
    avg_cycle_time_days:     cap.throughput.avg_cycle_time_days,
    median_cycle_time_days:  cap.throughput.median_cycle_time_days,
    total_completed:         cap.throughput.total_completed - 11, // remove as 11 de fev
    monthly:                 janMonthly,
  },
  tickets: cap.tickets,
  scenarios: {
    c1: { count: c1Tasks.length, label: 'Aguardando início',          tasks: c1Tasks },
    c2: { count: c2Tasks.length, label: 'Em integração — bloqueada',  tasks: c2Tasks, avg_flow_efficiency: avgFlow(c2Tasks) },
    c3: { count: c3Tasks.length, label: 'Em integração — ativa',      tasks: c3Tasks, avg_flow_efficiency: avgFlow(c3Tasks) },
  },
  wip_limit: {
    ideal:              WIP_LIMIT_IDEAL,
    max:                WIP_LIMIT_MAX,
    current:            total,
    over_by:            Math.max(0, total - WIP_LIMIT_MAX),
    current_vs_max_pct: Math.round(total / WIP_LIMIT_MAX * 100),
  },
  indicators: {
    flow: {
      avg_in:  avgIn,
      avg_out: avgOut,
      ratio:   flowRatio,
      status:  flowStatus,
    },
    wip_critical: {
      count:  criticalCount,
      total:  total,
      pct:    wipCriticalPct,
      status: wipCriticalStatus,
    },
    overall_status: overallStatus,
  },
  erp_breakdown:    erpBreakdown,
  phase_benchmarks: cap.phase_benchmarks,
};

writeFileSync('capacity-data-jan26.json', JSON.stringify(snapshot, null, 2));

console.log('Snapshot Jan/26 gerado!');
console.log('  WIP em 31/jan:', total, '(atual: ' + cap.wip.total + ')');
console.log('  Bloqueadas:',    blocked, '(atual: ' + cap.wip.blocked + ')');
console.log('  Críticas 61+d:', criticalCount);
console.log('  Avg mensal:',    avgMonthly, '(atual: ' + cap.throughput.avg_monthly_completions + ')');
console.log('  Arquivo:       capacity-data-jan26.json');
