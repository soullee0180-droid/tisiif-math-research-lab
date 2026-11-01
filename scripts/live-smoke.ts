// Explicitly opt-in. This schedules paid requests against a deployed, configured app.
import fs from 'node:fs/promises';
const args=process.argv.slice(2),value=(name:string)=>args[args.indexOf(name)+1];
if(!args.includes('--allow-paid')||!args.includes('--api-url')||!args.includes('--profile'))throw Error('Usage: npm run verify:live -- --allow-paid --api-url https://PROJECT.supabase.co --profile UUID [--mode pdf --revision UUID]');
const base=value('--api-url').replace(/\/$/,''),profile=value('--profile'),mode=args.includes('--mode')?value('--mode'):'text';
if(!/^https:\/\//.test(base)||!['text','pdf'].includes(mode))throw Error('INVALID_LIVE_TARGET');
const call=async(path:string,p?:any)=>{const r=await fetch(base+'/functions/v1/api/v1/'+path,{method:p?'POST':'GET',headers:p?{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}:{},body:p?JSON.stringify(p):undefined});const b=await r.json();if(!r.ok)throw Error(b.error?.code||'LIVE_HTTP_'+r.status);return b.data};
const config=await call('api-config'),model=config.models.find((m:any)=>m.id===profile);if(!model)throw Error('MODEL_NOT_FOUND');
const revision=args.includes('--revision')?value('--revision'):mode==='text'?(await call('api-config/example',{})).id:null;if(!revision)throw Error('PDF_REQUIRES_APPROVED_REVISION');
const check=await call('preflight',{mode:'probe',model_ids:[profile],revision_ids:[revision]});if(check.rows.some((r:any)=>r.issues.length))throw Error(JSON.stringify(check.rows.map((r:any)=>({stage:r.stage,issues:r.issues}))));
const probe=await call('api-config/probe',{profile_id:profile,revision_id:revision,mode});const ids=new Set(probe.plans.map((p:any)=>p.id));
console.log('Scheduled four paid diagnostic requests. Existing plans may also run; keep unrelated plans paused.');
for(let i=0;i<80;i++){
 await call('api/dispatch',{});const state=await call('api-config');const rows=state.probes.filter((p:any)=>ids.has(p.plan_id));
 if(rows.length===4&&rows.every((r:any)=>!['queued','running'].includes(r.status))){
  const report={checked_at:new Date().toISOString(),provider:model.provider,configured_model:model.model_id,profile_id:profile,mode,real_provider_calls:true,requests:rows.map((r:any)=>({stage:r.stage,status:r.status,error:r.error,attempt_id:r.attempt?.id,metadata:r.attempt?.metadata,response_hash:r.attempt?.response_hash}))};
  await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/live-smoke.json',JSON.stringify(report,null,2));console.log('Evidence saved to test-results/live-smoke.json');if(rows.some((r:any)=>r.status!=='complete'))process.exitCode=1;break;
 }
 if(i===79)throw Error('LIVE_TIMEOUT_INSPECT_QUEUE_DO_NOT_RESUBMIT');await new Promise(r=>setTimeout(r,10000));
}
