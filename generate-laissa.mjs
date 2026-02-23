import { readFileSync, writeFileSync } from 'fs';

const imp = JSON.parse(readFileSync('implantadores-data.json', 'utf8'));
const cap = JSON.parse(readFileSync('capacity-data.json', 'utf8'));

// ── Match integration task by name ────────────────────────────────────────────
function findCapMatch(impName) {
  const clean = impName.replace(/^\[INTEGRACAO\]\s*/i, '').trim().toLowerCase();
  return cap.wip.tasks.find(t => clean.startsWith(t.name.toLowerCase().trim()))
      || cap.wip.tasks.find(t => t.name.toLowerCase().trim().startsWith(clean.substring(0, 20)))
      || null;
}

// ── Status classification ─────────────────────────────────────────────────────
const WAITING_STATUSES  = new Set(['backlog','contato/comunicação','contato/comunicacao','todo/dados coletados','todo','open']);
const PROGRESS_STATUSES = new Set(['progresso produto','produtos integrado','progresso pedido','revisão']);
const BLOCKED_STATUSES  = new Set(['bloqueado pedido','bloqueado produto','aguardando cliente','bloqueado']);

// ── Urgency logic ─────────────────────────────────────────────────────────────
function getUrgency(status, currentStatusDays) {
  const st   = (status || '').toLowerCase().trim();
  const days = currentStatusDays ?? 0;

  if (WAITING_STATUSES.has(st)) {
    return {
      level:   'action',
      color:   '#3b82f6',
      bgColor: '#3b82f615',
      border:  '#3b82f640',
      label:   '📋 Ação necessária',
      message: 'Essa loja ainda não foi iniciada. Tente coletar os dados necessários para integração, registre uma justificativa para o atraso, ou busque desbloqueá-la.',
    };
  }

  if (PROGRESS_STATUSES.has(st)) {
    if (days >= 20) {
      return {
        level:   'critical',
        color:   '#ef4444',
        bgColor: '#ef444415',
        border:  '#ef444440',
        label:   `🔴 Intervenha agora — ${days}d parada`,
        message: `Essa integração está em "${status}" há ${days} dias sem avançar. Cobre o integrador imediatamente e entenda o que está travando. Não espere mais.`,
      };
    }
    if (days >= 10) {
      return {
        level:   'warning',
        color:   '#f59e0b',
        bgColor: '#f59e0b15',
        border:  '#f59e0b40',
        label:   `⚠ Verificar — ${days}d em progresso`,
        message: `Está em "${status}" há ${days} dias. Verifique com o integrador o que está acontecendo — se vai demorar mais ou se há algo que você pode ajudar.`,
      };
    }
    return {
      level:   'normal',
      color:   '#10b981',
      bgColor: null,
      border:  null,
      label:   null,
      message: `Em andamento há ${days} dias. Tudo dentro do esperado.`,
    };
  }

  if (BLOCKED_STATUSES.has(st)) {
    return {
      level:   'blocked',
      color:   '#f97316',
      bgColor: '#f9741615',
      border:  '#f9741640',
      label:   '⚑ Acompanhar bloqueio',
      message: 'Parada por fator externo. Verifique se há algo que você pode fazer para ajudar a destravar — como contato direto com o lojista.',
    };
  }

  return { level: 'normal', color: '#64748b', bgColor: null, border: null, label: null, message: '' };
}

// ── Laissa's tasks, enriched ──────────────────────────────────────────────────
const laissaTasks = imp.tasks
  .filter(t => t.implantador === 'Laissa')
  .map(t => {
    const c = findCapMatch(t.name);
    // Use integration task status (cap) as source of truth for urgency;
    // fall back to father task status (imp) if no match
    const integStatus       = c?.status ?? t.status;
    // currentStatusDays: prefer API value, fallback to daysSinceUpdated
    const currentStatusDays = (c?.currentStatusDays != null && c.currentStatusDays > 0)
      ? c.currentStatusDays
      : (c?.daysSinceUpdated ?? t.daysSinceUpdated ?? null);
    const urgency = getUrgency(integStatus, currentStatusDays);
    return {
      ...t,
      displayName:       t.name.replace(/^\[INTEGRACAO\]\s*/i, '').replace(/\s*\[MIGRAÇÃO[^\]]*\]/gi, '').trim(),
      isMigracao:        t.name.toLowerCase().includes('migração'),
      status:            integStatus,
      scenario:          c?.scenario        || 'C1',
      workDays:          c?.workDays        || 0,
      blockedDays:       c?.blockedDays     || 0,
      queueDays:         c?.queueDays       || 0,
      flowEfficiency:    c?.flowEfficiency  ?? null,
      currentStatusDays,
      urgency,
      clickupUrl:        c ? `https://app.clickup.com/t/${c.id}` : t.url,
    };
  })
  // Sort: critical first → warning → action → blocked → normal
  .sort((a, b) => {
    const order = { critical: 0, warning: 1, action: 2, blocked: 3, normal: 4 };
    const diff = order[a.urgency.level] - order[b.urgency.level];
    return diff !== 0 ? diff : b.daysSinceCreated - a.daysSinceCreated;
  });

// ── "Chegando em breve": C3 in revisão / progresso pedido (not Laissa's) ──────
const comingSoon = cap.wip.tasks
  .filter(t => t.scenario === 'C3' && ['revisão','progresso pedido','produtos integrado'].includes(t.status))
  .filter(t => !laissaTasks.find(l => findCapMatch(l.name)?.name === t.name))
  .sort((a, b) => b.age - a.age)
  .slice(0, 5);

// ── Status colors ──────────────────────────────────────────────────────────────
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

const SCENARIO_LABEL = { C1: 'Aguardando início', C2: 'Em integração — bloqueada', C3: 'Em integração — ativa' };
const SCENARIO_COLOR = { C1: '#64748b', C2: '#f97316', C3: '#3b82f6' };

