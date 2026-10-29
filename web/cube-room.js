'use strict';
// Cube room (Rubik shape): the app always sits on a cube. Beside the face you work on, the cube's top
// and right faces show as slanted strips of stickers: the right one in the colour of the next view (a
// click turns to it), the top one green for the Dashboard (a click turns up to it). The face itself
// stays flat so text stays sharp. Also "Your own…" sticker colours (Appearance › Stickers).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // The two side faces of a box at (left, top, width, height) seen from the front-left-below, `depth` deep:
  // clip-path polygons in page pixels, each as [x, y] corners.
  function edges(box,depth){
    const {left,top,width,height}=box;const right=left+width,bottom=top+height;
    return {
      top:[[left,top],[left+depth,top-depth],[right+depth,top-depth],[right,top]],
      right:[[right,top],[right+depth,top-depth],[right+depth,bottom-depth],[right,bottom]],
    };
  }
  const isColor=(value)=>/^#[0-9a-f]{6}$/i.test(String(value||''));
  const helpers={edges,isColor};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined'||typeof el!=='function')return;

  const root=document.documentElement;const depth=14;
  const on=()=>window.GitDeckRubik?.active?.();
  const top=el('button','gd-cube-edge gd-cube-edge-top');const right=el('button','gd-cube-edge gd-cube-edge-right');
  for(const edge of [top,right]){edge.type='button';edge.hidden=true;document.body.append(edge);}
  top.onclick=()=>{const R=window.GitDeckRubik;if(R?.dashboardOpen())return;if(typeof showOperationsCenter==='function')showOperationsCenter('briefing');};
  right.onclick=()=>window.GitDeckCubePlay?.twist?.(1);
  const workspaceTabs=['changes','history','branches','stashes','tags','compare'];
  function place(){
    const R=window.GitDeckRubik;
    if(!on()||!R){top.hidden=right.hidden=true;root.classList.remove('gd-cube-room');return;}
    root.classList.add('gd-cube-room');
    const face=R.dashboardOpen()?document.querySelector('.operations-view:not([hidden])'):document.getElementById('workspace-content');
    if(!face||!face.offsetParent||root.dataset.turn){top.hidden=right.hidden=true;return;}
    // The sticker area: inside the plastic groove (the island's border).
    const r=face.getBoundingClientRect(),cs=getComputedStyle(face);
    const box={left:r.left+parseFloat(cs.borderLeftWidth),top:r.top+parseFloat(cs.borderTopWidth),width:r.width-parseFloat(cs.borderLeftWidth)-parseFloat(cs.borderRightWidth),height:r.height-parseFloat(cs.borderTopWidth)-parseFloat(cs.borderBottomWidth)};
    const e=edges(box,depth);
    const set=(node,points)=>{
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);const x0=Math.min(...xs),y0=Math.min(...ys);
      node.style.left=`${x0}px`;node.style.top=`${y0}px`;node.style.width=`${Math.max(...xs)-x0}px`;node.style.height=`${Math.max(...ys)-y0}px`;
      node.style.clipPath=`polygon(${points.map(([x,y])=>`${x-x0}px ${y-y0}px`).join(', ')})`;node.hidden=false;
    };
    set(top,e.top);set(right,e.right);
    // The next face's colour on the right; the Dashboard's green on top.
    const order=(R.railOrder()||[]).filter(tab=>workspaceTabs.includes(tab));
    const current=R.dashboardOpen()?'':(typeof state!=='undefined'?state.workspaceTab:'');
    const next=R.dashboardOpen()?'':order[(order.indexOf(current)+1)%Math.max(1,order.length)]||'';
    right.style.setProperty('--edge',R.faceValue?R.faceValue(next||'dashboard'):'#6e7781');
    const nextLabel=next?next[0].toUpperCase()+next.slice(1):t('Next view');
    right.title=t('Turn to {view} (Ctrl+Alt+Right)',{view:nextLabel});right.setAttribute('aria-label',right.title);
    top.hidden=R.dashboardOpen();top.title=t('Turn up to the Dashboard (Ctrl+Alt+Up)');top.setAttribute('aria-label',top.title);
  }
  let queued=false;const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;place();});};
  window.addEventListener('resize',schedule);document.addEventListener('gitdeck:appearance',schedule);
  document.addEventListener('gitdeck:turn',()=>{top.hidden=right.hidden=true;setTimeout(schedule,700);});
  new MutationObserver(schedule).observe(document.body,{attributes:true,subtree:true,attributeFilter:['class','hidden']});
  setInterval(schedule,1000);schedule();

  // ---- your own sticker colours --------------------------------------------------------------------
  function edit(){
    const A=window.GitDeckAppearance;if(!A||typeof releaseDialog!=='function')return;
    document.querySelectorAll('.theme-picker[open]').forEach(menu=>menu.removeAttribute('open'));
    const ui=releaseDialog(t('Your own sticker colours'));
    const style=getComputedStyle(root);const names={red:t('Changes'),blue:t('History'),orange:t('Branches'),white:t('Tags'),yellow:t('Stashes'),green:t('Main action and Dashboard')};
    const grid=el('div','sticker-editor');const inputs={};
    for(const name of A.stickerVars){
      const label=el('label','sticker-editor-row');const input=document.createElement('input');input.type='color';
      const current=style.getPropertyValue(`--st-${name}`).trim();input.value=isColor(current)?current:'#6e7781';
      input.oninput=()=>root.style.setProperty(`--st-${name}`,input.value);
      inputs[name]=input;label.append(input,el('span','',names[name]));grid.append(label);
    }
    ui.body.append(el('p','fleet-muted',t('Each view keeps its sticker colour; changes show at once.')),grid);
    const save=el('button','primary',t('Save'));save.type='button';
    save.onclick=()=>{const colors={};for(const [name,input] of Object.entries(inputs))colors[name]=input.value;A.setStickers('custom',colors);ui.dialog.close();};
    ui.dialog.addEventListener('close',()=>{if(A.stickers!=='custom')for(const name of A.stickerVars)root.style.setProperty(`--st-${name}`,'');},{once:true});
    ui.actions.prepend(save);
  }
  window.GitDeckStickers={edit};
})();
