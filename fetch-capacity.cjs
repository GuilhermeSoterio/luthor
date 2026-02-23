const https = require('https');
const fs    = require('fs');

const TOKEN       = 'pk_81923455_D3302HBP8J8RWE5X6PS9Q1NIBUU0ZBWW';
const INTEG_LIST  = '211110999';

const ACTIVE_STATUSES = [
  'backlog','contato/comunicação','todo/dados coletados',
  'progresso produto','produtos integrado','progresso pedido',
  'bloqueado pedido','bloqueado produto','revisão','aguardando cliente',
];
const BLOCKED_STATUSES = ['bloqueado produto','bloqueado pedido','aguardando cliente'];
const DONE_STATUS      = 'implantado';
const SKIP_STATUSES    = ['não vão iniciar'];

// Classificação dos 3 cenários
const WORK_STATUSES  = new Set(['progresso produto','produtos integrado','progresso pedido','revisão']);
const BLOCK_STATUSES = new Set(['bloqueado','bloqueado produto','bloqueado pedido','aguardando cliente']);
const QUEUE_STATUSES = new Set(['open','todo','backlog','contato/comunicação','todo/dados coletados','contato/comunicacao']);

// Mapeamento de status → fase (para previsibilidade)
const PHASE_LOOKUP = {};
[['fila',    ['open','todo','backlog','contato/comunicação','contato/comunicacao','todo/dados coletados','aguardando cliente']],
 ['produto', ['progresso produto','produtos integrado','bloqueado produto']],
 ['pedido',  ['progresso pedido','bloqueado pedido']],
 ['revisao', ['revisão','revisao']],
].forEach(([phase, sts]) => sts.forEach(st => { PHASE_LOOKUP[st] = phase; }));

async function fetchTimeInStatus(taskId) {
  try {
    const url = 'https://api.clickup.com/api/v2/task/' + taskId + '/time_in_status';
    const data = await fetchJSON(url);
    return {
      history: data.status_history || [],
      currentStatusDays: data.current_status?.total_time?.by_minute
        ? Math.round(data.current_status.total_time.by_minute / 1440)
        : null,
    };
  } catch(e) {
    return { history: [], currentStatusDays: null };
  }
}

function classifyTask(currentStatus, statusHistory) {
  // Calcula dias em cada grupo com base no histórico
  let workMin = 0, blockedMin = 0, queueMin = 0, otherMin = 0;
  const phaseMin = { fila: 0, produto: 0, pedido: 0, revisao: 0 };

  statusHistory.forEach(s => {
    const st = (s.status || '').toLowerCase().trim();
    const min = s.total_time?.by_minute || 0;
    if (WORK_STATUSES.has(st))       workMin    += min;
    else if (BLOCK_STATUSES.has(st)) blockedMin += min;
    else if (QUEUE_STATUSES.has(st)) queueMin   += min;
    else otherMin += min;
    const phase = PHASE_LOOKUP[st];
    if (phase) phaseMin[phase] += min;
  });

  const workDays    = Math.round(workMin    / 1440);
  const blockedDays = Math.round(blockedMin / 1440);
  const queueDays   = Math.round(queueMin   / 1440);
  const phaseDays   = {
    fila:    Math.round(phaseMin.fila    / 1440),
    produto: Math.round(phaseMin.produto / 1440),
    pedido:  Math.round(phaseMin.pedido  / 1440),
    revisao: Math.round(phaseMin.revisao / 1440),
  };

  // Eficiência de fluxo: só faz sentido em tarefas que já iniciaram trabalho real
  const flowEfficiency = (workDays + blockedDays) > 0
    ? Math.round(workDays / (workDays + blockedDays) * 100)
    : null;

  // Cenário
  const neverWorked = workDays === 0;
  const curSt = (currentStatus || '').toLowerCase();
  const currentlyBlocked = BLOCK_STATUSES.has(curSt);

  let scenario;
  if (neverWorked) {
    scenario = 'C1'; // nunca iniciou trabalho real
  } else if (currentlyBlocked) {
    scenario = 'C2'; // iniciou, mas está bloqueado agora
  } else {
    scenario = 'C3'; // iniciou e está ativo agora
  }

  return { scenario, workDays, blockedDays, queueDays, flowEfficiency, phaseDays };
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: TOKEN } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAll(listId) {
  let all = [];
  for (let page = 0; page < 20; page++) {
    const url = `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&subtasks=false&page=${page}&limit=100`;
    const data = await fetchJSON(url);
    const tasks = data.tasks || [];
    all = [...all, ...tasks];
    console.log(`  page ${page}: ${tasks.length} tasks`);
    if (tasks.length < 100) break;
    await sleep(300);
  }
  return all;
}

