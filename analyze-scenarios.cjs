const cap = JSON.parse(require('fs').readFileSync('capacity-data.json'));
const { c1, c2, c3 } = cap.scenarios;

console.log('=== Distribuição dos cenários ===');
console.log('C1 (aguardando inicio): ' + c1.count + ' (' + Math.round(c1.count/50*100) + '%)');
console.log('C2 (em integracao, bloqueada): ' + c2.count + ' | flow efficiency: ' + c2.avg_flow_efficiency + '%');
console.log('C3 (em integracao, ativa): ' + c3.count + ' | flow efficiency: ' + c3.avg_flow_efficiency + '%');

// Das 18 criticas (61+d), quantas sao de cada cenario?
const critical = [...cap.wip.tasks_by_bucket['61_90'], ...cap.wip.tasks_by_bucket['90_plus']];
const critByScenario = { C1: 0, C2: 0, C3: 0 };
critical.forEach(t => critByScenario[t.scenario] = (critByScenario[t.scenario]||0)+1);
console.log('\n=== Das 18 críticas (61+d) por cenário ===');
console.log('C1 (aguardando inicio): ' + critByScenario.C1);
console.log('C2 (em integracao, bloqueada): ' + critByScenario.C2);
console.log('C3 (em integracao, ativa): ' + critByScenario.C3);

// C3 com status atual (para entender o que são essas 18 ativas)
console.log('\n=== C3 tasks — 5 mais antigas ===');
c3.tasks.sort((a,b) => b.age - a.age).slice(0,5).forEach(t => {
  console.log(t.age + 'd | flow ' + (t.flowEfficiency||'?') + '% | work ' + t.workDays + 'd blq ' + t.blockedDays + 'd | ' + t.status + ' | ' + t.name.substring(0,40));
});

console.log('\n=== C1 tasks — 5 mais antigas ===');
c1.tasks.sort((a,b) => b.age - a.age).slice(0,5).forEach(t => {
  console.log(t.age + 'd | ' + t.status + ' | ' + t.name.substring(0,40));
});
