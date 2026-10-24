import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
export const digest = (v:string) => createHash('sha256').update(v).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export function hashPassword(password:string) {const salt=token();return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function verifyPassword(password:string,hash:string) {const [salt,value]=hash.split(':');const actual=scryptSync(password,salt,64);return timingSafeEqual(actual,Buffer.from(value,'hex'));}
export function cryptoBox(key:Buffer) {
  return {
    derive:(scope:string,id:string)=>createHmac('sha256',key).update(scope+':'+id).digest('hex'),
    encrypt(value:unknown) {const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');},
    decrypt<T>(value:string):T {const b=Buffer.from(value,'base64');const cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8')) as T;}
  };
}
