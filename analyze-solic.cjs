const https = require('https');

function fetchJSON(url, token) {
  return new Promise((resolve, reject) => {
    const options = { headers: { Authorization: token, 'Content-Type': 'application/json' } };
    https.get(url, options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const TOKEN = 'pk_81923455_D3302HBP8J8RWE5X6PS9Q1NIBUU0ZBWW';

  // Fetch multiple pages
  let allTasks = [];
  for (let page = 0; page < 10; page++) {
    const data = await fetchJSON(
      `https://api.clickup.com/api/v2/list/211119618/task?include_closed=true&page=${page}&limit=100`,
      TOKEN
    );
    const tasks = data.tasks || [];
    allTasks = [...allTasks, ...tasks];
    if (data.last_page !== false || tasks.length < 100) break;
  }

  console.log('Total tasks:', allTasks.length);

  const dates = allTasks.map(t => parseInt(t.date_created)).filter(Boolean);
  if (dates.length) {
    console.log('Date range:', new Date(Math.min(...dates)).toLocaleDateString('pt-BR'), '—', new Date(Math.max(...dates)).toLocaleDateString('pt-BR'));
  }

  const statuses = {};
  allTasks.forEach(t => { statuses[t.status && t.status.status] = (statuses[t.status && t.status.status] || 0) + 1; });
  console.log('\nAll statuses:');
  Object.entries(statuses).sort((a,b) => b[1]-a[1]).forEach(([s,c]) => console.log('  ' + s + ': ' + c));

  const prios = {};
  allTasks.forEach(t => { const p = (t.priority && t.priority.priority) || 'sem prioridade'; prios[p] = (prios[p]||0)+1; });
  console.log('\nPriorities:');
  Object.entries(prios).sort((a,b) => b[1]-a[1]).forEach(([p,c]) => console.log('  ' + p + ': ' + c));

  const stores = {};
  allTasks.forEach(t => {
    const m = t.name.match(/^\[([^\]]+)\]/);
    if (m) stores[m[1]] = (stores[m[1]]||0)+1;
    else stores['(sem prefixo)'] = (stores['(sem prefixo)']||0)+1;
  });
  console.log('\nTop lojas por qtd solicitações:');
  Object.entries(stores).sort((a,b) => b[1]-a[1]).slice(0,15).forEach(([s,c]) => console.log('  ' + s + ': ' + c));

  const byMonth = {};
  allTasks.forEach(t => {
    const d = new Date(parseInt(t.date_created));
    const k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    byMonth[k] = (byMonth[k]||0)+1;
  });
  console.log('\nPor mês:');
  Object.entries(byMonth).sort().forEach(([m,c]) => console.log('  ' + m + ': ' + c));

  // Custom fields usage
  const cfCounts = {};
  allTasks.forEach(t => {
    (t.custom_fields || []).forEach(cf => {
      if (cf.value !== undefined && cf.value !== null && cf.value !== '') {
        cfCounts[cf.name] = (cfCounts[cf.name]||0)+1;
      }
    });
  });
  console.log('\nCustom fields com dados:');
  Object.entries(cfCounts).sort((a,b) => b[1]-a[1]).forEach(([n,c]) => console.log('  ' + n + ': ' + c + ' tasks'));

  // Sample a closed task to see "Resultado" field
  const resultadoTasks = allTasks.filter(t => {
    const cf = (t.custom_fields||[]).find(c => c.name === 'Resultado');
    return cf && cf.value !== undefined && cf.value !== null;
  });
  console.log('\nTasks com campo Resultado:', resultadoTasks.length);
  if (resultadoTasks.length > 0) {
    const cf = resultadoTasks[0].custom_fields.find(c => c.name === 'Resultado');
    console.log('  Sample Resultado:', JSON.stringify(cf.value));
    console.log('  Type config:', JSON.stringify(cf.type_config));
  }

  // Assignees distribution
  const assignees = {};
  allTasks.forEach(t => {
    (t.assignees||[]).forEach(a => { assignees[a.username] = (assignees[a.username]||0)+1; });
    if (!t.assignees || t.assignees.length === 0) assignees['(sem responsável)'] = (assignees['(sem responsável)']||0)+1;
  });
  console.log('\nAssignees:');
  Object.entries(assignees).sort((a,b) => b[1]-a[1]).forEach(([a,c]) => console.log('  ' + a + ': ' + c));
}

main().catch(console.error);
