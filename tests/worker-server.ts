import { createApp } from '../server/app.ts';
const {app,db}=createApp({dbPath:process.env.TEST_DB!,key:Buffer.from(process.env.TEST_KEY!,'hex'),demo:true});
const server=app.listen(0,'127.0.0.1',()=>{const a=server.address();process.send?.({port:typeof a==='object'&&a?a.port:0});});
process.on('message',msg=>{if(msg==='stop')server.close(()=>{db.close();process.exit(0);});});
