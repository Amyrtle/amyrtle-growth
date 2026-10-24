import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { Store } from './db.ts';
import { cryptoBox, digest, hashPassword, token, verifyPassword } from './security.ts';
import { seed, insertCampaign, defaultConfig } from './seed.ts';
import { generateCampaignCopy, type AIOptions } from './ai.ts';
import { checkAssets, registerAssets } from './assets.ts';
import { campaignSchema, shopSchema, bookingSchema, claimSchema, text, type CampaignInput, type Campaign, type Session, type Shop, type Slot } from '../shared/schema.ts';

interface CampaignRow {id:string;tenant_id:string;slug:string;status:Campaign['status'];config:string;revision:number;created_at:string;industry:'photo'|'food';demo:number}
interface Identity {id:string;email:string;tenant_id:string|null;role:'owner'|'staff'|'admin';csrf:string}
interface BookingRow {id:string;tenant_id:string;campaign_id:string;slot_id:string;contact_enc:string|null;status:string;visitor_hash:string;request_key:string;request_digest:string;privacy_hash:string;created_at:string}
interface VoucherRow {id:string;tenant_id:string;campaign_id:string;code_hash:string;status:string;visitor_hash:string;issued_at:string;redeemed_at:string|null;valid_until:string;privacy_hash:string}
export class AppError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
const fail=(status:number,code:string,message:string):never=>{throw new AppError(status,code,message);};
const cookies=(req:Request):Record<string,string>=>Object.fromEntries((req.headers.cookie||'').split(';').filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i).trim(),s.slice(i+1)];}));
const ok=(res:Response,data:unknown,status=200)=>res.status(status).json({ok:true,data,requestId:res.locals.requestId});
const param=(req:Request,name:string)=>String(req.params[name]);
const now=()=>new Date().toISOString();
export interface AppOptions {dbPath:string;key:Buffer;demo?:boolean;origin?:string;secure?:boolean;development?:boolean;ai?:AIOptions;aiDailyLimit?:number;aiMonthlyLimit?:number}