// ── Alert tasks ────────────────────────────────────────────────────────────────
// Vermelho: bloqueadas agora ou críticas
const blockedAlerts = laissaTasks.filter(t => t.urgency.level === 'blocked' || t.urgency.level === 'critical');
// Âmbar: historicamente bloqueadas pelo lojista por 10+ dias, mas hoje ativas
const historyAlerts = laissaTasks.filter(t =>
  t.blockedDays >= 10 &&
  t.urgency.level !== 'blocked' &&
  t.urgency.level !== 'critical'
);

// ── Team comparison ────────────────────────────────────────────────────────────
function buildImplStats(name) {
  const tasks = imp.tasks.filter(t => t.implantador === name).map(t => {
    const c = findCapMatch(t.name);
    return { ...t, blockedDays: c?.blockedDays || 0 };
  });
  const blocked   = tasks.filter(t => t.isBlocked).length;
  const blockedPct = tasks.length ? Math.round(blocked / tasks.length * 100) : 0;
  const avgAge    = tasks.length ? Math.round(tasks.reduce((s,t) => s + t.daysSinceCreated, 0) / tasks.length) : 0;
  const critical  = tasks.filter(t => t.daysSinceCreated > 60).length;
  return { name, total: tasks.length, blocked, blockedPct, avgAge, critical };
}
const teamStats = ['Derik','Ana Débora','Laissa'].map(buildImplStats);
const laissaStats = teamStats.find(s => s.name === 'Laissa');

// ── Summary counts ─────────────────────────────────────────────────────────────
const totalActive   = laissaTasks.length;
const totalCritical = laissaTasks.filter(t => t.urgency.level === 'critical').length;
const totalWarning  = laissaTasks.filter(t => t.urgency.level === 'warning').length;
const totalAction   = laissaTasks.filter(t => t.urgency.level === 'action').length;
const totalNeeded   = laissaTasks.filter(t => t.urgency.level !== 'normal').length;
const oldest        = [...laissaTasks].sort((a, b) => b.daysSinceCreated - a.daysSinceCreated)[0];

const now = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

// ── Predictability data ────────────────────────────────────────────────────────
const benchmarks = cap.phase_benchmarks;

const PHASE_ORDER  = ['fila', 'produto', 'pedido', 'revisao'];
const PHASE_LABELS = { fila: 'Aguardando / Fila', produto: 'Integração de Produtos', pedido: 'Integração de Pedidos', revisao: 'Revisão / Teste' };
const PHASE_COLORS = { fila: '#64748b', produto: '#06b6d4', pedido: '#f59e0b', revisao: '#a855f7' };
const PHASE_ICONS  = { fila: '⏸', produto: '📦', pedido: '🛒', revisao: '🔍' };

function getCurrentPhase(status) {
  const st = (status || '').toLowerCase().trim();
  if (['backlog','contato/comunicação','contato/comunicacao','todo/dados coletados','aguardando cliente','open','todo'].includes(st)) return 'fila';
  if (['progresso produto','produtos integrado','bloqueado produto'].includes(st)) return 'produto';
  if (['progresso pedido','bloqueado pedido'].includes(st)) return 'pedido';
  if (['revisão','revisao'].includes(st)) return 'revisao';
  return null;
}

// Dentro da fase fila, cada status indica um avanço diferente
// (quanto da fila já foi "consumido" pelo fato de estar nesse status)
const FILA_STATUS_ADVANCE = {
  'todo/dados coletados': 0.75, // dados prontos, quase saindo da fila
  'aguardando cliente':   0.50, // aguardando, mas já tem contato
  'contato/comunicação':  0.30, // contato feito
  'backlog':              0.00, // ainda não iniciou
};

