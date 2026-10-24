import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
if(existsSync('.env'))process.loadEnvFile('.env');
export function settings(){
  const dbPath=resolve(process.env.DATABASE_PATH||'.local/amyrtle.sqlite');const keyPath=resolve(dirname(dbPath),'key');
  mkdirSync(dirname(dbPath),{recursive:true});
  if(!process.env.DATA_KEY&&!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
  const key=Buffer.from(process.env.DATA_KEY||readFileSync(keyPath,'utf8').trim(),'hex');if(key.length!==32)throw new Error('DATA_KEY must be 32 bytes (64 hex characters)');
  return {dbPath,key,demo:process.env.DEMO_MODE!=='false',origin:process.env.PUBLIC_ORIGIN||'http://127.0.0.1:'+(process.env.PORT||4173),secure:process.env.PUBLIC_ORIGIN?.startsWith('https:')??false,ai:{provider:process.env.AI_PROVIDER||'mock',allowExternal:process.env.ALLOW_EXTERNAL_AI==='true',baseUrl:process.env.AI_BASE_URL,apiKey:process.env.AI_API_KEY,model:process.env.AI_MODEL},aiDailyLimit:Number(process.env.AI_DAILY_LIMIT||10),aiMonthlyLimit:Number(process.env.AI_MONTHLY_LIMIT||30)};
}
