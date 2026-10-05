'use strict';
// Custom actions (Sourcetree's Custom Actions): your own programs in the right-click menus of commits,
// files, branches and repository tabs, with $REPO, $SHA, $FILE and $BRANCH filled in. The list lives
// on the server (git-deck-custom-actions.json) and runs there; the page only lists and edits it.
(function(){
  if(typeof api!=='function'||typeof showContextMenu!=='function')return;
  let actions=[];
  const load=async()=>{try{actions=(await api('/api/custom-actions')).actions||[];}catch{actions=[];}};
  void load();
  const sep={separator:true};
  const targets=[['commit',()=>t('Commits')],['file',()=>t('Files')],['branch',()=>t('Branches')],['repo',()=>t('Repository tabs')]];

  async function runFor(repo,action,values){
    if(!repo)return;
    if(state.workspaceRepo&&repo.path===state.workspaceRepo.path)return runWorkspaceAction('custom-action-run',{id:action.id,...values},'');
    try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'custom-action-run',path:repo.path,id:action.id,...values})});showActionFeedback(result.message);if(result.output)setOutput(result.output,{collapse:true});}
    catch(error){showActionFeedback(error.message,{error:true,context:`${repo.name} · ${action.name}`});}
  }
  function items(target,values,repo=state.workspaceRepo){
    const matching=actions.filter(action=>(action.targets||[]).includes(target));
    return [sep,...matching.map(action=>({label:action.name,hint:t('Custom action'),run:()=>runFor(repo,action,values)})),{label:t('Custom actions…'),run:openManager}];
  }

  // ---- Menus ------------------------------------------------------------------------------------------
  if(typeof commitContextItems==='function'){const base=commitContextItems;commitContextItems=function(item){return [...base(item),...items('commit',{sha:item.fullHash})];};}
  if(typeof workingFileContextItems==='function'){const base=workingFileContextItems;workingFileContextItems=function(file,...rest){return [...base(file,...rest),...items('file',{file:file.path})];};}
  if(typeof branchOperationContextItems==='function'){const base=branchOperationContextItems;branchOperationContextItems=function(data,branch,kind){return [...base(data,branch,kind),...items('branch',{branch:branch.name})];};}
  if(typeof repositoryTabContextItems==='function'){const base=repositoryTabContextItems;repositoryTabContextItems=function(repo,close){return [...base(repo,close),...items('repo',{},repo)];};}

  // ---- Manager dialog -----------------------------------------------------------------------------------
  async function save(list,ui){
    try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({action:'custom-actions-save',actions:list})});actions=result.actions||[];showActionFeedback(result.message);return true;}
    catch(error){ui.body.querySelector('.custom-action-status')?.remove();const status=el('p','custom-action-status push-review-warning',error.message);ui.body.append(status);return false;}
  }
  function editor(ui,action,onDone){
    ui.body.replaceChildren();
    const form=el('form','modern-dialog-form custom-action-form');
    const field=(label,input)=>{const box=el('label','custom-action-field');box.append(el('span','',label),input);return box;};
    const name=el('input','workflow-input');name.value=action.name||'';name.maxLength=60;name.required=true;name.placeholder=t('Open in IntelliJ');
    const command=el('input','workflow-input');command.value=action.command||'';command.required=true;command.placeholder='C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe';
    const args=el('input','workflow-input');args.value=action.arguments||'';args.placeholder='$FILE';
    const where=el('fieldset','custom-action-targets');where.append(el('legend','',t('Show in the right-click menu of')));
    const boxes=targets.map(([id,label])=>{const box=document.createElement('input');box.type='checkbox';box.value=id;box.checked=(action.targets||['commit']).includes(id);const tag=el('label','modern-dialog-check');tag.append(box,el('span','',label()));where.append(tag);return box;});
    const output=document.createElement('input');output.type='checkbox';output.checked=Boolean(action.showOutput);
    const outputLabel=el('label','modern-dialog-check');outputLabel.append(output,el('span','',t('Wait and show the output in Git Deck (for scripts); otherwise just start the program')));
    form.append(field(t('Menu name'),name),field(t('Program to run'),command),field(t('Parameters'),args),
      el('p','custom-action-help',t('Placeholders: $REPO repository folder, $SHA commit, $FILE full file path, $BRANCH branch name. Each is passed as one argument.')),
      where,outputLabel);
    ui.body.append(form);
    const actionsBar=ui.actions;actionsBar.querySelectorAll('.custom-action-button').forEach(node=>node.remove());
    const back=el('button','custom-action-button',t('Back'));back.type='button';back.onclick=()=>onDone(null);
    const ok=el('button','primary custom-action-button',t('Save'));ok.type='button';
    ok.onclick=()=>{if(!form.reportValidity())return;onDone({id:action.id,name:name.value.trim(),command:command.value.trim(),arguments:args.value.trim(),targets:boxes.filter(box=>box.checked).map(box=>box.value),showOutput:output.checked});};
    actionsBar.append(back,ok);setTimeout(()=>name.focus(),0);
  }
  function openManager(){
    if(typeof releaseDialog!=='function')return;
    const ui=releaseDialog(t('Custom actions'));ui.dialog.classList.add('modern-action-dialog','custom-actions-dialog');
    const list=()=>{
      ui.body.replaceChildren(el('p','',t('Your own programs in the right-click menus, like Sourcetree. They run on this computer with the values of what you clicked.')));
      ui.actions.querySelectorAll('.custom-action-button').forEach(node=>node.remove());
      if(!actions.length)ui.body.append(el('p','custom-action-empty',t('No custom actions yet.')));
      actions.forEach((action,index)=>{
        const row=el('div','custom-action-row');
        const text=el('div');text.append(el('strong','',action.name),el('small','',`${action.command} ${action.arguments||''}`.trim()));
        const edit=el('button','',t('Edit'));edit.type='button';edit.onclick=()=>editor(ui,action,async(updated)=>{if(updated){const next=actions.slice();next[index]=updated;if(!await save(next,ui))return;}list();});
        const remove=el('button','danger',t('Delete'));remove.type='button';remove.onclick=async()=>{if(!confirm(t('Delete the custom action {name}?',{name:action.name})))return;const next=actions.filter((_,i)=>i!==index);if(await save(next,ui))list();};
        row.append(text,edit,remove);ui.body.append(row);
      });
      const add=el('button','primary custom-action-button',t('Add action'));add.type='button';
      add.onclick=()=>editor(ui,{targets:['commit']},async(created)=>{if(created){if(!await save([...actions,created],ui))return;}list();});
      ui.actions.append(add);
    };
    void load().then(list);
  }

  // A way in that does not need a right-click: More menu and command palette.
  const more=document.querySelector('.sync-more > div');
  if(more&&!more.querySelector('[data-custom-actions]')){
    const button=el('button','');button.type='button';button.dataset.customActions='1';
    button.append(el('strong','',t('⚡ Custom actions')),el('small','',t('Your own programs in right-click menus')));
    button.onclick=()=>{more.parentElement?.removeAttribute('open');openManager();};more.append(button);
  }
  if(typeof commandPaletteEntries==='function'){const base=commandPaletteEntries;commandPaletteEntries=function(){const label=t('Custom actions…'),group=t('Tools');return [...base(),{label,group,shortcut:'',run:openManager,search:`${label} ${group}`}];};}

  window.GitDeckCustomActions={items,openManager,reload:load,get list(){return actions;}};
})();