function estimateRemaining(task) {
  const pd    = task.phaseDays || {};
  const phase = getCurrentPhase(task.status);
  if (!phase) return null;
  const currentIdx = PHASE_ORDER.indexOf(phase);
  let days = 0;
  PHASE_ORDER.forEach((p, i) => {
    if (i < currentIdx) return; // fase já concluída
    const bench = benchmarks[p];
    if (i === currentIdx) {
      const actualSpent = (pd[p] || 0) + (task.currentStatusDays || 0);
      let spent = actualSpent;
      // Na fase fila: usar avanço mínimo por status para refletir proximidade real
      if (p === 'fila') {
        const st = (task.status || '').toLowerCase().trim();
        const advance = FILA_STATUS_ADVANCE[st] ?? 0;
        const minSpent = Math.round(bench * advance);
        spent = Math.max(actualSpent, minSpent);
      }
      days += Math.max(3, bench - spent);
    } else {
      days += bench; // fases futuras: tempo completo do benchmark
    }
  });
  return days;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

// Agrupar tasks da Laissa por fase atual
const tasksByPhase = { fila: [], produto: [], pedido: [], revisao: [] };
laissaTasks.forEach(t => {
  const phase = getCurrentPhase(t.status);
  if (phase && tasksByPhase[phase]) {
    tasksByPhase[phase].push({ ...t, daysToComplete: estimateRemaining(t) });
  }
});

// Pontuação de avanço no pipeline (desempate quando estimativa é igual)
const STATUS_PROGRESS = {
  'revisão': 8, 'progresso pedido': 7, 'bloqueado pedido': 6,
  'produtos integrado': 5, 'progresso produto': 4, 'bloqueado produto': 3,
  'todo/dados coletados': 2, 'aguardando cliente': 1,
  'contato/comunicação': 0, 'backlog': -1,
};

// Lista plana ordenada por menor estimativa de entrega; desempate por status mais avançado
const tasksForPrevisao = PHASE_ORDER.flatMap(p => tasksByPhase[p])
  .sort((a, b) => {
    const dtcDiff = (a.daysToComplete ?? 999) - (b.daysToComplete ?? 999);
    if (dtcDiff !== 0) return dtcDiff;
    const pa = STATUS_PROGRESS[a.status] ?? 0;
    const pb = STATUS_PROGRESS[b.status] ?? 0;
    return pb - pa; // mais avançado primeiro
  });

// ERP benchmark detalhado — tempo médio por fase por ERP
const erpMap = {};
cap.wip.tasks.filter(t => t.erp).forEach(t => {
  if (!erpMap[t.erp]) erpMap[t.erp] = { ages: [], workDays: [], phaseProduto: [], phasePedido: [] };
  erpMap[t.erp].ages.push(t.age);
  if (t.workDays > 0) erpMap[t.erp].workDays.push(t.workDays);
  if ((t.phaseDays?.produto || 0) > 0) erpMap[t.erp].phaseProduto.push(t.phaseDays.produto);
  if ((t.phaseDays?.pedido  || 0) > 0) erpMap[t.erp].phasePedido.push(t.phaseDays.pedido);
});

const avg = arr => arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : null;

const erpBenchmark = Object.entries(erpMap)
  .map(([erp, d]) => ({
    erp,
    count:       d.ages.length,
    avgAge:      avg(d.ages),
    avgWorkDays: avg(d.workDays),
    avgProduto:  avg(d.phaseProduto),
    avgPedido:   avg(d.phasePedido),
  }))
  .filter(e => e.count >= 1)
  .sort((a, b) => b.avgAge - a.avgAge);

// ERPs presentes nas lojas da Laissa
const laissaErps = new Set(laissaTasks.map(t => t.erp).filter(Boolean));

// ── Checklist items ────────────────────────────────────────────────────────────
const checklist = [
  { id: 'c1', text: 'Confirmar contato principal do lojista (nome, WhatsApp, e-mail)' },
  { id: 'c2', text: 'Verificar se o lojista tem acesso ao painel administrativo' },
  { id: 'c3', text: 'Confirmar ERP e versão em uso' },
  { id: 'c4', text: 'Entender o catálogo: produtos, categorias, variações' },
  { id: 'c5', text: 'Verificar se há promoções ou regras de preço especiais' },
  { id: 'c6', text: 'Checar se o lojista já tem experiência com marketplace' },
  { id: 'c7', text: 'Registrar observações importantes no card da loja' },
];

// ── Embed photo ───────────────────────────────────────────────────────────────
const laissaPhotoB64 = 'data:image/png;base64,' + readFileSync('laissa.png').toString('base64');

// ── HTML ───────────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Painel Laissa — Implantação</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f172a;color:#f1f5f9;font-family:'Inter',system-ui,sans-serif;font-size:14px;min-height:100vh}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:#1e293b}
  ::-webkit-scrollbar-thumb{background:#475569;border-radius:3px}

  .page{max-width:860px;margin:0 auto;padding:24px 20px}

  /* Header */
  .hdr{display:flex;align-items:center;gap:14px;margin-bottom:24px}
  .avatar{width:46px;height:46px;border-radius:50%;flex-shrink:0;box-shadow:0 0 0 3px #10b98133;object-fit:cover;display:block}
  .hdr-text h1{font-size:21px;font-weight:800;letter-spacing:-.4px}
  .hdr-text p{color:#64748b;font-size:12px;margin-top:3px}

  /* KPIs */
  .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  .kpi{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px 16px;position:relative;overflow:hidden}
  .kpi-accent{position:absolute;top:0;left:0;width:3px;height:100%;border-radius:12px 0 0 12px}
  .kpi-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:6px}
  .kpi-value{font-size:28px;font-weight:800;letter-spacing:-1px;line-height:1}
  .kpi-sub{font-size:11px;color:#64748b;margin-top:4px}

  /* Tabs */
  .tabs{display:flex;gap:4px;margin-bottom:22px;background:#1e293b;border-radius:10px;padding:4px}
  .tab-btn{flex:1;padding:8px 14px;border-radius:7px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s;color:#64748b;background:transparent;font-family:inherit}
  .tab-btn.active{background:#0f172a;color:#f1f5f9;box-shadow:0 1px 4px rgba(0,0,0,.4)}
  .tab-pane{display:none}
  .tab-pane.active{display:block}

  /* Timeline */
  .timeline{display:flex;flex-direction:column;gap:8px}
  .tl-item{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:13px 16px;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center}
  .tl-dot{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0}
  .tl-name{font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:3px}
  .tl-meta{font-size:11px;color:#64748b}
  .tl-date{text-align:right;flex-shrink:0}
  .tl-days{font-size:20px;font-weight:800;letter-spacing:-1px;line-height:1}
  .tl-days-label{font-size:9px;color:#64748b;text-transform:uppercase;font-weight:600}
  .tl-date-str{font-size:11px;color:#475569;margin-top:3px}

  /* Queue table */
  .queue-list{display:flex;flex-direction:column;gap:6px}
  .queue-item{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px}
  .queue-pos{width:24px;height:24px;border-radius:50%;background:#0f172a;color:#475569;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .queue-name{flex:1;font-size:12px;font-weight:600;color:#cbd5e1}
  .queue-est{font-size:11px;color:#64748b;text-align:right;flex-shrink:0}

  /* ERP bars */
  .erp-list{display:flex;flex-direction:column;gap:6px}
  .erp-row{display:flex;align-items:center;gap:10px}
  .erp-name{width:100px;font-size:11px;color:#94a3b8;flex-shrink:0}
  .erp-bar-wrap{flex:1;background:#0f172a;border-radius:3px;height:20px;overflow:hidden}
  .erp-bar{height:100%;border-radius:3px;background:#334155;display:flex;align-items:center;padding-left:8px;font-size:10px;font-weight:700;color:#94a3b8;min-width:30px}
  .erp-val{width:35px;text-align:right;font-size:12px;font-weight:700;color:#64748b;flex-shrink:0}

  /* Insight box */
  .insight{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px 16px;margin-bottom:10px}
  .insight-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#475569;margin-bottom:6px}
  .insight-text{font-size:12px;color:#94a3b8;line-height:1.7}
  .insight-text strong{color:#f1f5f9}

  /* Alert banner */
  .alert-banner{background:#ef444412;border:1px solid #ef444450;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px}
  .alert-banner+.alert-banner{margin-top:-8px}
  .alert-flag{font-size:20px;flex-shrink:0;margin-top:1px}
  .alert-content{flex:1}
  .alert-title{font-size:13px;font-weight:700;color:#fca5a5;margin-bottom:2px}
  .alert-desc{font-size:12px;color:#f87171;line-height:1.5;opacity:.85}
  .alert-banner.amber{background:#f59e0b12;border-color:#f59e0b50}
  .alert-banner.amber .alert-title{color:#fcd34d}
  .alert-banner.amber .alert-desc{color:#fbbf24}
  .alert-banner.amber a{color:#fbbf24;border-color:#f59e0b40;background:#f59e0b15}

  /* Section title */
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin-bottom:10px;margin-top:22px;display:flex;align-items:center;gap:8px}

  /* Loja cards */
  .loja-list{display:flex;flex-direction:column;gap:10px}
  .loja-card{background:#1e293b;border-radius:12px;padding:0;overflow:hidden;transition:border-color .15s}

  /* Urgency top bar */
  .urgency-bar{padding:8px 16px;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700}

  /* Card body */
  .card-body{padding:14px 16px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start}
  .loja-name{font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:6px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
  .loja-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}
  .urgency-msg{font-size:12px;line-height:1.6;margin-top:6px;padding:8px 10px;border-radius:7px}

  /* Phase pills */
  .phase-row{display:flex;gap:5px;margin-top:8px;flex-wrap:wrap}
  .phase-pill{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600}

  /* Badge */
  .badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap}

  /* Right side */
  .loja-right{text-align:right;flex-shrink:0;padding-top:2px}
  .loja-days{font-size:26px;font-weight:800;letter-spacing:-1px;line-height:1}
  .loja-days-label{font-size:10px;color:#475569;margin-top:2px}
  .status-days{font-size:11px;margin-top:6px;padding:4px 8px;border-radius:6px;text-align:center;font-weight:700}
  .card-link{display:inline-block;margin-top:8px;font-size:10px;color:#3b82f6;text-decoration:none;border:1px solid #3b82f644;border-radius:6px;padding:3px 8px;background:#3b82f610}

  /* Coming soon */
  .coming-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
  .coming-card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px;border-top:3px solid #3b82f6}
  .coming-name{font-size:12px;font-weight:700;color:#f1f5f9;margin-bottom:5px}
  .coming-meta{font-size:11px;color:#64748b}

  /* Checklist */
  .checklist{display:flex;flex-direction:column;gap:6px}
  .check-item{display:flex;align-items:center;gap:10px;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;cursor:pointer;transition:border-color .15s,background .15s;user-select:none}
  .check-item:hover{border-color:#475569}
  .check-item.done{background:#10b98110;border-color:#10b98135}
  .check-item.done .check-text{color:#475569;text-decoration:line-through}
  .check-box{width:18px;height:18px;border-radius:5px;border:2px solid #334155;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;transition:all .15s;background:#0f172a;color:transparent}
  .check-item.done .check-box{background:#10b981;border-color:#10b981;color:#fff}
  .check-text{font-size:12px;color:#cbd5e1;line-height:1.4;flex:1}

  /* Ranking */
  .rank-card{background:linear-gradient(135deg,#0f2318 0%,#1e293b 60%);border:1px solid #10b98140;border-radius:14px;padding:20px;margin-bottom:0;position:relative;overflow:hidden}
  .rank-card::before{content:'';position:absolute;top:-40px;right:-40px;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,#10b98120 0%,transparent 70%)}
  .rank-header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
  .rank-trophy{font-size:36px;filter:drop-shadow(0 0 8px #f59e0b80)}
  .rank-title{font-size:17px;font-weight:800;color:#f1f5f9;letter-spacing:-.3px}
  .rank-sub{font-size:12px;color:#10b981;margin-top:2px;font-weight:600}
  .rank-metrics{display:flex;flex-direction:column;gap:10px}
  .rank-metric{background:#0f172a55;border-radius:10px;padding:11px 14px;border:1px solid #1e293b}
  .rank-metric-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#10b981;margin-bottom:8px;display:flex;align-items:center;gap:5px}
  .rank-bars{display:flex;flex-direction:column;gap:4px}
  .rank-bar-row{display:flex;align-items:center;gap:8px}
  .rank-bar-name{width:80px;font-size:11px;flex-shrink:0}
  .rank-bar-wrap{flex:1;background:#1e293b;border-radius:3px;height:18px;overflow:hidden;position:relative}
  .rank-bar-fill{height:100%;border-radius:3px;display:flex;align-items:center;padding-left:7px;font-size:10px;font-weight:700;transition:width .5s}
  .rank-bar-val{width:32px;text-align:right;font-size:11px;font-weight:700;flex-shrink:0}
  .you-tag{display:inline-flex;align-items:center;gap:3px;background:#10b98122;color:#10b981;border:1px solid #10b98144;border-radius:99px;font-size:9px;font-weight:800;padding:1px 6px;flex-shrink:0}

  /* Empty */
  .empty{color:#475569;font-size:12px;padding:16px;text-align:center;background:#1e293b;border-radius:8px;border:1px dashed #334155}

  /* Footer */
  .footer{text-align:center;color:#334155;font-size:11px;margin-top:32px;padding-top:16px;border-top:1px solid #1e293b}

  @media(max-width:580px){
    .kpi-row{grid-template-columns:repeat(2,1fr)}
    .card-body{grid-template-columns:1fr}
    .loja-right{text-align:left;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="hdr">
    <img class="avatar" src="${laissaPhotoB64}" alt="Laissa">
    <div class="hdr-text">
      <h1>Painel da Laissa</h1>
      <p>Suas integrações em andamento · Atualizado em ${now}</p>
    </div>
  </div>

  <!-- Tabs nav -->
  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('painel', this)">📊 Meu Painel</button>
    <button class="tab-btn" onclick="switchTab('previsibilidade', this)">📅 Previsibilidade</button>
  </div>

  <!-- TAB 1: Painel -->
  <div id="tab-painel" class="tab-pane active">

  <!-- KPIs -->
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-accent" style="background:#10b981"></div>
      <div class="kpi-label">Suas lojas</div>
      <div class="kpi-value" style="color:#10b981">${totalActive}</div>
      <div class="kpi-sub">integrações ativas</div>
    </div>
    <div class="kpi">
      <div class="kpi-accent" style="background:${totalCritical > 0 ? '#ef4444' : '#334155'}"></div>
      <div class="kpi-label">Críticas</div>
      <div class="kpi-value" style="color:${totalCritical > 0 ? '#ef4444' : '#475569'}">${totalCritical}</div>
      <div class="kpi-sub">${totalCritical > 0 ? 'intervir agora' : 'nenhuma crítica'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-accent" style="background:${totalNeeded > 0 ? '#f59e0b' : '#10b981'}"></div>
      <div class="kpi-label">Ações necessárias</div>
      <div class="kpi-value" style="color:${totalNeeded > 0 ? '#f59e0b' : '#10b981'}">${totalNeeded}</div>
      <div class="kpi-sub">${totalNeeded > 0 ? `${totalNeeded} loja${totalNeeded > 1 ? 's' : ''} aguardam sua ação` : 'tudo em dia!'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-accent" style="background:#64748b"></div>
      <div class="kpi-label">Aguardando</div>
      <div class="kpi-value" style="color:#94a3b8">${totalAction}</div>
      <div class="kpi-sub">coletar dados / justificar</div>
    </div>
  </div>

  ${blockedAlerts.map(t => `
  <div class="alert-banner">
    <div class="alert-flag">⚑</div>
    <div class="alert-content">
      <div class="alert-title">${t.displayName}${t.currentStatusDays ? ` — ${t.currentStatusDays} dias nesse status` : ` — ${t.daysSinceCreated} dias no pipeline`}</div>
      <div class="alert-desc">${t.urgency.message}</div>
    </div>
    <a href="${t.clickupUrl || t.url}" target="_blank" style="font-size:10px;color:#f87171;text-decoration:none;border:1px solid #ef444440;border-radius:6px;padding:3px 8px;background:#ef444415;flex-shrink:0;margin-top:2px">ver card ↗</a>
  </div>`).join('')}

  ${historyAlerts.map(t => `
  <div class="alert-banner amber">
    <div class="alert-flag">⚠️</div>
    <div class="alert-content">
      <div class="alert-title">${t.displayName} — ficou ${t.blockedDays} dias bloqueada pelo lojista</div>
      <div class="alert-desc">Essa loja teve um histórico longo de bloqueio externo. Mesmo com a integração avançando agora, acompanhe de perto — esse lojista precisou de mais tempo e atenção do que o habitual.</div>
    </div>
    <a href="${t.clickupUrl || t.url}" target="_blank" style="font-size:10px;text-decoration:none;border-radius:6px;padding:3px 8px;flex-shrink:0;margin-top:2px">ver card ↗</a>
  </div>`).join('')}

  <!-- Ranking amigável -->
  <div class="section-title">🏆 Comparativo do time</div>
  <div class="rank-card">
    <div class="rank-header">
      <div class="rank-trophy">🥇</div>
      <div>
        <div class="rank-title">Você está em 1º lugar no time!</div>
        <div class="rank-sub">⭐ Pipeline mais saudável das implantadoras</div>
      </div>
    </div>
    <div class="rank-metrics">

      <!-- Idade média -->
      ${(() => {
        const sorted = [...teamStats].sort((a,b) => a.avgAge - b.avgAge);
        const max    = Math.max(...sorted.map(s => s.avgAge));
        return `<div class="rank-metric">
          <div class="rank-metric-title">⏱ Menor tempo médio de pipeline <span style="color:#64748b;font-weight:400;text-transform:none;letter-spacing:0">— quanto mais baixo, melhor</span></div>
          <div class="rank-bars">
            ${sorted.map((s, i) => {
              const isLaissa = s.name === 'Laissa';
              const pct = Math.round(s.avgAge / max * 100);
              const color = isLaissa ? '#10b981' : '#334155';
              const textColor = isLaissa ? '#fff' : '#94a3b8';
              return `<div class="rank-bar-row">
                <div class="rank-bar-name" style="color:${isLaissa ? '#f1f5f9' : '#64748b'};font-weight:${isLaissa ? 700 : 400}">
                  ${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : '🥉 '}${s.name}
                </div>
                <div class="rank-bar-wrap">
                  <div class="rank-bar-fill" style="width:${pct}%;background:${color};color:${textColor}">${s.avgAge}d</div>
                </div>
                ${isLaissa ? `<div class="you-tag">você</div>` : `<div class="rank-bar-val" style="color:#475569">${s.avgAge}d</div>`}
              </div>`;
            }).join('')}
          </div>
          <div style="font-size:11px;color:#10b981;margin-top:8px;padding-top:8px;border-top:1px solid #1e293b">
            ✨ Seu pipeline é <strong>${Math.round((teamStats.find(s=>s.name==='Ana Débora').avgAge - laissaStats.avgAge) / teamStats.find(s=>s.name==='Ana Débora').avgAge * 100)}% mais jovem</strong> que o da Ana Débora e <strong>${Math.round((teamStats.find(s=>s.name==='Derik').avgAge - laissaStats.avgAge) / teamStats.find(s=>s.name==='Derik').avgAge * 100)}% mais jovem</strong> que o do Derik
          </div>
        </div>`;
      })()}

      <!-- Lojas críticas -->
      ${(() => {
        const sorted = [...teamStats].sort((a,b) => a.critical - b.critical);
        const max    = Math.max(...sorted.map(s => s.critical), 1);
        return `<div class="rank-metric">
          <div class="rank-metric-title">🔴 Menos lojas críticas (60+ dias) <span style="color:#64748b;font-weight:400;text-transform:none;letter-spacing:0">— quanto mais baixo, melhor</span></div>
          <div class="rank-bars">
            ${sorted.map((s, i) => {
              const isLaissa = s.name === 'Laissa';
              const pct = s.critical === 0 ? 4 : Math.round(s.critical / max * 100);
              const color = isLaissa ? '#10b981' : '#334155';
              const textColor = isLaissa ? '#fff' : '#94a3b8';
              return `<div class="rank-bar-row">
                <div class="rank-bar-name" style="color:${isLaissa ? '#f1f5f9' : '#64748b'};font-weight:${isLaissa ? 700 : 400}">
                  ${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : '🥉 '}${s.name}
                </div>
                <div class="rank-bar-wrap">
                  <div class="rank-bar-fill" style="width:${pct}%;background:${color};color:${textColor}">${s.critical === 0 ? '0 ✓' : s.critical}</div>
                </div>
                ${isLaissa ? `<div class="you-tag">você</div>` : `<div class="rank-bar-val" style="color:#475569">${s.critical}</div>`}
              </div>`;
            }).join('')}
          </div>
          ${laissaStats.critical === 0 ? `
          <div style="font-size:11px;color:#10b981;margin-top:8px;padding-top:8px;border-top:1px solid #1e293b">
            ✨ <strong>Nenhuma loja sua está em estado crítico.</strong> Derik tem ${teamStats.find(s=>s.name==='Derik').critical} e Ana Débora tem ${teamStats.find(s=>s.name==='Ana Débora').critical}.
          </div>` : ''}
        </div>`;
      })()}

      <!-- Bloqueadas % -->
      ${(() => {
        const sorted = [...teamStats].sort((a,b) => a.blockedPct - b.blockedPct);
        const max    = Math.max(...sorted.map(s => s.blockedPct), 1);
        return `<div class="rank-metric">
          <div class="rank-metric-title">⚑ Menor % de lojas bloqueadas <span style="color:#64748b;font-weight:400;text-transform:none;letter-spacing:0">— quanto mais baixo, melhor</span></div>
          <div class="rank-bars">
            ${sorted.map((s, i) => {
              const isLaissa = s.name === 'Laissa';
              const pct = s.blockedPct === 0 ? 4 : Math.round(s.blockedPct / max * 100);
              const color = isLaissa ? '#10b981' : '#334155';
              const textColor = isLaissa ? '#fff' : '#94a3b8';
              return `<div class="rank-bar-row">
                <div class="rank-bar-name" style="color:${isLaissa ? '#f1f5f9' : '#64748b'};font-weight:${isLaissa ? 700 : 400}">
                  ${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : '🥉 '}${s.name}
                </div>
                <div class="rank-bar-wrap">
                  <div class="rank-bar-fill" style="width:${pct}%;background:${color};color:${textColor}">${s.blockedPct}%</div>
                </div>
                ${isLaissa ? `<div class="you-tag">você</div>` : `<div class="rank-bar-val" style="color:#475569">${s.blockedPct}%</div>`}
              </div>`;
            }).join('')}
          </div>
          <div style="font-size:11px;color:#10b981;margin-top:8px;padding-top:8px;border-top:1px solid #1e293b">
            ✨ Apenas <strong>${laissaStats.blockedPct}% das suas lojas</strong> estão bloqueadas vs ${teamStats.find(s=>s.name==='Ana Débora').blockedPct}% da Ana Débora
          </div>
        </div>`;
      })()}

    </div>
  </div>

  <!-- Suas Lojas -->
  <div class="section-title">🏪 Suas lojas — ordenadas por prioridade</div>
  <div class="loja-list">
    ${laissaTasks.map(t => {
      const urg = t.urgency;
      const statusColor = STATUS_COLORS[t.status] || '#64748b';
      const totalDaysColor = t.daysSinceCreated > 60 ? '#ef4444' : t.daysSinceCreated > 30 ? '#f59e0b' : '#94a3b8';
      const hasFases = t.queueDays > 0 || t.blockedDays > 0 || t.workDays > 0;

      const cardBorder = urg.border ? `border:1px solid ${urg.border}` : 'border:1px solid #334155';

      const statusDaysEl = t.currentStatusDays != null
        ? `<div class="status-days" style="background:${urg.bgColor||'#0f172a'};color:${urg.color}">${t.currentStatusDays}d nesse status</div>`
        : '';

      return `
      <div class="loja-card" style="${cardBorder}">
        ${urg.label ? `
        <div class="urgency-bar" style="background:${urg.bgColor};color:${urg.color};border-bottom:1px solid ${urg.border}">
          <span>${urg.label}</span>
        </div>` : ''}
        <div class="card-body">
          <div>
            <div class="loja-name">
              ${t.displayName}
              ${t.isMigracao ? `<span class="badge" style="background:#8b5cf622;color:#8b5cf6;border:1px solid #8b5cf644">migração</span>` : ''}
            </div>
            <div class="loja-meta">
              <span class="badge" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44">${t.status}</span>
              <span class="badge" style="background:${SCENARIO_COLOR[t.scenario]}18;color:${SCENARIO_COLOR[t.scenario]};border:1px solid ${SCENARIO_COLOR[t.scenario]}33">${SCENARIO_LABEL[t.scenario]}</span>
              ${t.erp ? `<span class="badge" style="background:#1e293b;color:#64748b;border:1px solid #334155">ERP: ${t.erp}</span>` : ''}
            </div>
            ${urg.message ? `
            <div class="urgency-msg" style="background:${urg.bgColor||'#0f172a'};color:${urg.level==='normal'?'#64748b':urg.color};border:1px solid ${urg.border||'#334155'}">
              ${urg.message}
            </div>` : ''}
            ${hasFases ? `
            <div class="phase-row">
              ${t.queueDays   > 0 ? `<span class="phase-pill" style="background:#64748b18;color:#64748b;border:1px solid #64748b33">⏸ fila ${t.queueDays}d</span>` : ''}
              ${t.blockedDays > 0 ? `<span class="phase-pill" style="background:#f9741618;color:#f97316;border:1px solid #f9741633">⚑ bloqueada ${t.blockedDays}d</span>` : ''}
              ${t.workDays    > 0 ? `<span class="phase-pill" style="background:#3b82f618;color:#3b82f6;border:1px solid #3b82f633">▶ ativa ${t.workDays}d</span>` : ''}
            </div>` : ''}
          </div>
          <div class="loja-right">
            <div class="loja-days" style="color:${totalDaysColor}">${t.daysSinceCreated}d</div>
            <div class="loja-days-label">no pipeline</div>
            ${statusDaysEl}
            <a href="${t.clickupUrl || t.url}" target="_blank" class="card-link">ver card ↗</a>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>

  <!-- Chegando em breve -->
  <div class="section-title">🔜 Chegando em breve — integrações perto de concluir</div>
  <p style="font-size:12px;color:#475569;margin-bottom:10px;margin-top:-4px">
    A equipe está finalizando essas lojas. Podem chegar para você em breve.
  </p>
  ${comingSoon.length === 0
    ? `<div class="empty">Nenhuma integração em fase final no momento</div>`
    : `<div class="coming-grid">
      ${comingSoon.map(t => {
        const sc = t.currentStatusDays != null ? `${t.currentStatusDays}d nesse status` : `${t.age}d no pipeline`;
        return `
        <div class="coming-card">
          <div class="coming-name">${t.name.substring(0, 33)}${t.name.length > 33 ? '…' : ''}</div>
          <div class="coming-meta" style="margin-bottom:5px">
            <span style="color:${STATUS_COLORS[t.status]||'#64748b'}">${t.status}</span>
          </div>
          <div class="coming-meta">${sc} · ${t.workDays}d ativo${t.erp ? ` · ${t.erp}` : ''}</div>
          <a href="${t.url}" target="_blank" style="display:inline-block;margin-top:8px;font-size:10px;color:#3b82f6;text-decoration:none">ver card ↗</a>
        </div>`;
      }).join('')}
    </div>`}

  <!-- Checklist -->
  <div class="section-title">✅ Checklist — o que fazer enquanto aguarda</div>
  <p style="font-size:12px;color:#475569;margin-bottom:10px;margin-top:-4px">
    Para cada loja nova, levante esses pontos com antecedência. Progresso salvo no navegador.
  </p>
  <div class="checklist" id="checklist">
    ${checklist.map(item => `
    <div class="check-item" id="item-${item.id}" onclick="toggle('${item.id}')">
      <div class="check-box" id="box-${item.id}">✓</div>
      <div class="check-text">${item.text}</div>
    </div>`).join('')}
  </div>

  </div><!-- /tab-painel -->

  <!-- TAB 2: Previsibilidade -->
  <div id="tab-previsibilidade" class="tab-pane">

    <!-- Insight geral -->
    <div class="insight">
      <div class="insight-title">📌 Como funciona essa estimativa</div>
      <div class="insight-text">
        As estimativas são baseadas no <strong>tempo médio real</strong> que integrações ativas passaram em cada fase do pipeline.
        Para cada loja, mostramos quanto tempo falta na fase atual e nas próximas, até a implantação.
        Não são datas garantidas — bloqueios ou aceleração podem mudar o resultado.
      </div>
    </div>

    <!-- Benchmark por fase -->
    <div class="section-title" style="margin-top:0">📊 Tempo médio por fase</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
      ${(() => {
        const totalBench = PHASE_ORDER.reduce((s, p) => s + benchmarks[p], 0);
        const maxBench   = Math.max(...PHASE_ORDER.map(p => benchmarks[p]));
        return PHASE_ORDER.map(p => {
          const bench = benchmarks[p];
          const color = PHASE_COLORS[p];
          const pct   = Math.round(bench / maxBench * 100);
          const pctOfTotal = Math.round(bench / totalBench * 100);
          return `
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:160px;font-size:12px;color:${color};font-weight:700;flex-shrink:0;display:flex;align-items:center;gap:5px">
              ${PHASE_ICONS[p]} ${PHASE_LABELS[p].split(' / ')[0]}
            </div>
            <div style="flex:1;background:#0f172a;border-radius:4px;height:22px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${color}33;border:1px solid ${color}55;border-radius:4px;display:flex;align-items:center;padding-left:8px;font-size:11px;font-weight:700;color:${color}">
                ${bench}d
              </div>
            </div>
            <div style="width:30px;text-align:right;font-size:10px;color:#94a3b8;flex-shrink:0">${pctOfTotal}%</div>
          </div>`;
        }).join('') +
        `<div style="font-size:11px;color:#94a3b8;padding:6px 0 0 170px">
          Total típico do início ao fim: <strong style="color:#e2e8f0">${totalBench} dias</strong>
        </div>`;
      })()}
    </div>

    <!-- Suas lojas por previsão de entrega -->
    <div class="section-title">📍 Suas lojas — ordenadas por menor previsão de entrega</div>

    <div style="display:flex;flex-direction:column;gap:8px">
    ${tasksForPrevisao.map((t, idx) => {
      const phase       = getCurrentPhase(t.status);
      const color       = PHASE_COLORS[phase] || '#64748b';
      const bench       = benchmarks[phase] || 20;
      const pd          = t.phaseDays || {};
      const spent       = (pd[phase] || 0) + (t.currentStatusDays || 0);
      const remaining   = Math.max(3, bench - spent);
      const pct         = Math.min(100, Math.round(spent / bench * 100));
      const statusColor = STATUS_COLORS[t.status] || '#64748b';
      const dtc         = t.daysToComplete;
      const daysLabel   = !dtc ? '?' : dtc <= 14 ? `~${dtc} dias` : dtc <= 60 ? `~${Math.ceil(dtc/7)} sem` : `~${Math.ceil(dtc/30)} mes`;
      const urgColor    = !dtc ? '#94a3b8' : dtc <= 14 ? '#10b981' : dtc <= 30 ? '#f59e0b' : '#94a3b8';
      const futurePhasePills = PHASE_ORDER.slice(PHASE_ORDER.indexOf(phase)+1).map(fp => {
        const fc = PHASE_COLORS[fp];
        return `<span style="font-size:10px;background:${fc}15;color:${fc};border:1px solid ${fc}33;border-radius:99px;padding:2px 8px">${PHASE_ICONS[fp]} +${benchmarks[fp]}d</span>`;
      }).join('');

      return `
      <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;overflow:hidden">
        <!-- Fase atual como header do card -->
        <div style="display:flex;align-items:center;gap:7px;padding:6px 14px;background:${color}15;border-bottom:1px solid ${color}30">
          <span style="font-size:12px">${PHASE_ICONS[phase]}</span>
          <span style="font-size:11px;font-weight:700;color:${color}">${PHASE_LABELS[phase]}</span>
          <span style="font-size:10px;color:#64748b;margin-left:auto">#${idx + 1} na fila de entrega</span>
        </div>
        <div style="padding:12px 14px">
          <div style="display:flex;align-items:start;justify-content:space-between;gap:10px;margin-bottom:8px">
            <div>
              <div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:4px">${t.displayName}</div>
              <span class="badge" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44">${t.status}</span>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:20px;font-weight:800;color:${urgColor};letter-spacing:-0.5px">${daysLabel}</div>
              <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.3px">até implantação</div>
              ${dtc ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">~${addDays(dtc)}</div>` : ''}
            </div>
          </div>
          <!-- Barra de progresso na fase atual -->
          <div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-bottom:3px">
              <span>${spent}d nessa fase — ~${remaining}d restantes</span>
              <span style="color:#64748b">típico: ${bench}d</span>
            </div>
            <div style="background:#0f172a;border-radius:4px;height:7px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${color};border-radius:4px"></div>
            </div>
          </div>
          <!-- Próximas fases -->
          ${futurePhasePills ? `
          <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
            <span style="font-size:10px;color:#64748b;margin-right:2px">próximas fases:</span>
            ${futurePhasePills}
          </div>` : `<span style="font-size:11px;color:#a855f7;font-weight:600">🏁 Última fase — próximo passo é implantação!</span>`}
        </div>
      </div>`;
    }).join('')}
    </div>

    <!-- ERP Benchmark -->
    ${erpBenchmark.length > 0 ? `
    <div class="section-title">🔧 Histórico de integração por ERP</div>
    <div class="insight" style="margin-bottom:14px">
      <div class="insight-text">
        Tempo médio que integrações ficam no pipeline, agrupado por ERP.
        ERPs com ciclos mais longos costumam ter maior complexidade ou mais dependências externas.
        <strong style="color:#f1f5f9">Lojas suas destacadas em verde.</strong>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${(() => {
        const maxAge = Math.max(...erpBenchmark.map(e => e.avgAge));
        return erpBenchmark.map(e => {
          const isLaissa = laissaErps.has(e.erp);
          const barColor = isLaissa ? '#10b981' : '#334155';
          const textColor = isLaissa ? '#10b981' : '#94a3b8';
          const pct = Math.max(Math.round(e.avgAge / maxAge * 100), 12);
          return `
          <div style="background:#1e293b;border:1px solid ${isLaissa ? '#10b98144' : '#334155'};border-radius:10px;padding:11px 14px${isLaissa ? ';border-left:3px solid #10b981' : ''}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
              <span style="font-size:12px;font-weight:700;color:${textColor}">${e.erp}</span>
              ${isLaissa ? `<span class="badge" style="background:#10b98122;color:#10b981;border:1px solid #10b98144">sua loja</span>` : ''}
              <span style="margin-left:auto;font-size:11px;color:#64748b">${e.count} integração${e.count > 1 ? 'ões' : ''} ativa${e.count > 1 ? 's' : ''}</span>
            </div>
            <!-- Barra de tempo médio total -->
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
              <div style="width:90px;font-size:10px;color:#64748b;flex-shrink:0">Tempo médio</div>
              <div style="flex:1;background:#0f172a;border-radius:3px;height:18px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;display:flex;align-items:center;padding-left:7px;font-size:10px;font-weight:700;color:${isLaissa ? '#fff' : '#94a3b8'}">
                  ${e.avgAge}d no pipeline
                </div>
              </div>
            </div>
            ${(e.avgProduto || e.avgPedido) ? `
            <!-- Detalhamento por fase -->
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">
              ${e.avgProduto ? `<span style="font-size:10px;background:#06b6d415;color:#06b6d4;border:1px solid #06b6d433;border-radius:99px;padding:2px 8px">📦 produto ~${e.avgProduto}d</span>` : ''}
              ${e.avgPedido  ? `<span style="font-size:10px;background:#f59e0b15;color:#f59e0b;border:1px solid #f59e0b33;border-radius:99px;padding:2px 8px">🛒 pedido ~${e.avgPedido}d</span>` : ''}
            </div>` : ''}
          </div>`;
        }).join('');
      })()}
    </div>` : ''}

  </div><!-- /tab-previsibilidade -->

  <div class="footer">
    Instabuy · Setor de Integrações · ${now} · Painel exclusivo Laissa
  </div>

</div>
<script>
  // Tab switching
  function switchTab(id, btn) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + id).classList.add('active');
    btn.classList.add('active');
  }

  const KEYS = ${JSON.stringify(checklist.map(c => c.id))};

  function load() {
    KEYS.forEach(id => {
      if (localStorage.getItem('laissa_check_' + id) === '1') apply(id, true);
    });
  }

  function toggle(id) {
    const done = localStorage.getItem('laissa_check_' + id) === '1';
    localStorage.setItem('laissa_check_' + id, done ? '0' : '1');
    apply(id, !done);
  }

  function apply(id, done) {
    const item = document.getElementById('item-' + id);
    const box  = document.getElementById('box-' + id);
    item.classList.toggle('done', done);
  }

  load();
</script>
</body>
</html>`;

writeFileSync('dashboard-laissa.html', html);
const kb = Math.round(html.length / 1024);
console.log(`Dashboard da Laissa gerado!`);
console.log(`Arquivo: dashboard-laissa.html (${kb}KB)`);
console.log(`\nResumo de urgência:`);
laissaTasks.forEach(t => {
  console.log(`  [${t.urgency.level.toUpperCase().padEnd(8)}] ${t.displayName.substring(0,40)} | ${t.status} | ${t.currentStatusDays ?? '?'}d nesse status`);
});
