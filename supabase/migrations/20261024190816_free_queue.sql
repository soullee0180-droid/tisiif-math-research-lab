create function public.lab_claim(provider_name text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare pr lab_private.provider_runtime;j lab.jobs;pl lab.plans;at lab.attempts;b lab_private.usage_budgets;model jsonb;tokens bigint;cost numeric;begin
 select * into pr from lab_private.provider_runtime where provider=provider_name for update;if not found or pr.paused or pr.blocked_reason is not null or pr.next_allowed_at>now() or pr.last_claim+pr.min_interval_ms*interval '1 millisecond'>now() then return null;end if;
 if exists(select 1 from lab.jobs jj join lab.plans pp on pp.id=jj.plan_id where jj.provider=provider_name and jj.status='running' and pp.transport<>'manual_web') then return null;end if;
 if(select count(*) from lab_private.quota_reservations where provider=provider_name and created_at>now()-interval '1 minute')>=pr.rpm then return null;end if;
 select j0.* into j from lab.jobs j0 join lab.plans p on p.workspace_id=j0.workspace_id and p.id=j0.plan_id join lab.workspaces ws on ws.id=p.workspace_id left join lab_private.plan_fairness fair on fair.plan_id=p.id
 where j0.provider=provider_name and j0.status='queued' and j0.due_at<=now() and p.status='running' and p.scheduled_at<=now() and p.transport<>'manual_web' and ws.active and(j0.depends_on is null or exists(select 1 from lab.jobs parent where parent.id=j0.depends_on and parent.status='complete'))
 order by case when j0.plan_id=pr.last_plan then 1 else 0 end,coalesce(fair.last_claimed_at,'1970-01-01'),j0.created_at,j0.id for update of j0 skip locked limit 1;
 if not found then return null;end if;select * into pl from lab.plans where id=j.plan_id;select snapshot into model from lab.plan_models where plan_id=pl.id and provider=provider_name;
 tokens=coalesce((model->>'output_cap')::integer,1000)+20000;cost=0;perform pg_advisory_xact_lock(610241);if lab_private.storage_admitted()+2097152>800000000 then update lab.jobs set status='blocked',last_error='RESPONSE_STORAGE_RESERVATION_BLOCKED' where id=j.id;return null;end if;
 if pl.transport='api' then
  if not coalesce((select (settings->>'api_enabled')::boolean from lab.workspaces where id=j.workspace_id),false) then return null;end if;
  select * into b from lab_private.usage_budgets where workspace_id=j.workspace_id and provider=provider_name for update;
  cost=(model->'pricing'->>'max_request_usd')::numeric;
  if cost is null or cost<=0 or not b.enabled or b.org_verified_at is null or b.org_verified_at<now()-interval '24 hours' or b.spent_usd+b.reserved_usd+cost>b.budget_usd then update lab.jobs set status='blocked',last_error='API_BUDGET_BLOCKED' where id=j.id;return null;end if;
 end if;
 if coalesce((select sum(estimated_tokens) from lab_private.quota_reservations where provider=provider_name and created_at>now()-interval '1 minute'),0)+tokens>pr.tpm then return null;end if;
 update lab.jobs set status='running',lease_until=now()+interval '90 seconds',attempt_no=attempt_no+1 where id=j.id returning * into j;
 insert into lab.attempts(workspace_id,job_id,attempt_no) values(j.workspace_id,j.id,j.attempt_no) returning * into at;
 insert into lab_private.quota_reservations(provider,job_id,attempt_id,estimated_tokens,reserved_usd,reserved_storage_bytes) values(provider_name,j.id,at.id,tokens,cost,2097152);
 if cost>0 then update lab_private.usage_budgets set reserved_usd=reserved_usd+cost where workspace_id=j.workspace_id and provider=provider_name;end if;
 insert into lab_private.plan_fairness(plan_id,last_claimed_at) values(j.plan_id,now()) on conflict(plan_id) do update set last_claimed_at=excluded.last_claimed_at;
 update lab_private.provider_runtime set last_claim=now(),last_plan=j.plan_id where provider=provider_name;
 return jsonb_build_object('job_id',j.id,'attempt_id',at.id,'workspace_id',j.workspace_id);end $$;
create function public.lab_context(attempt uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('attempt',to_jsonb(a),'job',to_jsonb(j),'run',to_jsonb(r),'plan',to_jsonb(p),'revision',pi.snapshot,'model',pm.snapshot,'secret',(select to_jsonb(s) from lab_private.provider_secrets s where s.workspace_id=p.workspace_id and s.provider=j.provider),'ideas',coalesce((select jsonb_agg(i.body order by candidate_id) from lab.ideas i where i.run_id=r.id),'[]')) from lab.attempts a join lab.jobs j on j.workspace_id=a.workspace_id and j.id=a.job_id join lab.runs r on r.id=j.run_id join lab.plans p on p.id=r.plan_id join lab.plan_inputs pi on pi.plan_id=p.id and pi.revision_id=r.revision_id join lab.plan_models pm on pm.plan_id=p.id and pm.provider=j.provider where a.id=attempt $$;
create function public.lab_heartbeat(attempt uuid) returns boolean language plpgsql security invoker set search_path='' as $$ begin update lab.jobs j set lease_until=now()+interval '90 seconds' from lab.attempts a where a.id=attempt and a.job_id=j.id and a.completed_at is null and j.status='running' and j.attempt_no=a.attempt_no;return found;end $$;
create function public.lab_attempt(attempt uuid,command text,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$ declare at lab.attempts;j lab.jobs;rid uuid;pl lab.plans;row jsonb;canonical text;map jsonb;q lab_private.quota_reservations;begin
 select provider into canonical from lab.jobs where id=(select job_id from lab.attempts where id=attempt);perform 1 from lab_private.provider_runtime where provider=canonical for update;
 select * into at from lab.attempts where id=attempt for update;if not found then raise exception 'ATTEMPT_NOT_FOUND';end if;select * into j from lab.jobs where id=at.job_id for update;select * into pl from lab.plans where id=j.plan_id;
 if command='complete' and at.completed_at is not null then return jsonb_build_object('complete',true);end if;
 if at.completed_at is not null then raise exception 'IMMUTABLE_ATTEMPT';end if;
 case command
 when 'request' then if at.send_started_at is not null then raise exception 'ALREADY_SENT';end if;update lab.attempts set request_snapshot=p->'snapshot',request_asset_id=(p->>'asset_id')::uuid,milestone='request_prepared' where id=attempt;
 when 'send' then if at.request_asset_id is null or at.send_started_at is not null then raise exception 'SEND_STATE';end if;update lab.attempts set milestone='send_started',send_started_at=now() where id=attempt;
 when 'response' then
 update lab_private.quota_reservations set reserved_storage_bytes=0 where attempt_id=attempt;
 if at.response_asset_id is not null then if at.response_hash<>p->>'sha256' then raise exception 'RAW_CONFLICT';end if;else update lab.attempts set response_asset_id=(p->>'asset_id')::uuid,response_hash=p->>'sha256',response_stored_at=now(),milestone='response_stored',metadata=metadata||coalesce(p->'metadata','{}') where id=attempt;end if;
 when 'complete' then
 if at.response_asset_id is null or at.request_snapshot is null then raise exception 'RAW_REQUIRED';end if;map=at.request_snapshot->'mapping'->'display_to_canonical';
 if j.stage='generate' then
  if jsonb_array_length(p->'parsed'->'ideas')<>pl.k then raise exception 'CANDIDATE_COUNT';end if;
  for row in select value from jsonb_array_elements(p->'parsed'->'ideas') loop insert into lab.ideas(workspace_id,run_id,candidate_id,body,anonymization_diff) values(j.workspace_id,j.run_id,row->>'candidate_id',row,p->'anonymization_diff');end loop;
 elsif j.stage='select' then
  canonical=map->>(p->'parsed'->>'selected_candidate_id');if canonical is null then raise exception 'MAPPING_REQUIRED';end if;
  insert into lab.selections values(j.workspace_id,j.run_id,canonical,p->'parsed',attempt);
 else
  if j.provider=(select generator from lab.runs where id=j.run_id) then raise exception 'SELF_JUDGE_FORBIDDEN';end if;
  if jsonb_array_length(p->'parsed'->'ratings')<>pl.k then raise exception 'RATING_COUNT';end if;
  for row in select value from jsonb_array_elements(p->'parsed'->'ratings') loop canonical=map->>(row->>'candidate_id');if canonical is null then raise exception 'MAPPING_REQUIRED';end if;
   if j.stage='usefulness' then insert into lab.usefulness_ratings values(j.workspace_id,j.run_id,canonical,j.provider,(row->>'score')::integer,row,attempt);else insert into lab.agreement_ratings values(j.workspace_id,j.run_id,canonical,j.provider,row->>'label',row,attempt);end if;
  end loop;
 end if;
 update lab.attempts set parsed=p->'parsed',completed_at=now(),milestone='complete',metadata=metadata||coalesce(p->'metadata','{}') where id=attempt;update lab.jobs set status='complete',lease_until=null,last_error=null where id=j.id;
 update lab_private.provider_runtime set last_success=now() where provider=j.provider;
 select * into q from lab_private.quota_reservations where attempt_id=attempt for update;
 if found then
  if pl.transport='mock' or p->'metadata'->>'cost_usd' is not null then
   update lab_private.quota_reservations set status='settled',actual_tokens=(p->'metadata'->>'total_tokens')::bigint,actual_usd=coalesce((p->'metadata'->>'cost_usd')::numeric,0) where id=q.id;
   update lab_private.usage_budgets set reserved_usd=greatest(0,reserved_usd-q.reserved_usd),spent_usd=spent_usd+coalesce((p->'metadata'->>'cost_usd')::numeric,0) where workspace_id=j.workspace_id and provider=j.provider;
  else update lab_private.quota_reservations set status='unknown' where id=q.id;end if;
 end if;
 if not exists(select 1 from lab.jobs where plan_id=j.plan_id and status<>'complete') then update lab.plans set status='complete' where id=j.plan_id;end if;
 when 'fail' then
 canonical=p->>'class';if canonical not in('credential_blocked','payment_blocked','permission_blocked','rate_transient','quota_daily','spend_blocked','quota_unknown','input_size','model_or_input','unknown_remote','parse_failed','storage_failed','cancelled') then raise exception 'FAILURE_CLASS_INVALID';end if;
 update lab.jobs set status=case when canonical='parse_failed' then 'parse_failed' when canonical='unknown_remote' then 'unknown_remote' when canonical='rate_transient' and p->>'safe_rejection'='true' and j.attempt_no<4 then 'queued' else 'blocked' end,last_error=canonical,due_at=greatest(now()+case j.attempt_no when 1 then interval '10 seconds' when 2 then interval '30 seconds' else interval '90 seconds' end,coalesce((p->>'retry_after')::timestamptz,now())),lease_until=null where id=j.id;
 update lab.attempts set milestone=canonical,metadata=metadata||jsonb_build_object('failure',p) where id=attempt;
 if canonical in('credential_blocked','payment_blocked','permission_blocked','quota_daily','spend_blocked','quota_unknown') then update lab_private.provider_runtime set blocked_reason=canonical where provider=j.provider;end if;
 if at.send_started_at is null or p->>'safe_rejection'='true' then
  select * into q from lab_private.quota_reservations where attempt_id=attempt for update;
  if found and q.status='held' then update lab_private.usage_budgets set reserved_usd=greatest(0,reserved_usd-q.reserved_usd) where workspace_id=j.workspace_id and provider=j.provider;update lab_private.quota_reservations set status='released' where id=q.id;end if;
 end if;
 when 'reparse_begin' then if at.response_asset_id is null then raise exception 'STORED_RAW_REQUIRED';end if;update lab.jobs set status='running',lease_until=now()+interval '90 seconds' where id=j.id;
 else raise exception 'ATTEMPT_COMMAND_INVALID';end case;
 return jsonb_build_object('id',attempt);end $$;
create function public.lab_raw_reserve(attempt uuid,bytes_count bigint,hash text,direction text) returns jsonb language plpgsql security invoker set search_path='' as $$ declare at lab.attempts;rid uuid;v jsonb;begin
 select * into at from lab.attempts where id=attempt;if not found or at.completed_at is not null or direction not in('request','response') then raise exception 'RAW_STATE';end if;
 perform pg_advisory_xact_lock(610241);update lab_private.quota_reservations set reserved_storage_bytes=greatest(0,reserved_storage_bytes-bytes_count) where attempt_id=attempt and status='held';if lab_private.storage_admitted()+bytes_count>800000000 then raise exception 'STORAGE_CAPACITY';end if;
 rid=gen_random_uuid();insert into lab.assets(id,workspace_id,kind,path,bytes,sha256,created_by) values(rid,at.workspace_id,'raw',at.workspace_id::text||'/'||rid::text||'/'||direction||'.json',bytes_count,hash,(select created_by from lab.plans where id=(select plan_id from lab.jobs where id=at.job_id)));select to_jsonb(s) into v from lab.assets s where id=rid;return v;end $$;
create function public.lab_raw_verified(asset uuid) returns boolean language plpgsql security invoker set search_path='' as $$ begin update lab.assets set status='verified',server_hash=true where id=asset and kind='raw';return found;end $$;
create function public.lab_recover() returns integer language plpgsql security invoker set search_path='' as $$ declare j lab.jobs;at lab.attempts;n integer=0;begin
 if not pg_try_advisory_xact_lock(610242) then return 0;end if;perform 1 from lab_private.provider_runtime order by provider for update;
 for j in select * from lab.jobs where status='running' and lease_until<now() and plan_id in(select id from lab.plans where transport<>'manual_web') for update skip locked loop
 select * into at from lab.attempts where job_id=j.id and attempt_no=j.attempt_no;
 update lab.jobs set status=case when at.response_asset_id is not null then 'parse_failed' when at.send_started_at is not null then 'unknown_remote' else 'queued' end,last_error=case when at.send_started_at is not null and at.response_asset_id is null then 'unknown_remote' else 'STALE_LEASE' end,lease_until=null where id=j.id;
 if at.send_started_at is null then update lab_private.usage_budgets b set reserved_usd=greatest(0,b.reserved_usd-q.reserved_usd) from lab_private.quota_reservations q where q.attempt_id=at.id and q.status='held' and b.workspace_id=j.workspace_id and b.provider=j.provider;update lab_private.quota_reservations set status='released' where attempt_id=at.id and status='held';end if;n=n+1;
 end loop;return n;end $$;
create function public.lab_manual_begin(w uuid,a uuid,job uuid) returns uuid language plpgsql security invoker set search_path='' as $$ declare j lab.jobs;at uuid;pl lab.plans;begin
 perform lab_private.actor(w,a);select * into j from lab.jobs where workspace_id=w and id=job for update;if not found then raise exception 'NOT_FOUND';end if;select * into pl from lab.plans where id=j.plan_id;
 if pl.transport<>'manual_web' or pl.status<>'running' or pl.scheduled_at>now() or(pl.created_by<>a and (lab_private.actor(w,a)).role<>'admin') then raise exception 'MANUAL_STATE';end if;
 if j.depends_on is not null and not exists(select 1 from lab.jobs where id=j.depends_on and status='complete') then raise exception 'GENERATE_FIRST';end if;
 if j.status in('running','parse_failed','complete') then select id into at from lab.attempts where job_id=j.id and attempt_no=j.attempt_no;return at;end if;
 if j.status<>'queued' then raise exception 'MANUAL_STATE';end if;
 update lab.jobs set status='running',lease_until=now()+interval '90 seconds',attempt_no=attempt_no+1 where id=job returning * into j;
 insert into lab.attempts(workspace_id,job_id,attempt_no) values(w,job,j.attempt_no) returning id into at;return at;end $$;
create function public.lab_authorize_attempt(w uuid,a uuid,attempt uuid) returns boolean language plpgsql security invoker set search_path='' as $$ declare m lab.members;begin m=lab_private.actor(w,a);perform 1 from lab.attempts t join lab.jobs j on j.id=t.job_id join lab.plans p on p.id=j.plan_id where t.id=attempt and t.workspace_id=w and (p.created_by=a or m.role='admin');if not found then raise exception 'FORBIDDEN_PLAN_OWNER';end if;return true;end $$;
create function public.lab_reconcile(w uuid,a uuid,job uuid,evidence text,decision text) returns jsonb language plpgsql security invoker set search_path='' as $$ declare m lab.members;j lab.jobs;begin
 m=lab_private.actor(w,a);select * into j from lab.jobs where workspace_id=w and id=job;if not found then raise exception 'NOT_FOUND';end if;
 perform 1 from lab_private.provider_runtime where provider=j.provider for update;perform 1 from lab.jobs where id=job for update;
 if length(evidence)<10 or not exists(select 1 from lab.plans where id=j.plan_id and(created_by=a or m.role='admin')) then raise exception 'RECONCILIATION_EVIDENCE_REQUIRED';end if;
 if j.status not in('unknown_remote','blocked') or decision not in('confirm_not_processed','mark_failed') then raise exception 'RECONCILIATION_STATE';end if;
 if decision='confirm_not_processed' then
 update lab_private.usage_budgets b set reserved_usd=greatest(0,b.reserved_usd-q.reserved_usd) from lab_private.quota_reservations q where q.job_id=j.id and q.status in('held','unknown') and b.workspace_id=w and b.provider=j.provider;update lab_private.quota_reservations set status='released' where job_id=j.id and status in('held','unknown');end if;
 update lab.jobs set status=case when decision='confirm_not_processed' then 'queued' else 'failed' end,last_error='HUMAN_RECONCILED',due_at=now() where id=job;
 insert into lab.audit_events(workspace_id,actor,action,resource_id,body) values(w,a,'reconcile',job,jsonb_build_object('decision',decision,'evidence',evidence));return jsonb_build_object('saved',true);end $$;
create function public.lab_nonce(value uuid) returns boolean language plpgsql security invoker set search_path='' as $$ begin delete from lab_private.internal_nonces where created_at<now()-interval '10 minutes';insert into lab_private.internal_nonces(nonce) values(value) on conflict do nothing;return found;end $$;
create function public.lab_server_config() returns jsonb language sql stable security invoker set search_path='' as $$ select jsonb_build_object('origin',settings->>'app_origin','scheduler_enabled',settings->'scheduler_enabled') from lab.workspaces where active limit 1 $$;
create function public.lab_usage(bytes_count bigint default 0) returns boolean language plpgsql security invoker set search_path='' as $$ begin update lab_private.scheduler_state set egress_bytes=case when month<>to_char(now(),'YYYY-MM') then bytes_count else egress_bytes+bytes_count end,edge_calls=case when month<>to_char(now(),'YYYY-MM') then 1 else edge_calls+1 end,month=to_char(now(),'YYYY-MM');return true;end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'lab_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
