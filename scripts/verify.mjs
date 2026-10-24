import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
mkdirSync('docs/test-logs',{recursive:true});
const jobs=['typecheck','lint','test','build','test:e2e','test:ops'];const results=[];
for(const job of jobs){const start=new Date();const cmd=process.platform==='win32'?'cmd.exe':'npm';const args=process.platform==='win32'?['/d','/s','/c',`npm run ${job}`]:['run',job];const r=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:12*1024*1024});const output=(r.stdout||'')+(r.stderr||'');const file='docs/test-logs/'+job.replaceAll(':','-')+'.log';writeFileSync(file,output);process.stdout.write(output);results.push({command:'npm run '+job,startedAt:start.toISOString(),durationMs:Date.now()-start.getTime(),exitCode:r.status,log:file});writeFileSync('docs/test-logs/verification.json',JSON.stringify({environment:{node:process.version,platform:process.platform},results},null,2));if(r.status!==0)process.exit(r.status||1);}
