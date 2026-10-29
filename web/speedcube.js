'use strict';
// Speedcube extras (Rubik shape):
// - Status stickers: each repository tab carries a small sticker for its state: green clean, yellow
//   work to commit, blue commits to pull, white commits to push, red conflicts.
// - Moves: hold Ctrl+Alt and type a cube "algorithm" of letters within a second: F fetch, P pull,
//   U push (up). "F P U" fetches, pulls, then pushes; pull and push ask first as usual. The algorithm
//   shows as a bubble while you type and runs once you let go of Ctrl+Alt.
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  function tabSticker({changes=0,ahead=0,behind=0,conflicts=0}={}){
    if(Number(conflicts)>0)return 'conflict';
    if(Number(changes)>0)return 'work';
    if(Number(behind)>0)return 'pull';
    if(Number(ahead)>0)return 'push';
    return 'clean';
  }
  const moveNames={F:'fetch',P:'pull',U:'push'};
  // Letters typed with Ctrl+Alt -> the moves to run (unknown letters are ignored, at most 6 moves).
  const parseMoves=(letters)=>String(letters||'').toUpperCase().split('').filter(letter=>moveNames[letter]).slice(0,6).map(letter=>moveNames[letter]);
  const helpers={tabSticker,parseMoves,moveNames};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;
  const on=()=>window.GitDeckRubik?.active?.();

  // ---- status stickers on repository tabs ----------------------------------------------------------
  if(typeof renderRepoTabs==='function'){
    const base=renderRepoTabs;
    const label={clean:t('Clean'),work:t('Changes to commit'),pull:t('Commits to pull'),push:t('Commits to push'),conflict:t('Conflicts')};
    renderRepoTabs=function(...args){
      const result=base.apply(this,args);
      for(const tab of document.querySelectorAll('.repo-tab')){
        const repo=(state.repos||[]).find(item=>repoKey(item)===tab.dataset.repoKey);if(!repo)continue;
        const open=state.workspaceRepo&&repoKey(state.workspaceRepo)===repoKey(repo);
        const cached=typeof workspaceSnapshots!=='undefined'?workspaceSnapshots.get(repoKey(repo))?.data:null;
        const data=open?state.workspace:cached;const sync=data?.sync||repo;
        const kind=tabSticker({changes:data?.files?.length??repo.changes,ahead:sync.ahead,behind:sync.behind,conflicts:(data?.conflicts||[]).length});
        tab.dataset.sticker=kind;
        let chip=tab.querySelector('.gd-tab-sticker');if(!chip){chip=el('i','gd-tab-sticker');chip.setAttribute('aria-hidden','true');tab.prepend(chip);}
        chip.title=label[kind];
      }
      return result;
    };
    // No render here: renderRepoTabs also prunes the open tabs to the repositories loaded so far, so an
    // early call would close tabs whose repositories are not loaded yet. The next render adds the stickers.
  }

  // ---- moves: Ctrl+Alt + F / P / U -------------------------------------------------------------------
  const typing=(target)=>Boolean(target&&target.closest&&target.closest('input, textarea, select, [contenteditable="true"]'));
  let letters='',bubble=null;
  const show=()=>{
    if(!bubble){bubble=el('div','gd-moves');bubble.setAttribute('role','status');document.body.append(bubble);}
    bubble.textContent=letters.split('').join(' ');bubble.hidden=!letters;
  };
  async function run(moves){
    for(const move of moves){
      if(!state.workspaceRepo)return;
      const confirmation=move==='fetch'?'':(typeof syncConfirmation==='function'?syncConfirmation(move):`${move}?`);
      const payload=move==='pull'?{strategy:state.meta.pullStrategy}:{};
      const result=await runWorkspaceAction(move,payload,confirmation);
      if(!result)return;
    }
  }
  document.addEventListener('keydown',(event)=>{
    if(!on()||!event.ctrlKey||!event.altKey||event.shiftKey||event.metaKey||typing(event.target))return;
    const letter=event.key.length===1?event.key.toUpperCase():'';
    if(!moveNames[letter]||typeof runWorkspaceAction!=='function'||!state.workspaceRepo)return;
    event.preventDefault();letters=(letters+letter).slice(-6);show();
  });
  document.addEventListener('keyup',(event)=>{
    if(!letters||(event.key!=='Control'&&event.key!=='Alt'))return;
    const moves=parseMoves(letters);letters='';setTimeout(show,500);
    if(moves.length)void run(moves);
  });
  window.addEventListener('blur',()=>{letters='';if(bubble)bubble.hidden=true;});
  window.GitDeckSpeedcube={...helpers,run};
})();
