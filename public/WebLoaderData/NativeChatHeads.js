/* Pinned native avatar portraits. Only the export section is extended; code,
 * function indices, assets, the native log, fonts and palette are unchanged. */
(function (g) {
  'use strict';
  const rows = new Map(), cache = new Map();
  let wanted = new Map(), template=0;
  const marker = /`o`o`o((?:`[0-9]){10})`o {4,6}/;
  let ex, module, overlay, paint, inLog=false, installed=false, lastDraw=0, capturing=false;
  const stats={rendered:0,errors:0,visible:0};
  function key(meta){return meta.clothes.join(',')+':'+(meta.skin>>>0);}
  function validMeta(meta){return meta&&meta.v===1&&typeof meta.id==='string'&&/^\d{10}$/.test(meta.id)&&Array.isArray(meta.clothes)&&meta.clothes.length===10&&meta.clothes.every(n=>Number.isInteger(n)&&n>=0&&n<=65535)&&Number.isInteger(meta.skin)&&meta.skin>=0&&meta.skin<=4294967295;}
  function receive(args){if(typeof args[2]!=='string'||args[2].length>512)return;let meta;try{meta=JSON.parse(args[2]);}catch(_){return;}if(!validMeta(meta))return;rows.set(meta.id,meta);while(rows.size>400)rows.delete(rows.keys().next().value);}
  function cropHead(pixels,w,h){let left=w,right=-1,top=h,bottom=-1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(pixels[((h-1-y)*w+x)*4+3]>16){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
    if(right<left)return null;
    const side=Math.max(right-left+1,bottom-top+1),c=document.createElement('canvas');c.width=c.height=side;const ctx=c.getContext('2d'),im=ctx.createImageData(side,side),ox=Math.floor((side-(right-left+1))/2),oy=Math.floor((side-(bottom-top+1))/2);
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){const from=((h-1-y)*w+x)*4,to=((y-top+oy)*side+x-left+ox)*4;im.data.set(pixels.subarray(from,from+4),to);}
    ctx.putImageData(im,0,0);return c;
  }
  function mergeHeadLayers(full,tail,w,h,chin){
    for(let y=chin;y<h;y++)for(let x=0;x<w;x++){
      const i=((h-1-y)*w+x)*4;
      // Retain only attachments actually visible in the fully equipped pass.
      // Removing a hood for the tail pass must not reveal a beard it occludes.
      if(tail[i+3]<=16||Math.abs(full[i]-tail[i])>4||Math.abs(full[i+1]-tail[i+1])>4||Math.abs(full[i+2]-tail[i+2])>4)full.fill(0,i,i+4);
    }
  }
  function capture(meta){const m=module,gl=m.ctx;if(!gl||!ex||capturing)return null;const resource=ex.portraitResources();if(!template)return null;
    // Owned appearance survives disconnect; no pointer into a destroyed NetAvatar.
    const source=template;
    const state=m._malloc(1056),fake=m._malloc(1712),scale=m._malloc(8);let copied=false,texture=null,fbo=null,depth=null;const savedResource=m.HEAPU8.slice(resource,resource+212);
    const saved={frame:gl.getParameter(gl.FRAMEBUFFER_BINDING),viewport:gl.getParameter(gl.VIEWPORT),texture:gl.getParameter(gl.TEXTURE_BINDING_2D),renderbuffer:gl.getParameter(gl.RENDERBUFFER_BINDING),clear:gl.getParameter(gl.COLOR_CLEAR_VALUE),depthClear:gl.getParameter(gl.DEPTH_CLEAR_VALUE),depthMask:gl.getParameter(gl.DEPTH_WRITEMASK),depthEnabled:gl.isEnabled(gl.DEPTH_TEST),depthFunc:gl.getParameter(gl.DEPTH_FUNC),scissor:gl.isEnabled(gl.SCISSOR_TEST)};
    capturing=true;
    try{
      // Native deep copy owns its rendering containers; never free a shallow copy.
      m.wasmTable.get(1970)(state,source);copied=true;m.HEAPU8.fill(0,fake,fake+1712);
      const dv=new DataView(m.HEAPU8.buffer);dv.setUint32(fake+1572,meta.skin,true);
      // Hair/hat, face, mask and neck. Body/hand/back/aura are not portrait layers.
      for(let i=0;i<10;i++)dv.setUint16(fake+1576+i*2,[0,4,7,8].includes(i)?meta.clothes[i]:0,true);
      dv.setUint32(state+860,fake,true);m.HEAPU8[state+101]=0;ex.portraitApply(state,fake);
      dv.setUint32(state+40,meta.skin,true);dv.setUint32(state+44,meta.skin,true);dv.setUint32(state+52,0,true);
      // f1513 maps facing -> +108 and native /smile expression 1 -> +309.
      m.HEAPU8[state+108]=0;m.HEAPU8[state+309]=1;m.HEAPU8[state+124]=0;m.HEAPU8[state+184]=0;m.HEAPU8[state+102]=0;m.HEAPU8[state+109]=0;m.HEAPU8[state+249]=0;
      dv.setFloat32(state+88,0,true);dv.setFloat32(state+92,0,true);dv.setUint32(state+860,fake,true);
      const cam=m.wasmTable.get(2611)(),sx=m.HEAPF32[(cam+20)>>2],sy=m.HEAPF32[(cam+24)>>2];if(!(sx>0&&sy>0))return null;
      m.HEAPF32[(state+56)>>2]=m.HEAPF32[(cam+4)>>2]+128/sx;m.HEAPF32[(state+60)>>2]=m.HEAPF32[(cam+8)>>2]+240/sy;
      m.HEAPF32[(state+276)>>2]=2/sx;m.HEAPF32[(state+280)>>2]=2/sy;m.HEAPF32[scale>>2]=m.HEAPF32[(scale+4)>>2]=1;
      m.wasmTable.get(1336)(392580,0);texture=gl.createTexture();fbo=gl.createFramebuffer();depth=gl.createRenderbuffer();
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,256,0,gl.RGBA,gl.UNSIGNED_BYTE,null);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,256,256);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Portrait framebuffer incomplete');
      gl.bindTexture(gl.TEXTURE_2D,saved.texture);gl.disable(gl.SCISSOR_TEST);gl.viewport(0,256-gl.drawingBufferHeight,gl.drawingBufferWidth,gl.drawingBufferHeight);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.clearDepth(1);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      ex.portraitDraw(resource,state,0,0,0,scale);m.wasmTable.get(1336)(392580,0);
      const pixels=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      // Below the chin retain face/neck attachments, NOT mask/hat costume bodies.
      // Cultist Hood is slot 7 and otherwise contributes its torso/legs.
      dv.setUint16(fake+1576,0,true);dv.setUint16(fake+1576+14,0,true);
      dv.setUint32(state+860,fake,true);m.HEAPU8[state+101]=0;ex.portraitApply(state,fake);
      dv.setUint32(state+40,meta.skin&0xffffff00,true);dv.setUint32(state+44,meta.skin&0xffffff00,true);
      gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);ex.portraitDraw(resource,state,0,0,0,scale);m.wasmTable.get(1336)(392580,0);
      const accessories=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,accessories);
      mergeHeadLayers(pixels,accessories,256,256,208);
      const image=cropHead(pixels,256,256);if(image)stats.rendered++;return image;
    }finally{
      gl.bindFramebuffer(gl.FRAMEBUFFER,saved.frame);gl.viewport(...saved.viewport);gl.bindRenderbuffer(gl.RENDERBUFFER,saved.renderbuffer);gl.clearColor(...saved.clear);gl.clearDepth(saved.depthClear);gl.depthMask(saved.depthMask);gl.depthFunc(saved.depthFunc);if(saved.depthEnabled)gl.enable(gl.DEPTH_TEST);else gl.disable(gl.DEPTH_TEST);if(saved.scissor)gl.enable(gl.SCISSOR_TEST);else gl.disable(gl.SCISSOR_TEST);
      if(depth)gl.deleteRenderbuffer(depth);if(fbo)gl.deleteFramebuffer(fbo);if(texture)gl.deleteTexture(texture);
      m.HEAPU8.set(savedResource,resource);if(copied)ex.portraitDestroy(state);m._free(state);m._free(fake);m._free(scale);capturing=false;
    }
  }
  function ensureOverlay(){
    if(!overlay){
      overlay=document.createElement('canvas');
      overlay.id='native-chat-heads';
      overlay.setAttribute('aria-hidden','true');
      Object.assign(overlay.style,{position:'fixed',pointerEvents:'none',zIndex:'15',imageRendering:'pixelated'});
      document.body.appendChild(overlay);
      paint=overlay.getContext('2d');
    }
    const c=module&&module.canvas;
    if(!c) return;
    const r=c.getBoundingClientRect();
    if(overlay.width!==c.width||overlay.height!==c.height){overlay.width=c.width;overlay.height=c.height;}
    Object.assign(overlay.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    paint.clearRect(0,0,overlay.width,overlay.height);stats.visible=0;wanted=new Map();lastDraw=performance.now();
  }
  function prepare(){if(document.hidden)return;let budget=1;for(const meta of wanted.values()){
    const k=key(meta),item=cache.get(k),now=Date.now();
    if(item&&(item.at>now||(item.image&&item.tries>=3)))continue;
    if(!budget--)break;
    try{const image=capture(meta);cache.set(k,{image:image||(item&&item.image),at:now+(image?800:1500),tries:(item?item.tries:0)+(image?1:0)});}
    catch(error){stats.errors++;cache.set(k,{image:item&&item.image,at:now+5000,tries:item?item.tries:0});console.warn('[Chat heads] Retrying native portrait:',error);}
    while(cache.size>96)cache.delete(cache.keys().next().value);
  }}
  function measure(font,text,scale){const m=module,p=m._malloc(24);m.HEAPU8.fill(0,p,p+24);try{GameSDK._abi.writeStdString(p,text);m.wasmTable.get(450)(p+16,font,p,scale);return m.HEAPF32[(p+16)>>2];}finally{GameSDK._abi.freeStdString(p);m._free(p);}}
  function draw(font,x,y,text,scale){
    try {
      const hit=marker.exec(text);if(!hit)return;const id=hit[1].replace(/`/g,''),meta=rows.get(id);if(!meta)return;wanted.set(key(meta),meta);const item=cache.get(key(meta));if(!item||!item.image)return;
      const gl=module&&module.ctx; if(!gl||!overlay||!paint) return;
      const clip=gl.getParameter(gl.SCISSOR_BOX),prefix=text.slice(0,hit.index),reserved=measure(font,hit[0].match(/ +$/)[0],scale),height=new DataView(module.HEAPU8.buffer).getInt16(font+14,true)*scale,size=Math.max(1,Math.min(reserved-1,height));
      const vw=(module.HEAP32&&module.HEAP32[392500>>2])||overlay.width,vh=(module.HEAP32&&module.HEAP32[392496>>2])||overlay.height;
      const sx=overlay.width/vw,sy=overlay.height/vh;
      paint.save();if(gl.isEnabled(gl.SCISSOR_TEST)&&clip){paint.beginPath();paint.rect(clip[0],overlay.height-clip[1]-clip[3],clip[2],clip[3]);paint.clip();}paint.imageSmoothingEnabled=false;paint.drawImage(item.image,(x+measure(font,prefix,scale))*sx,(y+(height-size)/2)*sy,size*sx,size*sy);paint.restore();stats.visible++;
    } catch(err) {
      console.warn('[Chat heads] draw error:', err);
    }
  }
  function install(m){if(installed||!ex)return;installed=true;module=m;GameSDK.onPacket('OnConsoleMessage',receive);// Cached pixels and the owned template deliberately survive world exit/reconnect.
    let clothes;clothes=m.hookWasmTable(3191,(p,v)=>{const result=clothes(p,v);const next=m._malloc(1056);m.wasmTable.get(1970)(next,p+516);if(template){ex.portraitDestroy(template);m._free(template);}template=next;return result;},'vii');
    let log;log=m.hookWasmTable(3577,(p,v)=>{if(document.hidden)return log(p,v);prepare();ensureOverlay();inLog=true;try{return log(p,v);}finally{inLog=false;}},'vii');
    let font;font=m.hookWasmTable(2416,(f,x,y,t,s,c,format,batch)=>{const result=font(f,x,y,t,s,c,format,batch);if(inLog&&!capturing)draw(f,x,y,GameSDK._abi.readStdString(t),s);return result;},'viffifiii');
    setInterval(()=>{if(overlay&&!document.hidden&&performance.now()-lastDraw>250)paint.clearRect(0,0,overlay.width,overlay.height);},250);
  }
  g.NativeChatHeads={stats,validMeta,install,
    instantiate(imports,done){fetch('/client/client.wasm',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('WASM HTTP '+r.status);return r.arrayBuffer();}).then(bytes=>WebAssembly.compile(bytes)).then(async mod=>{if(!["portraitDraw","portraitResources","portraitApply","portraitDestroy"].every(name=>WebAssembly.Module.exports(mod).some(e=>e.name===name&&e.kind==="function")))throw Error("Server missing audited portrait exports; rebuild the server");const instance=await WebAssembly.instantiate(mod,imports);ex=instance.exports;done(instance,mod);}).catch(error=>{console.error('[Chat heads]',error);if(g.showClientStartupError)g.showClientStartupError(String(error));});return {};},
    // Read-only diagnostics: no privilege-changing endpoints or equipment mutation.
    diagnostics(){return {...stats,entries:rows.size,portraits:cache.size};}
  };
})(globalThis);
