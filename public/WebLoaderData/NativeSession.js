/* Background liveness is not gameplay automation. Never synthesizes keydowns,
 * movement, punches, chat, or ENet ACKs; the real native loop services transport. */
(function(g){'use strict';
 const sockets=new Set();let paused=false,worker=null,timer=null,last=0,installed=false,draining=false;
 const stats={ticks:0,releases:0};
 // "Background" for the server means the tab is actually hidden/minimized.
 // Two Growtopia windows side by side are both visible; the unfocused one must
 // stay a normal foreground client or the server drops its packets and every
 // focus switch feels like a lag spike.
 const inactive=()=>document.hidden;
 // Only a hidden (minimized/background-tab) client needs the worker. An
 // unfocused but still visible window must keep rendering normally; otherwise
 // unminimizing leaves a frozen frame until the user clicks the canvas.
 const shouldPause=()=>document.hidden;
 function announce(){
  // Only a minimized/background tab with no focus is throttled. A visible
  // side-by-side window stays foreground, and a focused-but-occluded window
  // stays playable. The server drops only unreliable movement for this flag;
  // it never blocks punches or pull effects.
  const text=JSON.stringify({type:'client-presence',v:1,background:inactive()&&!document.hasFocus()});
  for(const ws of sockets)if(ws.readyState===1)ws.send(text);
 }
 function release(){const s=g.SDL;if(!s)return;stats.releases++;
  // Drop pending presses, not network events. Release already-consumed inputs.
  s.events=s.events.filter(e=>!['keydown','keypress','mousedown','touchstart','touchmove'].includes(e.type));
  for(const keyCode of Object.values(s.keyboardMap))s.receiveEvent({type:'keyup',keyCode,preventDefault(){}});
  const canvas=g.Module.canvas,r=canvas.getBoundingClientRect(),x=r.left+(g.scrollX||0)+(g.Browser?.mouseX||0)*(r.width&&canvas.width?r.width/canvas.width:1),y=r.top+(g.scrollY||0)+(g.Browser?.mouseY||0)*(r.height&&canvas.height?r.height/canvas.height:1);
  for(let button=0;button<3;button++)if(s.DOMButtons[button]||(s.buttonState&(1<<button)))s.receiveEvent({type:'mouseup',button,pageX:x,pageY:y,preventDefault(){}});
  for(const id of Object.keys(s.downFingers))s.receiveEvent({type:'touchend',changedTouches:[{identifier:Number(id),clientX:x-(g.scrollX||0),clientY:y-(g.scrollY||0)}],preventDefault(){}});
  s.DOMButtons=[0,0,0];s.savedKeydown=null;
 }
 function tick(force){if(!paused||(!force&&performance.now()-last<25))return;last=performance.now();
  const loop=g.MainLoop;if(!loop?.func||g.ABORT)return;
  // Hidden tabs do not present WebGL frames. Do not accumulate unpresented
  // drawing buffers in Chromium/SwiftShader while servicing the native network.
  const gl=g.Module?.ctx, saved=[];
  try{
   if(gl&&!document.hasFocus())for(const name of ['clear','drawArrays','drawElements']){saved.push([name,gl[name]]);gl[name]=()=>{};}
   loop.currentFrameNumber=(loop.currentFrameNumber+1)|0;
   loop.runIter(loop.func);stats.ticks++;
  }finally{if(gl)for(const [name,fn] of saved)gl[name]=fn;}

 }
 // Chrome freezes/discards a hidden tab after a while, especially with two
 // 325 MB clients open. A (near-)silent running AudioContext marks the tab as
 // audible so Memory Saver keeps it alive and the 20 Hz background loop keeps
 // draining the socket instead of leaving a packet backlog for the return.
 let audioCtx=null,audioOsc=null;
 function keepAliveAudio(){
  try{
   const Ctx=g.AudioContext||g.webkitAudioContext;if(!Ctx)return;
   if(audioCtx){if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});return;}
   audioCtx=new Ctx();
   audioOsc=audioCtx.createOscillator();
   const gain=audioCtx.createGain();
   audioOsc.frequency.value=30;
   gain.gain.value=0.0008;
   audioOsc.connect(gain);gain.connect(audioCtx.destination);
   audioOsc.start();
   if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
  }catch(_e){}
 }
 function stopWake(){if(worker){worker.terminate();worker=null;}if(timer){clearInterval(timer);timer=null;}}
 function sync(){if(!installed)return;const loop=g.MainLoop;
  if(shouldPause()&&!paused&&loop?.func&&loop.scheduler&&!loop.queue.length){release();loop.pause();paused=true;
   try{const blob=new Blob(['setInterval(()=>postMessage(0),50)'],{type:'application/javascript'}),url=URL.createObjectURL(blob);worker=new Worker(url);URL.revokeObjectURL(url);worker.onmessage=tick;worker.onerror=()=>{stopWake();timer=setInterval(tick,50);};}
   catch(_){timer=setInterval(tick,50);}tick();
  }else if(!shouldPause()&&paused){stopWake();paused=false;release();if(loop?.func&&!g.ABORT)loop.resume();}
 }
 const Base=g.WebSocket;
 if(Base)g.WebSocket=class extends Base{constructor(url,protocols){super(url,...(protocols===undefined?[]:[protocols]));
   let game=false;try{game=new URL(String(url),location.href).pathname==='/enet';}catch(_){}
   if(!game)return;sockets.add(this);this.addEventListener('open',announce);this.addEventListener('close',()=>sockets.delete(this));
   // Hidden timers are throttled by Chrome. Process each arriving socket frame
   // immediately so the native loop stays drained instead of building a burst.
   this.addEventListener('message',()=>{if(paused)tick(true);});
 }};
 function changed(){if(document.hidden||!document.hasFocus()){
   release();
   // Drain already-queued foreground input/releases BEFORE the presence frame.
   // WebSocket ordering then prevents rejecting a legitimate in-flight punch.
   const loop=g.MainLoop;
   if(installed&&!paused&&!draining&&loop?.func&&!loop.queue.length){draining=true;try{loop.currentFrameNumber=(loop.currentFrameNumber+1)|0;loop.runIter(loop.func);}finally{draining=false;}}
  }announce();sync();}
 document.addEventListener('visibilitychange',function(){if(document.hidden)keepAliveAudio();changed();});g.addEventListener('blur',changed);g.addEventListener('focus',changed);
 // Chrome Page Lifecycle can freeze/resume a hidden tab without firing focus.
 // Recover the loop and presence on every lifecycle return as well.
 document.addEventListener('freeze',announce);document.addEventListener('resume',function(){announce();sync();});g.addEventListener('pageshow',function(){announce();sync();});
 g.NativeSession={install(){if(installed)return;installed=true;announce();sync();keepAliveAudio();g.addEventListener('pointerdown',keepAliveAudio,{capture:true,once:true});g.addEventListener('keydown',keepAliveAudio,{capture:true,once:true});setInterval(()=>{sync();announce();},1000);},diagnostics(){let buffered=0;for(const ws of sockets)buffered+=ws.bufferedAmount||0;return{...stats,paused,background:inactive(),sockets:sockets.size,buffered};}};
})(globalThis);