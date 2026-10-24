import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import sharp from 'sharp';
import { createApp } from '../server/app.ts';
import { Store } from '../server/db.ts';
import { defaultConfig,DEMO_PASSWORD } from '../server/seed.ts';
import type { Campaign,Summary } from '../shared/schema.ts';

async function fixture(aiFail=false){
  const dir=mkdtempSync(join(tmpdir(),'amyrtle-test-'));const {app,db}=createApp({dbPath:join(dir,'test.sqlite'),key:randomBytes(32),demo:true,ai:aiFail?{provider:'compatible',allowExternal:false}:undefined});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('port');const base=`http://127.0.0.1:${address.port}`;
  function client(){const jar=new Map<string,string>();let csrf='';return {async raw(path:string,body:Buffer,headers:Record<string,string>={}){return fetch(base+path,{method:'POST',headers:{'Content-Type':'image/png','x-amyrtle-request':'1','x-csrf-token':csrf,'x-asset-copyright':'confirmed',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...headers},body:new Uint8Array(body)});},async call<T=Record<string,unknown>>(path:string,method='GET',body?:unknown){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json','x-amyrtle-request':'1','x-csrf-token':csrf,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});for(const c of r.headers.getSetCookie()){const first=c.split(';')[0];const i=first.indexOf('=');jar.set(first.slice(0,i),first.slice(i+1));}const data=await r.json() as {ok:boolean;data:T;error?:{code:string}};if(path==='/api/auth/login'&&data.ok)csrf=(data.data as {csrf:string}).csrf;return {status:r.status,...data};}};}
  async function login(role='photo'){const c=client();assert.equal((await c.call('/api/auth/login','POST',{email:role+'@demo.amyrtle.local',password:DEMO_PASSWORD})).status,200);return c;}
  const close=async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();rmSync(dir,{recursive:true,force:true});};
  return {client,login,db,dir,close};
}
const book=(slotId:string,key=randomUUID())=>({slotId,name:'测试访客',contact:'13800138000',consent:true,requestKey:key,source:'poster',website:''});
const claim=(key=randomUUID())=>({consent:true,requestKey:key,source:'wechat',website:''});

test('T01/T02: auth, tenant isolation on reads/writes/exports and staff permissions',async()=>{
  const f=await fixture();try{const anon=f.client();assert.equal((await anon.call('/api/campaigns')).status,401);assert.equal((await anon.call('/api/export/bookings')).status,401);assert.equal((await anon.call('/api/vouchers/redeem','POST',{code:'A'.repeat(32)})).status,401);
    const a=await f.login();const b=await f.login('food');const staff=await f.login('staff');const bc=(await b.call<Campaign[]>('/api/campaigns')).data[0];
    for(const path of [`/api/campaigns/${bc.id}`,`/api/bookings?campaignId=${bc.id}`,`/api/vouchers?campaignId=${bc.id}`,`/api/analytics/summary?campaignId=${bc.id}`,`/api/export/bookings?campaignId=${bc.id}`])assert.equal((await a.call(path)).status,404,path);
    assert.equal((await a.call('/api/campaigns/'+bc.id,'PATCH',{revision:bc.revision,config:bc.config})).status,404);assert.equal((await staff.call('/api/export/bookings')).status,403);assert.equal((await staff.call('/api/store','PATCH',{name:'接管店铺'})).status,403);assert.equal((await staff.call('/api/admin/tenants')).status,403);
    assert.ok(f.db.one("SELECT id FROM audit_logs WHERE action='authorization_denied'"));
  }finally{await f.close();}
});
test('T03/T04: draft and paused links hidden; review required; AI never modifies campaign',async()=>{
  const f=await fixture();try{const a=await f.login();const list=(await a.call<Campaign[]>('/api/campaigns')).data;const draft=list.find(c=>c.status==='draft')!;
    assert.equal((await f.client().call('/api/public/'+draft.slug)).status,404);assert.equal((await a.call(`/api/campaigns/${draft.id}/publish`,'POST',{reviewed:false,revision:draft.revision})).status,400);
    assert.equal((await a.call(`/api/campaigns/${draft.id}/ai-copy`,'POST',{})).status,200);assert.equal((await a.call<Campaign>('/api/campaigns/'+draft.id)).data.status,'draft');
    assert.equal((await a.call(`/api/campaigns/${draft.id}/publish`,'POST',{reviewed:true,revision:draft.revision})).status,200);assert.equal((await a.call(`/api/campaigns/${draft.id}/status`,'POST',{status:'paused'})).status,200);assert.equal((await f.client().call('/api/public/'+draft.slug)).status,404);
  }finally{await f.close();}
});
test('T05/T06/T11: final capacity concurrency, idempotency, cancellation and exact events',async()=>{
  const f=await fixture();try{const a=await f.login();const c=(await a.call<Campaign[]>('/api/campaigns')).data.find(c=>c.status==='published')!;f.db.run('UPDATE booking_slots SET capacity=1 WHERE campaign_id=?',c.id);const slot=c.slots[0].id;const x=f.client(),y=f.client();await x.call('/api/public/'+c.slug);await y.call('/api/public/'+c.slug);const payload=book(slot);
    const [one,two]=await Promise.all([x.call<{id:string}>(`/api/public/${c.slug}/book`,'POST',payload),y.call<{id:string}>(`/api/public/${c.slug}/book`,'POST',book(slot))]);assert.deepEqual([one.status,two.status].sort(),[201,409]);const winner=one.status===201?x:y;const receipt=one.status===201?one:two;
    if(one.status===201){const retry=await winner.call<{id:string}>(`/api/public/${c.slug}/book`,'POST',payload);assert.equal(retry.data.id,receipt.data.id);assert.equal((await winner.call(`/api/public/${c.slug}/book`,'POST',{...payload,name:'不同内容'})).status,409);}
    assert.equal(f.db.one<{n:number}>('SELECT count(*) n FROM bookings')!.n,1);assert.equal(f.db.one<{reserved_count:number}>('SELECT reserved_count FROM booking_slots WHERE id=?',slot)!.reserved_count,1);
    assert.equal((await a.call<Summary>('/api/analytics/summary')).data.counts.booking_submit_success,1);assert.equal((await a.call('/api/bookings/'+receipt.data.id,'PATCH',{status:'completed'})).status,409);assert.equal((await a.call('/api/bookings/'+receipt.data.id,'PATCH',{status:'confirmed'})).status,200);assert.equal((await a.call('/api/bookings/'+receipt.data.id,'PATCH',{status:'canceled'})).status,200);assert.equal(f.db.one<{reserved_count:number}>('SELECT reserved_count FROM booking_slots WHERE id=?',slot)!.reserved_count,0);
    const stored=f.db.one<{contact_enc:string}>('SELECT contact_enc FROM bookings')!;assert.ok(!stored.contact_enc.includes('13800138000'));assert.ok(!JSON.stringify(f.db.all('SELECT * FROM analytics_events')).includes('13800138000'));
  }finally{await f.close();}
});
test('T07/T08: coupon idempotency, per-browser quota, concurrent redemption and audit',async()=>{
  const f=await fixture();try{const food=await f.login('food'),photo=await f.login(),staff=await f.login('staff');const x=f.client();await x.call('/api/public/demo-autumn-coffee');const payload=claim();const first=await x.call<{id:string;code:string}>('/api/public/demo-autumn-coffee/claim','POST',payload);assert.equal(first.status,201);
    assert.equal((await x.call<{id:string;code:string}>('/api/public/demo-autumn-coffee/claim','POST',payload)).data.code,first.data.code);assert.equal((await x.call('/api/public/demo-autumn-coffee/claim','POST',claim())).status,409);
    assert.equal((await photo.call('/api/vouchers/redeem','POST',{code:first.data.code})).status,409);const rr=await Promise.all([food.call('/api/vouchers/redeem','POST',{code:first.data.code}),staff.call('/api/vouchers/redeem','POST',{code:first.data.code})]);assert.deepEqual(rr.map(x=>x.status).sort(),[200,409]);
    assert.equal(f.db.one<{n:number}>("SELECT count(*) n FROM redemption_logs WHERE result='success'")!.n,1);assert.equal((await food.call<Summary>('/api/analytics/summary')).data.counts.voucher_redeemed,1);assert.equal(f.db.one<{n:number}>('SELECT count(*) n FROM vouchers')!.n,1);assert.ok(!JSON.stringify(f.db.all('SELECT * FROM vouchers')).includes(first.data.code));
    const y=f.client();await y.call('/api/public/demo-autumn-coffee');const expired=await y.call<{id:string;code:string}>('/api/public/demo-autumn-coffee/claim','POST',claim());f.db.run("UPDATE vouchers SET valid_until='2000-01-01T00:00:00.000Z' WHERE id=?",expired.data.id);assert.equal((await food.call('/api/vouchers/redeem','POST',{code:expired.data.code})).error?.code,'EXPIRED');
  }finally{await f.close();}
});
test('total coupon limit and expired/paused campaigns reject new actions',async()=>{
  const f=await fixture();try{const owner=await f.login('food');const c=(await owner.call<Campaign[]>('/api/campaigns')).data.find(c=>c.status==='published')!;f.db.run('UPDATE voucher_rules SET quota=1 WHERE campaign_id=?',c.id);const x=f.client(),y=f.client();await x.call('/api/public/'+c.slug);await y.call('/api/public/'+c.slug);const results=await Promise.all([x.call(`/api/public/${c.slug}/claim`,'POST',claim()),y.call(`/api/public/${c.slug}/claim`,'POST',claim())]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    const cfg={...c.config,endsAt:'2000-01-01T00:00:00.000Z'};f.db.run('UPDATE campaigns SET config=? WHERE id=?',JSON.stringify(cfg),c.id);assert.equal((await y.call(`/api/public/${c.slug}/claim`,'POST',claim())).error?.code,'INACTIVE');await owner.call(`/api/campaigns/${c.id}/status`,'POST',{status:'paused'});assert.equal((await y.call(`/api/public/${c.slug}/claim`,'POST',claim())).status,404);
  }finally{await f.close();}
});
test('T09: validation, consent, extra tenant injection and body limits',async()=>{
  const f=await fixture();try{const a=await f.login();const cfg=defaultConfig('photo');for(const value of [{...cfg,price:-2},{...cfg,title:'<script>x</script>'},{...cfg,tenant_id:'foreign'},{...cfg,title:'x'.repeat(1000)}])assert.equal((await a.call('/api/campaigns','POST',value)).status,400);
    const c=(await a.call<Campaign[]>('/api/campaigns')).data.find(c=>c.status==='published')!;const x=f.client();await x.call('/api/public/'+c.slug);assert.equal((await x.call(`/api/public/${c.slug}/book`,'POST',{...book(c.slots[0].id),consent:false})).status,400);const publicData=JSON.stringify((await x.call('/api/public/'+c.slug)).data);assert.ok(!publicData.includes('tenantId'));assert.ok(!publicData.includes('contact_enc'));
  }finally{await f.close();}
});
test('T10: unavailable AI keeps manual creation and reviewed publication working',async()=>{
  const f=await fixture(true);try{const a=await f.login();const c=(await a.call<Campaign>('/api/campaigns','POST',defaultConfig('photo'))).data;assert.equal((await a.call(`/api/campaigns/${c.id}/ai-copy`,'POST',{})).status,503);assert.equal((await a.call(`/api/campaigns/${c.id}/publish`,'POST',{reviewed:true,revision:c.revision})).status,200);}finally{await f.close();}
});
test('T12: privacy credentials authorize only subject data; deletion frees capacity',async()=>{
  const f=await fixture();try{const owner=await f.login();const c=(await owner.call<Campaign[]>('/api/campaigns')).data.find(c=>c.status==='published')!;const x=f.client();await x.call('/api/public/'+c.slug);const r=(await x.call<{id:string;privacyToken:string}>(`/api/public/${c.slug}/book`,'POST',book(c.slots[0].id))).data;
    assert.equal((await x.call('/api/privacy/access','POST',{id:r.id,token:'a'.repeat(64)})).status,404);const credentials={id:r.id,token:r.privacyToken};assert.equal((await x.call('/api/privacy/access','POST',credentials)).status,200);assert.equal((await x.call('/api/privacy/delete','POST',credentials)).status,200);assert.equal(f.db.one<{contact_enc:string|null}>('SELECT contact_enc FROM bookings WHERE id=?',r.id)!.contact_enc,null);assert.equal(f.db.one<{reserved_count:number}>('SELECT reserved_count FROM booking_slots WHERE id=?',c.slots[0].id)!.reserved_count,0);assert.equal((await x.call('/api/privacy/delete','POST',credentials)).status,200);
  }finally{await f.close();}
});
test('T14: consistent SQLite backup recovers data and integrity after mutation',async()=>{
  const f=await fixture();try{const before=f.db.one<{n:number}>('SELECT count(*) n FROM campaigns')!.n;const path=join(f.dir,'backup.sqlite');await backup(f.db.db,path);f.db.run("UPDATE tenants SET name='changed'");const recovered=new Store(path);assert.equal(recovered.one<{n:number}>('SELECT count(*) n FROM campaigns')!.n,before);assert.equal(recovered.one<{integrity_check:string}>('PRAGMA integrity_check')!.integrity_check,'ok');assert.notEqual(recovered.one<{name:string}>('SELECT name FROM tenants')!.name,'changed');recovered.close();}finally{await f.close();}
});
test('share attribution and deduplication preserve unknown sources',async()=>{
  const f=await fixture();try{const x=f.client();await x.call('/api/public/demo-autumn-photo');const key=randomUUID();for(let i=0;i<2;i++)await x.call('/api/public/demo-autumn-photo/events','POST',{type:'page_view',key,source:'poster'});await x.call('/api/public/demo-autumn-photo/events','POST',{type:'page_view',key:randomUUID(),source:'unknown'});const a=await f.login();const summary=(await a.call<Summary>('/api/analytics/summary')).data;assert.equal(summary.counts.page_view,2);assert.equal(summary.counts.uv,1);assert.deepEqual(summary.sources.map(x=>x.source).sort(),['poster','unknown']);}finally{await f.close();}
});
test('session CSRF and brute-force protection reject unsafe operations',async()=>{
  const f=await fixture();try{const anon=f.client();for(let i=0;i<10;i++)assert.equal((await anon.call('/api/auth/login','POST',{email:'missing@example.com',password:'wrong'})).status,401);assert.equal((await anon.call('/api/auth/login','POST',{email:'missing@example.com',password:'wrong'})).status,429);}finally{await f.close();}
});
test('asset uploads enforce owner, file validity, rights, CSRF and tenant ownership',async()=>{
  const f=await fixture();try{const owner=await f.login();const other=await f.login('food');const staff=await f.login('staff');const png=await sharp({create:{width:30,height:20,channels:3,background:'#718658'}}).png().toBuffer();
    assert.equal((await f.client().raw('/api/assets',png)).status,401);assert.equal((await staff.raw('/api/assets',png)).status,403);
    assert.equal((await owner.raw('/api/assets',png,{'x-csrf-token':'wrong'})).status,403);assert.equal((await owner.raw('/api/assets',png,{'x-asset-copyright':'no'})).status,400);
    assert.equal((await owner.raw('/api/assets',Buffer.from('<svg onload="alert(1)"/>'))).status,400);assert.equal((await owner.raw('/api/assets',png,{Origin:'https://evil.example'})).status,403);
    const response=await owner.raw('/api/assets',png);assert.equal(response.status,201);const uploaded=await response.json() as {data:{id:string}};
    const row=f.db.one<{content:Uint8Array;mime_type:string}>('SELECT content,mime_type FROM campaign_assets WHERE id=?',uploaded.data.id)!;assert.equal(row.mime_type,'image/webp');const meta=await sharp(Buffer.from(row.content)).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);
    const config={...defaultConfig('food'),assetIds:[uploaded.data.id]};assert.equal((await other.call('/api/campaigns','POST',config)).status,404);assert.equal((await owner.call('/api/campaigns','POST',{...defaultConfig('photo'),assetIds:[uploaded.data.id]})).status,201);
  }finally{await f.close();}
});
