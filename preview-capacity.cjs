const d = JSON.parse(require('fs').readFileSync('capacity-data.json'));
console.log('Throughput ultimos meses:');
d.throughput.monthly.slice(-8).forEach(m => {
  const net = m.net > 0 ? '+'+m.net : ''+m.net;
  console.log('  ' + m.label + ': entradas=' + m.started + ' | saidas=' + m.completed + ' | saldo=' + net);
});
console.log('\nTickets ultimos meses:');
d.tickets.monthly.slice(-8).forEach(m => console.log('  ' + m.label + ': ' + m.total));
console.log('\nERP breakdown (top 8):');
d.erp_breakdown.slice(0,8).forEach(e => console.log('  ' + e.erp + ': ' + e.total + ' lojas | ' + e.blocked + ' bloq | med ' + e.avgAge + 'd'));
console.log('\nWIP tasks mais antigas (top 5):');
d.wip.tasks.slice(0,5).forEach(t => console.log('  ' + t.age + 'd | ' + t.status + ' | ' + t.name.substring(0,45)));
