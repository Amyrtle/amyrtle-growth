import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/db.ts';
import { seed,DEMO_PASSWORD } from '../server/seed.ts';
test('independent API processes share database capacity and one-time redemption constraints',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'amyrtle-race-'));const file=join(dir,'race.sqlite');const key=randomBytes(32).toString('hex');const db=new Store(file);seed(db);db.run('UPDATE booking_slots SET capacity=1');const children:ChildProcess[]=[];
  async function start(){const child=fork(new URL('./worker-server.ts',import.meta.url),{execArgv:['--import','tsx'],env:{...process.env,TEST_DB:file,TEST_KEY:key},silent:true});children.push(child);return new Promise<string>((resolve,reject)=>{child.once('message',(m:{port:number})=>resolve('http://127.0.0.1:'+m.port));child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error('worker failed'));});});}
  async function call(base:string,path:string,body?:unknown,cookie='',csrf=''){const res=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-amyrtle-request':'1','x-csrf-token':csrf,Cookie:cookie},body:body?JSON.stringify(body):undefined});return {status:res.status,json:await res.json(),cookie:res.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};}
  try{const [a,b]=await Promise.all([start(),start()]);const slot=db.one<{id:string}>("SELECT s.id FROM booking_slots s JOIN campaigns c ON c.id=s.campaign_id WHERE c.slug='demo-autumn-photo' AND c.status='published' ORDER BY s.starts_at,s.id LIMIT 1")!.id;
    const [av,bv]=await Promise.all([call(a,'/public/demo-autumn-photo'),call(b,'/public/demo-autumn-photo')]);const payload=()=>({slotId:slot,name:'进程并发测试',contact:'13800138000',consent:true,requestKey:randomUUID(),source:'unknown',website:''});const results=await Promise.all([call(a,'/public/demo-autumn-photo/book',payload(),av.cookie),call(b,'/public/demo-autumn-photo/book',payload(),bv.cookie)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    const visitor=await call(a,'/public/demo-autumn-coffee');const voucher=await call(a,'/public/demo-autumn-coffee/claim',{consent:true,requestKey:randomUUID(),source:'unknown',website:''},visitor.cookie);assert.equal(voucher.status,201);
    const auth=await call(a,'/auth/login',{email:'food@demo.amyrtle.local',password:DEMO_PASSWORD});const rr=await Promise.all([a,b].map(base=>call(base,'/vouchers/redeem',{code:voucher.json.data.code},auth.cookie,auth.json.data.csrf)));assert.deepEqual(rr.map(r=>r.status).sort(),[200,409]);assert.equal(db.one<{n:number}>("SELECT count(*) n FROM redemption_logs WHERE result='success'")!.n,1);
  }finally{await Promise.all(children.map(c=>new Promise<void>(resolve=>{if(c.exitCode!==null)return resolve();c.once('exit',()=>resolve());c.send('stop');})));db.close();rmSync(dir,{recursive:true,force:true});}
});
