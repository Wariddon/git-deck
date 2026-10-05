'use strict';
// Line icons for the Modern look: 24×24, 1.75px stroke, currentColor. Drawn for
// Git Deck in the style of open line-icon sets; bundled here so nothing loads
// from the network. GitDeckIcons.svg(name) returns a fresh <svg> element.
(function(){
  const c=(x,y,r)=>`<circle cx="${x}" cy="${y}" r="${r}"/>`;
  const p=(...paths)=>paths.map(d=>`<path d="${d}"/>`).join('');
  const shapes={
    changes:p('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z','M14 3v5h5','M9 14h6','M12 11v6'),
    history:p('M3 12a9 9 0 1 0 2.6-6.4L3 8','M3 3v5h5','M12 7v5l3 2'),
    branch:c(6,18,2.5)+c(18,6,2.5)+p('M6 3v12.5','M18 8.5A9.5 9.5 0 0 1 8.5 18'),
    commit:c(12,12,3.5)+p('M3 12h5.5','M15.5 12H21'),
    stash:p('M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3H3z','M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8','M10 12h4'),
    tag:p('M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z')+c(7.5,7.5,1.5),
    compare:c(5,6,2.5)+c(19,18,2.5)+p('M12 6h5a2 2 0 0 1 2 2v7.5','M12 18H7a2 2 0 0 1-2-2V8.5','M14.5 3.5 12 6l2.5 2.5','M9.5 15.5 12 18l-2.5 2.5'),
    conflict:p('M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z','M12 9v4','M12 17h.01'),
    recovery:p('M9 14 4 9l5-5','M4 9h10.5a5.5 5.5 0 0 1 0 11H11'),
    tools:p('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z'),
    settings:p('M4 21v-7','M4 10V3','M12 21v-9','M12 8V3','M20 21v-5','M20 12V3','M2 14h4','M10 8h4','M18 16h4'),
    fetch:p('M21 12a9 9 0 0 1-15.7 6L3 16','M3 12a9 9 0 0 1 15.7-6L21 8','M21 3v5h-5','M3 21v-5h5'),
    pull:p('M12 4v14','M18 12l-6 6-6-6','M5 21h14'),
    push:p('M12 20V6','M6 12l6-6 6 6','M5 3h14'),
    plus:p('M12 5v14','M5 12h14'),
    check:p('M20 6 9 17l-5-5'),
    more:c(5,12,1)+c(12,12,1)+c(19,12,1),
    chevron:p('M6 9l6 6 6-6'),
    folder:p('M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z'),
    search:c(11,11,7.5)+p('M21 21l-4.5-4.5'),
    inbox:p('M22 12h-6l-2 3h-4l-2-3H2','M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z'),
    alert:c(12,12,9.5)+p('M12 8v4.5','M12 16h.01'),
    sparkles:p('M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z','M19 17v4','M17 19h4'),
    cloud:p('M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z'),
    undo:p('M9 14 4 9l5-5','M4 9h10.5a5.5 5.5 0 0 1 0 11H11'),
    flow:c(6,5,2)+c(6,19,2)+c(18,12,2)+p('M6 7v10','M6 9c0 3 4 3 10 3'),
    repos:p('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z','M3 10h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z','M8 14h8','M8 17h5'),
    report:p('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z','M14 3v5h5','M9 13h6','M9 17h6','M9 9h2'),
    merge:c(6,6,2.5)+c(6,18,2.5)+c(18,12,2.5)+p('M6 8.5v7','M6 8.5c0 3 3 3.5 9.5 3.5'),
    terminal:p('M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z','M7 10l3 2-3 2','M13 15h4'),
    explorer:p('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z','M3 11h18'),
    focus:p('M8 3H5a2 2 0 0 0-2 2v3','M21 8V5a2 2 0 0 0-2-2h-3','M3 16v3a2 2 0 0 0 2 2h3','M16 21h3a2 2 0 0 0 2-2v-3'),
  };
  const ns='http://www.w3.org/2000/svg';
  function svg(name,size=16){
    const node=document.createElementNS(ns,'svg');
    node.setAttribute('viewBox','0 0 24 24');node.setAttribute('width',String(size));node.setAttribute('height',String(size));
    node.setAttribute('fill','none');node.setAttribute('stroke','currentColor');node.setAttribute('stroke-width','1.75');
    node.setAttribute('stroke-linecap','round');node.setAttribute('stroke-linejoin','round');node.setAttribute('aria-hidden','true');
    node.setAttribute('class','gd-icon gd-icon-'+name);node.innerHTML=shapes[name]||shapes.more;return node;
  }
  window.GitDeckIcons={names:Object.keys(shapes),svg};
})();
