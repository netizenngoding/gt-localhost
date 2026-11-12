/* Background liveness is not gameplay automation. Never synthesizes keydowns,
 * movement, punches, chat, or ENet ACKs; the real native loop services transport. */
(function(g){'use strict';
 const sockets=new Set();let paused=false,worker=null,timer=null,last=0,installed=false,draining=false;
 const stats={ticks:0,releases:0};
 const inactive=()=>document.hidden||!document.hasFocus();
 function announce(){const text=JSON.stringify({type:'client-presence',v:1,background:inactive()});for(const ws of sockets)if(ws.readyState===1)ws.send(text);}
 function release(){const s=g.SDL;if(!s)return;stats.releases++;
  // Drop pending presses, not network events. Release already-consumed inputs.
  s.events=s.events.filter(e=>!['keydown','keypress','mousedown','touchstart','touchmove'].includes(e.type));
  for(const keyCode of Object.values(s.keyboardMap))s.receiveEvent({type:'keyup',keyCode,preventDefault(){}});
  const canvas=g.Module.canvas,r=canvas.getBoundingClientRect(),x=r.left+(g.scrollX||0)+(g.Browser?.mouseX||0)*(r.width&&canvas.width?r.width/canvas.width:1),y=r.top+(g.scrollY||0)+(g.Browser?.mouseY||0)*(r.height&&canvas.height?r.height/canvas.height:1);
  for(let button=0;button<3;button++)if(s.DOMButtons[button]||(s.buttonState&(1<<button)))s.receiveEvent({type:'mouseup',button,pageX:x,pageY:y,preventDefault(){}});
  for(const id of Object.keys(s.downFingers))s.receiveEvent({type:'touchend',changedTouches:[{identifier:Number(id),clientX:x-(g.scrollX||0),clientY:y-(g.scrollY||0)}],preventDefault(){}});
  s.DOMButtons=[0,0,0];s.savedKeydown=null;
 }
 function tick(){if(!paused||!document.hidden||performance.now()-last<200)return;last=performance.now();
  const loop=g.MainLoop;if(!loop?.func||g.ABORT)return;
  release();
  // Hidden tabs do not present WebGL frames. Do not accumulate unpresented
  // drawing buffers in Chromium/SwiftShader while servicing the native network.
  const gl=g.Module?.ctx, saved=[];
  try{
   if(gl)for(const name of ['clear','drawArrays','drawElements']){saved.push([name,gl[name]]);gl[name]=()=>{};}
   loop.currentFrameNumber=(loop.currentFrameNumber+1)|0;
   loop.runIter(loop.func);stats.ticks++;
  }finally{if(gl)for(const [name,fn] of saved)gl[name]=fn;}

 }
 function stopWake(){if(worker){worker.terminate();worker=null;}if(timer){clearInterval(timer);timer=null;}}
 function sync(){if(!installed)return;const loop=g.MainLoop;
  if(document.hidden&&!paused&&loop?.func&&loop.scheduler&&!loop.queue.length){release();loop.pause();paused=true;
   try{const blob=new Blob(['setInterval(()=>postMessage(0),250)'],{type:'application/javascript'}),url=URL.createObjectURL(blob);worker=new Worker(url);URL.revokeObjectURL(url);worker.onmessage=tick;worker.onerror=()=>{stopWake();timer=setInterval(tick,1000);};}
   catch(_){timer=setInterval(tick,1000);}tick();
  }else if(!document.hidden&&paused){stopWake();paused=false;release();if(loop?.func&&!g.ABORT)loop.resume();}
 }
 const Base=g.WebSocket;
 if(Base)g.WebSocket=class extends Base{constructor(url,protocols){super(url,...(protocols===undefined?[]:[protocols]));
   let game=false;try{game=new URL(String(url),location.href).pathname==='/enet';}catch(_){}
   if(!game)return;sockets.add(this);this.addEventListener('open',announce);this.addEventListener('close',()=>sockets.delete(this));
 }};
 function changed(){if(inactive()){
   release();
   // Drain already-queued foreground input/releases BEFORE the presence frame.
   // WebSocket ordering then prevents rejecting a legitimate in-flight punch.
   const loop=g.MainLoop;
   if(installed&&!paused&&!draining&&loop?.func&&!loop.queue.length){draining=true;try{loop.currentFrameNumber=(loop.currentFrameNumber+1)|0;loop.runIter(loop.func);}finally{draining=false;}}
  }announce();sync();}
 document.addEventListener('visibilitychange',changed);g.addEventListener('blur',changed);g.addEventListener('focus',changed);
 // A hidden page must not collect new input to replay on focus.
 for(const type of ['keydown','keypress','mousedown','pointerdown','touchstart'])g.addEventListener(type,e=>{if(installed&&inactive()){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,passive:false});
 g.NativeSession={install(){if(installed)return;installed=true;announce();sync();setInterval(sync,1000);},diagnostics(){return{...stats,paused,background:inactive(),sockets:sockets.size};}};
})(globalThis);