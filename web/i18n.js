'use strict';
// UI translations. The English source text is the key, so untranslated or
// not-yet-migrated copy simply stays English:
//   t('Pulled {count} commit(s)', {count: 3})
// Dictionaries register themselves (web/i18n-<lang>.js). The chosen language
// is a per-browser preference; switching reloads the page.
(function(){
  const dictionaries={};
  const names={en:'English',th:'ไทย'};
  const storageKey='gitdeck.language';
  let chosen='en';
  try{chosen=localStorage.getItem(storageKey)||'en';}catch{}
  if(!names[chosen])chosen='en';
  const format=(text,vars)=>vars?String(text).replace(/\{(\w+)\}/g,(match,key)=>Object.prototype.hasOwnProperty.call(vars,key)?String(vars[key]):match):String(text);
  function t(text,vars){
    const dictionary=chosen==='en'?null:dictionaries[chosen];
    const entry=dictionary&&Object.prototype.hasOwnProperty.call(dictionary,text)?dictionary[text]:text;
    return format(entry,vars);
  }
  function setLanguage(language){
    if(!names[language]||language===chosen)return;
    try{localStorage.setItem(storageKey,language);}catch{}
    location.reload();
  }
  function addPicker(menu){
    if(menu.querySelector('.language-choice'))return;
    const block=document.createElement('div');block.className='language-choice';
    const title=document.createElement('strong');title.textContent=t('Language');block.append(title);
    for(const [code,name] of Object.entries(names)){
      const button=document.createElement('button');button.type='button';button.dataset.languageChoice=code;button.textContent=name;
      button.setAttribute('aria-pressed',String(code===chosen));button.addEventListener('click',()=>setLanguage(code));
      block.append(button);
    }
    menu.append(block);
  }
  window.t=t;
  window.GitDeckI18n={
    t,languages:names,
    get language(){return chosen;},
    register(language,entries){dictionaries[language]=Object.assign(dictionaries[language]||{},entries);},
    entries(language){return Object.assign({},dictionaries[language]);},
    setLanguage,
  };
  const ready=()=>{
    document.documentElement.lang=chosen;
    document.querySelectorAll('.theme-menu').forEach(addPicker);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
