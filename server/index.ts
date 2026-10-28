import express from 'express';
import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { settings } from './config.ts';
const config=settings();
const host=process.env.HOST||'127.0.0.1';const port=Number(process.env.PORT||4173);
if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('Local delivery binds to loopback only. Complete the deployment gates before external exposure.');
const {app,db}=createApp({...config,development:!process.argv.includes('--production')});
if(process.argv.includes('--production')){const dist=resolve('dist');app.use(express.static(dist));app.get('/{*path}',(_req,res)=>res.sendFile('index.html',{root:dist}));}
else {const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
const server=app.listen(port,host,()=>{const bound=server.address();console.log(`Amyrtle Growth: http://${host}:${typeof bound==='object'&&bound?bound.port:port} (${config.demo?'演示环境':'本地环境'})`);});
function stop(){server.close(()=>{db.close();process.exit(0);});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
