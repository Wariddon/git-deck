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
      // index.html starts the page green (no white flash before the splash); the app takes over after.
      // The splash fades out instead of vanishing (no fade for reduced motion or without Web Animations).
      const finish=()=>{
        if(finished)return;finished=true;clearTimeout(timer);
        const done=()=>{splash.close();document.getElementById('startup-background')?.remove();};
        const still=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if(typeof splash.animate!=='function'||still)return done();
        document.getElementById('startup-background')?.remove();
        splash.animate([{opacity:1},{opacity:0}],{duration:220,easing:'ease-out',fill:'forwards'}).onfinish=done;
      };
      window.GitDeckStartup={update(message){if(!finished)status.textContent=message;},finish};
      document.getElementById('startup-reload').onclick=()=>location.reload();
      document.getElementById('startup-continue').onclick=finish;
      splash.addEventListener('cancel',event=>{event.preventDefault();finish();});
      splash.showModal();
    })();
