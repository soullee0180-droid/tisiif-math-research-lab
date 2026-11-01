-- User-authorized shared provider keys and public execution, without account login.
create function lab_private.shared_operator(w uuid) returns uuid language plpgsql security invoker set search_path='' as $$ declare a uuid;begin
 if not exists(select 1 from lab.workspaces where id=w and active and settings->>'access_mode'='public') then raise exception 'FORBIDDEN';end if;
 insert into lab.members(id,workspace_id,id_email,role) values(gen_random_uuid(),w,'shared-api@lab.invalid','admin') on conflict(workspace_id,id_email) do nothing;
 select id into a from lab.members where workspace_id=w and id_email='shared-api@lab.invalid' and active and role='admin';if a is null then raise exception 'FORBIDDEN';end if;return a;end $$;
create function lab_private.stage_prompts(p jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$ declare item record;begin
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'STAGE_PROMPTS_INVALID';end if;
 for item in select key,value from jsonb_each(p) loop if item.key not in('generate','select','usefulness','agreement') or jsonb_typeof(item.value)<>'string' or length(item.value#>>'{}')>10000 then raise exception 'STAGE_PROMPTS_INVALID';end if;end loop;return p;end $$;
create function public.lab_shared_api(w uuid,a uuid,command text,p jsonb default '{}',idem text default '') returns jsonb language plpgsql security invoker set search_path='' as $$ declare operator uuid;v jsonb;begin
 perform lab_private.actor(w,a);operator=lab_private.shared_operator(w);
 case command
 when 'read' then return jsonb_build_object('api_enabled',(select coalesce((settings->>'api_enabled')::boolean,false) from lab.workspaces where id=w),'scheduler',(select to_jsonb(s) from lab_private.scheduler_state s),'stage_prompts',(select coalesce(settings->'stage_prompts','{}') from lab.workspaces where id=w),'keys',coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'last_four',last_four,'key_version',key_version)) from lab_private.provider_secrets where workspace_id=w),'[]'),'budgets',coalesce((select jsonb_agg(to_jsonb(b)) from lab_private.usage_budgets b where workspace_id=w),'[]'),'providers',(select jsonb_agg(to_jsonb(r)) from lab_private.provider_runtime r),'models',coalesce((select jsonb_agg(to_jsonb(m) order by created_at desc) from lab.model_profiles m where workspace_id=w),'[]'));
 when 'prompts' then update lab.workspaces set settings=settings||jsonb_build_object('stage_prompts',lab_private.stage_prompts(p->'stage_prompts')) where id=w;return jsonb_build_object('saved',true);
 when 'toggle' then update lab.workspaces set settings=settings||jsonb_build_object('api_enabled',coalesce((p->>'enabled')::boolean,false),'scheduler_enabled',true) where id=w;update lab_private.scheduler_state set enabled=true where id=true;return jsonb_build_object('saved',true);
 when 'key_store' then if p->>'provider' not in('google','openai','anthropic') then raise exception 'PROVIDER_INVALID';end if;
 when 'budget_save' then if p->>'provider' not in('google','openai','anthropic') or (p->>'budget_usd')::numeric<0 or (p->>'budget_usd')::numeric>1000 then raise exception 'BUDGET_INVALID';end if;
 when 'model_save' then if p->>'provider' not in('google','openai','anthropic') or coalesce(p->>'model_id','')!~'^[a-zA-Z0-9._:/-]{1,150}$' or (p->>'api_family') is distinct from (case p->>'provider' when 'google' then 'generate_content' when 'openai' then 'responses' else 'messages' end) or jsonb_typeof(p->'parameters')<>'object' or (p#>>'{pricing,max_request_usd}')::numeric<=0 or (p#>>'{pricing,input_per_million}')::numeric<0 or (p#>>'{pricing,output_per_million}')::numeric<0 then raise exception 'MODEL_PROFILE_INVALID';end if;
 when 'limits' then if p->>'provider' not in('google','openai','anthropic') or coalesce((p->>'rpm')::integer,0) not between 1 and 10000 or coalesce((p->>'tpm')::bigint,0) not between 1000 and 1000000000 or coalesce((p->>'min_interval_ms')::integer,0) not between 1000 and 60000 then raise exception 'PROVIDER_LIMIT_INVALID';end if;update lab_private.provider_runtime set rpm=(p->>'rpm')::integer,tpm=(p->>'tpm')::integer,min_interval_ms=(p->>'min_interval_ms')::integer where provider=p->>'provider';update lab.jobs set status='queued',last_error=null where workspace_id=w and provider=p->>'provider' and status='blocked' and last_error='TPM_CAP_TOO_LOW' and attempt_no=0;return jsonb_build_object('saved',true);
 when 'model_enable' then null;
 when 'provider_pause' then if p->>'provider' not in('google','openai','anthropic') then raise exception 'PROVIDER_INVALID';end if;
 else raise exception 'PUBLIC_ACTION_DISABLED';end case;
 return public.lab_write(w,operator,command,p,idem);end $$;
create function public.lab_shared_operator(w uuid,a uuid) returns uuid language plpgsql security invoker set search_path='' as $$ begin perform lab_private.actor(w,a);return lab_private.shared_operator(w);end $$;
create function public.lab_public_plan_create(w uuid,a uuid,p jsonb,idem text) returns jsonb language sql security invoker set search_path='' as $$ select public.lab_write(w,a,'plan_create',p,idem) $$;
revoke execute on function lab_private.shared_operator(uuid),lab_private.stage_prompts(jsonb),public.lab_shared_api(uuid,uuid,text,jsonb,text),public.lab_shared_operator(uuid,uuid),public.lab_public_plan_create(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function lab_private.shared_operator(uuid),lab_private.stage_prompts(jsonb),public.lab_shared_api(uuid,uuid,text,jsonb,text),public.lab_shared_operator(uuid,uuid),public.lab_public_plan_create(uuid,uuid,jsonb,text) to service_role;
notify pgrst,'reload schema';

-- Preserve the existing atomic queue, with custom prompt accounting and conservative cost admission.
create or replace function public.lab_claim(provider_name text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare pr lab_private.provider_runtime;j lab.jobs;pl lab.plans;at lab.attempts;b lab_private.usage_budgets;model jsonb;tokens bigint;cost numeric;begin
 select * into pr from lab_private.provider_runtime where provider=provider_name for update;if not found or pr.paused or pr.blocked_reason is not null or pr.next_allowed_at>now() or pr.last_claim+pr.min_interval_ms*interval '1 millisecond'>now() then return null;end if;
 if exists(select 1 from lab.jobs jj join lab.plans pp on pp.id=jj.plan_id where jj.provider=provider_name and jj.status='running' and pp.transport<>'manual_web') then return null;end if;
 if(select count(*) from lab_private.quota_reservations where provider=provider_name and created_at>now()-interval '1 minute')>=pr.rpm then return null;end if;
 select j0.* into j from lab.jobs j0 join lab.plans p on p.workspace_id=j0.workspace_id and p.id=j0.plan_id join lab.workspaces ws on ws.id=p.workspace_id left join lab_private.plan_fairness fair on fair.plan_id=p.id
 where j0.provider=provider_name and j0.status='queued' and j0.due_at<=now() and p.status='running' and p.scheduled_at<=now() and p.transport<>'manual_web' and ws.active and(j0.depends_on is null or exists(select 1 from lab.jobs parent where parent.id=j0.depends_on and parent.status='complete'))
 order by case when j0.plan_id=pr.last_plan then 1 else 0 end,coalesce(fair.last_claimed_at,'1970-01-01'),j0.created_at,j0.id for update of j0 skip locked limit 1;
 if not found then return null;end if;select * into pl from lab.plans where id=j.plan_id;select snapshot into model from lab.plan_models where plan_id=pl.id and provider=provider_name;
 -- Reserve a conservative byte-based upper estimate, including the current candidates.
 -- The fixed allowance covers system prompts/schema/wire framing. PDF adds 32k/page.
 tokens=octet_length(coalesce(pl.protocol->'stage_prompts','{}')::text)+coalesce((model->>'output_cap')::integer,1000)+65536
  +coalesce((select octet_length(snapshot::text) from lab.plan_inputs where plan_id=j.plan_id and revision_id=(select revision_id from lab.runs where id=j.run_id)),0)
  +coalesce((select sum(octet_length(body::text))*2 from lab.ideas where run_id=j.run_id),0)
  +coalesce((select case when pi.snapshot->>'input_mode'='pdf' then coalesce((s.metadata#>>'{inspection,pages}')::bigint,30)*32768 else 0 end from lab.plan_inputs pi left join lab.assets s on s.workspace_id=pi.workspace_id and s.id=(pi.snapshot->>'prepared_asset_id')::uuid where pi.plan_id=j.plan_id and pi.revision_id=(select revision_id from lab.runs where id=j.run_id)),0);
 cost=0;perform pg_advisory_xact_lock(610241);if lab_private.storage_admitted()+2097152>800000000 then update lab.jobs set status='blocked',last_error='RESPONSE_STORAGE_RESERVATION_BLOCKED' where id=j.id;return null;end if;
 if pl.transport='api' then
  if not coalesce((select (settings->>'api_enabled')::boolean from lab.workspaces where id=j.workspace_id),false) then return null;end if;
  select * into b from lab_private.usage_budgets where workspace_id=j.workspace_id and provider=provider_name for update;
  cost=(model->'pricing'->>'max_request_usd')::numeric;
  if cost < (tokens*2.5*coalesce((model#>>'{pricing,input_per_million}')::numeric,0)+coalesce((model->>'output_cap')::integer,1000)*coalesce((model#>>'{pricing,output_per_million}')::numeric,0))/1000000 then update lab.jobs set status='blocked',last_error='REQUEST_COST_CAP_TOO_LOW' where id=j.id;return null;end if;
  if cost is null or cost<=0 or not b.enabled or b.org_verified_at is null or b.org_verified_at<now()-interval '24 hours' or b.spent_usd+b.reserved_usd+cost>b.budget_usd then update lab.jobs set status='blocked',last_error='API_BUDGET_BLOCKED' where id=j.id;return null;end if;
 end if;
 if tokens>pr.tpm then update lab.jobs set status='blocked',last_error='TPM_CAP_TOO_LOW' where id=j.id;return null;end if;
 if coalesce((select sum(estimated_tokens) from lab_private.quota_reservations where provider=provider_name and created_at>now()-interval '1 minute'),0)+tokens>pr.tpm then return null;end if;
 update lab.jobs set status='running',lease_until=now()+interval '90 seconds',attempt_no=attempt_no+1 where id=j.id returning * into j;
 insert into lab.attempts(workspace_id,job_id,attempt_no) values(j.workspace_id,j.id,j.attempt_no) returning * into at;
 insert into lab_private.quota_reservations(provider,job_id,attempt_id,estimated_tokens,reserved_usd,reserved_storage_bytes) values(provider_name,j.id,at.id,tokens,cost,2097152);
 if cost>0 then update lab_private.usage_budgets set reserved_usd=reserved_usd+cost where workspace_id=j.workspace_id and provider=provider_name;end if;
 insert into lab_private.plan_fairness(plan_id,last_claimed_at) values(j.plan_id,now()) on conflict(plan_id) do update set last_claimed_at=excluded.last_claimed_at;
 update lab_private.provider_runtime set last_claim=now(),last_plan=j.plan_id where provider=provider_name;
 return jsonb_build_object('job_id',j.id,'attempt_id',at.id,'workspace_id',j.workspace_id);end $$;

create function public.lab_public_probe(w uuid,a uuid,p jsonb,idem text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior lab_private.idempotency_requests;operator uuid;stage text;result jsonb;plans jsonb='[]';h text;begin
 perform lab_private.actor(w,a);operator=lab_private.shared_operator(w);h=lab_private.hash(jsonb_build_object('action','shared_probe','payload',p));perform pg_advisory_xact_lock(hashtextextended(w::text||a::text||idem,0));
 select * into prior from lab_private.idempotency_requests where workspace_id=w and actor=a and key=idem;if found then if prior.payload_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;return prior.result;end if;
 if p->>'mode' not in('text','pdf') or not exists(select 1 from lab.checkpoint_revisions where workspace_id=w and id=(p->>'revision_id')::uuid and status='approved' and body->>'input_mode'=p->>'mode') then raise exception 'PROBE_INPUT_MODE_MISMATCH';end if;
 foreach stage in array array['generate','select','usefulness','agreement'] loop plans=plans||jsonb_build_array(public.lab_smoke_begin(w,operator,(p->>'profile_id')::uuid,(p->>'revision_id')::uuid,stage));end loop;
 result=jsonb_build_object('plans',plans,'requests',4);insert into lab_private.idempotency_requests values(w,a,idem,h,result,now());return result;end $$;
revoke execute on function public.lab_public_probe(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.lab_public_probe(uuid,uuid,jsonb,text) to service_role;
notify pgrst,'reload schema';

-- Custom instructions are inserted with the immutable plan, never updated afterward.
create or replace function lab_private.write_plans(w uuid,a uuid,action text,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m lab.members;h text;prior lab_private.idempotency_requests;v jsonb;rid uuid;pid uuid;cid uuid;ver integer;rev lab.checkpoint_revisions;pl lab.plans;gen text;judge text;rp integer;jid uuid;other text;item jsonb;k integer;rr integer;proto jsonb;models jsonb;dt timestamptz;budget lab_private.usage_budgets;cap jsonb;estimated_bytes bigint=0;max_output_bytes bigint=131072;
begin
 m=lab_private.actor(w,a);
 case action
 when 'plan_create' then
 perform lab_private.admit();
 k=(p->>'k')::integer;rr=(p->>'repeats')::integer;if k not between 1 and 10 or rr not between 1 and 10 or jsonb_array_length(p->'revision_ids')<1 then raise exception 'PLAN_RANGE';end if;
 if p->>'transport'='api' then
  if not coalesce((select (settings->>'api_enabled')::boolean from lab.workspaces where id=w),false) then raise exception 'REAL_API_DISABLED';end if;
  foreach gen in array array['google','openai','anthropic'] loop
   select * into budget from lab_private.usage_budgets where workspace_id=w and provider=gen;if not found or not budget.enabled or budget.budget_usd<=budget.spent_usd+budget.reserved_usd or budget.org_verified_at is null or budget.org_verified_at<now()-interval '24 hours' then raise exception 'API_BUDGET_BLOCKED';end if;
   select to_jsonb(mp) into cap from lab.model_profiles mp where workspace_id=w and id=(p->'model_ids'->>gen)::uuid and provider=gen and enabled;if cap is null or cap->'capabilities'->>'text'<>'PASS' or cap->'capabilities'->>'json'<>'PASS' or cap->'capabilities'->>'within_100s' is distinct from 'PASS' or cap#>>'{capabilities,stages,generate,status}' is distinct from 'PASS' or cap#>>'{capabilities,stages,select,status}' is distinct from 'PASS' or cap#>>'{capabilities,stages,usefulness,status}' is distinct from 'PASS' or cap#>>'{capabilities,stages,agreement,status}' is distinct from 'PASS' then raise exception 'MODEL_CAPABILITY_BLOCKED';end if;
  end loop;
 end if;
 select body into proto from lab.protocol_versions where workspace_id=w order by created_at desc limit 1;if proto is null then raise exception 'PROTOCOL_NOT_CONFIGURED';end if;proto=proto||jsonb_build_object('candidate_count',k,'independent_repeats',rr,'stage_prompts',lab_private.stage_prompts(coalesce((select settings->'stage_prompts' from lab.workspaces where id=w),'{}')||coalesce(p->'stage_prompts','{}')));
 dt=coalesce((p->>'scheduled_at')::timestamptz,now());pid=gen_random_uuid();models=coalesce(p->'model_ids','{}');
 insert into lab.plans(id,workspace_id,created_by,name,k,repeats,cohort,transport,scheduled_at,protocol,condition_hash) values(pid,w,a,p->>'name',k,rr,p->>'cohort',p->>'transport',dt,proto,lab_private.hash(jsonb_build_object('protocol',proto,'models',models,'transport',p->>'transport')));
 foreach gen in array array['google','openai','anthropic'] loop
 if p->>'transport'='api' then select to_jsonb(mp) into cap from lab.model_profiles mp where workspace_id=w and id=(models->>gen)::uuid;else cap=jsonb_build_object('provider',gen,'model_id',case when p->>'transport'='mock' then 'fixture-v3' else null end,'api_family',p->>'transport');end if;
 insert into lab.plan_models values(w,pid,gen,cap);end loop;
 for item in select value from jsonb_array_elements(p->'revision_ids') loop
 select * into rev from lab.checkpoint_revisions where workspace_id=w and id=(item#>>'{}')::uuid and status='approved';if not found then raise exception 'REVISION_NOT_APPROVED';end if;
 if p->>'transport'='api' then select least(1048576,coalesce(max((snapshot->>'output_cap')::bigint*32),131072)) into max_output_bytes from lab.plan_models where plan_id=pid;estimated_bytes=estimated_bytes+(6*octet_length(rev.body::text)+11*max_output_bytes)*3*rr*3/2;if lab_private.storage_admitted()+estimated_bytes>800000000 then raise exception 'PLAN_RAW_STORAGE_ESTIMATE_BLOCKED';end if;end if;
 if rev.body->>'input_mode'='pdf' and p->>'transport'='api' then
  perform 1 from lab.plan_models where plan_id=pid and (snapshot->'capabilities'->>'pdf' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,generate,status}' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,select,status}' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,usefulness,status}' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,agreement,status}' is distinct from 'PASS');if found then raise exception 'PDF_CAPABILITY_BLOCKED';end if;
 end if;
 insert into lab.plan_inputs select w,pid,rev.id,c.paper_id,c.id,rev.body,rev.input_hash,rev.reference_hash from lab.checkpoints c where c.id=rev.checkpoint_id and c.workspace_id=w;
 for rp in 1..rr loop foreach gen in array array['google','openai','anthropic'] loop
 insert into lab.runs(workspace_id,plan_id,revision_id,generator,repeat_index) values(w,pid,rev.id,gen,rp) returning id into rid;
 insert into lab.jobs(workspace_id,run_id,plan_id,stage,provider,due_at) values(w,rid,pid,'generate',gen,dt) returning id into jid;
 insert into lab.jobs(workspace_id,run_id,plan_id,stage,provider,depends_on,due_at) values(w,rid,pid,'select',gen,jid,dt);
 foreach judge in array array['google','openai','anthropic'] loop if judge<>gen then insert into lab.jobs(workspace_id,run_id,plan_id,stage,provider,depends_on,due_at) values(w,rid,pid,'usefulness',judge,jid,dt),(w,rid,pid,'agreement',judge,jid,dt);end if;end loop;
 end loop;end loop;end loop;
 v=jsonb_build_object('id',pid);
 when 'plan_control' then
 select * into pl from lab.plans where workspace_id=w and id=(p->>'id')::uuid for update;if not found or(pl.created_by<>a and m.role<>'admin') then raise exception 'FORBIDDEN_PLAN_OWNER';end if;
 if p->>'status' not in('paused','running','cancelled') or pl.status in('cancelled','complete') then raise exception 'PLAN_STATE';end if;
 update lab.plans set status=p->>'status' where id=pl.id;v=jsonb_build_object('id',pl.id,'status',p->>'status');
 else raise exception 'WRITE_ACTION_INVALID';end case;
 return jsonb_build_object('result',v,'resource_id',rid);
end $$;
