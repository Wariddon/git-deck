'use strict';
// Per-browser appearance: UI text size and Modern/Classic look, both in the theme
// menu. Runs before the page renders so neither causes a flash.
// - Text size overrides --ui-text-size (workspace.css), which sizes all UI copy;
//   code and diffs that opt out stay unchanged.
// - Modern adds html.ui-clean (web/clean.css, clean-layout.js: fewer boxes) and
//   html.ui-modern (web/modern.css, modern.js: tokens, icons, rail, header).
//   Classic is the original stylesheet stack. A saved 'clean' from older
//   builds is read as Modern.
(function(){
  // 13px Segoe UI is what Sourcetree uses on Windows; 8 and 10 were too small to read comfortably.
  const sizes=[11,12,13,14,16];const defaultSize=13;
  const looks=['modern','classic'];const defaultLook='modern';
  // Density: Comfortable (34 px rows) or Compact (26 px rows, tighter tables) for more on one screen.
  const densities=['comfortable','compact'];const defaultDensity='comfortable';
  // Shape: Soft (rounded islands, glass dialogs; web/soft.css) or Square (the previous boxes).
  const shapes=['soft','square'];const defaultShape='soft';
  // Opening: how Git Deck appears when it starts (web/entrance.js).
  const openings=['logo','stars','command','off'];const defaultOpening='logo';
  const keys={size:'gitdeck.textSize',look:'gitdeck.look',density:'gitdeck.density',shape:'gitdeck.shape',opening:'gitdeck.opening'};
  const read=(key)=>{try{return localStorage.getItem(key);}catch{return null;}};
  const write=(key,value,fallback)=>{try{if(value===fallback)localStorage.removeItem(key);else localStorage.setItem(key,String(value));}catch{}};
  let size=Number(read(keys.size));if(!sizes.includes(size))size=defaultSize;
  let look=read(keys.look);if(look==='clean')look='modern';if(!looks.includes(look))look=defaultLook;
  let density=read(keys.density);if(!densities.includes(density))density=defaultDensity;
  let shape=read(keys.shape);if(!shapes.includes(shape))shape=defaultShape;
  let opening=read(keys.opening);if(!openings.includes(opening))opening=defaultOpening;
  const root=document.documentElement;
  const apply=()=>{root.style.setProperty('--ui-text-size',size+'px');root.classList.toggle('ui-clean',look==='modern');root.classList.toggle('ui-modern',look==='modern');root.classList.toggle('gd-compact',density==='compact');root.classList.toggle('gd-soft',shape==='soft');};
  const refresh=()=>document.querySelectorAll('[data-text-size],[data-look],[data-density],[data-shape],[data-opening]').forEach(button=>{
    const active=button.dataset.textSize?Number(button.dataset.textSize)===size:button.dataset.density?button.dataset.density===density:button.dataset.shape?button.dataset.shape===shape:button.dataset.opening?button.dataset.opening===opening:button.dataset.look===look;
    button.setAttribute('aria-pressed',String(active));
  });
  const announce=()=>document.dispatchEvent(new CustomEvent('gitdeck:appearance',{detail:{size,look,density}}));
  function setTextSize(value){if(!sizes.includes(value))return;size=value;apply();write(keys.size,value,defaultSize);refresh();announce();}
  function setDensity(value){if(!densities.includes(value))return;density=value;apply();write(keys.density,value,defaultDensity);refresh();announce();}
  function setShape(value){if(!shapes.includes(value))return;shape=value;apply();write(keys.shape,value,defaultShape);refresh();announce();}
  function setOpening(value){if(!openings.includes(value))return;opening=value;apply();write(keys.opening,value,defaultOpening);refresh();announce();}
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
        {data:{look:'modern'},label:t('Modern'),title:t('Icons, side rail and a calmer palette'),run:()=>setLook('modern')},
        {data:{look:'classic'},label:t('Classic'),title:t('The original dense layout'),run:()=>setLook('classic')},
      ]),
      group('text-size-choice',t('Text size'),sizes.map(value=>({
        data:{textSize:String(value)},label:String(value),
        title:value===defaultSize?t('Default size'):t('{size}px text',{size:value}),run:()=>setTextSize(value),
      }))),
      group('look-choice density-choice',t('Density'),[
        {data:{density:'comfortable'},label:t('Comfortable'),title:t('Rows of 34 px'),run:()=>setDensity('comfortable')},
        {data:{density:'compact'},label:t('Compact'),title:t('Rows of 26 px and tighter tables: more on one screen'),run:()=>setDensity('compact')},
      ]),
      group('look-choice shape-choice',t('Shape'),[
        {data:{shape:'soft'},label:t('Soft'),title:t('Rounded islands, glass dialogs and a sliding highlight'),run:()=>setShape('soft')},
        {data:{shape:'square'},label:t('Square'),title:t('Boxes with straight edges, as before'),run:()=>setShape('square')},
      ]),
      group('look-choice opening-choice',t('Opening'),[
        {data:{opening:'logo'},label:t('Logo'),title:t('The logo grows into the app, then a greeting'),run:()=>setOpening('logo')},
        {data:{opening:'stars'},label:t('Stars'),title:t('Every repository flies in as a star, coloured by its weather'),run:()=>setOpening('stars')},
        {data:{opening:'command'},label:t('Command'),title:t('Start at one box: what will you do today?'),run:()=>setOpening('command')},
        {data:{opening:'off'},label:t('Off'),title:t('No opening animation'),run:()=>setOpening('off')},
        {data:{},label:t('Preview'),title:t('Play the chosen opening now'),run:()=>window.GitDeckEntrance?.preview?.()},
      ])
    );
    refresh();
  }
  apply();
  window.GitDeckAppearance={sizes,looks,get size(){return size;},get look(){return look;},get density(){return density;},get shape(){return shape;},get opening(){return opening;},setTextSize,setLook,setDensity,setShape,setOpening};
  const ready=()=>document.querySelectorAll('.theme-menu').forEach(addPickers);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
