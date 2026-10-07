const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../web/multi-repo.js'),'utf8');
const helpers=source.slice(source.indexOf('  function inFolder('),source.indexOf('  function openRepo('));
const context=vm.createContext({console,Array,Error,Promise});
vm.runInContext(String.raw`
const state={repos:[{name:'old',path:'C:\\SCB\\old',valid:true}],scanLocations:[]};
const worksets=()=>[{name:'ticket',paths:['C:\\SCB\\lns-azure-logicapp']}];
let calls=0,fail=false;
const api=async route=>{
 if(route!=='/api/repos')throw Error('unexpected route');calls++;
 if(fail)throw Error('offline');
 return {repos:[
 {name:'lns-azure-logicapp',path:'C:\\SCB\\lns-azure-logicapp',valid:true,pending:true},
 {name:'other',path:'C:\\Other\\other',valid:true},
 {name:'missing',path:'C:\\SCB\\missing',valid:false}
 ]};
};
${helpers}
`,context);
(async()=>{
 const list=await vm.runInContext("freshPendingRepos('C:\\\\SCB')",context);
 assert.equal(list.length,1);
 assert.equal(list[0].name,'lns-azure-logicapp','New pending-status repo must be discoverable despite stale state.repos');
 const workset=await vm.runInContext("freshPendingRepos('set:ticket')",context);
 assert.equal(workset.length,1);
 assert.equal(vm.runInContext('calls',context),2,'Every check reads the current registered list');
 vm.runInContext('fail=true',context);
 await assert.rejects(vm.runInContext("freshPendingRepos('all')",context),/offline/,'Do not silently fall back to stale repositories');
 console.log('PASS: fresh registered list, first-status repositories, folder/workset filters and list-fetch failures');
})().catch(error=>{console.error(error);process.exitCode=1;});
