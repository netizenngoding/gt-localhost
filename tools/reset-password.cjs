// OFFLINE owner recovery only. Stop the server before running this tool.
// SERVER_STOPPED=1 GT_RESET_PASSWORD='...' node tools/reset-password.cjs data_store/players.json GrowID
const fs=require('node:fs'),crypto=require('node:crypto');
const [file,name]=process.argv.slice(2),password=process.env.GT_RESET_PASSWORD;
if(process.env.SERVER_STOPPED!=='1'||!file||!name||!password||password.length<8||password.length>18) {
 console.error('Stop the server. Supply SERVER_STOPPED=1, GT_RESET_PASSWORD (8–18 characters), players.json path and GrowID.');process.exit(1);
}
const accounts=JSON.parse(fs.readFileSync(file,'utf8'));
if(!Array.isArray(accounts))throw Error('Invalid account database');
const matches=accounts.filter(a=>!a.isGuest&&(a.growId||a.name).toLowerCase()===name.toLowerCase());
if(matches.length!==1)throw Error('Expected exactly one registered account');
const salt=crypto.randomBytes(16).toString('hex');
matches[0].passwordHash=`scrypt$${salt}$${crypto.scryptSync(password,salt,32).toString('hex')}`;
fs.copyFileSync(file,`${file}.password-reset-${Date.now()}.bak`);
const tmp=file+'.reset-tmp';const fd=fs.openSync(tmp,'wx',0o600);
try{fs.writeFileSync(fd,JSON.stringify(accounts));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
fs.renameSync(tmp,file);console.log('Password reset saved. No password was printed. Restart the server.');
