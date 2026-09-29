const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
const storage=new Map(),actions=[];
function el(tag,cls,text){return {tag,cls,text,children:[],append(...xs){this.children.push(...xs)},setAttribute(){}}}
const c={el,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},repoKey:r=>r.path,state:{workspaceRepo:{path:'A'},meta:{historyViews:{A:{scope:'ref:main'}}}},saveMeta(){},selectWorkspaceTab:tab=>actions.push(['view',tab]),runWorkspaceAction:(...args)=>actions.push(args)};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function historyMemory('),source.indexOf('function renderWorkbenchTree(')),c);
c.historyMemory().save({search:'fix',commit:'123',top:64});assert.equal(c.historyMemory().value.top,64);
c.state.workspaceRepo.path='B';assert.equal(c.historyMemory().value.commit,undefined);c.state.workspaceRepo.path='A';assert.equal(c.historyMemory().value.search,'fix');
const bar=c.renderHistoryContext({branch:'dev',previousBranch:'main',branches:[{name:'main'},{name:'dev'}]});assert.equal(bar.children[0].children[0].text,'Working on: dev');assert.equal(bar.children[0].children[1].text,'Viewing: main');
bar.children[1].onclick();assert.equal(c.state.meta.historyViews.A.scope,'ref:dev');assert.equal(actions[0][0],'view');
bar.children[2].onclick();assert.equal(actions[1][0],'branch-switch');assert.equal(actions[1][1].branch,'main');assert.match(actions[1][2],/Pending changes will be checked again/);
assert.equal(c.renderHistoryContext({branch:'dev',previousBranch:'deleted',branches:[]}).children.length,2);
assert.match(source,/label:'Compare with current'/);assert.match(source,/refs\/tags\/.*name/);
console.log('PASS: per-repository memory, viewing/current context, confirmed return branch and missing branch guard');
