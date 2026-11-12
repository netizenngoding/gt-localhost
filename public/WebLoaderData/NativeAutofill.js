// Native in-game command assistant: all visuals are Proton/WASM entities.
// JavaScript only bridges input and the existing native entity ABI; no HTML UI.
(function (global) {
  'use strict';
  // Public commands only. Staff-only commands must not be suggested to guests.
  const catalog=[['help','Daftar perintah'],['level','Level dan XP'],['achievements','Pencapaian'],['hidestatus','Tampilkan/sembunyikan status'],['find','Cari item'],['growid','Daftar akun'],['warp','Pindah world'],['worlds','Daftar world'],['who','Pemain di world'],['me','Kirim aksi'],['middle','Emote'],['msg','Pesan pemain'],['trade','Tukar item'],['sb','Siaran'],['time','Waktu'],['skin','Warna kulit'],['flag','Bendera'],['rank','Rank'],['mods','Staff online'],['news','Gazette'],['door','Pintu'],['weather','Cuaca'],['convert','Konversi'],['wave','Melambaikan tangan'],['dance','Menari'],['love','Cinta'],['sleep','Tidur'],['facepalm','Facepalm'],['smh','Geleng kepala'],['yes','Ya'],['no','Tidak'],['omg','Terkejut'],['shrug','Angkat bahu'],['fold','Lipat tangan'],['dab','Dab'],['sassy','Gaya'],['dance2','Menari'],['march','Berbaris'],['grumpy','Kesal'],['shy','Malu']];
  const pref='magnolia_native_autofill_v1';
  function enabled(){try{return global.localStorage.getItem(pref)!=='0'}catch(_){return true}}
  function setEnabled(value){try{global.localStorage.setItem(pref,value?'1':'0')}catch(_){}if(!value)clear()}
  function match(text){if(!/^\/[a-z]*$/i.test(text))return [];const q=text.slice(1).toLowerCase();return catalog.filter(c=>c[0].startsWith(q))}
  global.NativeAutofill={enabled,setEnabled,match};
  if(!global.document)return;
  let rows=[],boxParent=0,last='',selection=0,choices=[],dismissed=null,shown=false,highlight=null,highlightBase=0,highlightStep=0,windowStart=0;
  function sdk(){return global.GameSDK && global.GameSDK.ready ? global.GameSDK : null}
  function clear(){
    const g=sdk(), parent=g && g.entity('ConsoleInputBG');
    if(parent && parent.exists && parent.ptr===boxParent){for(const e of rows) {try {if(e.exists)e.destroy()}catch(_){}}}
    rows=[];boxParent=0;shown=false;highlight=null;
  }
  function nativeDisabled(){
    try{const m=global.Module,g=sdk(),a=g._abi,s=a.ensureScratch()+320;a.writeStdString(s,'enableAutoFill');const v=m.wasmTable.get(623)(m.HEAPU32[393364>>2],s);a.freeStdString(s);if(v)m.HEAPU32[(v+8)>>2]=0;}catch(_){}
  }
  function accept(command){const g=sdk();if(!g||!command)return;const box=g.entity('ConsoleInputBox');if(!box.exists)return;box._applyTextNow('/'+command[0]+' ');last='/'+command[0]+' ';dismissed=last;clear();}
  function draw(parent){
    clear();boxParent=parent.ptr;
    const h=global.GameSDK.screenSize.height, step=Math.max(20,h*0.031), y0=parent.size.height+4;
    const width=Math.min(275,global.GameSDK.screenSize.width*.48), visible=choices.slice(windowStart,windowStart+3);
    const panel=parent.addOverlayBg({name:'mag_native_panel',file:'interface/autofill_panel.rttex',x:5,y:y0,width:width,height:step*(visible.length+1)+5});rows.push(panel);
    const title=parent.addLabel({name:'mag_native_autofill_title',text:'`wAutofill',x:14,y:y0+4,linesPerScreenY:48});rows.push(title);
    highlightBase=y0+step; highlightStep=step;
    highlight=parent.addOverlayBg({name:'mag_native_selection',file:'interface/autofill_selected.rttex',x:9,y:highlightBase+step*(selection-windowStart),width:width-8,height:step});rows.push(highlight);
    visible.forEach((c,i)=>{
      const label='`w/'+c[0].padEnd(12,' ')+' `o'+c[1];
      const button=parent.addButton({name:'mag_native_command_'+(windowStart+i),text:label,x:16,y:y0+step*(i+1)+2,linesPerScreenY:44,maxWidth:width-22,onClick:()=>accept(c)});rows.push(button);
    });
    shown=true;
  }
  function tick(){
    const g=sdk();if(!g)return;nativeDisabled();
    try{
      const parent=g.entity('ConsoleInputBG'),input=g.entity('ConsoleInputBox');
      const world=g.entity('WorldSpecificGUI');
      if(!parent.exists || !input.exists || !world.exists || ['GenericDialog','PauseMenu','OptionsMenu','StoreMenu'].some(n=>{const e=g.entity(n);return e.exists&&e.visible;})) {clear();last='';dismissed=null;return;}
      const text=input.text;if(text!==last){last=text;dismissed=null;selection=0;windowStart=0;}
      if(!enabled()||text===dismissed){clear();return;}
      const next=match(text);if(!next.length){clear();return;}
      if(!shown || boxParent!==parent.ptr || choices.length!==next.length || choices.some((x,i)=>x[0]!==next[i][0])){choices=next;draw(parent)}
    }catch(e){clear();console.warn('[NativeAutofill]',e)}
  }
  global.addEventListener('keydown',function(e){if(!shown||e.altKey||e.ctrlKey||e.metaKey)return;
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();e.stopImmediatePropagation();selection=(selection+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;
      const previous=windowStart;
      if(selection<windowStart)windowStart=selection;
      else if(selection>=windowStart+3)windowStart=selection-2;
      if(previous!==windowStart){const g=sdk(),p=g&&g.entity('ConsoleInputBG');if(p&&p.exists)draw(p);}
    }
    else if(e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();accept(choices[selection]);}
    else if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();dismissed=last;clear();}
  },true);
  global.setInterval(tick,100);
  // Smoothly move the native selection texture; no DOM animation or overlay.
  function animate(){
    if(shown && highlight && highlight.exists){
      const pos=highlight.position,target=highlightBase+(selection-windowStart)*highlightStep;
      if(Math.abs(target-pos.y)>0.1) highlight.position={x:pos.x,y:pos.y+(target-pos.y)*0.3};
    }
    global.requestAnimationFrame(animate);
  }
  global.requestAnimationFrame(animate);
})(globalThis);
