import type { Express, Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Store } from './db.ts';
import { AppError } from './app.ts';
interface AssetDeps {db:Store;identify:RequestHandler;owner:RequestHandler;tenant:(res:Response)=>string;rate:(req:Request,scope:string,limit:number)=>void;audit:(res:Response,id:string)=>void}
export function checkAssets(db:Store,tenantId:string,ids:string[]){for(const id of ids)if(!db.one('SELECT id FROM campaign_assets WHERE id=? AND tenant_id=?',id,tenantId))throw new AppError(404,'ASSET_NOT_FOUND','图片不存在或不属于本店');}
export function registerAssets(app:Express,{db,identify,owner,tenant,rate,audit}:AssetDeps){
  app.get('/api/assets/:id',(req:Request,res:Response,next:NextFunction)=>{
    const id=String(req.params.id);const asset=db.one<{tenant_id:string;content:Uint8Array}>('SELECT tenant_id,content FROM campaign_assets WHERE id=?',id);if(!asset)return next(new AppError(404,'NOT_FOUND','图片不存在'));
    const published=db.one("SELECT c.id FROM campaigns c WHERE c.tenant_id=? AND c.status='published' AND (EXISTS(SELECT 1 FROM json_each(c.config,'$.assetIds') WHERE value=?) OR EXISTS(SELECT 1 FROM tenants t WHERE t.id=c.tenant_id AND t.logo_asset_id=?)) LIMIT 1",asset.tenant_id,id,id);
    const send=()=>res.type('image/webp').setHeader('Cache-Control','private, no-store').send(Buffer.from(asset.content));
    if(published)return send();
    identify(req,res,(err?:unknown)=>{if(err)return next(err);if(tenant(res)!==asset.tenant_id)return next(new AppError(404,'NOT_FOUND','图片不存在'));send();});
  });
  app.post('/api/assets',identify,owner,async(req,res)=>{
    rate(req,'asset-upload',10);if(req.headers['x-asset-copyright']!=='confirmed')throw new AppError(400,'ASSET_RIGHTS','请先确认素材使用权限');
    if(!Buffer.isBuffer(req.body)||!req.body.length)throw new AppError(400,'IMAGE_FORMAT','请选择 JPEG、PNG 或 WebP 图片');
    const current=db.one<{n:number;bytes:number}>('SELECT count(*) n,coalesce(sum(size),0) bytes FROM campaign_assets WHERE tenant_id=?',tenant(res))!;if(current.n>=40||current.bytes>=20*1024*1024)throw new AppError(429,'ASSET_QUOTA','本店演示素材上限已达到（40 张 / 20 MB）');
    let output:Buffer;
    try{const input=sharp(req.body,{limitInputPixels:20_000_000,failOn:'warning'});const meta=await input.metadata();if(!['jpeg','png','webp'].includes(meta.format)|| (meta.pages??1)>1)throw new Error('format');output=await input.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();}catch{throw new AppError(400,'IMAGE_FORMAT','图片无效、尺寸过大或格式不支持；请选择不超过 2000 万像素的静态 JPEG、PNG、WebP');}
    const id=randomUUID();db.run('INSERT INTO campaign_assets VALUES(?,?,?,?,?,?,?)',id,tenant(res),output,'image/webp',output.length,1,new Date().toISOString());audit(res,id);res.status(201).json({ok:true,data:{id,url:'/api/assets/'+id},requestId:res.locals.requestId});
  });
}
