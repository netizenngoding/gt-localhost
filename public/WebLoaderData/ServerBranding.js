// server branding logo supplied by the project owner. RTPACK/RTTXTR format verified against the pinned native client.
// Runtime branding and intro branch hook for the SHA-pinned client.
(function(global){
  const images = global.SERVER_BRANDING_ASSETS;
  const config = global.SERVER_CONFIG;
  const name = config.serverName;
  const buttonConfig=Object.assign({text:"@salakpatty",url:"https://www.tiktok.com/@salakpatty",color:"#A5E3FB",textColor:"#FFFFFF",iconEnabled:true},config.menuButton);
  const nativeColor=hex=>{const n=parseInt(hex.slice(1),16);return (((n&255)<<24)|((n&65280)<<8)|((n>>>16)<<8)|255)>>>0;};
  const paths = {"background":["/interface/large/main_menu.rttex","/interface/large/generic_menu2.rttex"],"title": ["/interface/large/game_title.rttex", "/interface/large/game_title_themed.rttex", "/interface/new_game_title.rttex", "/interface/new_game_title2.rttex"], "banner": ["/interface/large/news_banner.rttex", "/interface/large/news_banner_hd.rttex", "/interface/large/news_banner_split.rttex"], "icon": ["/interface/logo_188.rttex", "/interface/large/btn_logo_gt.rttex"]};
  if (global.document && global.MutationObserver) {
    const keepTitle=()=>{if(document.title!==name)document.title=name;};
    keepTitle();new MutationObserver(keepTitle).observe(document.head,{childList:true,subtree:true,characterData:true});
  }
  global.ServerBranding = {
    installNativeHooks(module) {
      if(this.hooksInstalled) return;
      this.hooksInstalled=true;
      // Do NOT block table2047: func1790 is the shared console drag/layout callback.
      // VoiceMenu is removed specifically at entity creation; voice token handler is a native stub.
      const create={fn:null};
      create.fn=module.hookWasmTable(2342,(parent,x,y,n,t,index)=>{
        const abi=global.GameSDK._abi;
        if(abi.readStdString(n)!=="About") return create.fn(parent,x,y,n,t,index);
        const replacement=module._malloc(12);module.HEAPU8.fill(0,replacement,replacement+12);
        const prefix=buttonConfig.iconEnabled?(module.HEAPU8[393901]?"  ":"    "):"";
        abi.writeStdString(replacement,prefix+buttonConfig.text);
        try{return create.fn(parent,x,y,n,replacement,index);}finally{abi.freeStdString(replacement);module._free(replacement);}
      },"viiiiii");
      const select={fn:null};
      select.fn=module.hookWasmTable(2338,list=>{
        const ptr=module.HEAPU32[(list+44)>>2];
        if(ptr && global.GameSDK._abi.readStdString(ptr+40)==="About") {
          global.open(buttonConfig.url,"_blank","noopener,noreferrer");return;
        }
        return select.fn(list);
      },"vi");
      module.HEAPU8[369789]=0; module.HEAPU8[393905]=0;
      module.HEAPU8[393900]=0;
      if(config.skipIntro) {
        // Native bootstrap: take the normal no-promo-dialog branch, not an auto-accept click.
        const bootstrap={fn:null};
        bootstrap.fn=module.hookWasmTable(1498,()=>{
          module.HEAPU8[393360]=0;
          return bootstrap.fn();
        },"v");
        const original={fn:null};
        original.fn=module.hookWasmTable(2366,(parent,arg)=>{
          module.HEAPU8[393968]=1;
          this.introBypassCalls=(this.introBypassCalls||0)+1;
          return original.fn(parent,arg);
        },"vii");
      }
    },
    attachUi(sdk) {
      if (!sdk || this.uiAttached) return;
      this.uiAttached=true;
      sdk.onMenu("MainMenu",menu=>{
        Module.HEAPU8[369789]=0;Module.HEAPU8[393905]=0;Module.HEAPU8[393900]=0;
        menu.find("version").text = config.version || "V1.5";
        const about=menu.find("About");
        if(about.exists) {
          // Retain the actual native About button: same factory, font, alignment, padding,
          // border, bob and slide animation as Play Online/Options. Only content is modded.
          const pos=about.position,sz=about.size;
          const frame=sdk.listEntities("MainMenu").find(r=>r.name==="(unnamed)" && Math.abs(r.y-pos.y)<sz.height/2 && r.w>=sz.width);
          if(frame) {
            const color=nativeColor(buttonConfig.color),abi=sdk._abi,m=global.Module,scratch=abi.ensureScratch()+320;
            sdk.entity(frame.ptr)._applyColorNow(color);
            // Native frame edge color belongs to RectRender's VariantDB, not the Entity DB.
            abi.writeStdString(scratch,"RectRender");const component=m.wasmTable.get(637)(frame.ptr,scratch,0);abi.freeStdString(scratch);
            if(component) {
              abi.writeStdString(scratch,"borderColor");const v=m.wasmTable.get(625)(component+36,scratch);abi.freeStdString(scratch);
              m.HEAPU32[v>>2]=5;m.HEAPU32[(v+8)>>2]=color;abi.notifyVariantChanged(v);
            }
          }
          about._applyColorNow(nativeColor(buttonConfig.textColor));
          if(buttonConfig.iconEnabled) {
            const padded=about.text;
            about.text=buttonConfig.text;const textWidth=about.size.width;about.text=padded;
            const slot=Math.max(0,sz.width-textWidth),icon=Math.min(sz.height*.72,slot*.8);
            const logo=about.addOverlayBg({name:"MenuButtonIcon",file:"interface/server_tiktok.rttex",x:(slot-icon)/2,y:(sz.height-icon)/2,width:icon,height:icon});
            logo._applyColorNow(nativeColor(buttonConfig.textColor));
          }
        }
      });
      sdk.onMenu("OptionsMenu",menu=>{
        const rows=sdk.listEntities("OptionsMenu/scroll/scroll_child");
        const removed=rows.filter(r=>["begaty_mode","join_calls","ptt"].includes(r.name));
        const step=sdk.screenSize.height*0.1225;
        const soundOn=menu.find("sound_1"),soundOff=menu.find("sound_0");
        const oldAudioY=soundOn.position.y;
        const fps=rows.find(r=>r.name==="sbeat_ad");
        for(const r of rows) {
          if(r.path.split("/").length!==6) continue;
          const ent=sdk.entity(r.ptr);
          if(["sound_1","sound_0","sound_lightbar"].includes(r.name) || ent.text==="Audio:") {
            // Retain native selector entities for the original enable/mute callbacks.
            // They remain noninteractive and transparent outside the scroll viewport.
            ent._applyAlphaNow(0);ent._applyVisibleNow(false);continue;
          }
          if(removed.some(d=>d.ptr===r.ptr)) ent.destroy();
          else {
            let shift=removed.filter(d=>d.y<r.y).length*step;
            if(r.y>oldAudioY)shift+=step; // remove the old Audio On/Off row
            if(fps && r.y>fps.y)shift-=step; // reserve the new checkbox below Show FPS
            if(shift)ent._applyPosNow(r.x,r.y-shift);
          }
        }
        if(fps && soundOn.exists && soundOff.exists) {
          const m=global.Module,abi=sdk._abi,scratch=abi.ensureScratch()+320;
          abi.writeStdString(scratch,"soundDisabled");
          const variable=m.wasmTable.get(623)(m.HEAPU32[393364>>2],scratch);
          abi.freeStdString(scratch);
          const enabled=!m.HEAPU32[(variable+8)>>2];
          menu.find("scroll_child").addCheckbox({name:"audio_enabled",text:"Audio",x:fps.x,y:fps.y,checked:enabled,linesPerScreenY:30,onChange:on=>{
            // Native OptionsMenuOnSelect expects VariantList[1] = TYPE_ENTITY, value +4.
            // Delegate all engine channels, music/SFX mute and persistence to the native handler.
            const list=m._malloc(240);m.HEAPU8.fill(0,list,list+240);
            m.HEAPU32[(list+40)>>2]=6;m.HEAPU32[(list+44)>>2]=(on?soundOn:soundOff).ptr;
            try{m.wasmTable.get(2222)(list);}finally{m._free(list);}
          }});
        }
        // Native checkbox for the new in-engine assistant; no DOM UI.
        const auto=menu.find("enable_autofill");
        if(auto.exists && global.NativeAutofill) {
          const pos=auto.position;
          auto.destroy();
          menu.find("scroll_child").addCheckbox({name:"mag_native_autofill_enabled",text:config.autofillLabel||"Autofill",x:pos.x,y:pos.y,checked:global.NativeAutofill.enabled(),linesPerScreenY:30,onChange:on=>global.NativeAutofill.setEnabled(on)});
        }
        sdk.entity("_textalt_font").text="Swap to Minecraft Font";
        Module.HEAPU8[369789]=0;Module.HEAPU8[393905]=0;Module.HEAPU8[393900]=0;
      });
      sdk.onMenu("VoiceMenu",menu=>menu.destroy());
      for(const menu of ["MainMenu","GenericDialog","LoginMenu","AboutMenu","OptionsMenu","OnlineMenu","FlagMenu"]) sdk.onMenu(menu,()=>{
        for(const row of sdk.listEntities(menu)) {
          const entity=sdk.entity(row.ptr),text=entity.text;
          
          // Product labels follow config; upstream author notices remain in THIRD_PARTY_NOTICES.md.
          if (!text) continue;
          if (/iProgramInCpp|TCG Group|copyright.*Creative|Creative.*copyright|reverse engineer|client has been created/i.test(text)) {
            entity.text="Client engine notices: THIRD_PARTY_NOTICES.md"; continue;
          }
          const updated=text.replace(/Creative Growtopia|CreativeGrowtopia|CreativePS|Creative PS/g,name);
          if(updated!==text) entity.text=updated;
        }
      });
    },
    install(fs) {
      if (!fs || typeof fs.writeFile !== 'function') throw new Error('VFS unavailable for server branding');
      const old = fs.ignorePermissions;fs.ignorePermissions=true;
      const patched=[];
      try {
        const ui=global.SERVER_UI_ASSETS;
        for(const [stem,encoded] of Object.entries({autofill_panel:"UlRQQUNLAABrAQAAfAABAAEAAAAAAAAAAAAAAAAAAAB4nO3RoQ3CYBRG0aJYAI/EMkvzC8ZhBcIibMMIjAECmjS1yHNfcpKnPnPnMS5jnqbr9LU7rP6ff2/Z267tj6d3bLfnK6B1//P9EUj9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d9Wf1v9bfW31d+27R/P0j+uDy2q9G4=",autofill_selected:"UlRQQUNLAAB4AAAAfAABAAEAAAAAAAAAAAAAAAAAAAB4nO3MsQnAIBRF0Z8dMpn8IpBlnMktnMoUJiBpbc+DA6+6JfPKElFjOs7lv3b39f61u/UBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADySTT6w="})) {
          const target="/interface/"+stem+".rttex";
          try{fs.unlink(target);}catch(_){} fs.writeFile(target,Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))); patched.push(target);
        }
        // The user's emote artwork is installed into the existing native hand
        // texture. Both client variants use the same transparent grayscale PNG.
        const customMiddle=Uint8Array.from(atob("UlRQQUNLAAB1AAAAfAgAAAEAAAAAAAAAAAAAAAAAAAB42gsKCYkICWJgEGBgYFAAYkYRJDYUUwpg5jFwMIyCQQ4WL178H4Zv3boFxydOnIBjWtoNswPE3rp1KxzTw+8wu2BuGAj7YfYiu4FecT9Y7EfG9LQfOQ3QM97xhcFA2Q/L8yPV/oEO/4GyH9kNtLYHAMUz24Y="),c=>c.charCodeAt(0));
        for(const target of ["/game/player_arm_middlefinger.rttex","/game/player_arm_middlefinger_beta.rttex"]) {
          try{fs.unlink(target);}catch(_){} fs.writeFile(target,customMiddle); patched.push(target);
        }
        const fontPaths={normal:"font_normal",normalx2:"font_normalx2",big:"font_mono_big",bigx2:"font_mono_bigx2",tiktok:"server_tiktok"};
        for(const [key,stem] of Object.entries(fontPaths)) {
          const target="/interface/"+stem+(key==="tiktok"?".rttex":".rtfont");
          try{fs.unlink(target);}catch(_){}
          fs.writeFile(target,Uint8Array.from(atob(ui[key]),c=>c.charCodeAt(0)));patched.push(target);
        }
        for(const [kind,targets] of Object.entries(paths)) {
          const binary=atob(images[kind]);const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
          for(const path of targets) { try{fs.unlink(path);}catch(_){} fs.writeFile(path,bytes);patched.push(path); }
        }
      } finally {fs.ignorePermissions=old;}
      this.patchedPaths=patched;return patched;
    }
  };
  if(global.document) document.addEventListener("DOMContentLoaded",()=>{
    document.querySelectorAll("[data-server-logo]").forEach(el=>{el.src="/"+config.logoPath;el.alt=name;});
    document.querySelectorAll("[data-server-name]").forEach(el=>el.textContent=name);
    document.querySelectorAll("[data-server-loading]").forEach(el=>el.textContent="Loading "+name+"...");
    document.querySelector('meta[name="application-name"]')?.setAttribute("content",name);
  });
})(globalThis);
