import { z } from 'zod';
export const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(v => !/[<>]/.test(v) && ![...v].some(c => c.charCodeAt(0) <= 8), '请使用纯文字，不含 HTML 标签');
const timestamp = z.string().datetime({offset: true}).transform(v => new Date(v).toISOString());
export const slotSchema = z.object({id: z.string().uuid().optional(), startsAt: timestamp, endsAt: timestamp, capacity: z.number().int().min(1).max(100)}).strict();
export const campaignSchema = z.object({
  title: text(2, 60), description: text(5, 1500), terms: text(5, 1500), offer: text(2, 200),
  price: z.number().min(0).max(100000), startsAt: timestamp, endsAt: timestamp,
  cta: text(2, 20), highlights: z.array(text(1, 100)).min(1).max(6),
  slots: z.array(slotSchema).max(30), quota: z.number().int().min(1).max(10000),
  dailyLimit: z.number().int().min(1).max(10000), perVisitorLimit: z.number().int().min(1).max(5),
  validUntil: timestamp, minimumSpend: z.number().min(0).max(100000),
  image: z.enum(['photo', 'coffee']), assetConfirmed: z.boolean(), assetIds:z.array(z.string().uuid()).max(4).default([]),
}).strict().superRefine((v, ctx) => {
  if (v.endsAt <= v.startsAt) ctx.addIssue({code:'custom', message:'结束时间必须晚于开始时间', path:['endsAt']});
  for (const s of v.slots) if (s.endsAt <= s.startsAt || s.startsAt < v.startsAt || s.endsAt > v.endsAt) ctx.addIssue({code:'custom', message:'档期需在活动时间内，且结束晚于开始', path:['slots']});
  if (v.validUntil < v.endsAt) ctx.addIssue({code:'custom', message:'券有效期不能早于活动结束', path:['validUntil']});
});
export type CampaignInput = z.infer<typeof campaignSchema>;
export const shopSchema = z.object({name: text(2, 60), description: text(0, 500), address: text(2, 200), contact: text(2, 100), brandColor: z.string().regex(/^#[a-fA-F0-9]{6}$/),logoAssetId:z.string().uuid().nullable().default(null)}).strict();
export const bookingSchema = z.object({slotId:z.string().uuid(), name:text(1,40), contact:z.string().trim().regex(/^1[3-9]\d{9}$/, '请输入有效的 11 位手机号'), consent:z.literal(true), requestKey:z.string().uuid(), source:z.enum(['unknown','wechat','xiaohongshu','poster','direct']).default('unknown'), website:z.literal('').default('')}).strict();
export const claimSchema = z.object({consent:z.literal(true), requestKey:z.string().uuid(), source:bookingSchema.shape.source, website:z.literal('').default('')}).strict();
export const aiSchema = z.object({titles:z.array(text(2,60)).min(1).max(3), description:text(5,1500), sellingPoints:z.array(text(1,100)).min(1).max(6), cta:text(2,20), claimsToVerify:z.array(text(1,200)).max(10), warnings:z.array(text(1,200)).max(10)}).strict();
export type Copy = z.infer<typeof aiSchema>;
export type Industry = 'photo'|'food';
export interface Shop {id:string;name:string;industry:Industry;description:string;address:string;contact:string;brandColor:string;demo:number;logoAssetId:string|null}
export interface Session {user:{id:string;email:string;role:'owner'|'staff'|'admin'};shop:Shop|null;csrf:string;demoMode:boolean}
export interface Campaign {id:string;tenantId:string;slug:string;status:'draft'|'published'|'paused'|'ended';revision:number;config:CampaignInput;industry:Industry;createdAt:string;demo:number;slots:Slot[]}
export interface Slot {id:string;startsAt:string;endsAt:string;capacity:number;reserved:number}
export interface Booking {id:string;campaignId:string;title:string;name:string;contact:string;status:'requested'|'confirmed'|'completed'|'canceled';startsAt:string;createdAt:string}
export interface Voucher {id:string;title:string;status:string;issuedAt:string;redeemedAt:string|null;validUntil:string}
export interface Summary {counts:Record<string,number>;sources:{source:string;visits:number;actions:number}[];trend:{date:string;visits:number;actions:number}[];campaigns:number;active:number;pending:number;asOf:string;demo:boolean}