export function createApp(options:AppOptions) {
  const db=new Store(options.dbPath);const box=cryptoBox(options.key);if(options.demo)seed(db);
  const app=express();app.disable('x-powered-by');
  app.use((_req,res,next)=>{res.locals.requestId=randomUUID();next();});
  app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:options.development?["'self'","'unsafe-inline'"]:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],connectSrc:["'self'",'ws://127.0.0.1:*','ws://localhost:*'],objectSrc:["'none'"],upgradeInsecureRequests:null}},strictTransportSecurity:options.secure?undefined:false}));
  app.use('/api/assets',express.raw({type:['image/jpeg','image/png','image/webp'],limit:'4mb'}));
  app.use(express.json({limit:'48kb'}));
  app.use('/api',(req,res,next)=>{res.locals.requestId=randomUUID();res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      if(req.headers['x-amyrtle-request']!=='1')return next(new AppError(403,'CSRF','请求来源校验失败'));
      const origin=req.headers.origin;if(origin&&origin!==options.origin)return next(new AppError(403,'ORIGIN','不允许的请求来源'));
    } next();
  });
  const audit=(actor:string,tenant:string|null,action:string,target:string)=>db.run('INSERT INTO audit_logs VALUES(?,?,?,?,?,?)',randomUUID(),tenant,actor,action,target,now());
  const rate=(req:Request,scope:string,limit:number,ms=60000)=>{
    const k=box.derive('rate',scope+':'+req.ip);const time=Date.now();
    const count=db.tx(()=>{db.run('DELETE FROM rate_limits WHERE resets_at<?',time);db.run('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',k,time+ms);return db.one<{count:number}>('SELECT count FROM rate_limits WHERE key=?',k)!.count;});
    if(count>limit)fail(429,'RATE_LIMIT','操作过于频繁，请稍后再试');
  };
  const identify=(req:Request,res:Response,next:NextFunction)=>{
    const s=cookies(req).amyrtle_session;
    const user=s?db.one<Identity>(`SELECT u.id,u.email,m.tenant_id,CASE WHEN u.platform_admin=1 THEN 'admin' ELSE m.role END role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN memberships m ON m.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`,digest(s),now()):undefined;
    if(!user)return next(new AppError(401,'UNAUTHENTICATED','请先登录商家账号'));
    if(!['GET','HEAD'].includes(req.method)&&req.headers['x-csrf-token']!==user.csrf)return next(new AppError(403,'CSRF','会话校验失效，请重新登录'));
    res.locals.user=user;next();
  };
  const user=(res:Response)=>res.locals.user as Identity;
  const tenant=(res:Response)=>user(res).tenant_id||fail(403,'NO_SHOP','此账号没有绑定商家');
  const owner=(req:Request,res:Response,next:NextFunction)=>{if(user(res).role!=='owner'){audit(user(res).id,user(res).tenant_id,'authorization_denied',req.path);return next(new AppError(403,'OWNER_REQUIRED','此操作仅限店主'));}next();};
  const admin=(_req:Request,res:Response,next:NextFunction)=>user(res).role==='admin'?next():next(new AppError(403,'ADMIN_REQUIRED','此操作仅限平台管理员'));
  const shop=(id:string)=>db.one<Shop>('SELECT id,name,industry,description,address,contact,brand_color brandColor,demo,logo_asset_id logoAssetId FROM tenants WHERE id=?',id)!;
  const campaign=(id:string,tenantId?:string)=>{
    const c=db.one<CampaignRow>('SELECT c.*,t.industry,t.demo FROM campaigns c JOIN tenants t ON c.tenant_id=t.id WHERE c.id=?'+(tenantId?' AND c.tenant_id=?':''),...tenantId?[id,tenantId]:[id]);
    return c||fail(404,'NOT_FOUND','活动不存在或无权访问');
  };
  const slots=(id:string)=>db.all<Slot>('SELECT id,starts_at startsAt,ends_at endsAt,capacity,reserved_count reserved FROM booking_slots WHERE campaign_id=? ORDER BY starts_at',id);
  const pack=(c:CampaignRow):Campaign=>({id:c.id,tenantId:c.tenant_id,slug:c.slug,status:c.status,revision:c.revision,config:JSON.parse(c.config),industry:c.industry,demo:c.demo,createdAt:c.created_at,slots:slots(c.id)});
  const publicCampaign=(slug:string,active=false)=>{
    const row=db.one<CampaignRow>("SELECT c.*,t.industry,t.demo FROM campaigns c JOIN tenants t ON t.id=c.tenant_id WHERE c.slug=? AND c.status='published'",slug);
    if(!row)fail(404,'NOT_FOUND','活动未发布、已暂停或不存在');
    const c=row!;const cfg=JSON.parse(c.config) as CampaignInput;
    if(active&&(now()<cfg.startsAt||now()>cfg.endsAt))fail(409,'INACTIVE','活动尚未开始或已经结束');
    return c;
  };
  const visitor=(req:Request,res:Response)=>{
    let id=cookies(req).amyrtle_visitor;if(!id||!/^[a-f0-9]{64}$/.test(id)){id=token();res.cookie('amyrtle_visitor',id,{httpOnly:true,sameSite:'strict',secure:options.secure,maxAge:90*86400000,path:'/'});}return box.derive('visitor',id);
  };
  const event=(c:CampaignRow,type:string,source:string,anon:string,key:string)=>db.run('INSERT OR IGNORE INTO analytics_events VALUES(?,?,?,?,?,?,?,?)',randomUUID(),c.tenant_id,c.id,type,source,anon,key,now());
  const consent=(tenantId:string,id:string,purpose:string)=>db.run('INSERT INTO consent_records VALUES(?,?,?,?,?,?)',randomUUID(),tenantId,id,'2026-10-v1',purpose,now());
  const privacyToken=(id:string)=>box.derive('privacy',id);
  const voucherCode=(id:string)=>box.derive('voucher',id).slice(0,32).toUpperCase();
  const bookingReceipt=(b:BookingRow)=>({id:b.id,status:b.status,privacyToken:privacyToken(b.id)});
  const voucherReceipt=(v:VoucherRow)=>({id:v.id,code:voucherCode(v.id),status:v.status,validUntil:v.valid_until,privacyToken:privacyToken(v.id)});

  app.get('/api/health',(_req,res)=>ok(res,{service:'Amyrtle Growth',mode:options.demo?'demo':'local',database:'sqlite'}));
  app.post('/api/auth/login',(req,res)=>{
    rate(req,'login',10,15*60000);const v=z.object({email:z.string().email().max(120),password:z.string().min(1).max(200)}).strict().parse(req.body);
    const u=db.one<{id:string;password_hash:string}>('SELECT id,password_hash FROM users WHERE email=?',v.email.toLowerCase());
    // Same scrypt cost for unknown accounts reduces account enumeration through timing.
    const fallback='0'.repeat(64)+':'+'0'.repeat(128);const valid=verifyPassword(v.password,u?.password_hash??fallback);
    if(!u||!valid)fail(401,'INVALID_CREDENTIALS','账号或密码不正确');
    const raw=token();const csrf=token();db.run('DELETE FROM sessions WHERE expires_at<?',now());db.run('INSERT INTO sessions VALUES(?,?,?,?)',digest(raw),u!.id,csrf,new Date(Date.now()+8*3600000).toISOString());
    res.cookie('amyrtle_session',raw,{httpOnly:true,sameSite:'strict',secure:options.secure,maxAge:8*3600000,path:'/'});ok(res,{csrf});
  });
  app.get('/api/auth/session',identify,(_req,res)=>{const u=user(res);ok(res,{user:{id:u.id,email:u.email,role:u.role},shop:u.tenant_id?shop(u.tenant_id):null,csrf:u.csrf,demoMode:!!options.demo} satisfies Session);});
  app.post('/api/auth/logout',identify,(req,res)=>{db.run('DELETE FROM sessions WHERE token_hash=?',digest(cookies(req).amyrtle_session||''));res.clearCookie('amyrtle_session',{path:'/'});ok(res,{});});

  app.get('/api/public/:slug',(req,res)=>{
    rate(req,'public-read',180);const c=publicCampaign(param(req,'slug'));visitor(req,res);const config=JSON.parse(c.config) as CampaignInput;const s=shop(c.tenant_id);
    const r=db.one<{quota:number;issued_count:number}>('SELECT quota,issued_count FROM voucher_rules WHERE campaign_id=?',c.id)!;
    ok(res,{slug:c.slug,industry:c.industry,demo:!!c.demo,title:config.title,description:config.description,terms:config.terms,offer:config.offer,price:config.price,startsAt:config.startsAt,endsAt:config.endsAt,cta:config.cta,highlights:config.highlights,image:config.image,assetUrls:(config.assetIds??[]).map(id=>'/api/assets/'+id),minimumSpend:config.minimumSpend,validUntil:config.validUntil,perVisitorLimit:config.perVisitorLimit,dailyLimit:config.dailyLimit,remaining:r.quota-r.issued_count,slots:slots(c.id),shop:{name:s.name,address:s.address,contact:s.contact,description:s.description,brandColor:s.brandColor,logoUrl:s.logoAssetId?'/api/assets/'+s.logoAssetId:null},active:now()>=config.startsAt&&now()<=config.endsAt});
  });
  app.post('/api/public/:slug/events',(req,res)=>{
    rate(req,'events',120);const c=publicCampaign(param(req,'slug'));const v=z.object({type:z.enum(['page_view','cta_click']),key:z.string().uuid(),source:bookingSchema.shape.source}).strict().parse(req.body);const anon=visitor(req,res);
    event(c,v.type,v.source,anon,c.id+':'+anon+':'+v.type+':'+v.key);ok(res,{});
  });
  app.post('/api/public/:slug/book',(req,res)=>{
    rate(req,'book',20);const v=bookingSchema.parse(req.body);const anon=visitor(req,res);const fingerprint=box.derive('booking-request',JSON.stringify(v));
    const result=db.tx(()=>{
      const c=publicCampaign(param(req,'slug'),true);if(c.industry!=='photo')fail(400,'WRONG_INDUSTRY','此活动不支持预约');
      const prior=db.one<BookingRow>('SELECT * FROM bookings WHERE campaign_id=? AND visitor_hash=? AND request_key=?',c.id,anon,v.requestKey);
      if(prior){if(prior.request_digest!==fingerprint)fail(409,'IDEMPOTENCY_CONFLICT','提交内容已改变，请重新发起预约');return bookingReceipt(prior);}
      const changed=db.run('UPDATE booking_slots SET reserved_count=reserved_count+1 WHERE id=? AND campaign_id=? AND reserved_count<capacity AND starts_at>?',v.slotId,c.id,now());
      if(!changed.changes)fail(409,'SLOT_FULL','该档期已约满或不可预约，请选择其他时间');
      const id=randomUUID();db.run('INSERT INTO bookings VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,c.tenant_id,c.id,v.slotId,box.encrypt({name:v.name,contact:v.contact}),'requested',anon,v.requestKey,fingerprint,digest(privacyToken(id)),now(),now());
      consent(c.tenant_id,id,'booking');event(c,'booking_submit_success',v.source,anon,'booking:'+id);return bookingReceipt(db.one<BookingRow>('SELECT * FROM bookings WHERE id=?',id)!);
    });ok(res,result,201);
  });
  app.post('/api/public/:slug/claim',(req,res)=>{
    rate(req,'claim',15);const v=claimSchema.parse(req.body);const anon=visitor(req,res);
    const result=db.tx(()=>{
      const c=publicCampaign(param(req,'slug'),true);if(c.industry!=='food')fail(400,'WRONG_INDUSTRY','此活动不支持领券');
      const previous=db.one<VoucherRow>('SELECT * FROM vouchers WHERE campaign_id=? AND visitor_hash=? AND request_key=?',c.id,anon,v.requestKey);if(previous)return voucherReceipt(previous);
      const rule=db.one<{quota:number;issued_count:number;daily_limit:number;per_visitor_limit:number;valid_until:string}>('SELECT * FROM voucher_rules WHERE campaign_id=?',c.id)!;
      const n=db.one<{n:number}>('SELECT count(*) n FROM vouchers WHERE campaign_id=? AND visitor_hash=?',c.id,anon)!.n;
      if(n>=rule.per_visitor_limit)fail(409,'VISITOR_LIMIT','当前浏览器已达到此活动的领取上限');
      const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
      const daily=db.one<{n:number}>("SELECT count(*) n FROM vouchers WHERE campaign_id=? AND date(issued_at,'+8 hours')=?",c.id,today)!.n;
      if(daily>=rule.daily_limit)fail(409,'DAILY_LIMIT','今日名额已领完，请明日再来');
      const changed=db.run('UPDATE voucher_rules SET issued_count=issued_count+1 WHERE campaign_id=? AND issued_count<quota AND valid_until>?',c.id,now());
      if(!changed.changes)fail(409,'SOLD_OUT','优惠券已领完或过期');
      const id=randomUUID();db.run('INSERT INTO vouchers VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,c.tenant_id,c.id,digest(voucherCode(id)),anon,v.requestKey,digest(privacyToken(id)),'issued',now(),null,rule.valid_until);
      consent(c.tenant_id,id,'voucher');event(c,'voucher_claimed',v.source,anon,'claim:'+id);return voucherReceipt(db.one<VoucherRow>('SELECT * FROM vouchers WHERE id=?',id)!);
    });ok(res,result,201);
  });
  const privacySchema=z.object({id:z.string().uuid(),token:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
  app.post('/api/privacy/access',(req,res)=>{
    rate(req,'privacy',10);const v=privacySchema.parse(req.body);const b=db.one<BookingRow>('SELECT * FROM bookings WHERE id=? AND privacy_hash=?',v.id,digest(v.token));const coupon=db.one<VoucherRow>('SELECT * FROM vouchers WHERE id=? AND privacy_hash=?',v.id,digest(v.token));
    if(!b&&!coupon)fail(404,'NOT_FOUND','编号或隐私凭证无效');
    ok(res,b?{id:b.id,type:'booking',status:b.status,contact:b.contact_enc?box.decrypt(b.contact_enc):null,createdAt:b.created_at}:{id:coupon!.id,type:'voucher',status:coupon!.status,issuedAt:coupon!.issued_at});
  });
  app.post('/api/privacy/delete',(req,res)=>{
    rate(req,'privacy',10);const v=privacySchema.parse(req.body);
    db.tx(()=>{const b=db.one<BookingRow>('SELECT * FROM bookings WHERE id=? AND privacy_hash=?',v.id,digest(v.token));const coupon=db.one<VoucherRow>('SELECT * FROM vouchers WHERE id=? AND privacy_hash=?',v.id,digest(v.token));
      if(!b&&!coupon)fail(404,'NOT_FOUND','编号或隐私凭证无效');
      if(b){if(['requested','confirmed'].includes(b.status))db.run('UPDATE booking_slots SET reserved_count=reserved_count-1 WHERE id=? AND reserved_count>0',b.slot_id);db.run("UPDATE bookings SET contact_enc=NULL,status=CASE WHEN status IN ('requested','confirmed') THEN 'canceled' ELSE status END,updated_at=? WHERE id=?",now(),b.id);}
      if(coupon)db.run("UPDATE vouchers SET status=CASE WHEN status='issued' THEN 'revoked' ELSE status END WHERE id=?",coupon.id);
      db.run('DELETE FROM consent_records WHERE subject_ref=?',v.id);audit('privacy-holder',b?.tenant_id??coupon!.tenant_id,'privacy_deleted',v.id);
    });ok(res,{message:'联系方式已删除；未完成预约已取消，未用券已撤销。必要的匿名业务计数保留。'});
  });

  registerAssets(app,{db,identify,owner,tenant,rate,audit:(res,id)=>audit(user(res).id,tenant(res),'asset_uploaded',id)});
  app.use('/api',identify);
  app.get('/api/store',(_req,res)=>ok(res,shop(tenant(res))));
  app.patch('/api/store',owner,(req,res)=>{const v=shopSchema.parse(req.body);checkAssets(db,tenant(res),v.logoAssetId?[v.logoAssetId]:[]);db.run('UPDATE tenants SET name=?,description=?,address=?,contact=?,brand_color=?,logo_asset_id=? WHERE id=?',v.name,v.description,v.address,v.contact,v.brandColor,v.logoAssetId,tenant(res));audit(user(res).id,tenant(res),'store_updated',tenant(res));ok(res,shop(tenant(res)));});
  app.get('/api/campaigns',(_req,res)=>ok(res,db.all<CampaignRow>('SELECT c.*,t.industry,t.demo FROM campaigns c JOIN tenants t ON t.id=c.tenant_id WHERE c.tenant_id=? ORDER BY c.created_at DESC',tenant(res)).map(pack)));
  app.get('/api/campaigns/:id',(req,res)=>ok(res,pack(campaign(param(req,'id'),tenant(res)))));
  app.post('/api/campaigns',owner,(req,res)=>{
    const config=campaignSchema.parse(req.body);checkAssets(db,tenant(res),config.assetIds);if(shop(tenant(res)).industry==='photo'&&!config.slots.length)fail(400,'SLOTS_REQUIRED','请至少配置一个档期');
    const id=db.tx(()=>insertCampaign(db,tenant(res),config,randomUUID()));audit(user(res).id,tenant(res),'campaign_created',id);ok(res,pack(campaign(id,tenant(res))),201);
  });
  app.get('/api/template',(_req,res)=>ok(res,defaultConfig(shop(tenant(res)).industry)));
  app.patch('/api/campaigns/:id',owner,(req,res)=>{
    const payload=z.object({revision:z.number().int(),config:campaignSchema}).strict().parse(req.body);const c=campaign(param(req,'id'),tenant(res));
    if(c.status==='published'||c.status==='ended')fail(409,'PAUSE_FIRST','请先暂停活动再修改；已结束活动不能编辑');
    if(c.revision!==payload.revision)fail(409,'VERSION_CONFLICT','活动已被修改，请刷新后重试');
    const config=payload.config;checkAssets(db,tenant(res),config.assetIds);if(c.industry==='photo'&&!config.slots.length)fail(400,'SLOTS_REQUIRED','至少保留一个档期');
    db.tx(()=>{
      const old=JSON.parse(c.config) as CampaignInput;const used=db.one<{n:number}>('SELECT (SELECT count(*) FROM bookings WHERE campaign_id=?)+(SELECT count(*) FROM vouchers WHERE campaign_id=?) n',c.id,c.id)!.n;
      if(used&&JSON.stringify([old.price,old.offer,old.terms,old.endsAt,old.validUntil,old.minimumSpend,old.perVisitorLimit])!==JSON.stringify([config.price,config.offer,config.terms,config.endsAt,config.validUntil,config.minimumSpend,config.perVisitorLimit]))fail(409,'TERMS_LOCKED','已有预约或券，价格、优惠与有效期已锁定。请新建活动调整条款。');
      const savedSlots=config.slots.map(s=>({...s,id:s.id??randomUUID()}));
      for(const s of slots(c.id))if(!savedSlots.some(x=>x.id===s.id)){if(db.one('SELECT id FROM bookings WHERE slot_id=?',s.id))fail(409,'SLOT_HAS_HISTORY','已有预约记录的档期不能删除');db.run('DELETE FROM booking_slots WHERE id=?',s.id);}
      for(const s of savedSlots){const existing=db.one<{campaign_id:string;reserved_count:number;starts_at:string;ends_at:string}>('SELECT * FROM booking_slots WHERE id=?',s.id);
        if(existing){if(existing.campaign_id!==c.id)fail(404,'NOT_FOUND','档期不存在');if(s.capacity<existing.reserved_count)fail(409,'CAPACITY','容量不能低于已预约数量');if(db.one('SELECT id FROM bookings WHERE slot_id=?',s.id)&&(existing.starts_at!==s.startsAt||existing.ends_at!==s.endsAt))fail(409,'SLOT_HAS_HISTORY','有预约历史的档期不能改时间');db.run('UPDATE booking_slots SET starts_at=?,ends_at=?,capacity=? WHERE id=?',s.startsAt,s.endsAt,s.capacity,s.id);}
        else db.run('INSERT INTO booking_slots(id,campaign_id,starts_at,ends_at,capacity) VALUES(?,?,?,?,?)',s.id,c.id,s.startsAt,s.endsAt,s.capacity);
      }
      const rule=db.one<{issued_count:number}>('SELECT issued_count FROM voucher_rules WHERE campaign_id=?',c.id)!;if(config.quota<rule.issued_count)fail(409,'QUOTA','总量不能低于已发券数量');
      db.run('UPDATE voucher_rules SET quota=?,daily_limit=?,per_visitor_limit=?,valid_until=? WHERE campaign_id=?',config.quota,config.dailyLimit,config.perVisitorLimit,config.validUntil,c.id);
      db.run('UPDATE campaigns SET config=?,revision=revision+1,reviewed_revision=NULL WHERE id=? AND tenant_id=?',JSON.stringify({...config,slots:savedSlots}),c.id,tenant(res));audit(user(res).id,tenant(res),'campaign_updated',c.id);
    });ok(res,pack(campaign(c.id,tenant(res))));
  });
  app.post('/api/campaigns/:id/publish',owner,(req,res)=>{
    const v=z.object({reviewed:z.literal(true),revision:z.number().int()}).strict().parse(req.body);const c=campaign(param(req,'id'),tenant(res));const cfg=campaignSchema.parse(JSON.parse(c.config));
    if(c.revision!==v.revision)fail(409,'VERSION_CONFLICT','内容已变更，请重新审核');if(c.status==='ended'||cfg.endsAt<=now())fail(409,'EXPIRED','已结束的活动不能发布');if(!cfg.assetConfirmed)fail(400,'ASSET_RIGHTS','请确认素材使用权限');
    db.tx(()=>{db.run("UPDATE campaigns SET status='published',reviewed_revision=? WHERE id=? AND tenant_id=?",v.revision,c.id,tenant(res));db.run('INSERT INTO campaign_versions VALUES(?,?,?,?,?,?)',randomUUID(),c.id,tenant(res),c.revision,c.config,now());audit(user(res).id,tenant(res),'campaign_published',c.id);});ok(res,pack(campaign(c.id,tenant(res))));
  });
  app.post('/api/campaigns/:id/status',owner,(req,res)=>{const v=z.object({status:z.enum(['paused','ended'])}).strict().parse(req.body);const c=campaign(param(req,'id'),tenant(res));if(c.status==='ended'||(v.status==='paused'&&c.status!=='published'))fail(409,'INVALID_TRANSITION','当前状态不能执行此操作');db.run('UPDATE campaigns SET status=? WHERE id=? AND tenant_id=?',v.status,c.id,tenant(res));audit(user(res).id,tenant(res),'campaign_'+v.status,c.id);ok(res,pack(campaign(c.id,tenant(res))));});
  app.post('/api/campaigns/:id/duplicate',owner,(req,res)=>{const c=campaign(param(req,'id'),tenant(res));const cfg=JSON.parse(c.config) as CampaignInput;cfg.title=cfg.title.slice(0,54)+' · 副本';const id=db.tx(()=>insertCampaign(db,tenant(res),cfg,randomUUID()));audit(user(res).id,tenant(res),'campaign_duplicated',id);ok(res,pack(campaign(id,tenant(res))),201);});
  app.post('/api/campaigns/:id/ai-copy',owner,async(req,res)=>{
    rate(req,'ai',10);const c=campaign(param(req,'id'),tenant(res));const today=now().slice(0,10);const month=now().slice(0,7);const count=db.one<{daily:number;monthly:number}>('SELECT count(CASE WHEN created_at LIKE ? THEN 1 END) daily,count(*) monthly FROM ai_generations WHERE tenant_id=? AND created_at LIKE ?',today+'%',tenant(res),month+'%')!;
    if(count.daily>=(options.aiDailyLimit??10)||count.monthly>=(options.aiMonthlyLimit??30))fail(429,'AI_QUOTA','文案额度已用完，仍可手动编辑并发布');
    const id=randomUUID();const aiOptions=options.ai??{provider:'mock',allowExternal:false};
    db.run('INSERT INTO ai_generations(id,tenant_id,campaign_id,input_digest,provider,status,created_at) VALUES(?,?,?,?,?,?,?)',id,tenant(res),c.id,digest(c.config),aiOptions.provider,'pending',now());
    try{const s=shop(tenant(res));const result=await generateCampaignCopy(JSON.parse(c.config),{name:s.name,description:s.description},aiOptions);db.run("UPDATE ai_generations SET status='needs_review',output=?,tokens=? WHERE id=?",JSON.stringify(result.copy),result.tokens,id);ok(res,{...result,id,requiresReview:true});}
    catch{db.run("UPDATE ai_generations SET status='failed',error_code='AI_UNAVAILABLE' WHERE id=?",id);fail(503,'AI_UNAVAILABLE','文案服务暂不可用，已保留原内容。请继续手动编辑。');}
  });
  app.get('/api/bookings',(req,res)=>{
    const campaignId=req.query.campaignId?String(req.query.campaignId):undefined;if(campaignId)campaign(campaignId,tenant(res));
    const rows=db.all<BookingRow&{title:string;startsAt:string}>(`SELECT b.*,json_extract(c.config,'$.title') title,s.starts_at startsAt FROM bookings b JOIN campaigns c ON c.id=b.campaign_id JOIN booking_slots s ON s.id=b.slot_id WHERE b.tenant_id=? ${campaignId?'AND b.campaign_id=?':''} ORDER BY b.created_at DESC LIMIT 1000`,...campaignId?[tenant(res),campaignId]:[tenant(res)]);
    ok(res,rows.map(b=>({id:b.id,campaignId:b.campaign_id,title:b.title,startsAt:b.startsAt,status:b.status,createdAt:b.created_at,...b.contact_enc?box.decrypt<{name:string;contact:string}>(b.contact_enc):{name:'已删除资料',contact:'已删除'}})));
  });
  app.patch('/api/bookings/:id',(req,res)=>{
    const v=z.object({status:z.enum(['confirmed','completed','canceled'])}).strict().parse(req.body);
    db.tx(()=>{const b=db.one<BookingRow>('SELECT * FROM bookings WHERE id=? AND tenant_id=?',param(req,'id'),tenant(res));if(!b)fail(404,'NOT_FOUND','预约不存在');const allowed:Record<string,string[]>={requested:['confirmed','canceled'],confirmed:['completed','canceled']};if(!allowed[b!.status]?.includes(v.status))fail(409,'INVALID_TRANSITION','不允许此预约状态转换');
      db.run('UPDATE bookings SET status=?,updated_at=? WHERE id=? AND tenant_id=?',v.status,now(),b!.id,tenant(res));if(v.status==='canceled')db.run('UPDATE booking_slots SET reserved_count=reserved_count-1 WHERE id=? AND reserved_count>0',b!.slot_id);
      if(v.status==='confirmed')event(campaign(b!.campaign_id,tenant(res)),'booking_confirmed','unknown',b!.visitor_hash,'confirmed:'+b!.id);audit(user(res).id,tenant(res),'booking_'+v.status,b!.id);
    });ok(res,{});
  });
  app.get('/api/vouchers',(req,res)=>{const id=req.query.campaignId?String(req.query.campaignId):undefined;if(id)campaign(id,tenant(res));ok(res,db.all(`SELECT v.id,json_extract(c.config,'$.title') title,CASE WHEN v.status='issued' AND v.valid_until<? THEN 'expired' ELSE v.status END status,v.issued_at issuedAt,v.redeemed_at redeemedAt,v.valid_until validUntil FROM vouchers v JOIN campaigns c ON c.id=v.campaign_id WHERE v.tenant_id=? ${id?'AND v.campaign_id=?':''} ORDER BY v.issued_at DESC LIMIT 1000`,...id?[now(),tenant(res),id]:[now(),tenant(res)]));});
  app.post('/api/vouchers/redeem',(req,res)=>{
    rate(req,'redeem',20);const v=z.object({code:z.string().trim().regex(/^[a-fA-F0-9]{32}$/)}).strict().parse(req.body);
    const result=db.tx(()=>{const voucher=db.one<VoucherRow>('SELECT * FROM vouchers WHERE code_hash=? AND tenant_id=?',digest(v.code.toUpperCase()),tenant(res));
      const failure=!voucher?'INVALID_VOUCHER':voucher.status!=='issued'?voucher.status==='redeemed'?'ALREADY_REDEEMED':'REVOKED':voucher.valid_until<now()?'EXPIRED':null;
      if(failure){db.run('INSERT INTO redemption_logs VALUES(?,?,?,?,?,?)',randomUUID(),tenant(res),voucher?.id??null,user(res).id,failure,now());audit(user(res).id,tenant(res),'redeem_rejected',voucher?.id??'unknown');return {failure};}
      const change=db.run("UPDATE vouchers SET status='redeemed',redeemed_at=? WHERE id=? AND tenant_id=? AND status='issued' AND valid_until>?",now(),voucher!.id,tenant(res),now());
      if(!change.changes)fail(409,'ALREADY_REDEEMED','该券已核销');
      db.run('INSERT INTO redemption_logs VALUES(?,?,?,?,?,?)',randomUUID(),tenant(res),voucher!.id,user(res).id,'success',now());audit(user(res).id,tenant(res),'voucher_redeemed',voucher!.id);event(campaign(voucher!.campaign_id,tenant(res)),'voucher_redeemed','unknown',voucher!.visitor_hash,'redeem:'+voucher!.id);return {id:voucher!.id};
    });if(result.failure){const messages:Record<string,string>={INVALID_VOUCHER:'券码无效或不属于本店',ALREADY_REDEEMED:'该券已核销，请勿重复操作',REVOKED:'该券已撤销',EXPIRED:'该券已过期'};fail(409,result.failure,messages[result.failure]);}ok(res,result);
  });
  app.post('/api/vouchers/:id/revoke',owner,(req,res)=>{const change=db.run("UPDATE vouchers SET status='revoked' WHERE id=? AND tenant_id=? AND status='issued'",param(req,'id'),tenant(res));if(!change.changes)fail(409,'NOT_REVOCABLE','券不存在或已无法撤销');audit(user(res).id,tenant(res),'voucher_revoked',param(req,'id'));ok(res,{});});
  app.get('/api/analytics/summary',(req,res)=>{
    const id=req.query.campaignId?String(req.query.campaignId):undefined;if(id)campaign(id,tenant(res));const filter='tenant_id=?'+(id?' AND campaign_id=?':'');const args=id?[tenant(res),id]:[tenant(res)];
    const counts=Object.fromEntries(db.all<{event_type:string;n:number}>('SELECT event_type,count(*) n FROM analytics_events WHERE '+filter+' GROUP BY event_type',...args).map(r=>[r.event_type,r.n]));
    counts.uv=db.one<{n:number}>("SELECT count(DISTINCT anon_id) n FROM analytics_events WHERE "+filter+" AND event_type='page_view'",...args)!.n;
    const sources=db.all<{source:string;visits:number;actions:number}>(`SELECT source,sum(event_type='page_view') visits,sum(event_type IN ('booking_submit_success','voucher_claimed')) actions FROM analytics_events WHERE ${filter} GROUP BY source`,...args);
    const trend=db.all<{date:string;visits:number;actions:number}>(`SELECT date(created_at,'+8 hours') date,sum(event_type='page_view') visits,sum(event_type IN ('booking_submit_success','voucher_claimed')) actions FROM analytics_events WHERE ${filter} AND created_at>=? GROUP BY date ORDER BY date`,...args,new Date(Date.now()-7*86400000).toISOString());
    ok(res,{counts,sources,trend,campaigns:db.one<{n:number}>('SELECT count(*) n FROM campaigns WHERE tenant_id=?',tenant(res))!.n,active:db.one<{n:number}>("SELECT count(*) n FROM campaigns WHERE tenant_id=? AND status='published' AND json_extract(config,'$.endsAt')>?",tenant(res),now())!.n,pending:db.one<{n:number}>("SELECT count(*) n FROM bookings WHERE tenant_id=? AND status='requested'",tenant(res))!.n,asOf:now(),demo:!!shop(tenant(res)).demo});
  });
  app.get('/api/export/bookings',owner,(req,res)=>{const id=req.query.campaignId?String(req.query.campaignId):undefined;if(id)campaign(id,tenant(res));const records=db.all<BookingRow>('SELECT * FROM bookings WHERE tenant_id=?'+(id?' AND campaign_id=?':''),...id?[tenant(res),id]:[tenant(res)]);audit(user(res).id,tenant(res),'bookings_exported',id??tenant(res));ok(res,records.map(b=>({id:b.id,campaignId:b.campaign_id,status:b.status,createdAt:b.created_at,...b.contact_enc?box.decrypt<{name:string;contact:string}>(b.contact_enc):{name:'已删除',contact:'已删除'}})));});
  app.get('/api/audit',owner,(_req,res)=>ok(res,db.all('SELECT action,target_id targetId,created_at createdAt FROM audit_logs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50',tenant(res))));
  app.get('/api/admin/tenants',admin,(_req,res)=>ok(res,db.all('SELECT id,name,industry,demo,created_at createdAt FROM tenants ORDER BY created_at DESC')));
  app.post('/api/admin/tenants',admin,(req,res)=>{
    const v=z.object({name:text(2,60),industry:z.enum(['photo','food']),email:z.string().email().max(120),password:z.string().min(12).max(200),address:text(2,200),contact:text(2,100)}).strict().parse(req.body);if(db.one('SELECT id FROM users WHERE email=?',v.email.toLowerCase()))fail(409,'EMAIL_EXISTS','账号已存在');
    const id=db.tx(()=>{const tenantId=randomUUID();const uid=randomUUID();db.run('INSERT INTO tenants(id,name,industry,address,contact,demo,created_at) VALUES(?,?,?,?,?,?,?)',tenantId,v.name,v.industry,v.address,v.contact,options.demo?1:0,now());db.run('INSERT INTO users VALUES(?,?,?,0)',uid,v.email.toLowerCase(),hashPassword(v.password));db.run('INSERT INTO memberships VALUES(?,?,?)',uid,tenantId,'owner');audit(user(res).id,tenantId,'tenant_created',tenantId);return tenantId;});ok(res,{id},201);
  });
  app.use('/api',()=>fail(404,'NOT_FOUND','接口不存在'));
  app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{
    const invalid=err instanceof ZodError;const known=err instanceof AppError;
    const parseError=typeof err==='object'&&err!==null&&'type' in err&&['entity.too.large','entity.parse.failed'].includes(String(err.type));
    const status=invalid?400:known?err.status:parseError?400:500;const message=invalid?err.issues.map(i=>i.message).slice(0,3).join('；'):known?err.message:parseError?'请求数据过大或格式不正确':'服务暂不可用，请稍后重试';
    if(status===500)console.error(JSON.stringify({requestId:res.locals.requestId,code:'INTERNAL',type:err instanceof Error?err.name:'Unknown'}));
    res.status(status).json({ok:false,error:{code:invalid?'VALIDATION':known?err.code:parseError?'INVALID_BODY':'INTERNAL',message},requestId:res.locals.requestId});
  });
  return {app,db};
}
