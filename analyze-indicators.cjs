const cap = JSON.parse(require('fs').readFileSync('capacity-data.json'));

// ── WIP Crítico: quem são os 18 com 61+ dias ──────────────────────────────────
const critical = [
  ...cap.wip.tasks_by_bucket['61_90'],
  ...cap.wip.tasks_by_bucket['90_plus'],
];
console.log('=== WIP Crítico: ' + critical.length + ' integrações com 61+ dias ===');

// por status
const byStatus = {};
critical.forEach(t => { byStatus[t.status] = (byStatus[t.status]||0)+1; });
console.log('\nPor status:');
Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).forEach(([s,n]) => console.log('  ' + s + ': ' + n));

// bloqueadas vs ativas
const blockedCritical = critical.filter(t => t.isBlocked);
const activeCritical  = critical.filter(t => !t.isBlocked);
console.log('\nBloqueadas (fator externo): ' + blockedCritical.length);
console.log('Ativas (responsabilidade interna): ' + activeCritical.length);

// quando entraram no pipeline
console.log('\nQuando entraram (mes de criacao):');
const byMonth = {};
critical.forEach(t => {
  const age = t.age;
  // data de criação estimada: hoje - age dias
  const created = new Date(Date.now() - age * 86400000);
  const m = created.toISOString().substring(0,7);
  byMonth[m] = (byMonth[m]||0)+1;
});
Object.entries(byMonth).sort().forEach(([m,n]) => console.log('  ' + m + ': ' + n + ' integ.'));

// as 5 mais antigas com status
console.log('\nAs 5 mais antigas:');
critical.slice(0,5).forEach(t => {
  console.log('  ' + t.age + 'd | ' + t.status + ' | ' + t.name.substring(0,45));
});

// ── Ratio de Fluxo: por que 23 entradas vs 11 saidas ─────────────────────────
console.log('\n=== Ratio de Fluxo: últimos 6 meses ===');
cap.throughput.monthly.slice(-6).forEach(m => {
  const isMig = m.completed > 50;
  const saldo = m.completed - m.started;
  const saldoStr = saldo >= 0 ? '+'+saldo : ''+saldo;
  console.log(
    m.label + ': ' +
    'entradas=' + m.started +
    ' saidas=' + (isMig ? '(migração)' : m.completed) +
    ' saldo=' + (isMig ? 'n/a' : saldoStr)
  );
});

// acúmulo total
const validMonths = cap.throughput.monthly.slice(-6).filter(m => m.completed <= 50);
const totalIn  = validMonths.reduce((s,m)=>s+m.started,0);
const totalOut = validMonths.reduce((s,m)=>s+m.completed,0);
console.log('\nAcúmulo nos últimos 6 meses: ' + totalIn + ' entraram, ' + totalOut + ' saíram → saldo: ' + (totalOut-totalIn));

// qual mes mais contribuiu para o desbalanco
console.log('\nMês com maior desequilíbrio (mais entradas do que saídas):');
const worst = validMonths.filter(m=>m.started > m.completed).sort((a,b)=>(b.started-b.completed)-(a.started-a.completed))[0];
if (worst) console.log('  ' + worst.label + ': +' + (worst.started-worst.completed) + ' (entrou ' + worst.started + ', saiu ' + worst.completed + ')');

console.log('\nMeses com mais entradas do que saídas:');
validMonths.filter(m=>m.started>m.completed).forEach(m => {
  console.log('  ' + m.label + ': entrou ' + m.started + ' saiu ' + m.completed + ' (saldo ' + (m.started-m.completed) + ')');
});
