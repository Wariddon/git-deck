const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
const cache=source.slice(source.indexOf('const workspaceSnapshots='),source.indexOf('let repoDetailRepo='));
const loader=source.slice(source.indexOf('async function loadWorkspace('),source.indexOf('function renderSyncSummary('));
const context=vm.createContext({setTimeout,Date,JSON,Map,console});
vm.runInContext(`
let workspaceLoadVersion=0;
const state={workspaceRepo:null,workspace:null,workspaceTab:'history'};
const node={textContent:'',removeAttribute(){},replaceChildren(){}};
const $=()=>node;const repoKey=r=>r.path;
let calls=[],paints=0,fail=false;
const showLoading=()=>{},hideLoading=()=>{},setOutput=()=>{},setNotice=()=>{};
const renderSyncSummary=()=>{},renderWorkspaceStatus=()=>{},renderWorkbenchTree=()=>{},renderWorkspace=()=>{paints++};
const api=async path=>{calls.push(path);await new Promise(r=>setTimeout(r,40));if(fail)throw Error('offline');return {workspace:{branch:path.includes('path=A')?'A':'B',files:[],settings:{extrasLoaded:false}}};};
${cache}
${loader}
async function test(){
 state.workspaceRepo={path:'A'};const a=loadWorkspace();
 state.workspaceRepo={path:'B'};const b=loadWorkspace();await Promise.all([a,b]);
 if(calls.length!==1||!calls[0].includes('path=B')||state.workspace.branch!=='B')throw Error('obsolete dispatch or wrong repo');
 const previous=paints;await loadWorkspace();if(paints!==previous)throw Error('unchanged data repainted');
 fail=true;await loadWorkspace();if(state.workspace.branch!=='B')throw Error('cache lost on failure');fail=false;
 for(let i=0;i<20;i++)rememberWorkspace({path:String(i)},{files:[]});if(workspaceSnapshots.size!==12)throw Error('unbounded cache');
 calls=[];state.workspaceRepo={path:'A'};const first=loadWorkspace();await new Promise(r=>setTimeout(r,90));
 state.workspaceRepo={path:'B'};const second=loadWorkspace();await Promise.all([first,second]);
 if(state.workspace.branch!=='B'||calls.length!==2)throw Error('in-flight switch failed');
 return 'PASS: coalescing, latest-repo guard, unchanged refresh, failed refresh, cache bound, in-flight switching';
}
`,context);
vm.runInContext('test()',context).then(result=>{assert.match(result,/PASS/);console.log(result);}).catch(error=>{console.error(error);process.exitCode=1;});
