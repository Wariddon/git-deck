'use strict';
// Persist on this browser only. No telemetry and no automatic report uploads.
const GitDeckRelease=(()=>{
  const prefix='git-deck-session-v2';
  function read(storage,key,fallback){try{return JSON.parse(storage.getItem(key))??fallback;}catch{return fallback;}}
  function write(storage,key,value){try{storage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
  function report(info={}){
    // Allowlist only: never copy console output, URLs, paths, user identity or errors.
    return JSON.stringify({app:'Git Deck',version:'1.3.0',platform:'Windows',gitAvailable:info.gitAvailable===true,gitlabCliAvailable:info.gitlabCliAvailable===true,serviceReady:info.serviceReady===true,powerShellVersion:/^\d+(\.\d+){1,3}$/.test(info.powerShellVersion||'')?info.powerShellVersion:'unknown',gitVersion:/^git version [\d.]+(?:\.windows\.\d+)?$/.test(info.gitVersion||'')?info.gitVersion:'unknown'},null,2);
  }
  function githubProject(remote=''){
    const match=/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(remote);
    return match?`https://github.com/${match[1]}/${match[2]}`:null;
  }
  return {prefix,read,write,report,githubProject};
})();
if(typeof module!=='undefined')module.exports=GitDeckRelease;
