import { connect, screenshot } from "./cdp.mjs";
const T=ms=>new Promise(r=>setTimeout(r,ms));
const l=await (await fetch("http://127.0.0.1:9341/json/list")).json();const p=l.find(t=>t.type==='page');const c=connect(p.webSocketDebuggerUrl);await c.ready;await c.send("Page.enable");
await fetch("http://127.0.0.1:3000/debug-die?spike=0");
await T(250);await screenshot(c.send,"C:/Users/User/AppData/Local/Temp/die_false_250.png");
await T(600);await screenshot(c.send,"C:/Users/User/AppData/Local/Temp/die_false_850.png");
await T(1500);await screenshot(c.send,"C:/Users/User/AppData/Local/Temp/die_false_2350.png");
process.exit(0);
