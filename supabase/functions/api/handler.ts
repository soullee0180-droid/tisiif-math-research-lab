import{sha,type Json,providers,recipeValid}from '../../../packages/contracts/core.ts';
import{type Runtime,safeError,crypt}from '../_shared/runtime.ts';
import{signed}from '../_shared/internal-auth.ts';
import{execute,manualPrompt,manualSubmit,reparse}from '../_shared/execution.ts';
const reads=new Set(['papers','paper','revision','revisions','plans','plan','queue','results','analysis']);
const writes=new Set(['paper_create','paper_update','checkpoint_create','revision_clone','revision_save','revision_approve','plan_create','plan_control','analysis_create']);
// The application is intentionally public. Database/service credentials remain server-only.
export async function handler(req:Request,rt:Runtime){const id=crypto.randomUUID();const cors={'Content-Type':'application/json','x-request-id':id,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,content-type,idempotency-key','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
 try{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const u=new URL(req.url),path=u.pathname.replace(/^(?:\/functions\/v1)?\/api(?=\/|$)/,''),query=Object.fromEntries(u.searchParams);
  if(req.method==='GET'&&path==='/v1/health')return Response.json({ok:true,version:'3.2.0',access:'public',real_api_default:false},{headers:cors});
  if(!['GET','POST'].includes(req.method))throw Error('METHOD_NOT_ALLOWED');
  if(!await rt.rpc('lab_public_request',{is_write:req.method==='POST'}))throw Error('PUBLIC_RATE_LIMIT');
  const identity=await rt.rpc('lab_public_identity',{}),w=identity.workspace.id,a=identity.user.id;
  await rt.rpc('lab_usage',{bytes_count:0});
  const get=(kind:string,args:Json={})=>rt.rpc('lab_read',{w,a,kind,args});
  let result:any;
  if(req.method==='GET'){
   if(path==='/v1/me')result=identity;
   else if(path==='/v1/api-config')result=await rt.rpc('lab_shared_api',{w,a,command:'read'});
   else if(path.startsWith('/v1/read/')){const kind=path.slice(9);if(!reads.has(kind))throw Error('PUBLIC_ACTION_DISABLED');const args:Json={...query};if(query.plan_ids_json)args.plan_ids=JSON.parse(query.plan_ids_json);result=await get(kind,args)}
   else if(path==='/v1/duplicate')result=await rt.rpc('lab_duplicate',{w,a,hash:query.hash});
   else if(path==='/v1/asset'){const asset=await rt.rpc('lab_asset',{w,a,asset_id:query.id});if(asset.status!=='verified')throw Error('ASSET_NOT_VERIFIED');await rt.rpc('lab_usage',{bytes_count:asset.bytes});result={asset,url:await rt.download(asset.kind,asset.path)}}
   else throw Error('NOT_FOUND');
  }else{
   const key=req.headers.get('Idempotency-Key')||'';if(key.length<8||key.length>100)throw Error('IDEMPOTENCY_REQUIRED');
   const text=await req.text();if(new TextEncoder().encode(text).length>1153434)throw Error('BODY_TOO_LARGE');const p:Json=JSON.parse(text||'{}');
   const write=(action:string,payload=p)=>rt.rpc('lab_write',{w,a,action,p:payload,idem:key});
   if(path.startsWith('/v1/write/')){const action=path.slice(10);if(!writes.has(action))throw Error('PUBLIC_ACTION_DISABLED');
    if(action==='plan_create'&&!['manual_web','mock','api'].includes(p.transport))throw Error('PLAN_TRANSPORT_INVALID');
    if(action==='plan_control'){const plan=await get('plan',{id:p.id});if(!['manual_web','mock','api'].includes(plan.transport))throw Error('PLAN_TRANSPORT_INVALID');if(plan.created_by!==a){const operator=await rt.rpc('lab_shared_operator',{w,a});result=await rt.rpc('lab_write',{w,a:operator,action,p,idem:key});return Response.json({data:result,request_id:id},{headers:cors})}}
    if(action==='revision_save'&&p.body?.input_mode==='pdf')recipeValid(p.body.page_recipe);result=action==='plan_create'?await rt.rpc('lab_public_plan_create',{w,a,p,idem:key}):await write(action);
   }else if(path==='/v1/api-config/key'){if(!providers.includes(p.provider)||typeof p.key!=='string'||p.key.trim().length<8||p.key.length>4096)throw Error('KEY_INPUT_REQUIRED');const value=p.key.trim();result=await rt.rpc('lab_shared_api',{w,a,command:'key_store',p:{provider:p.provider,encrypted:await crypt(rt,w,p.provider,value),last_four:value.slice(-4),request_hash:await sha(p.provider+':'+value)},idem:key});
   }else if(path==='/v1/api-config/save'){if(!['budget_save','model_save','model_enable','provider_pause','prompts','toggle','limits'].includes(p.command))throw Error('PUBLIC_ACTION_DISABLED');if(p.command==='budget_save'&&(!Number.isFinite(p.data?.budget_usd)||p.data.budget_usd<0||p.data.budget_usd>1000))throw Error('BUDGET_INVALID');if(p.command==='model_save'&&['input_per_million','output_per_million','max_request_usd'].some(k=>!Number.isFinite(p.data?.pricing?.[k])))throw Error('MODEL_PRICE_REQUIRED');result=await rt.rpc('lab_shared_api',{w,a,command:p.command,p:p.data||{},idem:key});
   }else if(path==='/v1/api-config/probe'){if(!['text','pdf'].includes(p.mode)||!p.profile_id||!p.revision_id)throw Error('PROBE_INPUT_REQUIRED');result=await rt.rpc('lab_public_probe',{w,a,p,idem:key});
   }else if(path==='/v1/api/dispatch'){const body='{}',path='/functions/v1/dispatch';const response=await rt.fetch(rt.env('SUPABASE_URL')+path,{method:'POST',headers:await signed(rt,path,body),body,signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('DISPATCH_FAILED');result={accepted:true};
   }else if(path==='/v1/upload/batch')result=await write('asset_batch_reserve');
   else if(path==='/v1/upload/failed')result=await write('asset_failed');
   else if(path==='/v1/upload/reserve'){if(!['source','prepared'].includes(p.kind))throw Error('UPLOAD_KIND_INVALID');result=await write('asset_reserve');result={asset:result,...await rt.uploadToken(result.kind,result.path)}}
   else if(path==='/v1/upload/resume'){const asset=await rt.rpc('lab_asset',{w,a,asset_id:p.id});if(!['source','prepared'].includes(asset.kind))throw Error('UPLOAD_KIND_INVALID');result={asset,...await rt.uploadToken(asset.kind,asset.path)}}
   else if(path==='/v1/upload/verify'){const asset=await rt.rpc('lab_asset',{w,a,asset_id:p.id});if(!['source','prepared'].includes(asset.kind))throw Error('UPLOAD_KIND_INVALID');const bytes=await rt.head(asset.kind,asset.path);if(bytes!==asset.bytes)throw Error('ASSET_SIZE_MISMATCH');let serverHash=false;if(asset.kind==='prepared'){if(bytes>8388608)throw Error('PREPARED_TOO_LARGE');if(await sha(await rt.get(asset.kind,asset.path))!==asset.sha256)throw Error('ASSET_HASH_MISMATCH');serverHash=true}const metadata:Json={size_verified:true,inspection_source:'client_inspected'};if(p.inspection)metadata.inspection=p.inspection;if(p.preview_sha256){if(p.preview_sha256!==asset.sha256)throw Error('PREVIEW_HASH_MISMATCH');metadata.preview_sha256=p.preview_sha256}result=await write('asset_verified',{id:asset.id,server_hash:serverHash,metadata})}
   else if(path==='/v1/manual/prompt')result=await manualPrompt(rt,w,a,p.job_id);
   else if(path==='/v1/manual/response')result=await manualSubmit(rt,w,a,p.attempt_id,p);
   else if(path==='/v1/reparse'){const operator=await rt.rpc('lab_shared_operator',{w,a});await rt.rpc('lab_authorize_attempt',{w,a:operator,attempt:p.attempt_id});const c=await rt.rpc('lab_context',{attempt:p.attempt_id});result=await reparse(rt,p.attempt_id)}
   else if(path==='/v1/mock/step'){let processed=0;await rt.rpc('lab_recover',{});for(const provider of providers){const claim=await rt.rpc('lab_public_mock_claim',{provider_name:provider});if(claim){await execute(rt,claim.attempt_id);processed++}}result={processed,real_provider_calls:0}}
   else throw Error('PUBLIC_ACTION_DISABLED');
  }
  return Response.json({data:result,request_id:id},{headers:cors});
 }catch(error){const code=safeError(error);const status=code==='PUBLIC_RATE_LIMIT'?429:/PUBLIC_ACTION_DISABLED|PUBLIC_API_DISABLED|FORBIDDEN/.test(code)?403:/NOT_FOUND/.test(code)?404:/CONFLICT|IMMUTABLE/.test(code)?409:400;
  const messages:Record<string,string>={PUBLIC_RATE_LIMIT:'공개 공간의 요청이 많습니다. 잠시 후 다시 시도하세요.',PUBLIC_ACTION_DISABLED:'공개 공간에서는 이 관리 작업을 사용할 수 없습니다.',PUBLIC_API_DISABLED:'공개 공간에서는 수동·모의 실험만 사용할 수 있습니다.'};
  return Response.json({error:{code,message:messages[code]||code,request_id:id}},{status,headers:cors});
 }
}
