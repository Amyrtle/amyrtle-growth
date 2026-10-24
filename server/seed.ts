import { randomUUID } from 'node:crypto';
import { Store } from './db.ts';
import { hashPassword } from './security.ts';
import type { CampaignInput, Industry } from '../shared/schema.ts';
export const DEMO_PASSWORD = 'AmyrtleDemo2026!';
export function defaultConfig(industry:Industry, now=new Date()):CampaignInput {
  const day=(n:number)=>new Date(now.getTime()+n*86400000).toISOString();
  return {title:industry==='photo'?'秋日校园写真季':'秋日咖啡计划',description:industry==='photo'?'把校园里的日常，留成值得珍藏的秋日记忆。一个人的写真，也是给自己的礼物。':'把匆忙留在门外，让这一杯咖啡，成为秋日里刚刚好的停顿。',terms:'演示活动，仅用于功能体验。所有商家、价格与服务均为模拟，不提供实际服务。',offer:industry==='photo'?'单人拍摄 · 精修 6 张 · 电子相册':'指定饮品第二杯半价',price:industry==='photo'?299:0,startsAt:day(-1),endsAt:day(30),cta:industry==='photo'?'预约我的秋日写真':'领取秋日咖啡券',highlights:industry==='photo'?['单人拍摄','精修 6 张','电子相册交付']:['指定饮品适用','到店出示券码','第二杯半价'],slots:industry==='photo'?[{startsAt:day(7),endsAt:new Date(now.getTime()+7*86400000+3600000).toISOString(),capacity:2}]:[],quota:100,dailyLimit:20,perVisitorLimit:1,validUntil:day(31),minimumSpend:0,image:industry==='photo'?'photo':'coffee',assetConfirmed:true,assetIds:[]};
}
export function insertCampaign(db:Store,tenantId:string,config:CampaignInput,slug:string,status='draft') {
  const id=randomUUID(); const slots=config.slots.map(s=>({...s,id:randomUUID()}));const saved={...config,slots};
  db.run('INSERT INTO campaigns(id,tenant_id,slug,status,config,created_at) VALUES(?,?,?,?,?,?)',id,tenantId,slug,status,JSON.stringify(saved),new Date().toISOString());
  for (const s of slots) db.run('INSERT INTO booking_slots(id,campaign_id,starts_at,ends_at,capacity) VALUES(?,?,?,?,?)',s.id,id,s.startsAt,s.endsAt,s.capacity);
  db.run('INSERT INTO voucher_rules(campaign_id,tenant_id,quota,daily_limit,per_visitor_limit,valid_until) VALUES(?,?,?,?,?,?)',id,tenantId,config.quota,config.dailyLimit,config.perVisitorLimit,config.validUntil);
  return id;
}
export function seed(db:Store) {
  if(db.one('SELECT id FROM users LIMIT 1'))return;
  db.tx(()=>{
    for(const industry of ['photo','food'] as const){
      const tenantId=randomUUID(); const id=randomUUID();
      db.run('INSERT INTO tenants(id,name,industry,description,address,contact,demo,created_at) VALUES(?,?,?,?,?,?,1,?)',tenantId,industry==='photo'?'轻屿摄影工作室':'日晞咖啡',industry,'演示商家 · 为每一次相遇，留一点美好','模拟地址 · 校园生活街 18 号','演示联系渠道 · 请勿实际联系',new Date().toISOString());
      db.run('INSERT INTO users VALUES(?,?,?,0)',id,industry+'@demo.amyrtle.local',hashPassword(DEMO_PASSWORD));
      db.run('INSERT INTO memberships VALUES(?,?,?)',id,tenantId,'owner');
      if(industry==='food'){const staff=randomUUID();db.run('INSERT INTO users VALUES(?,?,?,0)',staff,'staff@demo.amyrtle.local',hashPassword(DEMO_PASSWORD));db.run('INSERT INTO memberships VALUES(?,?,?)',staff,tenantId,'staff');}
      insertCampaign(db,tenantId,defaultConfig(industry),'demo-autumn-'+(industry==='photo'?'photo':'coffee'),'published');
      const draft=defaultConfig(industry);draft.title=industry==='photo'?'把毕业前的日常留住':'周末，来一场咖啡小聚';insertCampaign(db,tenantId,draft,'draft-'+industry);
    }
    db.run('INSERT INTO users VALUES(?,?,?,1)',randomUUID(),'admin@demo.amyrtle.local',hashPassword(DEMO_PASSWORD));
  });
}
