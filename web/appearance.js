'use strict';
// Per-browser appearance: UI text size and Clean/Classic look, both in the theme
// menu. Runs before the page renders so neither causes a flash.
// - Text size overrides --ui-text-size (workspace.css), which sizes all UI copy;
//   code and diffs that opt out stay unchanged.
// - Clean adds html.ui-clean, which enables web/clean.css; Classic is the
//   original stylesheet stack.
(function(){
  const sizes=[8,10,12,14];const defaultSize=12;
  const looks=['clean','classic'];const defaultLook='clean';
  const keys={size:'gitdeck.textSize',look:'gitdeck.look'};
  const read=(key)=>{try{return localStorage.getItem(key);}catch{return null;}};
  const write=(key,value,fallback)=>{try{if(value===fallback)localStorage.removeItem(key);else localStorage.setItem(key,String(value));}catch{}};
  let size=Number(read(keys.size));if(!sizes.includes(size))size=defaultSize;
  let look=read(keys.look);if(!looks.includes(look))look=defaultLook;
  const root=document.documentElement;
  const apply=()=>{root.style.setProperty('--ui-text-size',size+'px');root.classList.toggle('ui-clean',look==='clean');};
  const refresh=()=>document.querySelectorAll('[data-text-size],[data-look]').forEach(button=>{
    const active=button.dataset.textSize?Number(button.dataset.textSize)===size:button.dataset.look===look;
    button.setAttribute('aria-pressed',String(active));
  });
  const announce=()=>document.dispatchEvent(new CustomEvent('gitdeck:appearance',{detail:{size,look}}));
  function setTextSize(value){if(!sizes.includes(value))return;size=value;apply();write(keys.size,value,defaultSize);refresh();announce();}
  function setLook(value){if(!looks.includes(value))return;look=value;apply();write(keys.look,value,defaultLook);refresh();announce();}
  function group(className,title,items){
    const block=document.createElement('div');block.className=className;
    const heading=document.createElement('strong');heading.textContent=title;block.append(heading);
    for(const item of items){
      const button=document.createElement('button');button.type='button';Object.assign(button.dataset,item.data);
      button.textContent=item.label;button.title=item.title;button.addEventListener('click',item.run);block.append(button);
    }
    return block;
  }
  function addPickers(menu){
    if(menu.querySelector('.text-size-choice'))return;
    menu.append(
      group('look-choice',t('Look'),[
        {data:{look:'clean'},label:t('Clean'),title:t('Fewer borders and hints'),run:()=>setLook('clean')},
        {data:{look:'classic'},label:t('Classic'),title:t('The original dense layout'),run:()=>setLook('classic')},
      ]),
      group('text-size-choice',t('Text size'),sizes.map(value=>({
        data:{textSize:String(value)},label:String(value),
        title:value===defaultSize?t('Default size'):t('{size}px text',{size:value}),run:()=>setTextSize(value),
      }))),
    );
    refresh();
  }
  apply();
  window.GitDeckAppearance={sizes,looks,get size(){return size;},get look(){return look;},setTextSize,setLook};
  const ready=()=>document.querySelectorAll('.theme-menu').forEach(addPickers);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