function monthKey(ts)   { return new Date(parseInt(ts)).toISOString().substring(0, 7); }
function monthLabel(key) {
  const [y, m] = key.split('-');
  const names = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${names[parseInt(m)-1]}/${String(y).slice(2)}`;
}

async function main() {
  console.log('Fetching all integration tasks...');
  const allTasks = await fetchAll(INTEG_LIST);
  console.log(`Total tasks: ${allTasks.length}`);

  const activeTasks  = allTasks.filter(t => ACTIVE_STATUSES.includes(t.status?.status));
  const doneTasks    = allTasks.filter(t => t.status?.status === DONE_STATUS && t.date_closed);
  const skippedTasks = allTasks.filter(t => SKIP_STATUSES.includes(t.status?.status));

  console.log(`Active: ${activeTasks.length} | Done: ${doneTasks.length} | Skipped: ${skippedTasks.length}`);

  // ── Throughput: entries (date_created) vs completions (date_closed) ──────────
  const monthlyData = {};
  const ensureMonth = key => {
    if (!monthlyData[key]) monthlyData[key] = { started: 0, completed: 0, tasks_started: [], tasks_completed: [] };
  };

  // All non-skipped tasks → started
  [...activeTasks, ...doneTasks].forEach(t => {
    const key = monthKey(t.date_created);
    ensureMonth(key);
    monthlyData[key].started++;
    monthlyData[key].tasks_started.push(t.name);
  });

  // Done tasks → completed (by close date)
  doneTasks.forEach(t => {
    const key = monthKey(t.date_closed);
    ensureMonth(key);
    monthlyData[key].completed++;
    monthlyData[key].tasks_completed.push(t.name);
  });

  // Sort keys and trim to last 12 months
  const allKeys  = Object.keys(monthlyData).sort();
  const now      = new Date();
  const cutoff   = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().substring(0, 7);
  const recentKeys = allKeys.filter(k => k >= cutoff);

  const throughputMonthly = recentKeys.map(k => ({
    month:     k,
    label:     monthLabel(k),
    started:   monthlyData[k].started,
    completed: monthlyData[k].completed,
    net:       monthlyData[k].completed - monthlyData[k].started,
  }));

  // ── WIP age + time_in_status para os 3 cenários ──────────────────────────────
  console.log('\nBuscando time_in_status para ' + activeTasks.length + ' tasks ativas...');
  const now_ms = Date.now();
  const wipTasks = [];
  for (let i = 0; i < activeTasks.length; i++) {
    const t   = activeTasks[i];
    const age = Math.round((now_ms - parseInt(t.date_created)) / 86400000);
    const upd = Math.round((now_ms - parseInt(t.date_updated || t.date_created)) / 86400000);
    const st  = t.status?.status || 'unknown';
    const erp = (t.tags || []).map(g => g.name).find(n => n.toLowerCase().includes('erp'))
                  ?.replace(/^:?erp[:\s]*/i,'').trim() || null;

    const { history, currentStatusDays } = await fetchTimeInStatus(t.id);
    const classify = classifyTask(st, history);

    wipTasks.push({
      id:               t.id,
      name:             t.name.replace(/\[INTEGRACAO\]\s*/i,'').replace(/\[MIGRAÇÃO.*?\]/gi,'').replace(/\(Migração.*?\)/gi,'').trim(),
      status:           st,
      isBlocked:        BLOCKED_STATUSES.includes(st),
      age,
      daysSinceUpdated: upd,
      currentStatusDays,
      erp,
      url:              'https://app.clickup.com/t/' + t.id,
      scenario:         classify.scenario,
      workDays:         classify.workDays,
      blockedDays:      classify.blockedDays,
      queueDays:        classify.queueDays,
      flowEfficiency:   classify.flowEfficiency,
      phaseDays:        classify.phaseDays,
    });

    if ((i + 1) % 10 === 0) console.log('  ' + (i+1) + '/' + activeTasks.length + ' concluídas');
    await sleep(150);
  }
  wipTasks.sort((a, b) => b.age - a.age);

  const bucket = age =>
    age <= 30 ? '0_30' :
    age <= 60 ? '31_60' :
    age <= 90 ? '61_90' : '90_plus';

  const wipByBucket = { '0_30': [], '31_60': [], '61_90': [], '90_plus': [] };
  wipTasks.forEach(t => wipByBucket[bucket(t.age)].push(t));

  const blocked     = wipTasks.filter(t => t.isBlocked).length;
  const ages        = wipTasks.map(t => t.age);
  const avgAge      = ages.length ? Math.round(ages.reduce((s,a) => s+a, 0) / ages.length) : 0;
  const oldestAge   = ages.length ? Math.max(...ages) : 0;

  // ── Avg cycle time (done tasks, last 6 months) ────────────────────────────────
  const sixMonthsAgo = Date.now() - 180 * 86400000;
  const recentDone   = doneTasks.filter(t => parseInt(t.date_closed) >= sixMonthsAgo);
  const cycleTimes   = recentDone
    .filter(t => t.date_created && t.date_closed)
    .map(t => Math.round((parseInt(t.date_closed) - parseInt(t.date_created)) / 86400000));
  const avgCycleTime = cycleTimes.length
    ? Math.round(cycleTimes.reduce((s,v) => s+v, 0) / cycleTimes.length) : null;
  const medianCycleTime = cycleTimes.length
    ? cycleTimes.sort((a,b)=>a-b)[Math.floor(cycleTimes.length/2)] : null;

  // ── Throughput avg (completions per month, last 6 months) ────────────────────
  const sixMonthKeys = recentKeys.slice(-6);
  const completedLast6 = sixMonthKeys.reduce((s, k) => s + (monthlyData[k]?.completed || 0), 0);
  const avgMonthlyCompletions = Math.round(completedLast6 / Math.max(sixMonthKeys.length, 1));

  // ── Solicitações monthly (from file) — filtrado pela equipe de integrações ──
  const INTEG_TEAM = new Set([81923455, 61029153, 100155071, 82067446, 112072857]);
  const solRaw = JSON.parse(fs.readFileSync('C:/Users/guilh/projetos/clickup-activity-mcp/solicitacoes-data.json'));
  const solByMonth = {};
  let solTotal = 0, solFiltered = 0;
  solRaw.tasks.forEach(t => {
    solTotal++;
    if (!t.date_created) return;
    const assignees = t.assignees || [];
    const isIntegTeam = assignees.some(a => INTEG_TEAM.has(Number(a.id)));
    if (!isIntegTeam) return;
    solFiltered++;
    const k = monthKey(t.date_created);
    solByMonth[k] = (solByMonth[k] || 0) + 1;
  });
  console.log('Solicitacoes: ' + solTotal + ' total, ' + solFiltered + ' da equipe de integracoes');

  const ticketsMonthly = recentKeys.map(k => ({
    month: k,
    label: monthLabel(k),
    total: solByMonth[k] || 0,
  }));

  // ── Cenários WIP ─────────────────────────────────────────────────────────────
  const c1Tasks = wipTasks.filter(t => t.scenario === 'C1');
  const c2Tasks = wipTasks.filter(t => t.scenario === 'C2');
  const c3Tasks = wipTasks.filter(t => t.scenario === 'C3');

  const avgFlowC2 = c2Tasks.length
    ? Math.round(c2Tasks.filter(t => t.flowEfficiency !== null).reduce((s,t) => s + t.flowEfficiency, 0) / c2Tasks.filter(t => t.flowEfficiency !== null).length)
    : null;
  const avgFlowC3 = c3Tasks.length
    ? Math.round(c3Tasks.filter(t => t.flowEfficiency !== null).reduce((s,t) => s + t.flowEfficiency, 0) / c3Tasks.filter(t => t.flowEfficiency !== null).length)
    : null;

  // ── Indicador 1: Ratio de fluxo (entradas ÷ saídas) ─────────────────────────
  // avgIn:  média das entradas dos últimos 3 meses (excluindo migração)
  // avgOut: média das saídas dos últimos 6 meses   (excluindo migração)
  const nonMigrationKeys = recentKeys.filter(k => (monthlyData[k]?.completed || 0) <= 50);
  const last3Keys = nonMigrationKeys.slice(-3);
  const last6Keys = nonMigrationKeys.slice(-6);
  const avgIn  = last3Keys.length
    ? Math.round(last3Keys.reduce((s,k) => s + (monthlyData[k]?.started   || 0), 0) / last3Keys.length)
    : 0;
  const avgOut = last6Keys.length
    ? Math.round(last6Keys.reduce((s,k) => s + (monthlyData[k]?.completed || 0), 0) / last6Keys.length)
    : 1;
  const flowRatio = avgOut > 0 ? Math.round((avgIn / avgOut) * 100) : 999;
  const flowStatus =
    flowRatio <= 110 ? 'normal' :
    flowRatio <= 140 ? 'atenção' : 'crítico';

  // ── Limite saudável de WIP (baseado em Little's Law + histórico) ────────────
  // Throughput 11/mês × ciclo alvo 60d = 22 (limite máximo)
  // Throughput 11/mês × ciclo alvo 42d = 15 (limite ideal)
  const WIP_LIMIT_MAX   = 22; // acima disso o ciclo começa a represar
  const WIP_LIMIT_IDEAL = 15; // mantém o ciclo mediano histórico de 42d
  const wipOverLimit    = Math.max(0, wipTasks.length - WIP_LIMIT_MAX);
  const wipOverLimitPct = Math.round(wipTasks.length / WIP_LIMIT_MAX * 100);

  // ── Indicador 2: % WIP crítico (61+ dias) ────────────────────────────────────
  const criticalCount = wipByBucket['61_90'].length + wipByBucket['90_plus'].length;
  const wipCriticalPct = wipTasks.length
    ? Math.round(criticalCount / wipTasks.length * 100) : 0;
  const wipCriticalStatus =
    wipCriticalPct < 20 ? 'normal' :
    wipCriticalPct < 35 ? 'atenção' : 'crítico';

  // Status geral = pior dos dois
  const statusRank = { normal: 0, atenção: 1, crítico: 2 };
  const overallStatus = statusRank[flowStatus] >= statusRank[wipCriticalStatus]
    ? flowStatus : wipCriticalStatus;

  // ── Phase benchmarks (tempo médio por fase) ──────────────────────────────────
  // Usa apenas tasks que já PASSARAM por cada fase (estão em fase posterior)
  // para não contaminar a média com tasks ainda em andamento naquela fase.
  const PHASE_ORDER = ['fila','produto','pedido','revisao'];
  const avg = (arr) => arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : null;

  const pastPhase = (phase) => {
    const idx = PHASE_ORDER.indexOf(phase);
    return wipTasks.filter(t => PHASE_ORDER.slice(idx+1).some(p => t.phaseDays[p] > 0));
  };

  const phaseBenchmarks = {
    fila:    avg(pastPhase('fila').map(t => t.phaseDays.fila)),
    produto: avg(pastPhase('produto').map(t => t.phaseDays.produto)),
    pedido:  avg(pastPhase('pedido').map(t => t.phaseDays.pedido)),
    revisao: avg(wipTasks.filter(t => t.status === 'revisão').map(t => t.currentStatusDays || 0)),
    // fallbacks se não tiver dados suficientes
  };
  // Fallbacks baseados em dados históricos do time
  if (!phaseBenchmarks.fila)    phaseBenchmarks.fila    = 28;
  if (!phaseBenchmarks.produto) phaseBenchmarks.produto = 18;
  if (!phaseBenchmarks.pedido)  phaseBenchmarks.pedido  = 15;
  if (!phaseBenchmarks.revisao) phaseBenchmarks.revisao = 14;

  console.log('\nBenchmarks por fase:');
  console.log('  Fila:    ' + phaseBenchmarks.fila    + 'd (n=' + pastPhase('fila').length + ')');
  console.log('  Produto: ' + phaseBenchmarks.produto + 'd (n=' + pastPhase('produto').length + ')');
  console.log('  Pedido:  ' + phaseBenchmarks.pedido  + 'd (n=' + pastPhase('pedido').length + ')');
  console.log('  Revisão: ' + phaseBenchmarks.revisao + 'd (n=' + wipTasks.filter(t=>t.status==='revisão').length + ')');

  // ── ERP breakdown of active WIP ──────────────────────────────────────────────
  const erpWip = {};
  wipTasks.forEach(t => {
    const e = t.erp || 'N/A';
    if (!erpWip[e]) erpWip[e] = { total: 0, blocked: 0, ages: [] };
    erpWip[e].total++;
    if (t.isBlocked) erpWip[e].blocked++;
    erpWip[e].ages.push(t.age);
  });
  const erpBreakdown = Object.entries(erpWip)
    .map(([erp, v]) => ({
      erp,
      total:   v.total,
      blocked: v.blocked,
      avgAge:  Math.round(v.ages.reduce((s,a)=>s+a,0)/v.ages.length),
    }))
    .sort((a, b) => b.total - a.total);

  // ── Output ────────────────────────────────────────────────────────────────────
  const output = {
    generated_at: new Date().toISOString(),
    wip: {
      total:          wipTasks.length,
      blocked:        blocked,
      blocked_pct:    wipTasks.length ? Math.round(blocked / wipTasks.length * 100) : 0,
      avg_age:        avgAge,
      oldest_age:     oldestAge,
      by_bucket: {
        '0_30':    wipByBucket['0_30'].length,
        '31_60':   wipByBucket['31_60'].length,
        '61_90':   wipByBucket['61_90'].length,
        '90_plus': wipByBucket['90_plus'].length,
      },
      tasks:          wipTasks,
      tasks_by_bucket: wipByBucket,
    },
    throughput: {
      avg_monthly_completions: avgMonthlyCompletions,
      avg_cycle_time_days:     avgCycleTime,
      median_cycle_time_days:  medianCycleTime,
      total_completed:         doneTasks.length,
      monthly:                 throughputMonthly,
    },
    tickets: {
      monthly: ticketsMonthly,
    },
    scenarios: {
      c1: { count: c1Tasks.length, label: 'Aguardando início',         tasks: c1Tasks },
      c2: { count: c2Tasks.length, label: 'Em integração — bloqueada', tasks: c2Tasks, avg_flow_efficiency: avgFlowC2 },
      c3: { count: c3Tasks.length, label: 'Em integração — ativa',     tasks: c3Tasks, avg_flow_efficiency: avgFlowC3 },
    },
    wip_limit: {
      ideal:         WIP_LIMIT_IDEAL,
      max:           WIP_LIMIT_MAX,
      current:       wipTasks.length,
      over_by:       wipOverLimit,
      current_vs_max_pct: wipOverLimitPct,
    },
    indicators: {
      flow: {
        avg_in:    avgIn,
        avg_out:   avgOut,
        ratio:     flowRatio,
        status:    flowStatus,
      },
      wip_critical: {
        count:   criticalCount,
        total:   wipTasks.length,
        pct:     wipCriticalPct,
        status:  wipCriticalStatus,
      },
      overall_status: overallStatus,
    },
    erp_breakdown:    erpBreakdown,
    phase_benchmarks: phaseBenchmarks,
  };

  fs.writeFileSync(
    'C:/Users/guilh/projetos/clickup-activity-mcp/capacity-data.json',
    JSON.stringify(output, null, 2)
  );

  console.log('\n=== Capacity Summary ===');
  console.log(`WIP: ${wipTasks.length} integrações ativas`);
  console.log(`  0-30d: ${wipByBucket['0_30'].length} | 31-60d: ${wipByBucket['31_60'].length} | 61-90d: ${wipByBucket['61_90'].length} | 90+d: ${wipByBucket['90_plus'].length}`);
  console.log(`  Bloqueadas: ${blocked} (${Math.round(blocked/wipTasks.length*100)}%)`);
  console.log(`  Idade média: ${avgAge}d | Mais antiga: ${oldestAge}d`);
  console.log(`Throughput (últ. 6 meses): ${avgMonthlyCompletions} concluídas/mês`);
  console.log(`Tempo médio de ciclo: ${avgCycleTime}d (mediana: ${medianCycleTime}d)`);
  console.log('\nCenários WIP:');
  console.log('  C1 (aguardando inicio): ' + c1Tasks.length);
  console.log('  C2 (em integracao, bloqueada): ' + c2Tasks.length + (avgFlowC2 !== null ? ' | flow efficiency media: ' + avgFlowC2 + '%' : ''));
  console.log('  C3 (em integracao, ativa): ' + c3Tasks.length + (avgFlowC3 !== null ? ' | flow efficiency media: ' + avgFlowC3 + '%' : ''));
  console.log('Ratio de fluxo: ' + avgIn + ' entradas / ' + avgOut + ' saidas = ' + flowRatio + '% -> ' + flowStatus.toUpperCase());
  console.log('WIP critico (61+d): ' + criticalCount + '/' + wipTasks.length + ' = ' + wipCriticalPct + '% -> ' + wipCriticalStatus.toUpperCase());
  console.log('Status geral: ' + overallStatus.toUpperCase());
  console.log('\nSalvo em capacity-data.json');
}

main().catch(console.error);
