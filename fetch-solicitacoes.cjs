// Save as fetch-solicitacoes.cjs and run with: node fetch-solicitacoes.cjs
const https = require('https');
const fs = require('fs');

const TOKEN = 'pk_81923455_D3302HBP8J8RWE5X6PS9Q1NIBUU0ZBWW';
const LIST_ID = '211119618';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { Authorization: TOKEN, 'Content-Type': 'application/json' } };
    https.get(url, options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.substring(0,200))); }
      });
    }).on('error', reject);
  });
}

async function main() {
  let allTasks = [];
  let page = 0;
  while(true) {
    console.log('Fetching page', page, '...');
    const data = await fetchJSON(
      `https://api.clickup.com/api/v2/list/${LIST_ID}/task?include_closed=true&page=${page}&limit=100`
    );
    const tasks = data.tasks || [];
    allTasks = [...allTasks, ...tasks];
    console.log('  Got', tasks.length, 'tasks. Total:', allTasks.length);
    if (data.last_page !== false || tasks.length < 100) break;
    page++;
  }
  
  // Save simplified version
  const simplified = allTasks.map(t => ({
    id: t.id,
    name: t.name,
    status: t.status && t.status.status,
    priority: t.priority && t.priority.priority,
    date_created: parseInt(t.date_created),
    date_done: t.date_done ? parseInt(t.date_done) : null,
    date_updated: parseInt(t.date_updated),
    assignees: (t.assignees||[]).map(a => ({ id: a.id, username: a.username })),
    tags: (t.tags||[]).map(tg => tg.name),
    resultado: (() => {
      const cf = (t.custom_fields||[]).find(c => c.name === 'Resultado');
      if (!cf || !cf.value) return null;
      const valIds = Array.isArray(cf.value) ? cf.value : [cf.value];
      const opts = (cf.type_config && cf.type_config.options) || [];
      return valIds.map(vid => { const o = opts.find(op => op.id === vid); return o ? o.label : vid; }).join(', ');
    })(),
    email_lojista: (() => {
      const cf = (t.custom_fields||[]).find(c => c.name === 'Email do lojista');
      return (cf && cf.value) || null;
    })(),
  }));
  
  fs.writeFileSync('C:/Users/guilh/projetos/clickup-activity-mcp/solicitacoes-data.json',
    JSON.stringify({ generated_at: new Date().toISOString(), total: simplified.length, tasks: simplified }, null, 2)
  );
  console.log('\nDone! Saved', simplified.length, 'tasks to solicitacoes-data.json');
  
  // Quick summary
  const assigneeCounts = {};
  simplified.forEach(t => {
    t.assignees.forEach(a => { assigneeCounts[a.username] = (assigneeCounts[a.username]||0)+1; });
  });
  console.log('\nAssignee counts:');
  Object.entries(assigneeCounts).sort((a,b)=>b[1]-a[1]).forEach(([n,c]) => console.log(' ', n, ':', c));
}

main().catch(console.error);
