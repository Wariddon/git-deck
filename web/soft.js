'use strict';
// Sliding highlight for the Soft shape (web/soft.css): in the side rail, the repository tabs and the
// Dashboard menu one rounded highlight moves to the item you pick. It first stretches over the old
// and new item, then settles on the new one, like a drop of liquid. Off with the Square shape and
// with reduced motion (it jumps instead).
(function(){
  // ---- pure helpers (tested) ----------------------------------------------------------------
  // The box that covers both items (the stretch), in the container's coordinates.
  function union(a,b){
    if(!a)return b;const left=Math.min(a.left,b.left),top=Math.min(a.top,b.top);
    return {left,top,width:Math.max(a.left+a.width,b.left+b.width)-left,height:Math.max(a.top+a.height,b.top+b.height)-top};
  }
  const helpers={union};
  if(typeof module!=='undefined'){module.exports=helpers;return;}
  if(typeof document==='undefined')return;

  const soft=()=>document.documentElement.classList.contains('gd-soft')&&document.documentElement.classList.contains('ui-modern');
  const still=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const targets=[
    {container:'.modern-rail',active:'.modern-rail-item.active'},
    {container:'.repo-tabs',active:'.repo-tab.active'},
    {container:'.operations-tabs',active:'button.active'},
  ];
  const state_=new WeakMap();
  function boxOf(container,item){
    const c=container.getBoundingClientRect(),r=item.getBoundingClientRect();
    return {left:r.left-c.left+container.scrollLeft,top:r.top-c.top+container.scrollTop,width:r.width,height:r.height};
  }
  const place=(blob,box)=>{blob.style.transform=`translate(${box.left}px,${box.top}px)`;blob.style.width=`${box.width}px`;blob.style.height=`${box.height}px`;};
  function update(spec){
    for(const container of document.querySelectorAll(spec.container)){
      let info=state_.get(container);
      if(!soft()){if(info){info.blob.remove();container.classList.remove('gd-liquid-on');state_.delete(container);}continue;}
      const item=container.querySelector(spec.active);
      if(!info){if(getComputedStyle(container).position==='static')container.style.position='relative';const blob=document.createElement('span');blob.className='gd-liquid';blob.setAttribute('aria-hidden','true');container.prepend(blob);info={blob,box:null,item:null};state_.set(container,info);container.classList.add('gd-liquid-on');}
      if(!item||!item.offsetParent){info.blob.style.opacity='0';info.item=null;continue;}
      const box=boxOf(container,item);
      const same=info.box&&Math.abs(info.box.left-box.left)<1&&Math.abs(info.box.top-box.top)<1&&Math.abs(info.box.width-box.width)<1&&Math.abs(info.box.height-box.height)<1;
      if(same&&info.item===item)continue;
      info.blob.style.opacity='1';
      if(!info.box||still()||info.item===item){info.blob.classList.add('stretch');place(info.blob,box);requestAnimationFrame(()=>info.blob.classList.remove('stretch'));}
      else{info.blob.classList.add('stretch');place(info.blob,union(info.box,box));setTimeout(()=>{info.blob.classList.remove('stretch');place(info.blob,box);},140);}
      info.box=box;info.item=item;
    }
  }
  let queued=false;
  const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;for(const spec of targets)update(spec);});};
  new MutationObserver(schedule).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','aria-current'],childList:true});
  window.addEventListener('resize',schedule);document.addEventListener('gitdeck:appearance',schedule);
  schedule();
})();
