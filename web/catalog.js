'use strict';
// Local service directory, explicit read-only environment and MR checks.
(function(){
  function readinessOf(mr){
    if(!mr)return 'unknown';
    if(mr.state!=='opened'||mr.draft||['failed','canceled','running','pending','manual'].includes(mr.pipeline)||mr.approval?.status==='waiting'||['conflict','cannot_be_merged','not_approved','draft_status'].includes(mr.merge))return 'blocked';
    if(mr.pipeline==='success'&&['approved','not-required'].includes(mr.approval?.status)&&['mergeable','can_be_merged'].includes(mr.merge))return 'ready';
    return 'unknown';
  }
  function snapshotAge(value,now=Date.now()){
    const time=Date.parse(value||'');return Number.isFinite(time)&&time<=now+60000?Math.max(0,now-time):Infinity;
  }
  function ticketMatches(value,key){
    if(!key)return false;
    const escaped=String(key).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp('(^|[^A-Z0-9])'+escaped+'(?![A-Z0-9])','i').test(String(value||''));
  }
  function filterServices(services,words,kind=''){
    const terms=String(words||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return services.filter(s=>(!kind||s.kind===kind)&&terms.every(term=>[s.service,s.name,s.path,s.owner,s.system,s.description].join(' ').toLowerCase().includes(term)));
  }
  const helpers={readinessOf,snapshotAge,ticketMatches,filterServices};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  const F=window.GitDeckFleet;if(!F||typeof api!=='function')return;
  const {addPanel,table,row,query,mapLimit}=F;
  // Explicit literals keep the translation inventory complete for dynamic labels.
  const labelTranslations=new Map([
    [t('Ready at last check'),t('Ready at last check')],[t('Action needed'),t('Action needed')],
    [t('Find service, owner or system'),t('Find service, owner or system')],[t('Refresh catalog'),t('Refresh catalog')],
    [t('Close details'),t('Close details')],[t('Edit metadata'),t('Edit metadata')],[t('CI page'),t('CI page')],
    [t('Copy repository path'),t('Copy repository path')],
    [t('Check environment'),t('Check environment')],[t('Service name'),t('Service name')],[t('Owner'),t('Owner')],[t('System'),t('System')],
    [t('Description'),t('Description')],[t('Documentation link'),t('Documentation link')],[t('CI link'),t('CI link')],
    [t('Environment name'),t('Environment name')],[t('Argo application'),t('Argo application')],[t('CLI context'),t('CLI context')],
    [t('Application namespace (optional)'),t('Application namespace (optional)')],[t('Remove environment'),t('Remove environment')],
    [t('Add environment'),t('Add environment')],[t('Save metadata'),t('Save metadata')],[t('Find dashboard tool'),t('Find dashboard tool')],
    [t('Work'),t('Work')],[t('Inspect'),t('Inspect')],[t('Manage'),t('Manage')]
  ]);
  const translate=label=>labelTranslations.get(label)||t(label);
  const button=(label,fn)=>{const b=el('button','',translate(label));b.type='button';b.onclick=fn;return b;};
  const field=(label,value='')=>{const box=el('label','catalog-field');box.append(el('span','',translate(label)));const input=el('input','workflow-input');input.value=value;input.placeholder=translate(label);input.setAttribute('aria-label',translate(label));box.append(input);return {box,input};};
  const message=(host,text,tone='info')=>host.replaceChildren(el('p','repo-alert tone-'+tone,text));
  const stamp=(value)=>Number.isFinite(Date.parse(value||''))?new Date(value).toLocaleString():t('Unknown');
  function renderReadiness(host,mr){
    const state=readinessOf(mr);host.replaceChildren();
    const title={ready:t('Ready at last check'),blocked:t('Action needed'),unknown:t('Readiness unknown')}[state];
    host.append(el('strong','tone-'+({ready:'ok',blocked:'warn',unknown:'muted'}[state]),translate(title)));
    host.append(el('p','',t('Pipeline')+': '+(mr.pipeline||t('Unknown'))+' · '+t('Approvals')+': '+(mr.approval?.status||t('Unknown'))+' · '+t('Merge status')+': '+(mr.merge||t('Unknown'))));
    if(mr.approval?.required!=null)host.append(el('small','fleet-muted',t('Approval rules remaining: {left} of {required}',mr.approval)));
    host.append(el('small','catalog-stamp',t('Checked')+': '+stamp(mr.checkedAt)+' · '+t('Snapshot only. GitLab decides whether merging is allowed.')));
  }
  async function checkReadiness(repo,iid,host,trigger){
    if(trigger)trigger.disabled=true;message(host,t('Checking readiness…'));
    try{const answer=await api('/api/repo/mr-readiness?'+query({path:repo.path,iid}));renderReadiness(host,answer.readiness);}
    catch(error){message(host,t('Readiness unknown')+': '+error.message,'warn');}
    finally{if(trigger)trigger.disabled=false;}
  }
  async function checkTicket(repo,key,host,trigger){
    trigger.disabled=true;message(host,t('Checking readiness…'));
    try{
      const list=(await api('/api/repo/mrs?'+query({path:repo.path}))).mergeRequests||[];
      const matches=list.filter(mr=>ticketMatches(mr.source,key)||ticketMatches(mr.title,key));
      host.replaceChildren();
      if(!matches.length){message(host,t('No matching open merge requests in the latest 50 results. Check GitLab for older requests.'));return;}
      const results=await mapLimit(matches.slice(0,8),2,async mr=>{try{return {mr,data:(await api('/api/repo/mr-readiness?'+query({path:repo.path,iid:mr.iid}))).readiness};}catch(error){return {mr,error:error.message};}});
      for(const result of results){const box=el('section','catalog-check');box.append(el('b','',`!${result.mr.iid} ${result.mr.title}`));const detail=el('div');box.append(detail);if(result.error)message(detail,t('Readiness unknown')+': '+result.error,'warn');else renderReadiness(detail,result.data);host.append(box);}
      if(matches.length>8)host.append(el('small','fleet-muted',t('Only the first 8 matching requests were checked.')));
    }catch(error){message(host,t('Readiness unknown')+': '+error.message,'warn');}finally{trigger.disabled=false;}
  }
  function buildCatalog(panel){
    const toolbar=el('div','operations-toolbar');const search=field(t('Find service, owner or system'));search.input.type='search';
    const kind=el('select','workflow-input');kind.setAttribute('aria-label',t('Service type'));kind.append(new Option(t('All types'),''));for(const value of ['service','application','library','infrastructure','repository'])kind.append(new Option(value,value));
    const refresh=button(t('Refresh catalog'),()=>load());toolbar.append(search.input,kind,refresh);
    const status=el('p','multi-repo-status');status.setAttribute('role','status');
    const layout=el('div','catalog-layout');const list=el('div','catalog-list');const detail=el('section','catalog-detail');detail.hidden=true;layout.append(list,detail);
    panel.append(toolbar,el('p','multi-repo-explain',t('Owner, system and dependencies are local metadata. Environment checks read Argo CD only when requested; Git configuration is not deployment proof.')),status,layout);
    let services=[];let selected='';let serial=0;let editing=null;
    function leaveEditor(){
      if(editing?.saving)return false;
      if(editing?.dirty&&!confirm(t('Discard unsaved metadata changes?')))return false;
      editing=null;return true;
    }
    function draw(){
      list.replaceChildren();const shown=filterServices(services,search.input.value,kind.value);status.textContent=t('{shown} of {total} services',{shown:shown.length,total:services.length});
      if(!shown.length){message(list,t('No services match. Clear the search or change the type.'));return;}
      const grid=table([t('Service'),t('Owner / system'),t('Type'),t('Environments')]);
      for(const item of shown){const name=button(item.service,()=>{if(!leaveEditor())return;selected=item.path;showDetail(item);draw();});name.textContent=item.service;name.className='catalog-name';name.title=item.path;const cell=el('div');const path=el('small','catalog-path',item.path);path.title=item.path;cell.append(name,path);
        const info=el('div');info.append(el('span','',item.owner||t('Owner not set')),el('small','catalog-path',item.system||t('System not set')));
        const tr=row([cell,info,item.kind,item.environments.length?item.environments.map(e=>e.env.toUpperCase()).join(' · '):t('Not configured')]);[t('Service'),t('Owner / system'),t('Type'),t('Environments')].forEach((label,index)=>{tr.cells[index].dataset.label=label;});tr.classList.toggle('catalog-selected',item.path===selected);grid.append(tr);}
      list.append(grid);
    }
    async function load(){if(!leaveEditor())return;const request=++serial;refresh.disabled=true;status.textContent=t('Reading catalog…');try{const answer=await api('/api/catalog');if(request!==serial)return;services=answer.services||[];draw();if(selected&&!editing){const item=services.find(s=>s.path===selected);if(item)showDetail(item);else detail.hidden=true;}}catch(error){if(request===serial){message(list,error.message,'bad');status.textContent=t('Catalog unavailable');if(!editing)detail.hidden=true;}}finally{if(request===serial)refresh.disabled=false;}}
    function showDetail(item){
      detail.hidden=false;detail.replaceChildren();const head=el('div','catalog-detail-head');head.append(el('h3','',item.service),button(t('Close details'),()=>{selected='';detail.hidden=true;draw();}));detail.append(head);
      detail.append(el('p','catalog-path',item.path));if(item.description)detail.append(el('p','',item.description));
      const actions=el('div','catalog-inline');const open=button(t('Open repository'),()=>F.openRepo({path:item.path,name:item.name}));open.disabled=!item.available;const copy=button(t('Copy repository path'),async()=>{try{await navigator.clipboard.writeText(item.path);copy.textContent=t('Copied');}catch{copy.textContent=t('Could not copy');}});actions.append(open,copy,button(t('Edit metadata'),()=>edit(item)));
      for(const [label,url] of [[t('Documentation'),item.docs],[t('CI page'),item.ci]])if(url){const b=button(label,()=>api('/api/action',{method:'POST',body:JSON.stringify({action:'open-url',url})}).catch(error=>message(detail,error.message,'warn')));actions.append(b);}detail.append(actions);
      detail.append(el('h4','',t('Dependencies')));if(!item.dependencies.length)detail.append(el('p','fleet-muted',t('No dependencies recorded.')));for(const path of item.dependencies){const target=services.find(s=>s.path===path);detail.append(button(target?.service||path,()=>{if(target){selected=path;showDetail(target);draw();}}));}
      detail.append(el('h4','',t('Observed environments')),el('p','fleet-muted',t('Read-only controller snapshots, not a request to sync or deploy.')));
      if(!item.environments.length)detail.append(el('p','fleet-muted',t('Edit metadata to map an environment to an Argo CD application and explicit CLI context.')));
      for(const binding of item.environments){const section=el('section','catalog-check');section.append(el('strong','',binding.env.toUpperCase()),el('small','catalog-path',binding.app+' · '+binding.context));const result=el('div');
        const check=button(t('Check environment'),async()=>{check.disabled=true;message(result,t('Reading Argo CD…'));try{const data=(await api('/api/repo/observed-env?'+query({path:item.path,env:binding.env}))).observed;result.replaceChildren();const stale=snapshotAge(data.reconciledAt)>5*60*1000;result.append(el('p',stale?'tone-warn':'',t('Health')+': '+(data.health||t('Unknown'))+' · '+t('Sync')+': '+(data.sync||t('Unknown'))));if(stale)result.append(el('strong','tone-warn',t('Controller data is stale or has no timestamp.')));result.append(el('p','catalog-path',t('Revision')+': '+([data.revision,...(data.revisions||[])].filter(Boolean).join(', ')||t('Unknown'))));for(const image of data.images||[])result.append(el('code','catalog-image',image));result.append(el('small','catalog-stamp',t('Controller observed')+': '+stamp(data.reconciledAt)+' · '+t('Checked')+': '+stamp(data.checkedAt)));}catch(error){message(result,t('Environment unknown')+': '+error.message,'warn');}finally{check.disabled=false;}});section.append(check,result);detail.append(section);}
      detail.append(el('small','catalog-stamp',t('Metadata saved')+': '+stamp(item.updatedAt)));
    }
    function edit(item){
      editing={dirty:false,saving:false};const session=editing;
      detail.replaceChildren(el('h3','',t('Edit local metadata')));const form=el('form','catalog-form');const fields={};
      for(const [key,label] of [['service',t('Service name')],['owner',t('Owner')],['system',t('System')],['description',t('Description')],['docs',t('Documentation link')],['ci',t('CI link')]]){fields[key]=field(label,item[key]);fields[key].input.maxLength=key==='description'||key==='docs'||key==='ci'?1000:200;form.append(fields[key].box);}fields.service.input.required=true;
      const type=el('select','workflow-input');type.setAttribute('aria-label',t('Service type'));for(const value of ['service','application','library','infrastructure','repository'])type.append(new Option(value,value));type.value=item.kind;form.append(type,el('h4','',t('Dependencies')));
      const deps=[];const options=services.filter(s=>s.path!==item.path);for(const path of item.dependencies)if(!options.some(s=>s.path.toLowerCase()===path.toLowerCase()))options.push({path,service:path+' ('+t('Unavailable')+')'});for(const other of options){const label=el('label','settings-check');const box=el('input');box.type='checkbox';box.checked=item.dependencies.some(path=>path.toLowerCase()===other.path.toLowerCase());label.append(box,el('span','',other.service));deps.push({path:other.path,box});form.append(label);}
      form.append(el('h4','',t('Argo CD bindings')),el('p','fleet-muted',t('Use an existing CLI context. Never enter tokens or passwords.')));const bindings=el('div');const envRows=[];
      const addEnv=(binding={})=>{if(envRows.length>=8)return;const box=el('fieldset','catalog-binding');const inputs={};for(const [key,label] of [['env',t('Environment name')],['app',t('Argo application')],['context',t('CLI context')],['namespace',t('Application namespace (optional)')]]){inputs[key]=field(label,binding[key]);if(key!=='namespace')inputs[key].input.required=true;box.append(inputs[key].box);}const entry={box,inputs};box.append(button(t('Remove environment'),()=>{session.dirty=true;envRows.splice(envRows.indexOf(entry),1);box.remove();}));envRows.push(entry);bindings.append(box);};item.environments.forEach(addEnv);form.append(bindings,button(t('Add environment'),()=>{session.dirty=true;addEnv();}));
      const error=el('p','catalog-form-error');error.setAttribute('role','alert');const save=button(t('Save metadata'));save.type='submit';form.append(error,save,button(t('Cancel'),()=>{if(leaveEditor())showDetail(item);}));form.addEventListener('input',()=>session.dirty=true);form.addEventListener('change',()=>session.dirty=true);
      form.onsubmit=async event=>{event.preventDefault();if(session.saving)return;session.saving=true;refresh.disabled=true;const controls=[...form.querySelectorAll('input,select,button')];controls.forEach(control=>control.disabled=true);error.textContent='';try{await api('/api/action',{method:'POST',body:JSON.stringify({action:'catalog-save',path:item.path,expectedUpdatedAt:item.updatedAt||'',...Object.fromEntries(Object.entries(fields).map(([key,f])=>[key,f.input.value])),kind:type.value,dependencies:deps.filter(d=>d.box.checked).map(d=>d.path),environments:envRows.map(r=>Object.fromEntries(Object.entries(r.inputs).map(([key,f])=>[key,f.input.value])))})});editing=null;await load();}catch(problem){error.textContent=problem.message;}finally{session.saving=false;controls.forEach(control=>control.disabled=false);refresh.disabled=false;}};detail.append(form);fields.service.input.focus();
    }
    search.input.addEventListener('input',draw);kind.addEventListener('change',draw);load();
  }
  addPanel('catalog',t('Service catalog'),buildCatalog);
  // Existing buttons are moved, not recreated, preserving handlers and lazy view builders.
  const nav=document.querySelector('.operations-tabs');const modal=document.querySelector('.operations-modal');
  if(nav&&modal){
    modal.classList.add('catalog-dashboard');nav.classList.add('catalog-navigation');
    const tabs=[...nav.querySelectorAll('[data-operations-view]')];const search=field(t('Find dashboard tool'));search.input.type='search';nav.append(search.input);
    const select=el('select','catalog-mobile-select');select.setAttribute('aria-label',t('Dashboard view'));nav.append(select);
    const groups=[[t('Work'),['pending','update-all','switch-all','search-all','tag-all','ticket']],[t('Inspect'),['catalog','compare-files','ci','releases','merge-requests','dependencies','fleet']],[t('Manage'),['jobs','automation']]];
    const assigned=new Set();for(const [label,ids] of groups){const group=el('section','catalog-nav-group');group.append(el('h3','',translate(label)));for(const tab of tabs.filter(b=>ids.includes(b.dataset.operationsView))){group.append(tab);assigned.add(tab);}nav.append(group);}
    const other=el('section','catalog-nav-group');other.append(el('h3','',t('More tools')));for(const tab of tabs)if(!assigned.has(tab))other.append(tab);if(other.children.length>1)nav.append(other);
    tabs.forEach(tab=>{select.append(new Option(tab.textContent,tab.dataset.operationsView));tab.addEventListener('click',()=>{select.value=tab.dataset.operationsView;});});select.onchange=()=>tabs.find(b=>b.dataset.operationsView===select.value)?.click();
    search.input.oninput=()=>{const term=search.input.value.trim().toLowerCase();tabs.forEach(tab=>{tab.hidden=!tab.textContent.toLowerCase().includes(term);});nav.querySelectorAll('.catalog-nav-group').forEach(group=>{group.hidden=![...group.querySelectorAll('button')].some(b=>!b.hidden);});};
    search.input.onkeydown=event=>{if(event.key==='Enter'){const first=tabs.find(b=>!b.hidden);if(first){first.click();first.focus();}}};
    nav.addEventListener('keydown',event=>{if(!event.target.matches('button[data-operations-view]'))return;const visible=[...nav.querySelectorAll('[data-operations-view]')].filter(b=>!b.hidden&&b.getClientRects().length);const index=visible.indexOf(event.target);let next;if(event.key==='ArrowDown')next=visible[(index+1)%visible.length];if(event.key==='ArrowUp')next=visible[(index-1+visible.length)%visible.length];if(event.key==='Home')next=visible[0];if(event.key==='End')next=visible.at(-1);if(next){event.preventDefault();next.focus();}});
    const update=()=>{const active=tabs.find(tab=>tab.classList.contains('active'));if(active)select.value=active.dataset.operationsView;};new MutationObserver(update).observe(nav,{subtree:true,attributes:true,attributeFilter:['class']});update();
  }
  window.GitDeckCatalog={...helpers,checkReadiness,checkTicket,renderReadiness};
})();
