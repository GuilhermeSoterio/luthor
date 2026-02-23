const https = require('https');
const fs = require('fs');

const TOKEN = 'pk_81923455_D3302HBP8J8RWE5X6PS9Q1NIBUU0ZBWW';
const INTEG_LIST_ID   = '211110999'; // Integrações (cards de integração)
const IMPLANT_LIST_ID = '211186088'; // Implantação de lojas (cards pai com implantador)

const IMPLANTADORES = {
  82096739:  'Derik',
  106171961: 'Ana Débora',
  87975925:  'Laissa',
};

const ACTIVE_STATUSES = [
  'backlog','contato/comunicação','todo/dados coletados',
  'progresso produto','produtos integrado','progresso pedido',
  'bloqueado pedido','bloqueado produto','revisão','aguardando cliente',
];
const BLOCKED_STATUSES = ['bloqueado produto','bloqueado pedido','aguardando cliente'];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: TOKEN, 'Content-Type': 'application/json' } }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAllPages(listId, extraParams = '') {
  let all = [];
  for (let page = 0; page < 20; page++) {
    const url = `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&subtasks=false&page=${page}&limit=100${extraParams}`;
    const data = await fetchJSON(url);
    const tasks = data.tasks || [];
    all = [...all, ...tasks];
    console.log(`  List ${listId} page ${page}: ${tasks.length} tasks`);
    if (tasks.length < 100) break;
    await sleep(300);
  }
  return all;
}

async function main() {
  // 1. Fetch all "Implantação de lojas" tasks to build implantador map
  console.log('Fetching Implantação de lojas tasks...');
  const implantTasks = await fetchAllPages(IMPLANT_LIST_ID);
  console.log(`Total implantação tasks: ${implantTasks.length}`);

  // Build map: father_task_id → implantador name
  const implantadorMap = {}; // task_id → { name, id }
  implantTasks.forEach(t => {
    const implantador = (t.assignees || []).find(a => IMPLANTADORES[a.id]);
    if (implantador) {
      implantadorMap[t.id] = {
        name: IMPLANTADORES[implantador.id],
        memberId: implantador.id,
        taskName: t.name,
      };
    }
  });
  console.log(`Father tasks with implantador: ${Object.keys(implantadorMap).length}`);

  // 2. Fetch all active integration tasks
  console.log('\nFetching Integrações tasks...');
  const integTasks = await fetchAllPages(INTEG_LIST_ID);
  const activeTasks = integTasks.filter(t => ACTIVE_STATUSES.includes(t.status?.status));
  console.log(`Active tasks: ${activeTasks.length}`);

  // 3. Match via _father_task_id custom field
  const result = activeTasks.map(t => {
    const status = t.status?.status || 'unknown';
    const isBlocked = BLOCKED_STATUSES.includes(status);
    const daysSinceCreated  = Math.round((Date.now() - parseInt(t.date_created)) / 86400000);
    const daysSinceUpdated  = Math.round((Date.now() - parseInt(t.date_updated || t.date_created)) / 86400000);

    // Find _father_task_id
    const fatherCF = (t.custom_fields || []).find(cf => cf.name === '_father_task_id');
    const fatherCustomId = fatherCF?.value || null; // e.g. "F0H-577"

    // Resolve father task ID to actual task ID
    // The father task has customId like "F0H-577", need to match by custom_id
    const fatherTask = fatherCustomId
      ? implantTasks.find(ft => ft.custom_id === fatherCustomId)
      : null;
    const fatherTaskId = fatherTask?.id || null;
    const implantadorInfo = fatherTaskId ? implantadorMap[fatherTaskId] : null;

    // ERP from tags
    const erp = (t.tags || [])
      .map(tag => tag.name)
      .filter(tag => tag.toLowerCase().includes('erp'))
      .map(tag => tag.replace(/^:?erp[:\s]*/i, '').trim())
      .filter(Boolean)[0] || null;

    // Engajamento lojista
    const engCF = (t.custom_fields || []).find(cf => cf.name === 'Engajamento do lojista');
    const engLabel = engCF?.value?.[0]
      ? engCF.type_config?.options?.find(o => o.id === engCF.value[0])?.label?.trim() || null
      : null;

    return {
      id: t.id,
      name: t.name,
      status,
      isBlocked,
      daysSinceCreated,
      daysSinceUpdated,
      erp,
      fatherCustomId,
      implantador: implantadorInfo?.name || null,
      assignees: (t.assignees || []).map(a => a.username.split(' ')[0]),
      engajamento_lojista: engLabel,
      url: `https://app.clickup.com/t/${t.id}`,
    };
  });

  // 4. Summary by implantador
  const summary = {};
  for (const name of Object.values(IMPLANTADORES)) {
    const tasks = result.filter(t => t.implantador === name);
    summary[name] = {
      total: tasks.length,
      blocked: tasks.filter(t => t.isBlocked).length,
      byStatus: {},
      avgDaysSinceCreated: tasks.length
        ? Math.round(tasks.reduce((s, t) => s + t.daysSinceCreated, 0) / tasks.length)
        : 0,
      maxDaysSinceCreated: tasks.length ? Math.max(...tasks.map(t => t.daysSinceCreated)) : 0,
    };
    tasks.forEach(t => {
      summary[name].byStatus[t.status] = (summary[name].byStatus[t.status] || 0) + 1;
    });
  }

  const noImplantador = result.filter(t => !t.implantador);

  console.log('\n=== Resumo por implantador ===');
  for (const [name, s] of Object.entries(summary)) {
    console.log(`${name}: ${s.total} lojas | ${s.blocked} bloqueadas | média ${s.avgDaysSinceCreated}d | max ${s.maxDaysSinceCreated}d`);
    Object.entries(s.byStatus).forEach(([st, c]) => console.log(`   ${st}: ${c}`));
  }
  console.log(`\nSem implantador identificado: ${noImplantador.length}`);
  noImplantador.forEach(t => console.log('  ', t.name.substring(0, 60), '|', t.status, '| father:', t.fatherCustomId));

  const output = {
    generated_at: new Date().toISOString(),
    implantadores: Object.keys(IMPLANTADORES).map(id => ({ id: parseInt(id), name: IMPLANTADORES[id] })),
    tasks: result,
    summary,
    noImplantador: noImplantador.map(t => ({ id: t.id, name: t.name, status: t.status, fatherCustomId: t.fatherCustomId })),
  };

  fs.writeFileSync(
    'C:/Users/guilh/projetos/clickup-activity-mcp/implantadores-data.json',
    JSON.stringify(output, null, 2)
  );
  console.log('\nSalvo em implantadores-data.json');
}

main().catch(console.error);
