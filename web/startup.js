    (() => {
      const splash=document.getElementById('startup-splash');
      const status=document.getElementById('startup-status');
      // Paint the splash in the saved theme straight away (app.js applies the theme later).
      try{
        const theme=(JSON.parse(localStorage.getItem('git-deck-meta-v1')||'{}').theme)||'light';
        const dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
        splash.dataset.theme=theme==='system'?(dark?'dark':'light'):theme;
      }catch{}
      let finished=false;
      const timer=setTimeout(()=>{if(!finished)document.getElementById('startup-actions').hidden=false;},12000);
      const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);splash.close();};
      window.GitDeckStartup={update(message){if(!finished)status.textContent=message;},finish};
      document.getElementById('startup-reload').onclick=()=>location.reload();
      document.getElementById('startup-continue').onclick=finish;
      splash.addEventListener('cancel',event=>{event.preventDefault();finish();});
      splash.showModal();
    })();
