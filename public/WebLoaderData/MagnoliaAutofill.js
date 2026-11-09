// Command assistant for the local server. Does not transmit or store chat text.
(function (global) {
  'use strict';
  const commands = [
    ['help','Daftar perintah'], ['find','Cari item'], ['growid','Daftar akun'],
    ['warp','Pindah world'], ['worlds','World yang tersedia'], ['who','Pemain di world'],
    ['me','Kirim aksi'], ['msg','Pesan pemain'], ['sb','Siaran pesan'], ['kits','Lihat kit'],
    ['skin','Ubah warna kulit'], ['flag','Ubah bendera'], ['rank','Lihat rank'], ['mods','Staff online'],
    ['news','Buka gazette'], ['door','Pengaturan pintu'], ['weather','Atur cuaca'],
    ['convert','Konversi item'], ['gitem','Beri item • staff'], ['clearinv','Bersihkan inventaris • staff'],
    ['ghost','Mode ghost • staff'], ['cheats','Pengaturan cheat • staff'],
    ['give','Beri item • staff'], ['kick','Keluarkan pemain • staff'], ['pull','Panggil pemain • staff'],
    ['ban','Ban pemain • staff'], ['unban','Buka ban • staff']
  ];
  function matches(text) {
    if (!/^\/[a-z]*$/i.test(text)) return [];
    const query = text.slice(1).toLowerCase();
    return commands.filter(c=>c[0].includes(query)).sort((a,b)=>
      Number(!a[0].startsWith(query))-Number(!b[0].startsWith(query))
    ).slice(0,6);
  }
  global.MagnoliaAutofillMatch = matches;
  if (!global.document) return;
  const style=document.createElement('style');
  style.textContent=`#magnolia-command-assist{position:fixed;z-index:120;display:none;width:min(340px,90vw);box-sizing:border-box;padding:8px;border:1px solid var(--mag-accent,#bf95ee80);border-radius:14px;background:rgba(24,19,45,.96);box-shadow:0 12px 35px #08031680;color:#f8f2ff;font:14px system-ui,sans-serif;pointer-events:auto;animation:mag-assist-enter .18s ease-out} @keyframes mag-assist-enter{from{opacity:0;transform:translateY(-7px) scale(.98)}to{opacity:1;transform:none}} #magnolia-command-assist .mag-head{display:flex;justify-content:space-between;align-items:center;padding:4px 8px 8px;color:#d8b9ff;font-size:11px;letter-spacing:.09em;font-weight:800} #magnolia-command-assist button{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;border:0;border-radius:8px;padding:7px 9px;background:transparent;color:#fff;text-align:left;cursor:pointer} #magnolia-command-assist button[aria-selected=true],#magnolia-command-assist button:hover{background:#8254b3;color:white} #magnolia-command-assist b{font-size:14px;color:#f4dcff} #magnolia-command-assist small{color:#c5b4d7;font-size:11px;text-align:right} #magnolia-command-assist footer{padding:7px 8px 2px;color:#a99bbd;font-size:10px} @media(prefers-reduced-motion:reduce){#magnolia-command-assist{animation:none}}`;
  document.head.appendChild(style);
  const panel=document.createElement('section');panel.id='magnolia-command-assist';
  const accent=global.SERVER_CONFIG && global.SERVER_CONFIG.autofillAccent;
  if(typeof accent==='string' && /^#[0-9a-f]{6}$/i.test(accent)) panel.style.setProperty('--mag-accent',accent+'80');panel.setAttribute('aria-label','Autofill commands');document.body.appendChild(panel);
  let current=[],selected=0,lastText='',dismissedText=null,visible=false;
  function input() { return global.GameSDK && global.GameSDK.ready ? global.GameSDK.entity('ConsoleInputBox') : null; }
  const prefKey='magnolia_autofill_enabled_v1';
  function isEnabled() { try{return global.localStorage.getItem(prefKey)!=='0'} catch(_){return true} }
  function setEnabled(value){try{global.localStorage.setItem(prefKey,value?'1':'0')}catch(_){} if(!value)hide();}
  global.MagnoliaAutofill={isEnabled,setEnabled};
  // Disable the native dropdown itself, not just its Entity visibility: it
  // draws through its own component. Our separate preference drives the new UI.
  function disableNative() {
    try {
      const m=global.Module,abi=global.GameSDK._abi,s=abi.ensureScratch()+320;
      abi.writeStdString(s,'enableAutoFill');
      const v=m.wasmTable.get(623)(m.HEAPU32[393364>>2],s);
      abi.freeStdString(s);
      if(v) m.HEAPU32[(v+8)>>2]=0;
    } catch (_) {}
  }
  function hide(){panel.style.display='none';visible=false;}
  function accept(item){
    const box=input(); if(!box || !box.exists || !item) return;
    box._applyTextNow('/'+item[0]+' ');
    dismissedText='/'+item[0]+' '; hide();
    const canvas=document.getElementById('canvas'); if(canvas) canvas.focus({preventScroll:true});
  }
  function draw(){
    panel.replaceChildren();
    const header=document.createElement('div');header.className='mag-head';header.textContent='✦  AUTOFILL';
    const hint=document.createElement('span');hint.textContent=current.length+' hasil';header.appendChild(hint);panel.appendChild(header);
    current.forEach((item,i)=>{
      const btn=document.createElement('button');btn.type='button';btn.setAttribute('aria-selected',i===selected?'true':'false');
      const name=document.createElement('b');name.textContent='/'+item[0];const desc=document.createElement('small');desc.textContent=item[1];btn.append(name,desc);
      btn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();accept(item)});panel.appendChild(btn);
    });
    const foot=document.createElement('footer');foot.textContent='↑ ↓ pilih  ·  Tab lengkapi  ·  Esc tutup';panel.appendChild(foot);
  }
  function tick(){
    try {
      const sdk=global.GameSDK,box=input();
      if(sdk && sdk.ready) disableNative();
      if (!sdk || !box || !box.exists || !sdk.root.find('WorldSpecificGUI').exists) { lastText='';dismissedText=null;hide();return; }
      if (['GenericDialog','PauseMenu','OptionsMenu','StoreMenu','HotkeySettingsMenu'].some(name=>{const e=sdk.entity(name);return e.exists && e.visible;})){hide();return;}
      const native=sdk.entity('Autofill');if(native.exists)native._applyVisibleNow(false);
      const text=box.text;
      if(text!==lastText){lastText=text;dismissedText=null;selected=0;}
      if(!isEnabled() || text===dismissedText){hide();return;}
      const next=matches(text);if(!next.length){hide();return;}
      current=next;selected=Math.min(selected,current.length-1);
      const canvas=document.getElementById('canvas'),bg=sdk.entity('ConsoleInputBG');
      if(!canvas || !bg.exists){hide();return;}
      const r=canvas.getBoundingClientRect(),screen=sdk.screenSize;
      panel.style.left=Math.max(4,r.left+bg.position.x*r.width/screen.width+8)+'px';
      panel.style.top=Math.max(4,r.top+(bg.position.y+bg.size.height)*r.height/screen.height+8)+'px';
      if (!visible || panel.dataset.text!==text) { panel.dataset.text=text;draw(); }
      panel.style.display='block';visible=true;
    } catch(e){hide();}
  }
  global.addEventListener('keydown',function(e){
    if(!visible || e.altKey || e.ctrlKey || e.metaKey) return;
    if(e.key==='ArrowDown' || e.key==='ArrowUp'){
      e.preventDefault();e.stopImmediatePropagation();selected=(selected+(e.key==='ArrowDown'?1:-1)+current.length)%current.length;draw();
    }else if(e.key==='Tab'){
      e.preventDefault();e.stopImmediatePropagation();accept(current[selected]);
    }else if(e.key==='Escape'){
      e.preventDefault();e.stopImmediatePropagation();dismissedText=lastText;hide();
    }
  },true);
  global.setInterval(tick,100);
})(globalThis);
