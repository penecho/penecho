'use strict';
require('./helpers/safety.js');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/lines/state.js'), 'utf8');
function harness({ view = 'home', embed = null } = {}) {
  const requests = [], c = vm.createContext({
    S:{ cur:'p', route:{view,line:'first',doc:'works/first/work-1.md'}, data:{} }, HOSTED:false, EMBED:embed,
    pathFor:id => `/projects/${id}`, api:url => new Promise((resolve, reject) => requests.push({url,resolve,reject})),
    lineById:(p, id) => [...p.lines, ...(p.landed || []), ...(p.backlog || [])].find(l => l.id === id),
    adoptState:state => { c.S.data[state.project.id] = { ...state, id:state.project.id, partial:c.run('statePartial')(state), everyLine:!state.view || state.full === '*', openLines:Array.isArray(state.full) ? state.full : [], parts:state.parts || [] }; },
  });
  c.run = code => vm.runInContext(code, c);
  vm.runInContext(source.slice(source.indexOf('const stateView ='), source.indexOf('async function loadProjects()')), c);
  const snapshot = (rev, extra = {}) => ({ format:2, rev, project:{id:'p'}, lines:[{id:'first',text:'All of the first Ask'}, {id:'second',text:'All of the other Ask'}], files:[{path:'files/result.md'}], ...extra });
  return {c, requests, snapshot, run:code => vm.runInContext(code, c)};
}
const asks = { home:'', line:'&full=first', files:'&parts=files', topics:'&parts=files', stats:'&parts=stats', archive:'&parts=archive,files', orchestrator:'&parts=stats', doc:'&full=first&parts=files', find:'', deleted:'' };
for (const [view, ask] of Object.entries(asks)) test(`${view} asks for the light state and what it shows, at once`, async () => {
  const h = harness({view}), pending = h.c.loadState('p');
  assert.equal(h.requests[0].url, `/projects/p/state?for=light${ask}&base=`);
  // A small project is sent whole: nothing more is ever asked for.
  h.requests[0].resolve(h.snapshot('r1', {view:'light',full:'*',parts:['files','tokens','stats','archive','words'],tag:'r1.x.1'})); await pending;
  assert.equal(h.c.S.data.p.partial, '');
  h.c.S.route = {view:'line',line:'second'};
  assert.equal(h.run('lacks(S.data.p, routeNeeds(S.route))'), null, 'opening another Line needs no delayed partial-state redraw');
  const poll = h.c.loadState('p');
  assert.match(h.requests[1].url, /for=light&rev=r1&/);
  assert.match(h.requests[1].url, /&base=r1\.x\.1$/);
  h.requests[1].resolve({same:true,rev:'r1',tag:'r1.x.1'}); assert.equal(await poll, false);
});
test('a line not read yet, or a part, is read once however many places ask, and only what is missing', async () => {
  const h = harness();
  const pending = h.c.loadState('p'), light = { view:'light', full:[], parts:[], tag:'r1.x.1', files:undefined, landed:[], backlog:[] };
  h.requests[0].resolve(h.snapshot('r1', {...light, lines:[{id:'first',light:true},{id:'second',text:'Still going'}]})); await pending;
  assert.equal(h.run("lacks(S.data.p, { lines:['second'] })"), null, 'a line that is going is whole already');
  assert.equal(JSON.stringify(h.run("lacks(S.data.p, { lines:['first'], parts:['files'] })")), '{"lines":["first"],"parts":["files"],"all":false}');
  h.c.a = h.run("readLines(S.data.p, ['first'])"); h.c.b = h.run("readLines(S.data.p, ['first'])");
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].url, '/projects/p/state?for=light&full=first&base=r1.x.1');
  h.requests[1].resolve({ format:2, delta:true, base:'r1.x.1', rev:'r1', tag:'r1.x.2', set:{ full:['first'] }, lists:{ lines:{ put:[{id:'first',text:'All of the first Ask'}] } } });
  assert.equal(await h.c.a, true); assert.equal(await h.c.b, true);
  assert.equal(h.c.S.data.p.lines[0].text, 'All of the first Ask');
  // It stays whole: every later look names it.
  h.c.loadState('p');
  assert.equal(h.requests[2].url, '/projects/p/state?for=light&rev=r1&full=first&base=r1.x.2');
  // An open line that came whole by itself still asks for its own files.
  h.c.S.route = {view:'line',line:'second'}; h.c.loadState('p');
  assert.equal(h.requests[3].url, '/projects/p/state?for=light&full=first,second&base=r1.x.2');
});
test('a change asked for before a line was opened still applies after it, and does not close the line', async () => {
  const h = harness(), pending = h.c.loadState('p');
  h.requests[0].resolve(h.snapshot('r1', { view:'light', full:[], parts:[], tag:'r1.x.1', files:undefined, landed:[], backlog:[], lines:[{id:'first',light:true},{id:'second',text:'Going'}] })); await pending;
  const poll = h.c.loadState('p'); h.c.opened = h.run("readLines(S.data.p, ['first'])");
  // The poll's answer comes first; the line's was made for the state before it.
  h.requests[1].resolve({ format:2, delta:true, base:'r1.x.1', rev:'r2', tag:'r2.x.2', set:{}, lists:{ lines:{ put:[{id:'second',text:'Going on'}] } } });
  assert.equal(await poll, true);
  h.requests[2].resolve({ format:2, delta:true, base:'r1.x.1', rev:'r2', tag:'r2.x.3', set:{ full:['first'] }, lists:{ lines:{ put:[{id:'first',text:'Whole'},{id:'second',text:'Going on'}] } } });
  assert.equal(await h.c.opened, true);
  assert.equal(h.requests.length, 3, 'nothing is asked again');
  assert.equal(JSON.stringify(h.c.S.data.p.lines), '[{"id":"first","text":"Whole"},{"id":"second","text":"Going on"}]');
});
test('a server without the light state is asked for the whole one, and no page waits for more', async () => {
  const h = harness({view:'line'}), pending = h.c.loadState('p');
  h.requests[0].reject(Object.assign(new Error('There is no state for "light".'), {status:400}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests[1].url, '/projects/p/state?base=');
  h.requests[1].resolve(h.snapshot('r1')); await pending;
  assert.equal(h.c.S.data.p.partial, '');
  assert.equal(h.run('lacks(S.data.p, routeNeeds(S.route))'), null);
});
test('standalone embedded rail retains its compact response', async () => {
  const h = harness({embed:{rail:true}}), pending = h.c.loadState('p');
  assert.match(h.requests[0].url, /for=rail/); h.requests[0].resolve(h.snapshot('r1',{view:'rail'})); await pending;
  assert.equal(h.c.S.data.p.partial, 'rail');
});
for (const older of ['complete', 'rail']) test(`delayed older ${older} response cannot overwrite complete content`, async () => {
  const h = harness({embed:older === 'rail' ? {rail:true} : null}), slow = h.c.loadState('p');
  h.c.EMBED = null;
  const recent = h.c.loadState('p',{force:true});
  h.requests[1].resolve(h.snapshot('new')); await recent;
  h.requests[0].resolve(h.snapshot('old',older === 'rail' ? {view:'rail'} : {}));
  assert.equal(await slow, false); assert.equal(h.c.S.data.p.rev, 'new');
});
test('responses for another project stay in its own cache', async () => {
  const h = harness(), oldProject = h.c.loadState('p'); h.c.S.cur = 'other';
  const other = h.c.loadState('other');
  h.requests[1].resolve(h.snapshot('other',{project:{id:'other'}})); await other;
  h.requests[0].resolve(h.snapshot('p')); await oldProject;
  assert.equal(h.c.S.cur, 'other'); assert.equal(h.c.S.data.other.rev, 'other'); assert.equal(h.c.S.data.p.rev, 'p');
});
