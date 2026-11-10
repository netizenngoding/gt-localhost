// Visibility is a cooperative restriction, NEVER an authority or bot detector.
// Every connection, including clients lying about focus, gets action limits.
export class SessionGuard {
  background = false;
  denied = 0;
  private buckets = new Map<string,{tokens:number;at:number}>();
  allow(kind:string, rate:number, burst:number, now=Date.now()):boolean {
    const b=this.buckets.get(kind)||{tokens:burst,at:now};
    b.tokens=Math.min(burst,b.tokens+Math.max(0,now-b.at)*rate/1000);b.at=now;
    this.buckets.set(kind,b);
    if(b.tokens<1){this.denied++;return false;}b.tokens--;return true;
  }
  presence(raw:Buffer):boolean {
    if(raw.length>128||!this.allow('presence',4,8))return false;
    let p;try{p=JSON.parse(raw.toString('utf8'));}catch{return false;}
    if(p?.type!=='client-presence'||p.v!==1||typeof p.background!=='boolean')return false;
    this.background=p.background;return true;
  }
  game(type:number):boolean {
    if(type===21||type===22)return this.allow('ping',10,20);
    if(this.background){this.denied++;return false;}
    if(type===0)return this.allow('movement',60,120);
    if([3,7,10,11].includes(type))return this.allow('interaction',10,16);
    return true; // Unsupported types are ignored by the existing dispatcher.
  }
  text(text:string, loggedIn:boolean):boolean {
    if(!this.allow('text',8,24))return false;
    if(!loggedIn||!this.background)return true;
    // Login/world-selection and explicit exit stay possible, not commands/dialogs.
    return /^action\|(enter_game|quit|quit_to_exit)(\n|$)/.test(text);
  }
}
