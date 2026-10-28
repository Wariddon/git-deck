'use strict';
// Recipes: record a sequence you repeat (switch to main in three repositories, pull, tag, push…) and
// replay it from Ctrl+K. Ctrl+K › "Record a recipe" captures every fetch, pull, push, switch, branch,
// tag, stash and merge you run, in any window part, until you stop and name it. Replaying shows the
// steps first and runs only after you press Run, one at a time, stopping at the first failure.
// Commits, resets and discards are never recorded. Recipes are kept on this computer.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  const recordable=new Set(['fetch','pull','push','branch-switch','branch-create','tag-create','tag-push','stash-save','stash-pop','merge']);
  // One request body -> a recipe step, or null when it is not something to replay.
  function captureStep(body){
    if(!body||!recordable.has(body.action)||!body.path)return null;
    const {action,path,...payload}=body;
    return {action,path:String(path),payload};
  }
  const nameOf=(path)=>String(path||'').split(/[\\/]/).filter(Boolean).pop()||String(path||'');
  function describeStep(step){
    const p=step.payload||{};
    const detail=p.branch||p.tag||p.message||p.remote||'';
    return `${nameOf(step.path)} · ${step.action}${detail?` ${detail}`:''}`;
  }
  function addRecipe(list,name,steps,limit=40){
    const clean=String(name||'').trim();if(!clean||!steps?.length)return list||[];
    return [{name:clean,steps,at:Date.now()},...(list||[]).filter(item=>item.name!==clean)].slice(0,limit);
  }
  const helpers={recordable,captureStep,describeStep,addRecipe};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof api!=='function'||typeof el!=='function'||typeof commandPaletteEntries!=='function')return;

  const key='gitdeck.recipes';
  const load=()=>{try{return JSON.parse(localStorage.getItem(key)||'[]')||[];}catch{return [];}};
  const store=(list)=>{try{localStorage.setItem(key,JSON.stringify(list));}catch{}};
  let recording=null,replaying=false,pill=null;
  const drawPill=()=>{
    if(!recording){pill?.remove();pill=null;return;}
    if(!pill){pill=el('button','gd-recording');pill.type='button';pill.onclick=stop;document.getElementById('workspace-statusbar')?.append(pill);if(!pill.isConnected)document.body.append(pill);}
    pill.textContent=t('● Recording · {count} step(s) · Stop',{count:recording.length});
  };
  const baseApi=api;
  api=async function(path,options={}){
    const result=await baseApi(path,options);
    if(recording&&!replaying&&path==='/api/action'&&String(options.method||'').toUpperCase()==='POST'){
      let body={};try{body=JSON.parse(options.body||'{}');}catch{}
      const step=captureStep(body);if(step){recording.push(step);drawPill();}
    }
    return result;
  };
  function start(){if(typeof hideCommandPalette==='function')hideCommandPalette();recording=[];drawPill();if(typeof showActionFeedback==='function')showActionFeedback(t('Recording: fetch, pull, push, switch, branch, tag, stash and merge are captured until you press Stop.'));}
  function stop(){
    const steps=recording||[];recording=null;drawPill();
    if(typeof releaseDialog!=='function')return;
    const ui=releaseDialog(t('Save recipe'));
    if(!steps.length){ui.body.append(el('p','',t('Nothing was recorded.')));return;}
    const list=el('ol','recipe-steps');for(const step of steps)list.append(el('li','mono',describeStep(step)));
    const name=el('input','workflow-input');name.placeholder=t('Recipe name, for example Morning pull crs-');name.setAttribute('aria-label',name.placeholder);
    const save=el('button','primary',t('Save'));save.type='button';
    save.onclick=()=>{if(!name.value.trim()){name.focus();return;}store(addRecipe(load(),name.value,steps));ui.dialog.close();if(typeof showActionFeedback==='function')showActionFeedback(t('Recipe {name} saved: Ctrl+K and type its name.',{name:name.value.trim()}));};
    ui.body.append(list,name);ui.actions.prepend(save);name.focus();
  }
  function replay(recipe){
    if(typeof hideCommandPalette==='function')hideCommandPalette();
    const ui=releaseDialog(t('Recipe · {name}',{name:recipe.name}));
    ui.body.append(el('p','fleet-muted',t('{count} step(s). Nothing runs until you press Run; the first failure stops the rest.',{count:recipe.steps.length})));
    const list=el('ol','recipe-steps');const rows=recipe.steps.map(step=>{const li=el('li','');const result=el('small','recipe-result');li.append(el('span','mono',describeStep(step)),' ',result);list.append(li);return result;});
    const run=el('button','primary',t('Run'));run.type='button';
    const remove=el('button','',t('Delete recipe'));remove.type='button';
    remove.onclick=()=>{if(!confirm(t('Delete recipe {name}?',{name:recipe.name})))return;store(load().filter(item=>item.name!==recipe.name));ui.dialog.close();};
    run.onclick=async()=>{
      run.disabled=true;remove.disabled=true;replaying=true;
      const quiet=window.GitDeckFleet?.runQuiet;
      try{
        for(let i=0;i<recipe.steps.length;i++){
          const step=recipe.steps[i];rows[i].textContent=t('Running…');
          try{
            const repo=(state.repos||[]).find(item=>String(item.path).toLowerCase()===step.path.toLowerCase())||{path:step.path,name:nameOf(step.path)};
            if(quiet)await quiet(step.action,repo,step.payload);else await baseApi('/api/action',{method:'POST',body:JSON.stringify({action:step.action,path:step.path,...step.payload})});
            rows[i].textContent='✓';rows[i].className='recipe-result tone-ok';
          }catch(error){rows[i].textContent='✗ '+String(error.message||'').split('\n')[0];rows[i].className='recipe-result tone-bad';for(let j=i+1;j<rows.length;j++)rows[j].textContent=t('Not run');break;}
        }
      }finally{replaying=false;if(typeof loadWorkspace==='function'&&state?.workspaceRepo)void loadWorkspace();}
    };
    ui.body.append(list);ui.actions.prepend(remove,run);
  }
  const base=commandPaletteEntries;
  commandPaletteEntries=function(){
    const group=t('Recipes');
    const entries=recording?[{label:t('Stop recording and save the recipe'),group,shortcut:'',run:()=>{if(typeof hideCommandPalette==='function')hideCommandPalette();stop();}}]:[{label:t('Record a recipe'),group,shortcut:'',run:start}];
    for(const recipe of load())entries.push({label:t('Recipe: {name}',{name:recipe.name}),group,shortcut:t('{count} step(s)',{count:recipe.steps.length}),run:()=>replay(recipe)});
    return [...base(),...entries.map(item=>({...item,search:`${item.label} ${group}`}))];
  };
})();
