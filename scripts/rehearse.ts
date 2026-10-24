import { fork,type ChildProcess } from 'node:child_process';
import { cpSync,mkdirSync,readFileSync,writeFileSync,copyFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { backup } from 'node:sqlite';
import assert from 'node:assert/strict';
import { Store } from '../server/db.ts';
import { digest } from '../server/security.ts';
import { DEMO_PASSWORD } from '../server/seed.ts';
const root=resolve('.local/rehearsal-'+Date.now());mkdirSync(root,{recursive:true});
const a=join(root,'release-a');const b=join(root,'release-b');const key=randomBytes(32).toString('hex');
for(const dir of [a,b]){mkdirSync(dir);for(const name of ['server','shared','db','dist','package.json'])cpSync(resolve(name),join(dir,name),{recursive:true});}
const original=readFileSync(join(a,'dist/index.html'),'utf8');writeFileSync(join(b,'dist/index.html'),original.replace('<title>','<title>ROLLBACK-DRILL '));
let active:ChildProcess|undefined;
async function stop(){const current=active;if(!current||current.exitCode!==null)return;await new Promise<void>(resolve=>{current.once('exit',()=>resolve());current.kill('SIGTERM');});active=undefined;}
async function start(dir:string,dbPath:string){const child=fork(join(dir,'server/index.ts'),['--production'],{cwd:dir,execArgv:['--import','tsx'],silent:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATABASE_PATH:dbPath,DATA_KEY:key,DEMO_MODE:'true',ALLOW_EXTERNAL_AI:'false'}});active=child;return new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('rehearsal startup timeout')),20000);child.once('error',reject);child.stdout?.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.once('exit',code=>{if(code){clearTimeout(timer);reject(new Error('rehearsal server failed'));}});});}
async function login(base:string){const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','x-amyrtle-request':'1'},body:JSON.stringify({email:'photo@demo.amyrtle.local',password:DEMO_PASSWORD})});const value=await res.json() as {data:{csrf:string}};assert.equal(res.status,200);return {'Content-Type':'application/json','x-amyrtle-request':'1','x-csrf-token':value.data.csrf,Cookie:res.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};}
try{
  const database=join(root,'current.sqlite');let base=await start(a,database);assert.equal(digest(await (await fetch(base)).text()),digest(original));const auth=await login(base);const current=await (await fetch(base+'/api/store',{headers:auth})).json() as {data:{name:string;description:string;address:string;contact:string;brandColor:string;logoAssetId:null}};
  const db=new Store(database);const snapshot=join(root,'snapshot.sqlite');await backup(db.db,snapshot);db.close();await stop();
  base=await start(b,database);assert.ok((await (await fetch(base)).text()).includes('ROLLBACK-DRILL'));const authB=await login(base);const shop=current.data;const changed=await fetch(base+'/api/store',{method:'PATCH',headers:authB,body:JSON.stringify({name:'回滚演练中的修改',description:shop.description,address:shop.address,contact:shop.contact,brandColor:shop.brandColor,logoAssetId:null})});assert.equal(changed.status,200);await stop();
  const restored=join(root,'restored.sqlite');copyFileSync(snapshot,restored);const checked=new Store(restored);assert.equal(checked.one<{integrity_check:string}>('PRAGMA integrity_check')!.integrity_check,'ok');assert.equal(checked.all('PRAGMA foreign_key_check').length,0);checked.close();
  base=await start(a,restored);assert.equal(digest(await (await fetch(base)).text()),digest(original));const finalAuth=await login(base);const finalShop=await (await fetch(base+'/api/store',{headers:finalAuth})).json() as {data:{name:string}};assert.equal(finalShop.data.name,shop.name);
  const report={status:'passed',time:new Date().toISOString(),checks:['release A served and hash verified','online SQLite backup created','release B served and test mutation persisted','release A restored and exact HTML hash matched','database snapshot restored, integrity_check and foreign_key_check passed','restored owner login and original shop verified'],scope:'Local Node/SQLite same-schema release and database rollback; no cloud environment touched',recoveryWindow:'Changes after the backup are discarded in this snapshot recovery drill'};
  mkdirSync('docs/test-logs',{recursive:true});writeFileSync('docs/test-logs/operations.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await stop();}
