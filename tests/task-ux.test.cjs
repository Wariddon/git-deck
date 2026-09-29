const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
function node(tag,cls,text){return {tag,cls,text,children:[],attributes:{},append(...items){this.children.push(...items)},setAttribute(k,v){this.attributes[k]=v;}};}
const c={el:node,document:{createTextNode:text=>node('text','',text)}};vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('function appendSearchHighlight('),source.indexOf('function repoSwitcherCandidates(')),c);
vm.runInContext(source.slice(source.indexOf('function actionContext('),source.indexOf('function outputLooksImportant(')),c);
const highlighted=c.appendSearchHighlight(node('strong'),'service-<img src=x>-payment','<img payment');
assert.equal(highlighted.children.map(n=>n.text).join(''),'service-<img src=x>-payment');assert.deepEqual(highlighted.children.filter(n=>n.tag==='mark').map(n=>n.text),['<img','payment']);assert(!highlighted.children.some(n=>n.tag==='img'));
const disabled=node('button');c.setDisabledReason(disabled,true,'Select staged files first.');assert.equal(disabled.disabled,true);assert.equal(disabled.attributes['aria-description'],'Select staged files first.');c.setDisabledReason(disabled,false,'');assert.equal(disabled.title,'');
const context=c.actionContext({name:'project',path:'C:/one/project'},{branch:'main'},{remote:'origin',branches:[{local:'feature/a',remote:'release'}]});assert.match(context,/Repository: project/);assert.match(context,/Folder: C:\/one\/project/);assert.match(context,/Working on: main/);assert.match(context,/feature\/a → origin\/release/);assert(!context.includes('undefined'));
const confirmations=[];let writes=0;
Object.assign(c,{state:{workspaceRepo:{name:'project',path:'C:/one/project'},workspace:{branch:'main'},busy:false},gitCommandPreview:()=>'',confirm:text=>{confirmations.push(text);return false;},api:()=>{writes++;}});
vm.runInContext(source.slice(source.indexOf('async function runWorkspaceAction('),source.indexOf('function gitCommandPreview(')),c);
(async()=>{for(const action of ['commit','merge','branch-delete','push-selection'])await c.runWorkspaceAction(action,{branch:'feature/a'},'Proceed?');assert.equal(writes,0);assert.equal(confirmations.length,4);for(const text of confirmations){assert.match(text,/Working on: main/);assert.match(text,/Repository: project/);assert.match(text,/Selected branch: feature\/a/);}assert.match(source,/retry:action==='fetch'\?/);assert.match(source,/diff\.diffFilePosition=`File/);console.log('PASS: safe search highlighting, disabled reasons, action destination and cancel-before-write');})().catch(error=>{console.error(error);process.exitCode=1;});
