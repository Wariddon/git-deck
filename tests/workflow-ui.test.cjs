const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/workflow-ui.js'),'utf8');
function extract(name){const start=source.indexOf('function '+name+'(');let depth=0,begin=source.indexOf('{',start);for(let i=begin;i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(start,i+1)}}
const c=vm.createContext({});vm.runInContext('const workflowTimings=[];'+extract('recordWorkflowTiming')+extract('workflowReport')+extract('workflowBlockers'),c);
c.recordWorkflowTiming('status',123,45);c.recordWorkflowTiming('C:/private/token',1);c.recordWorkflowTiming('render',NaN);for(let i=0;i<50;i++)c.recordWorkflowTiming('render',i);
const report=JSON.parse(c.workflowReport());assert.equal(report.measurements.length,40);assert(report.measurements.every(x=>Object.keys(x).every(k=>['kind','ms','gitMs'].includes(k))));assert(!c.workflowReport().includes('private'));
assert(c.workflowBlockers(null).length);assert(c.workflowBlockers({branch:'main',remotes:[{}],files:[],operation:{active:false},sync:{behind:0}}).length===0);
assert(c.workflowBlockers({branch:'',remotes:[],files:[{}],operation:{active:true,type:'merge'},sync:{behind:2}},true).length===6);
// Guard the read-only refresh and checkout boundary against accidental write/auto-stash additions.
const status=source.slice(source.indexOf('async function checkActiveWorkingFiles'),source.indexOf("window.addEventListener('focus'"));assert(!status.includes("'/api/action'"));assert(status.includes('version!==workspaceLoadVersion'));assert(status.includes('workspaceReadInFlight'));assert(!status.includes('paintWorkspace('));
const checkout=source.slice(source.indexOf('async function confirmCheckoutReview'),source.indexOf('async function showSendReview'));assert(!checkout.includes('stash-save'));assert(checkout.includes('result.blocked'));assert(checkout.includes('workflowCurrent(repo)'));
console.log('PASS: numeric-only bounded reports, blocker reasons, read-only refresh and explicit checkout boundaries');
const statusContext=vm.createContext({URLSearchParams,Date,JSON,Map,console});
vm.runInContext(`
let statusCheckRunning=false,lastStatusCheck=0,statusUnsupported=false,workspaceReadInFlight=null,workspaceLoadVersion=1;
const workflowHeads=new Map();const notices=[];let paints=0,statusRenders=0,requests=[];
const state={workspaceRepo:{path:'fixture'},workspace:{branch:'main',files:[],operation:{active:false}},workspaceTab:'history',busy:false};
const document={hidden:false,activeElement:{matches(){return false}},querySelector(){return null}};
const repoKey=r=>r.path;const workflowCurrent=r=>state.workspaceRepo.path===r.path;
const api=()=>new Promise(resolve=>requests.push(resolve));
const renderWorkspace=()=>paints++;const renderWorkspaceStatus=()=>statusRenders++;const workflowStatusNotice=(text)=>notices.push(text);
${extract('workflowFileStamp')}
${source.slice(source.indexOf('async function checkActiveWorkingFiles'),source.indexOf("window.addEventListener('focus'"))}
async function run(){
 const data={branch:'main',head:'abc',files:[{status:' M',path:'a.txt',staged:false,unstaged:true}],operation:{active:false},protectedUntracked:{count:0}};
 let p=checkActiveWorkingFiles(true);requests.shift()(data);await p;if(paints!==0||state.workspace.files.length!==1)throw Error('History repainted or status not updated');
 state.workspaceTab='changes';p=checkActiveWorkingFiles(true);requests.shift()({...data,files:[]});await p;if(paints!==1)throw Error('File Status not refreshed');
 p=checkActiveWorkingFiles(true);state.workspaceRepo={path:'other'};requests.shift()(data);await p;if(state.workspace.files.length)throw Error('Stale repository status applied');
 state.workspaceRepo={path:'fixture'};state.busy=true;await checkActiveWorkingFiles(true);if(requests.length)throw Error('Read dispatched during write');
 console.log('PASS: focus refresh preserves History, refreshes changed files, rejects stale repo results and skips writes');
}
run();`,statusContext).catch(error=>{console.error(error);process.exitCode=1});
// Checkout with uncommitted changes (like git/Sourcetree): carry unrelated changes, stash-switch-restore for overlaps.
assert(checkout.includes("approve('carry')")&&checkout.includes("approve('stash')")&&checkout.includes("approve('clean')"),'checkout offers carry, stash and clean modes');
assert(source.includes("mode==='clean'?payload:{...payload,localChanges:mode}"),'the approved mode is sent to the server');
assert(source.includes("if(result?.conflicts?.length&&workflowCurrent(repo))selectWorkspaceTab('changes');"),'restore conflicts open File Status');
console.log('PASS: checkout review modes for uncommitted changes');
