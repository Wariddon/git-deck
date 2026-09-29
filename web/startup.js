    (() => {
      const splash=document.getElementById('startup-splash');
      const status=document.getElementById('startup-status');
      let finished=false;
      const timer=setTimeout(()=>{if(!finished)document.getElementById('startup-actions').hidden=false;},12000);
      const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);splash.close();};
      window.GitDeckStartup={update(message){if(!finished)status.textContent=message;},finish};
      document.getElementById('startup-reload').onclick=()=>location.reload();
      document.getElementById('startup-continue').onclick=finish;
      splash.addEventListener('cancel',event=>{event.preventDefault();finish();});
      splash.showModal();
    })();
