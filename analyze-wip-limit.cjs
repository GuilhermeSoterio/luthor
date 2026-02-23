const https = require('https');
const TOKEN = 'pk_81923455_D3302HBP8J8RWE5X6PS9Q1NIBUU0ZBWW';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: TOKEN } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  // Fetch all tasks (active + closed)
  let all = [];
  for (let page = 0; page < 10; page++) {
    const url = 'https://api.clickup.com/api/v2/list/211110999/task?include_closed=true&subtasks=false&page=' + page + '&limit=100';
    const data = await fetchJSON(url);
    const tasks = data.tasks || [];
    all = [...all, ...tasks];
    if (tasks.length < 100) break;
    await new Promise(r => setTimeout(r, 300));
  }

  // Filter: somente tasks concluídas com datas válidas, excluindo migração em massa
  const MIGRATION_CUTOFF_START = new Date('2025-08-01').getTime();
  const MIGRATION_CUTOFF_END   = new Date('2025-09-01').getTime();

  const done = all.filter(t => {
    if (t.status?.status !== 'implantado') return false;
    if (!t.date_created || !t.date_closed) return false;
    const closed = parseInt(t.date_closed);
    // Excluir o lote de migração de agosto
    if (closed >= MIGRATION_CUTOFF_START && closed < MIGRATION_CUTOFF_END) return false;
    return true;
  }).map(t => ({
    id:        t.id,
    name:      t.name.replace(/\[INTEGRACAO\]\s*/i, '').substring(0, 40),
    created:   parseInt(t.date_created),
    closed:    parseInt(t.date_closed),
    cycleDays: Math.round((parseInt(t.date_closed) - parseInt(t.date_created)) / 86400000),
  })).filter(t => t.cycleDays >= 0 && t.cycleDays < 365); // sanity check

  console.log('Integrações concluídas válidas: ' + done.length);

  // ── Para cada integração concluída, calcular o WIP no momento em que foi criada
  // WIP = quantas outras tasks estavam abertas quando essa foi criada
  done.forEach(t => {
    t.wipAtCreation = done.filter(other =>
      other.id !== t.id &&
      other.created <= t.created &&
      other.closed   >= t.created
    ).length;
  });

  // ── Agrupar por faixa de WIP e calcular ciclo médio/mediana
  const WIP_BUCKETS = [
    { label: '1–10',  min: 1,  max: 10  },
    { label: '11–15', min: 11, max: 15  },
    { label: '16–20', min: 16, max: 20  },
    { label: '21–25', min: 21, max: 25  },
    { label: '26–30', min: 26, max: 30  },
    { label: '31–40', min: 31, max: 40  },
    { label: '41–50', min: 41, max: 50  },
    { label: '51+',   min: 51, max: 999 },
  ];

  console.log('\n=== Ciclo médio por WIP no momento de criação ===');
  console.log('Faixa WIP   | N  | Mediana | Média  | Concluídas em <30d | >60d');
  console.log('------------|----|---------|---------|--------------------|------');

  const bucketResults = WIP_BUCKETS.map(b => {
    const group = done.filter(t => t.wipAtCreation >= b.min && t.wipAtCreation <= b.max);
    if (group.length === 0) return null;
    const cycles = group.map(t => t.cycleDays).sort((a, b) => a - b);
    const median = cycles[Math.floor(cycles.length / 2)];
    const avg    = Math.round(cycles.reduce((s, v) => s + v, 0) / cycles.length);
    const fast   = group.filter(t => t.cycleDays <= 30).length;
    const slow   = group.filter(t => t.cycleDays > 60).length;
    const fastPct = Math.round(fast / group.length * 100);
    const slowPct = Math.round(slow / group.length * 100);
    console.log(
      b.label.padEnd(11) + ' | ' +
      String(group.length).padStart(3) + ' | ' +
      String(median + 'd').padStart(7) + ' | ' +
      String(avg + 'd').padStart(7) + ' | ' +
      String(fast + ' (' + fastPct + '%)').padStart(18) + ' | ' +
      slow + ' (' + slowPct + '%)'
    );
    return { ...b, n: group.length, median, avg, fastPct, slowPct };
  }).filter(Boolean);

  // ── Little's Law: WIP ideal = Throughput × Cycle Time alvo
  // Throughput = media de concluídas por mês (excluindo migração)
  // Agrupa por mês
  const byMonth = {};
  done.forEach(t => {
    const m = new Date(t.closed).toISOString().substring(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
  });
  const monthCounts = Object.values(byMonth).filter(v => v < 50); // excluir migração
  const throughput  = Math.round(monthCounts.reduce((s, v) => s + v, 0) / monthCounts.length);
  const medianCycle = done.map(t => t.cycleDays).sort((a,b)=>a-b)[Math.floor(done.length/2)];

  console.log('\n=== Lei de Little ===');
  console.log('Throughput médio (excl. migração): ' + throughput + ' integ/mês');
  console.log('Ciclo mediano histórico: ' + medianCycle + ' dias');
  console.log('');
  console.log('WIP ideal para ciclo alvo de 30d: ' + Math.round(throughput * 30/30) + ' integrações');
  console.log('WIP ideal para ciclo alvo de 42d: ' + Math.round(throughput * 42/30) + ' integrações');
  console.log('WIP ideal para ciclo alvo de 60d: ' + Math.round(throughput * 60/30) + ' integrações');

  // ── Ponto de inflexão: onde o ciclo começa a degradar significativamente
  console.log('\n=== Ponto de inflexão ===');
  const baseline = bucketResults[0];
  bucketResults.forEach(b => {
    const degradation = baseline ? Math.round((b.median - baseline.median) / baseline.median * 100) : 0;
    console.log(b.label + ': mediana=' + b.median + 'd | degradação vs baseline: +' + Math.max(0, degradation) + '%');
  });
}

main().catch(console.error);
