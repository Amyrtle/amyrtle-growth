import { backup } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db.ts';
import { settings } from '../server/config.ts';
import { seed } from '../server/seed.ts';
import { hashPassword } from '../server/security.ts';
const command=process.argv[2];const config=settings();
if(command==='restore'){
  const from=process.argv[3];const to=process.argv[4];if(!from||!to)throw new Error('用法: npm run restore -- <备份路径> <新的数据库路径>');
  if(!existsSync(resolve(from)))throw new Error('备份文件不存在');
  if(existsSync(resolve(to)))throw new Error('恢复目标已存在；使用全新路径，禁止覆盖运行中的数据库');
  const check=new Store(resolve(from));const integrity=check.one<{integrity_check:string}>('PRAGMA integrity_check');if(integrity?.integrity_check!=='ok')throw new Error('备份校验失败');check.close();mkdirSync(dirname(resolve(to)),{recursive:true});copyFileSync(resolve(from),resolve(to));console.log('已恢复至 '+resolve(to)+'。停服务后设置 DATABASE_PATH 指向该文件，并保留原 DATA_KEY。');
}else{
  const db=new Store(config.dbPath);
  try{
    if(command==='seed'){if(!config.demo)throw new Error('非演示环境禁止种子账号');seed(db);console.log('演示种子已就绪（重复执行不会覆盖已有数据）');}
    else if(command==='backup'){const target=resolve(process.argv[3]||`.local/backups/amyrtle-${Date.now()}.sqlite`);if(existsSync(target))throw new Error('备份目标已存在');mkdirSync(dirname(target),{recursive:true});await backup(db.db,target);console.log('数据库快照已保存：'+target+'；加密密钥须另行安全备份。');}
    else if(command==='provision'){
      const email=process.env.PROVISION_EMAIL;const password=process.env.PROVISION_PASSWORD;if(!email||!password||password.length<12)throw new Error('通过环境变量设置 PROVISION_EMAIL、PROVISION_PASSWORD（至少12位）；创建平台管理员');
      db.run('INSERT INTO users VALUES(?,?,?,1)',randomUUID(),email.toLowerCase(),hashPassword(password));console.log('平台管理员已创建；未输出密码');
    }else throw new Error('支持 seed / backup / restore / provision');
  }finally{db.close();}
}
