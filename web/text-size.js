'use strict';
// Per-browser UI text size. workspace.css sizes all UI copy from --ui-text-size
// (default 11px); this only overrides that variable, so code/diff fonts that opt
// out stay unchanged. Loaded before the page renders to avoid a size flash.
(function(){
  const sizes=[11,12,13,14];const storageKey='gitdeck.textSize';const fallback=11;
  let current=fallback;
  try{const saved=Number(localStorage.getItem(storageKey));if(sizes.includes(saved))current=saved;}catch{}
  const apply=()=>{if(current===fallback)document.documentElement.style.removeProperty('--ui-text-size');else document.documentElement.style.setProperty('--ui-text-size',current+'px');};
  function setTextSize(size){
    if(!sizes.includes(size))return;current=size;apply();
    try{if(size===fallback)localStorage.removeItem(storageKey);else localStorage.setItem(storageKey,String(size));}catch{}
    document.querySelectorAll('[data-text-size]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.textSize)===current)));
  }
  function addPicker(menu){
    if(menu.querySelector('.text-size-choice'))return;
    const block=document.createElement('div');block.className='text-size-choice';
    const title=document.createElement('strong');title.textContent=t('Text size');block.append(title);
    for(const size of sizes){
      const button=document.createElement('button');button.type='button';button.dataset.textSize=String(size);button.textContent=String(size);
      button.title=size===fallback?t('Default size'):t('{size}px text',{size});
      button.setAttribute('aria-pressed',String(size===current));button.addEventListener('click',()=>setTextSize(size));
      block.append(button);
    }
    menu.append(block);
  }
  apply();
  window.GitDeckTextSize={sizes,get size(){return current;},set:setTextSize};
  const ready=()=>document.querySelectorAll('.theme-menu').forEach(addPicker);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
