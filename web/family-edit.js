'use strict';
// Family edit (server side: lib/GitDeck.Agents.ps1): the same change to one file in every repository
// of a family (bump the Docker base image, a pom property...). Preview reads the file from the ticket
// worktree (or where it would start) and shows the diff per repository; Apply writes it in the ticket
// worktree on feature/<KEY>, commits that file alone and optionally pushes (GitLab answers with the
// merge request link). Your own folders and branches are not touched.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const presets={
    'base-image':{label:'Docker base image',file:'Dockerfile',regex:true,find:'(eclipse-temurin:)\\S+',replace:'$1'},
    'pom-property':{label:'pom.xml property',file:'pom.xml',regex:true,find:'(<java.version>)[^<]*(</java.version>)',replace:'$1$2'},
    'spring-boot':{label:'Spring Boot parent',file:'pom.xml',regex:true,find:'(<artifactId>spring-boot-starter-parent</artifactId>\\s*<version>)[^<]+(</version>)',replace:'$1$2'},
  };
  // {after, count, error}: literal text or a regular expression (with $1 groups), every match.
  function applyEdit(text,{find,replace='',regex=false}){
    text=String(text??'');if(!find)return {after:text,count:0};
    if(!regex){const parts=text.split(find);return {after:parts.join(replace),count:parts.length-1};}
    let re;try{re=new RegExp(find,'gm');}catch(error){return {after:text,count:0,error:error.message};}
    const count=(text.match(re)||[]).length;return {after:text.replace(re,replace),count};
  }
  const helpers={presets,applyEdit};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,folderSelect,reposIn,repoLink,mapLimit,runQuiet,query,lineDiff}=F;
  const feedback=(text,error=false)=>{if(typeof showActionFeedback==='function')showActionFeedback(text,{error});};
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const input=(placeholder,type='search')=>{const node=el('input','workflow-input');node.type=type;node.placeholder=placeholder;node.setAttribute('aria-label',placeholder);return node;};
  const remember=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
  const recall=(key,fallback='')=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};

  function diffView(lines){
    const pre=el('div','diff-code fleet-diff');let shown=0;
    lines.forEach((line,index)=>{const near=lines.slice(Math.max(0,index-2),index+3).some(l=>l[0]!==' ');if(!near||shown++>300)return;pre.append(el('div',line[0]==='+'?'diff-add':line[0]==='-'?'diff-remove':'',`${line[0]} ${line[1]}`));});
    return pre;
  }

  function build(panel){
    const bar=el('div','operations-toolbar');const folder=folderSelect();
    const family=input(t('Family, for example depinq- or crs-'));family.value=recall('gitdeck.familyPrefix');
    const key=input(t('Ticket key, for example PAY-1234'));key.value=recall('gitdeck.familyEditKey');
    const start=input(t('Start from (empty: origin/develop, main or master)'));start.classList.add('fleet-ref');
    const preview=button(t('Preview'),'primary');bar.append(folder,family,key,start,preview);
    const fields=el('div','operations-toolbar family-edit-fields');
    const preset=document.createElement('select');preset.className='workflow-input';preset.setAttribute('aria-label',t('Preset'));
    preset.append(new Option(t('Preset…'),''),...Object.entries(presets).map(([id,item])=>new Option(t(item.label),id)));
    const file=input(t('File, for example pom.xml or Dockerfile'));file.value=recall('gitdeck.familyEditFile','Dockerfile');
    const find=input(t('Find'));const replace=input(t('Replace with'));
    const regexLabel=el('label','fleet-check');const regex=el('input');regex.type='checkbox';regexLabel.append(regex,el('span','',t('Regular expression ($1 for groups)')));
    fields.append(preset,file,find,replace,regexLabel);
    const applyBar=el('div','fleet-options');const message=input(t('Commit message (empty: <KEY> update <file>)'));message.classList.add('family-edit-message');
    const pushLabel=el('label','fleet-check');const push=el('input');push.type='checkbox';push.checked=recall('gitdeck.familyEditPush','1')==='1';pushLabel.append(push,el('span','',t('Push feature/<KEY> (GitLab gives the merge request link)')));
    const apply=button(t('Apply'),'primary');apply.disabled=true;applyBar.append(message,pushLabel,apply);applyBar.hidden=true;
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    panel.append(bar,fields,el('p','multi-repo-explain',t('The same change to one file in every repository of a family, for example a new Docker base image. Each repository gets its ticket worktree on feature/<KEY>; you see every diff before anything is written, and only that file is committed. Your own folders and branches stay as they are.')),applyBar,status,out);
    preset.onchange=()=>{const item=presets[preset.value];if(!item)return;file.value=item.file;find.value=item.find;replace.value=item.replace;regex.checked=item.regex;replace.focus();};
    let rows=[];
    const count=()=>rows.filter(item=>item.box.checked).length;
    const refresh=()=>{const n=count();apply.disabled=!n;apply.textContent=n?t('Apply to {count} repositories',{count:n}):t('Apply');};
    preview.onclick=async()=>{
      const k=key.value.trim().toUpperCase();
      if(!/^[A-Z][A-Z0-9]{1,9}-\d{1,12}$/.test(k)){status.textContent=t('Use a ticket key, for example PAY-1234.');key.focus();return;}
      if(!file.value.trim()||!find.value){status.textContent=t('Fill in the file and what to find.');return;}
      const probe=applyEdit('',{find:find.value,replace:replace.value,regex:regex.checked});if(probe.error){status.textContent=probe.error;return;}
      remember('gitdeck.familyPrefix',family.value.trim());remember('gitdeck.familyEditKey',k);remember('gitdeck.familyEditFile',file.value.trim());
      const prefix=family.value.trim().toLowerCase();
      const repos=reposIn(folder.value).filter(repo=>!/\.worktrees[\\/]/i.test(repo.path)&&(!prefix||repo.name.toLowerCase().startsWith(prefix)));
      if(!repos.length){status.textContent=t('No repositories in this folder.');return;}
      preview.disabled=true;out.replaceChildren();applyBar.hidden=true;rows=[];let done=0;
      status.textContent=t('Reading {done} of {total}…',{done,total:repos.length});
      const found=await mapLimit(repos,6,async repo=>{
        let source=null,error='';
        try{source=(await api('/api/repo/family-edit-source?'+query({path:repo.path,key:k,file:file.value.trim(),start:start.value.trim()}))).source;}catch(problem){error=problem.message;}
        status.textContent=t('Reading {done} of {total}…',{done:++done,total:repos.length});
        return {repo,source,error};
      });
      preview.disabled=false;
      let changing=0,unchanged=0,missing=0;
      for(const item of found.sort((a,b)=>a.repo.name.localeCompare(b.repo.name))){
        const card=el('div','family-edit-card');const head=el('div','family-edit-head');const result=el('span','multi-repo-result');
        if(item.error||!item.source?.exists){missing++;head.append(repoLink(item.repo),el('span','fleet-muted',item.error||t('No {file} at {ref}',{file:file.value.trim(),ref:item.source?.ref||''})));card.append(head);out.append(card);continue;}
        const edit=applyEdit(item.source.content,{find:find.value,replace:replace.value,regex:regex.checked});
        if(!edit.count||edit.after===item.source.content){unchanged++;head.append(repoLink(item.repo),el('span','fleet-muted',edit.count?t('Already up to date'):t('No match')));card.append(head);out.append(card);continue;}
        changing++;
        const box=el('input');box.type='checkbox';box.checked=true;box.onchange=refresh;
        const from=item.source.from==='worktree'?t('ticket worktree'):item.source.ref;
        head.append(box,repoLink(item.repo),el('small','fleet-muted',t('{count} change(s) · from {from}',{count:edit.count,from})),result);
        const lines=lineDiff?lineDiff(item.source.content,edit.after):null;
        card.append(head);if(lines)card.append(diffView(lines));out.append(card);
        rows.push({repo:item.repo,box,result,before:item.source.content,after:edit.after});
      }
      applyBar.hidden=!rows.length;refresh();
      status.textContent=t('{changing} to change · {unchanged} without a match or already done · {missing} without the file',{changing,unchanged,missing});
    };
    push.onchange=()=>remember('gitdeck.familyEditPush',push.checked?'1':'0');
    apply.onclick=async()=>{
      const todo=rows.filter(item=>item.box.checked);if(!todo.length)return;
      const k=key.value.trim().toUpperCase();
      if(!confirm(t('Commit {file} on feature/{key} in {count} repositories{push}?',{file:file.value.trim(),key:k,count:todo.length,push:push.checked?t(' and push them'):''})+'\n\n'+todo.map(item=>item.repo.name).join('\n')))return;
      apply.disabled=preview.disabled=true;let ok=0,failed=0;
      await mapLimit(todo,2,async item=>{
        item.result.className='multi-repo-result';item.result.textContent=t('Working…');
        try{
          const answer=await runQuiet('family-edit',item.repo,{key:k,file:file.value.trim(),before:item.before,after:item.after,message:message.value.trim(),push:push.checked,start:start.value.trim()});
          const value=answer?.result||answer;item.result.replaceChildren(el('span','',value?.message||t('Done')));item.result.classList.add('tone-ok');
          if(value?.mergeRequest){const link=el('a','',t('Open merge request'));link.href=value.mergeRequest;link.target='_blank';link.rel='noopener';item.result.append(' ',link);}
          item.box.checked=false;item.box.disabled=true;ok++;
        }catch(error){item.result.textContent=error.message;item.result.classList.add('tone-bad');failed++;}
      });
      preview.disabled=false;refresh();
      status.textContent=t('{ok} committed · {failed} failed',{ok,failed});feedback(t('{ok} committed · {failed} failed',{ok,failed}),failed>0);
    };
  }

  addPanel('family-edit',t('Family edit'),build);
  const more=document.querySelector('.sync-more > div');
  if(more&&!more.querySelector('[data-multi-repo="family-edit"]')){
    const item=el('button','');item.type='button';item.dataset.multiRepo='family-edit';item.append(el('strong','',t('Family edit')),el('small','',t('The same change to one file in every repository of a family')));
    item.onclick=()=>{more.parentElement?.removeAttribute('open');if(typeof showOperationsCenter==='function')showOperationsCenter('family-edit');};
    const anchor=more.querySelector('[data-multi-repo="family-checks"]');if(anchor)anchor.after(item);else more.append(item);
  }
  window.GitDeckFamilyEdit=helpers;
})();
