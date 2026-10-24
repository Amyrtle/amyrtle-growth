let csrf='';
export class APIError extends Error {constructor(message:string,public status:number,public code:string){super(message);}}
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const res=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','x-amyrtle-request':'1','x-csrf-token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
  const json=await res.json();if(!res.ok||!json.ok)throw new APIError(json.error?.message||'请求失败，请稍后重试',res.status,json.error?.code||'ERROR');
  if(json.data?.csrf)csrf=json.data.csrf;return json.data as T;
}
export async function uploadAsset(file:File):Promise<{id:string;url:string}>{
  if(file.size>4*1024*1024)throw new Error('图片不能超过 4 MB');
  const res=await fetch('/api/assets',{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type,'x-amyrtle-request':'1','x-csrf-token':csrf,'x-asset-copyright':'confirmed'},body:file});
  const result=await res.json();if(!res.ok)throw new Error(result.error?.message||'上传失败');return result.data;
}
export const date=(value:string,short=false)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',...short?{}:{hour:'2-digit',minute:'2-digit',hour12:false}});
export const statusLabels:Record<string,string>={draft:'草稿',published:'已发布',paused:'已暂停',ended:'已结束',requested:'待确认',confirmed:'已确认',completed:'已完成',canceled:'已取消',issued:'待使用',redeemed:'已核销',expired:'已过期',revoked:'已撤销'};
export const sourceLabels:Record<string,string>={unknown:'未知来源',direct:'直接访问',wechat:'微信',xiaohongshu:'小红书',poster:'线下海报'};
export function download(name:string,data:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
