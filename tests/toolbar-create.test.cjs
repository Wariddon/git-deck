const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
const html=fs.readFileSync(require('node:path').join(__dirname,'../web/index.html'),'utf8');
const nodes=[],calls=[];
function el(tag,cls='',text=''){const n={tag,text,children:[],value:'',append(...xs){this.children.push(...xs)},setAttribute(){},addEventListener(k,f){this[k]=f},focus(){}};nodes.push(n);return n;}
const ui={body:el('div'),dialog:{close(){ui.closed=true}}};
const context={el,state:{workspaceRepo:{path:'C:/fixture',name:'Fixture'},workspace:{branch:'main',branches:[{name:'main'}]}},releaseDialog:()=>ui,runWorkspaceAction:async(...args)=>{calls.push(args);return {ok:true}}};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function showBranchCreator(){'),source.indexOf("$('toolbar-create-branch')")),context);
(async()=>{
context.showBranchCreator();const input=nodes.find(n=>n.tag==='input'),form=nodes.find(n=>n.tag==='form');
assert.equal(calls.length,0,'Opening dialog never creates a branch');
input.value='main';await form.submit({preventDefault(){}});assert.equal(calls.length,0);
input.value='feature/test';context.state.workspaceRepo={path:'D:/other'};await form.submit({preventDefault(){}});assert.equal(calls.length,0);
context.state.workspaceRepo.path='C:/fixture';await form.submit({preventDefault(){}});assert.equal(calls[0][0],'branch-create');assert.equal(calls[0][1].branch,'feature/test');assert(ui.closed);
assert(html.indexOf('id="toolbar-create-branch"')>html.indexOf('data-git-action="push"'));
assert(html.includes('id="toolbar-create-tag"'));assert(source.includes("if(!state.busy)showTagDialog();"));
console.log('PASS: toolbar create controls, no write on open, duplicate/stale guards and explicit create-and-switch');
})().catch(error=>{console.error(error);process.exitCode=1});
