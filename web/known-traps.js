'use strict';
// Known traps (server side: lib/GitDeck.Traps.ps1): the built-in checks Push checks runs on added
// lines, plus your own. A lesson you write down (for example in your notes) becomes a rule: a file
// pattern, a line pattern and what to check. Push checks and the coding agents (MCP push_risk) use it
// from the next push. Kept on this computer (git-deck-traps.json).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // Does a rule fire on a sample line of a file? {ok, error}
  function tryRule(rule,file,line){
    try{
      const fileRe=new RegExp(rule.file),lineRe=new RegExp(rule.line.replace(/^\(\?i\)/,''),/^\(\?i\)/.test(rule.line)?'i':'');
      const also=rule.also?new RegExp(rule.also.replace(/^\(\?i\)/,''),/^\(\?i\)/.test(rule.also)?'i':''):null;
      return {ok:fileRe.test(file)&&lineRe.test(line)&&(!also||also.test(line))};
    }catch(error){return {ok:false,error:error.message};}
  }
  const slug=(text)=>String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'rule';
  const helpers={tryRule,slug};
  if(typeof module!=='undefined'){module.exports=helpers;return;}

  const F=window.GitDeckFleet;
  if(!F||typeof el!=='function'||typeof api!=='function'||!document.querySelector('.operations-tabs'))return;
  const {addPanel,table,row}=F;
  const button=(label,className='')=>{const node=el('button',className,label);node.type='button';return node;};
  const input=(placeholder)=>{const node=el('input','workflow-input');node.type='text';node.placeholder=placeholder;node.setAttribute('aria-label',placeholder);return node;};

  function build(panel){
    const status=el('small','multi-repo-status');const out=el('div','multi-repo-body');
    const form=el('details','fleet-mr-create known-traps-form');form.append(el('summary','',t('Add a trap you learned')));
    const label=input(t('Name, for example Content-Length forwarded'));const file=input(t('Files (regular expression), for example \\.java$'));
    const line=input(t('Added line (regular expression), for example @Value\\("\\$\\{'));const detail=el('textarea','workflow-input');detail.rows=2;detail.placeholder=t('What to check, in one or two sentences');
    const note=input(t('Where the lesson is written (optional), for example knowledge/notes/2026-10-01-config.md'));
    const sampleFile=input(t('Try on a file, for example src/main/java/A.java'));const sampleLine=input(t('Try on a line'));const tryNote=el('small','fleet-muted','');
    const add=button(t('Add rule'),'primary');
    form.append(label,file,line,detail,note,sampleFile,sampleLine,tryNote,add);
    panel.append(el('p','multi-repo-explain',t('Push checks look for these patterns in the lines you add and warn with the file and line. Add your own lessons: they apply from the next push, for you and for coding agents asking Git Deck (MCP push_risk).')),form,status,out);
    let custom=[];
    const preview=()=>{if(!file.value||!line.value||!sampleFile.value){tryNote.textContent='';return;}const result=tryRule({file:file.value,line:line.value},sampleFile.value,sampleLine.value);tryNote.textContent=result.error||(result.ok?t('✓ This rule would warn on that line.'):t('✗ This rule would not fire on that line.'));};
    for(const node of [file,line,sampleFile,sampleLine])node.addEventListener('input',preview);
    const save=async(rules)=>{const answer=await api('/api/action',{method:'POST',body:JSON.stringify({action:'traps-save',rules})});status.textContent=answer.message||t('Saved');};
    const draw=(builtIn)=>{
      out.replaceChildren();
      const grid=table([t('Trap'),t('Files'),t('Added line'),t('What to check'),'']);grid.classList.add('api-table');
      for(const rule of [...custom.map(item=>({...item,custom:true})),...builtIn]){
        const name=el('div','');name.append(el('strong','',rule.label||rule.id),el('small','fleet-muted',rule.custom?' · '+t('yours'):' · '+t('built in')));
        const actions=el('div','');
        if(rule.custom){const remove=button(t('Remove'));remove.onclick=async()=>{if(!confirm(t('Remove the rule {name}?',{name:rule.label||rule.id})))return;custom=custom.filter(item=>item.id!==rule.id);try{await save(custom);draw(builtIn);}catch(error){status.textContent=error.message;}};actions.append(remove);}
        grid.append(row([name,el('code','',rule.file),el('code','',rule.line+(rule.also?` + ${rule.also}`:'')),el('span','',(rule.detail||'')+(rule.note?` (${rule.note})`:'')),actions]));
      }
      out.append(grid);
    };
    const load=async()=>{try{const answer=await api('/api/traps');custom=answer.custom||[];draw(answer.builtIn||[]);status.textContent=t('{builtIn} built in · {custom} yours',{builtIn:(answer.builtIn||[]).length,custom:custom.length});add.onclick=async()=>{
      if(!label.value.trim()||!file.value||!line.value){tryNote.textContent=t('Name, files and added line are required.');return;}
      const check=tryRule({file:file.value,line:line.value},'x','x');if(check.error){tryNote.textContent=check.error;return;}
      let id=slug(label.value);while(custom.some(item=>item.id===id)||(answer.builtIn||[]).some(item=>item.id===id))id=`${id.slice(0,36)}-${Math.floor(Math.random()*900+100)}`;
      const next=[...custom,{id,label:label.value.trim(),file:file.value,line:line.value,detail:detail.value.trim(),note:note.value.trim()}];
      try{await save(next);custom=next;draw(answer.builtIn||[]);for(const node of [label,file,line,detail,note,sampleFile,sampleLine])node.value='';tryNote.textContent='';form.open=false;}catch(error){tryNote.textContent=error.message;}
    };}catch(error){status.textContent=error.message;}};
    load();
  }

  addPanel('known-traps',t('Known traps'),build);
  window.GitDeckKnownTraps=helpers;
})();
