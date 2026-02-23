const data = JSON.parse(require('fs').readFileSync('C:/Users/guilh/projetos/clickup-activity-mcp/dashboard-data.json','utf8'));
const tasks = data.tasks;

const intTasks = tasks.filter(t => t.name.startsWith('[INTEGRACAO]'));
console.log('Total [INTEGRACAO] tasks:', intTasks.length);

const withTime = intTasks.filter(t => t.total_days !== undefined);
const withoutTime = intTasks.filter(t => t.error);
console.log('With time data:', withTime.length);
console.log('Without time data (error):', withoutTime.length);

const byStatus = {};
for(const t of intTasks) {
  byStatus[t.status] = (byStatus[t.status] || 0) + 1;
}
console.log('\nStatus breakdown:');
for(const [s, c] of Object.entries(byStatus).sort((a,b)=>b[1]-a[1])) {
  console.log('  ' + s + ': ' + c);
}

console.log('\nTop tasks by total_days:');
withTime.sort((a,b) => (b.total_days||0) - (a.total_days||0)).slice(0,5).forEach(t => {
  console.log('  ' + t.name.replace('[INTEGRACAO] ','') + ': ' + t.total_days + 'd (blocked: ' + t.blocked_pct + '%)');
});

console.log('\nSample tags (ERP):');
intTasks.filter(t=>t.tags && t.tags.length>0).slice(0,10).forEach(t => {
  console.log('  ' + t.name.replace('[INTEGRACAO] ','') + ': ' + t.tags.join(', '));
});

const dates = intTasks.map(t=>t.date_created).filter(Boolean);
console.log('\nDate range:');
console.log('  Oldest:', new Date(Math.min(...dates)).toLocaleDateString('pt-BR'));
console.log('  Newest:', new Date(Math.max(...dates)).toLocaleDateString('pt-BR'));

// Sample phases
const withPhases = withTime.filter(t => t.phases);
console.log('\nSample phases (first 5):');
withPhases.slice(0,5).forEach(t => {
  const p = t.phases;
  console.log('  ' + t.name.replace('[INTEGRACAO] ','').substring(0,40) + ': prep=' + p.preparacao + 'd prod=' + p.produto + 'd ped=' + p.pedido + 'd test=' + p.teste + 'd');
});
