'use strict';
// Family checks: the same rules over every repository of a family (depinq-*, src-*, crs-*...), as a
// table, so a migration done "everywhere" does not miss one sibling. Rules read files only:
//   capture     - a value from a file (Dockerfile base image, Spring Boot version); odd ones out are marked
//   contains    - a pattern that must (or must not) be in a file (argo_yaml in the SIT Jenkins build)
//   deploy-file - a file per environment in the deploy repository ({repo}, {env} in the path)
// Rules are kept on this computer and can be edited as JSON.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const defaultRules=[
    {id:'base-image',type:'capture',label:'Docker base image',file:'Dockerfile',pattern:'FROM\\s+\\S*eclipse-temurin:(\\S+)',last:true},
    {id:'boot',type:'capture',label:'Spring Boot',file:'pom.xml',pattern:'<artifactId>spring-boot-starter-parent</artifactId>\\s*<version>([^<]+)</version>'},
    {id:'argo-yaml',type:'contains',label:'SIT build pushes the image tag (argo_yaml)',file:'jenkins/jenkins-build-sit.groovy',pattern:'argo_yaml',expect:true,exclude:'-db-migration$'},
    {id:'provided-uber-jar',type:'contains',label:'ci-lib-module as provided (still packed into the fat jar)',file:'pom.xml',pattern:'ci-lib-module</artifactId>[\\s\\S]{0,300}?<scope>provided</scope>',expect:false},
    {id:'app-config',type:'deploy-file',label:'Configuration in the deploy repository',path:'manifestvalues/{env}/lns-app-configuration/{repo}.yml',envs:['dev','sit','uat','prod']},
  ];
  function compile(pattern){try{return new RegExp(pattern,'g');}catch{return null;}}
  // One rule against one file's text: {state: ok|bad|none|value, value}
  function evaluate(rule,text){
    if(text===null||text===undefined)return {state:'none'};
    const re=compile(rule.pattern);if(!re)return {state:'bad',value:'invalid pattern'};
    if(rule.type==='capture'){const all=[...String(text).matchAll(re)];if(!all.length)return {state:'none'};const hit=rule.last?all[all.length-1]:all[0];return {state:'value',value:hit[1]??hit[0]};}
    const found=re.test(String(text));return {state:found===(rule.expect!==false)?'ok':'bad'};
  }
  // Values that differ from the most common one in a capture column.
  function oddOnes(values){
    const counts=new Map();for(const value of values)if(value!==undefined)counts.set(value,(counts.get(value)||0)+1);
    const common=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
    return {common,odd:new Set([...counts.keys()].filter(value=>value!==common))};
  }
  const applies=(rule,repoName)=>!rule.exclude||!new RegExp(rule.exclude).test(repoName);
  const helpers={defaultRules,evaluate,oddOnes,applies};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,repoLink,table,row,mapLimit,query}=F;
  const rulesKey='gitdeck.familyChecks';
  const loadRules=()=>{try{const saved=JSON.parse(localStorage.getItem(rulesKey)||'null');if(Array.isArray(saved)&&saved.length)return saved;}catch{}return defaultRules;};
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const input=(placeholder)=>{const node=el('input','workflow-input');node.type='search';node.placeholder=placeholder;node.setAttribute('aria-label',placeholder);return node;};

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();const family=input(t('Family, for example depinq- or crs-'));
    try{family.value=localStorage.getItem('gitdeck.familyPrefix')||'';}catch{}
    const ref=input(t('Branch or tag (empty: files on disk)'));ref.classList.add('fleet-ref');
    const deploy=document.createElement('select');deploy.className='workflow-input';deploy.setAttribute('aria-label',t('Deploy repository'));
    const run=button(t('Run checks'),'primary');bar.append(folder,family,ref,deploy,run);
    const editor=el('details','fleet-mr-create');editor.append(el('summary','',t('Edit rules')));
    const text=el('textarea','workflow-input family-rules');text.rows=12;text.spellcheck=false;text.value=JSON.stringify(loadRules(),null,2);
    const save=button(t('Save rules'),'primary');const reset=button(t('Restore the default rules'));const note=el('small','fleet-muted','');
    const editorBar=el('div','fleet-options');editorBar.append(save,reset,note);editor.append(el('p','fleet-muted',t('type: capture (pattern with one group), contains (expect true or false), deploy-file (path with {repo} and {env}, envs). exclude: repositories to skip (pattern).')),text,editorBar);
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,el('p','multi-repo-explain',t('The same rules over every repository of a family, in one table: the Docker base image, the Spring Boot version, the Jenkins SIT build, known traps in pom.xml and the configuration in the deploy repository. A sibling that was missed stands out.')),editor,status,out);
    const fillDeploy=()=>{const list=(state.repos||[]).filter(repo=>repo.valid!==false).sort((a,b)=>a.name.localeCompare(b.name));const keep=localStorage.getItem('gitdeck.deployRepo')||'';deploy.replaceChildren(new Option(t('No deploy repository'),''),...list.map(repo=>new Option(repo.name,repo.path)));const guess=list.find(repo=>repo.path===keep)||list.find(repo=>/deploy/i.test(repo.name));if(guess)deploy.value=guess.path;};
    fillDeploy();
    save.onclick=()=>{try{const parsed=JSON.parse(text.value);if(!Array.isArray(parsed))throw new Error(t('The rules must be a JSON list.'));for(const rule of parsed)if(rule.pattern&&!compile(rule.pattern))throw new Error(t('Invalid pattern in {id}',{id:rule.id||rule.label}));localStorage.setItem(rulesKey,JSON.stringify(parsed));note.textContent=t('Saved');}catch(error){note.textContent=error.message;}};
    reset.onclick=()=>{try{localStorage.removeItem(rulesKey);}catch{}text.value=JSON.stringify(defaultRules,null,2);note.textContent=t('Default rules restored');};
    run.onclick=async()=>{
      const rules=loadRules();const prefix=family.value.trim().toLowerCase();try{localStorage.setItem('gitdeck.familyPrefix',family.value.trim());}catch{}
      const repos=reposIn(folder.value).filter(repo=>!prefix||repo.name.toLowerCase().startsWith(prefix)).filter(repo=>repo.path!==deploy.value&&!/\.worktrees[\\/]/i.test(repo.path));
      if(!repos.length){status.textContent=t('No repositories in this folder.');return;}
      run.disabled=true;out.replaceChildren();let done=0;const total=repos.length;status.textContent=t('Checking {done} of {total}…',{done,total});
      const files=[...new Set(rules.filter(rule=>rule.file).map(rule=>rule.file))];
      const readFile=async(path,file,refName)=>{try{const answer=(await api('/api/repo/file?'+query({path,file,ref:refName}))).file;return answer.exists?answer.content:null;}catch{return null;}};
      const results=await mapLimit(repos,6,async repo=>{
        const texts={};for(const file of files)texts[file]=await readFile(repo.path,file,ref.value.trim());
        const cells={};
        for(const rule of rules){
          if(!applies(rule,repo.name)){cells[rule.id]={state:'skip'};continue;}
          if(rule.type==='deploy-file'){
            if(!deploy.value){cells[rule.id]={state:'none'};continue;}
            const missing=[];for(const envName of rule.envs||['']){const path=String(rule.path).replaceAll('{repo}',repo.name).replaceAll('{env}',envName);if((await readFile(deploy.value,path,''))===null)missing.push(envName||path);}
            cells[rule.id]=missing.length?{state:'bad',value:t('missing: {envs}',{envs:missing.join(', ')})}:{state:'ok'};continue;
          }
          cells[rule.id]=evaluate(rule,texts[rule.file]);
        }
        status.textContent=t('Checking {done} of {total}…',{done:++done,total});
        return {repo,cells};
      });
      run.disabled=false;
      const odd={};for(const rule of rules.filter(rule=>rule.type==='capture'))odd[rule.id]=oddOnes(results.map(item=>item.cells[rule.id]?.value).filter(value=>value!==undefined));
      let issues=0;
      const grid=table([t('Repository'),...rules.map(rule=>rule.label||rule.id)]);grid.classList.add('family-table');
      for(const item of results.sort((a,b)=>a.repo.name.localeCompare(b.repo.name))){
        const cells=rules.map(rule=>{
          const cell=item.cells[rule.id]||{state:'none'};
          if(cell.state==='skip')return el('span','fleet-muted','n/a');
          if(cell.state==='none')return el('span','fleet-muted','—');
          if(cell.state==='value'){const isOdd=odd[rule.id]?.odd.has(cell.value);if(isOdd)issues++;const node=el('span',`fleet-state tone-${isOdd?'warn':'ok'}`,cell.value);if(isOdd)node.title=t('Most repositories have {value}',{value:odd[rule.id].common});return node;}
          if(cell.state==='bad')issues++;
          return el('span',`fleet-state tone-${cell.state==='ok'?'ok':'bad'}`,cell.state==='ok'?'✓':(cell.value||'✗'));
        });
        grid.append(row([repoLink(item.repo),...cells]));
      }
      out.append(grid);
      status.textContent=t('{repos} repositories · {issues} issue(s)',{repos:results.length,issues});
    };
  }

  addPanel('family-checks',t('Family checks'),build);
  const more=document.querySelector('.sync-more > div');
  if(more&&!more.querySelector('[data-multi-repo="family-checks"]')){
    const item=el('button','');item.type='button';item.dataset.multiRepo='family-checks';item.append(el('strong','',t('Family checks')),el('small','',t('The same rules over every repository of a family')));
    item.onclick=()=>{more.parentElement?.removeAttribute('open');if(typeof showOperationsCenter==='function')showOperationsCenter('family-checks');};
    const anchor=more.querySelector('[data-multi-repo="effective-config"]')||more.querySelector('[data-multi-repo="compare-files"]');if(anchor)anchor.after(item);else more.append(item);
  }
  window.GitDeckFamilyChecks=helpers;
})();
