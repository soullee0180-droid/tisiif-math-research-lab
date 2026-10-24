import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { components } from './generated';
export type PlanBody = components['schemas']['PlanBody'];
export type RevisionPatch = components['schemas']['RevisionPatch'];
export type Row = Record<string, any>;
export type PublicConfig = {supabase_url:string;supabase_publishable_key:string;app_origin:string;build_sha:string|null};
let config:PublicConfig;
export let supabase:SupabaseClient|null=null;
const pendingKeys=new Map<string,string>();

export class ApiError extends Error {
  constructor(public code:string,message:string,public status:number,public details:Row={}){super(message)}
}
export async function initialize(){
  const response=await fetch('/api/public/config');
  if(!response.ok)throw new Error('연결 설정을 불러오지 못했습니다.');
  config=(await response.json()).data;
  if(config.supabase_url&&config.supabase_publishable_key){
    supabase=createClient(config.supabase_url,config.supabase_publishable_key,{
      auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
    });
  }
  return config;
}
export async function token(){return (await supabase?.auth.getSession())?.data.session?.access_token}
export async function api<T=Row>(path:string,body?:unknown,method?:string):Promise<T>{
  const verb=method||(body===undefined?'GET':'POST');
  const headers:Record<string,string>={};
  const access=await token();
  if(access)headers.Authorization='Bearer '+access;
  let keyName='';
  if(verb!=='GET'){
    headers['Content-Type']='application/json';
    keyName=verb+':'+path+':'+JSON.stringify(body??{});
    if(!pendingKeys.has(keyName))pendingKeys.set(keyName,crypto.randomUUID());
    headers['Idempotency-Key']=pendingKeys.get(keyName)!;
  }
  const response=await fetch('/api/v1'+path,{method:verb,headers,body:verb==='GET'?undefined:JSON.stringify(body??{})});
  const payload=await response.json();
  if(!response.ok)throw new ApiError(payload.error?.code||'REQUEST_FAILED',payload.error?.message||'요청을 완료하지 못했습니다.',response.status,payload.error?.details);
  if(keyName)pendingKeys.delete(keyName);
  return payload.data;
}
export async function image(path:string){
  const access=await token();
  const response=await fetch('/api/v1'+path,{headers:{Authorization:'Bearer '+access}});
  if(!response.ok)throw new Error('미리보기를 불러오지 못했습니다.');
  return response.blob();
}
export async function downloadAsset(id:string){
  const result=await api<{url:string}>('/assets/'+id+'/download');
  const a=document.createElement('a');a.href=result.url;a.target='_blank';a.rel='noopener noreferrer';
  if(result.url.startsWith('/api/v1/test-download')){
    const r=await fetch(result.url,{headers:{Authorization:'Bearer '+await token()}});
    const url=URL.createObjectURL(await r.blob());a.href=url;a.download='download';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }else a.click();
}
export function time(value:unknown){
  if(!value)return '—';
  return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(String(value)));
}
export const providers=['google','openai','anthropic'];
export const names:Row={google:'Google',openai:'OpenAI',anthropic:'Anthropic',mock:'가상 검수'};

