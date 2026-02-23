const cap = JSON.parse(require('fs').readFileSync('capacity-data.json'));
const https = require('https');
const TOKEN = 'pk_81923455_D3302HBP8J8RWE5X6PS9Q1NIBUU0ZBWW';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: TOKEN } }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    }).on('error', reject);
  });
}

async function main() {
  // Fetch all completed tasks to analyze by day
  let all = [];
  for (let page = 0; page < 10; page++) {
    const url = `https://api.clickup.com/api/v2/list/211110999/task?include_closed=true&statuses[]=implantado&page=${page}&limit=100`;
    const data = await fetchJSON(url);
    const tasks = data.tasks || [];
    all = [...all, ...tasks];
    if (tasks.length < 100) break;
    await new Promise(r => setTimeout(r, 300));
  }

  const MONTHS = ['2025-11', '2025-12', '2026-01'];

  MONTHS.forEach(month => {
    const tasks = all.filter(t => {
      if (!t.date_closed) return false;
      return new Date(parseInt(t.date_closed)).toISOString().substring(0,7) === month;
    });
    console.log('\n=== ' + month + ' === (' + tasks.length + ' concluidas)');
    tasks.forEach(t => {
      const d = new Date(parseInt(t.date_closed));
      const day = d.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'});
      const name = t.name.replace(/\[INTEGRACAO\]\s*/i,'').substring(0,50);
      console.log('  ' + day + ' | ' + name);
    });
  });
}

main().catch(console.error);
