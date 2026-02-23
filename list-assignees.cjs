const d = JSON.parse(require('fs').readFileSync('solicitacoes-data.json'));
const people = {};
d.tasks.forEach(t => {
  (t.assignees || []).forEach(a => {
    const key = '' + a.id;
    if (!people[key]) people[key] = { id: a.id, username: a.username, count: 0 };
    people[key].count++;
  });
});
Object.values(people).sort((a, b) => b.count - a.count).forEach(p => {
  console.log(p.id + ' | ' + p.username + ' | ' + p.count + ' tickets');
});
