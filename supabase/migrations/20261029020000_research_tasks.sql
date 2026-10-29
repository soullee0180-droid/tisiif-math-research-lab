-- Optional ML design tasks. Legacy idea experiments retain their original stages.

alter table lab.runs add column variant text not null default 'standard' check(variant in('standard','swapped','control','flawed'));
alter table lab.runs drop constraint runs_plan_id_revision_id_generator_repeat_index_key;
alter table lab.runs add unique(plan_id,revision_id,generator,repeat_index,variant);
alter table lab.jobs drop constraint jobs_stage_check;
alter table lab.jobs add constraint jobs_stage_check check(stage in('generate','select','usefulness','agreement','research'));
create table lab.research_responses(workspace_id uuid not null references lab.workspaces,run_id uuid primary key references lab.runs,attempt_id uuid not null references lab.attempts,task_type text not null,body jsonb not null,mapping jsonb,created_at timestamptz not null default now());
create table lab.research_reviews(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references lab.workspaces,run_id uuid not null references lab.runs,reviewer_code text not null,phase text not null check(phase in('independent','consensus')),version_no integer not null default 1,body jsonb not null,created_at timestamptz not null default now(),unique(run_id,reviewer_code,phase,version_no));
create trigger immutable before update or delete on lab.research_responses for each row execute function lab_private.immutable();
create trigger immutable before update or delete on lab.research_reviews for each row execute function lab_private.immutable();
alter table lab.research_responses enable row level security;
alter table lab.research_reviews enable row level security;
grant all on lab.research_responses,lab.research_reviews to service_role;
revoke all on lab.research_responses,lab.research_reviews from anon,authenticated;


insert into lab_private.execution_bundles values('research-v1',$bundle${"version": "research-v1", "prompts": {"generation": "Propose an experiment design for the stated decision point. Explain your rationale and limitations. Do not invent results.", "discrimination": "Choose the better experiment design, A or B, and justify your choice. Do not assume either position is correct.", "anchoring": "Review the supplied preceding design step. Identify any methodological problem and provide a justified revised design. If it is valid, preserve it and explain why.", "review": "Review the supplied experiment design. List concrete methodological concerns, evidence in the supplied input, and a proposed fix for each. Do not invent unseen reviewer comments."}, "schemas": {"generation": {"type": "object", "properties": {"design_md": {"type": "string"}, "rationale_md": {"type": "string"}, "risks": {"type": "array", "items": {"type": "string"}}}, "required": ["design_md", "rationale_md", "risks"], "additionalProperties": false}, "discrimination": {"type": "object", "properties": {"choice": {"type": "string", "enum": ["A", "B"]}, "rationale_md": {"type": "string"}}, "required": ["choice", "rationale_md"], "additionalProperties": false}, "anchoring": {"type": "object", "properties": {"detects_problem": {"type": "boolean"}, "revised_design_md": {"type": "string"}, "rationale_md": {"type": "string"}}, "required": ["detects_problem", "revised_design_md", "rationale_md"], "additionalProperties": false}, "review": {"type": "object", "properties": {"critiques": {"type": "array", "items": {"type": "object", "properties": {"claim": {"type": "string"}, "evidence_in_input": {"type": "string"}, "proposed_fix": {"type": "string"}}, "required": ["claim", "evidence_in_input", "proposed_fix"], "additionalProperties": false}}}, "required": ["critiques"], "additionalProperties": false}}}$bundle$);

create or replace function lab_private.write_plans(w uuid,a uuid,action text,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m lab.members;h text;prior lab_private.idempotency_requests;v jsonb;rid uuid;pid uuid;cid uuid;ver integer;rev lab.checkpoint_revisions;pl lab.plans;gen text;judge text;rp integer;jid uuid;other text;item jsonb;k integer;rr integer;proto jsonb;models jsonb;dt timestamptz;budget lab_private.usage_budgets;cap jsonb;estimated_bytes bigint=0;max_output_bytes bigint=131072;chosen text[];n integer;reveal boolean;variant_name text;variants text[];
begin
 m=lab_private.actor(w,a);
 case action
 when 'plan_create' then
 perform lab_private.admit();
 if p ? 'selected_providers' then
  if jsonb_typeof(p->'selected_providers') is distinct from 'array' then raise exception 'PROVIDER_SELECTION_INVALID';end if;
  if exists(select 1 from jsonb_array_elements(p->'selected_providers') entry(value) where jsonb_typeof(entry.value)<>'string' or (entry.value#>>'{}') not in('google','openai','anthropic')) then raise exception 'PROVIDER_SELECTION_INVALID';end if;
  select array_agg(provider order by ord) into chosen from unnest(array['google','openai','anthropic']) with ordinality t(provider,ord) where p->'selected_providers' ? provider;
  if coalesce(cardinality(chosen),0)<>jsonb_array_length(p->'selected_providers') then raise exception 'PROVIDER_SELECTION_INVALID';end if;
 else chosen=array['google','openai','anthropic'];end if;
 n=coalesce(cardinality(chosen),0);if n<1 or n>3 then raise exception 'PROVIDER_SELECTION_INVALID';end if;
 if p ? 'reveal_generator_identity' and jsonb_typeof(p->'reveal_generator_identity') is distinct from 'boolean' then raise exception 'IDENTITY_OPTION_INVALID';end if;
 reveal=coalesce((p->>'reveal_generator_identity')::boolean,false);
 k=(p->>'k')::integer;rr=(p->>'repeats')::integer;if k not between 1 and 10 or rr not between 1 and 10 or jsonb_array_length(p->'revision_ids')<1 then raise exception 'PLAN_RANGE';end if;
 if p->>'transport'='api' then
  if not coalesce((select (settings->>'api_enabled')::boolean from lab.workspaces where id=w),false) then raise exception 'REAL_API_DISABLED';end if;
  foreach gen in array chosen loop
   select * into budget from lab_private.usage_budgets where workspace_id=w and provider=gen;if not found or not budget.enabled or budget.budget_usd<=budget.spent_usd+budget.reserved_usd or budget.org_verified_at is null or budget.org_verified_at<now()-interval '24 hours' then raise exception 'API_BUDGET_BLOCKED';end if;
   select to_jsonb(mp) into cap from lab.model_profiles mp where workspace_id=w and id=(p->'model_ids'->>gen)::uuid and provider=gen and enabled;if cap is null or cap->'capabilities'->>'text'<>'PASS' or cap->'capabilities'->>'json'<>'PASS' or cap->'capabilities'->>'within_100s' is distinct from 'PASS' or cap#>>'{capabilities,stages,generate,status}' is distinct from 'PASS' or cap#>>'{capabilities,stages,select,status}' is distinct from 'PASS' or cap#>>'{capabilities,stages,usefulness,status}' is distinct from 'PASS' or cap#>>'{capabilities,stages,agreement,status}' is distinct from 'PASS' then raise exception 'MODEL_CAPABILITY_BLOCKED';end if;
  end loop;
 end if;
 select body into proto from lab.protocol_versions where workspace_id=w order by created_at desc limit 1;if proto is null then raise exception 'PROTOCOL_NOT_CONFIGURED';end if;proto=proto||jsonb_build_object('candidate_count',k,'independent_repeats',rr,'protocol_id','tisiif-math-selected-v4','version',4,'scientific_rules_version',2,'selected_providers',to_jsonb(chosen),'reveal_generator_identity',reveal,'jobs_per_run',2*n,'stages',jsonb_build_array('generate','select','usefulness','agreement'),'judges','all other selected providers; no self-judging','candidate_usefulness','mean of all expected peer judges when all numeric; no judges means null','strict_core_match','all expected peer judges label core; no judges means null','primary_comparison','same revision and repeat with all selected generators eligible','metric_eligibility',jsonb_build_object('usefulness','all expected peer ratings numeric','agreement','all expected peer labels determinate','no_peer_judges','all peer-derived metrics null'),'stage_prompts',lab_private.stage_prompts(coalesce((select settings->'stage_prompts' from lab.workspaces where id=w),'{}')||coalesce(p->'stage_prompts','{}')));
 if reveal then proto=jsonb_set(proto,'{judge_blinding,usefulness_excludes}',coalesce(proto#>'{judge_blinding,usefulness_excludes}','[]')-array['generator_provider','generator_model']);proto=jsonb_set(proto,'{judge_blinding,agreement_excludes}',coalesce(proto#>'{judge_blinding,agreement_excludes}','[]')-array['generator_provider','generator_model']);end if;
 proto=proto||jsonb_build_object('execution_bundle',(select body from lab_private.execution_bundles where version='execution-v5'),'research_bundle',(select body from lab_private.execution_bundles where version='research-v1'));
 dt=coalesce((p->>'scheduled_at')::timestamptz,now());pid=gen_random_uuid();models=coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(p->'model_ids','{}')) where key=any(chosen)),'{}');
 insert into lab.plans(id,workspace_id,created_by,name,k,repeats,cohort,transport,scheduled_at,protocol,condition_hash) values(pid,w,a,p->>'name',k,rr,p->>'cohort',p->>'transport',dt,proto,lab_private.hash(jsonb_build_object('protocol',proto,'models',models,'transport',p->>'transport')));
 foreach gen in array chosen loop
 if p->>'transport'='api' then select to_jsonb(mp) into cap from lab.model_profiles mp where workspace_id=w and id=(models->>gen)::uuid;else cap=jsonb_build_object('provider',gen,'model_id',case when p->>'transport'='mock' then 'fixture-v3' else null end,'api_family',p->>'transport');end if;
 insert into lab.plan_models values(w,pid,gen,cap);end loop;
 for item in select value from jsonb_array_elements(p->'revision_ids') loop
 select * into rev from lab.checkpoint_revisions where workspace_id=w and id=(item#>>'{}')::uuid and status='approved';if not found then raise exception 'REVISION_NOT_APPROVED';end if;
 if p->>'cohort'='main' and exists(select 1 from lab.checkpoints c join lab.papers p0 on p0.id=c.paper_id where c.id=rev.checkpoint_id and p0.metadata->>'diagnostic'='true') then raise exception 'DIAGNOSTIC_EXCLUDED_FROM_MAIN';end if;
 if p->>'transport'='api' then select least(1048576,coalesce(max((snapshot->>'output_cap')::bigint*32),131072)) into max_output_bytes from lab.plan_models where plan_id=pid;estimated_bytes=estimated_bytes+(2*n*octet_length(rev.body::text)+(4*n-1)*max_output_bytes)*n*rr*3/2;if lab_private.storage_admitted()+estimated_bytes>800000000 then raise exception 'PLAN_RAW_STORAGE_ESTIMATE_BLOCKED';end if;end if;
 if rev.body->>'input_mode'='pdf' then perform lab_private.check_prepared(w,rev.body);end if;
 if rev.body->>'input_mode'='pdf' and p->>'transport'='api' then
  perform 1 from lab.plan_models where plan_id=pid and (snapshot->'capabilities'->>'pdf' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,generate,status}' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,select,status}' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,usefulness,status}' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,agreement,status}' is distinct from 'PASS');if found then raise exception 'PDF_CAPABILITY_BLOCKED';end if;
 end if;
 insert into lab.plan_inputs select w,pid,rev.id,c.paper_id,c.id,rev.body,rev.input_hash,rev.reference_hash from lab.checkpoints c where c.id=rev.checkpoint_id and c.workspace_id=w;
 if coalesce(rev.body->>'task_type','idea')<>'idea' then
 if coalesce(rev.body->>'task_type','') not in('generation','discrimination','anchoring','review') or coalesce(rev.body->>'decision_point','') not in('P1','P2','P3','P4','P5') or jsonb_array_length(coalesce(rev.body#>'{research,rubric}','[]'))=0 then raise exception 'RESEARCH_ITEM_INCOMPLETE';end if;
 variants=case rev.body->>'task_type' when 'discrimination' then array['standard','swapped'] when 'anchoring' then array['control','flawed'] else array['standard'] end;
 for rp in 1..rr loop foreach gen in array chosen loop foreach variant_name in array variants loop
 insert into lab.runs(workspace_id,plan_id,revision_id,generator,repeat_index,variant) values(w,pid,rev.id,gen,rp,variant_name) returning id into rid;
 insert into lab.jobs(workspace_id,run_id,plan_id,stage,provider,due_at) values(w,rid,pid,'research',gen,dt);
 end loop;end loop;end loop;
 else
 for rp in 1..rr loop foreach gen in array chosen loop
 insert into lab.runs(workspace_id,plan_id,revision_id,generator,repeat_index) values(w,pid,rev.id,gen,rp) returning id into rid;
 insert into lab.jobs(workspace_id,run_id,plan_id,stage,provider,due_at) values(w,rid,pid,'generate',gen,dt) returning id into jid;
 insert into lab.jobs(workspace_id,run_id,plan_id,stage,provider,depends_on,due_at) values(w,rid,pid,'select',gen,jid,dt);
 foreach judge in array chosen loop if judge<>gen then insert into lab.jobs(workspace_id,run_id,plan_id,stage,provider,depends_on,due_at) values(w,rid,pid,'usefulness',judge,jid,dt),(w,rid,pid,'agreement',judge,jid,dt);end if;end loop;
 end loop;end loop;end if;end loop;
 v=jsonb_build_object('id',pid);
 when 'plan_control' then
 select * into pl from lab.plans where workspace_id=w and id=(p->>'id')::uuid for update;if not found or(pl.created_by<>a and m.role<>'admin') then raise exception 'FORBIDDEN_PLAN_OWNER';end if;
 if p->>'status' not in('paused','running','cancelled') or pl.status in('cancelled','complete') then raise exception 'PLAN_STATE';end if;
 update lab.plans set status=p->>'status' where id=pl.id;v=jsonb_build_object('id',pl.id,'status',p->>'status');
 else raise exception 'WRITE_ACTION_INVALID';end case;
 return jsonb_build_object('result',v,'resource_id',rid);
end $$;

create or replace function public.lab_attempt(attempt uuid,command text,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$ declare at lab.attempts;j lab.jobs;rid uuid;pl lab.plans;row jsonb;canonical text;map jsonb;q lab_private.quota_reservations;begin
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
 if j.stage='research' then
 insert into lab.research_responses(workspace_id,run_id,attempt_id,task_type,body,mapping) select j.workspace_id,j.run_id,attempt,pi.snapshot->>'task_type',p->'parsed',at.request_snapshot->'mapping' from lab.plan_inputs pi join lab.runs r on r.plan_id=pi.plan_id and r.revision_id=pi.revision_id where r.id=j.run_id;
 elsif j.stage='generate' then
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
 if found and q.status in('held','unknown') then
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
 if at.send_started_at is null or p->>'safe_rejection'='true' or (p->>'confirmed_rejection'='true' and (p->>'http_status')::integer in(400,401,402,403,404,413,422,429)) then
  select * into q from lab_private.quota_reservations where attempt_id=attempt for update;
  if found and q.status in('held','unknown') then update lab_private.usage_budgets set reserved_usd=greatest(0,reserved_usd-q.reserved_usd) where workspace_id=j.workspace_id and provider=j.provider;update lab_private.quota_reservations set status='released' where id=q.id;end if;
 end if;
 when 'reparse_begin' then if j.attempt_no<>at.attempt_no or j.status not in('parse_failed','blocked','unknown_remote') then raise exception 'REPARSE_STATE';end if;if at.response_asset_id is null then raise exception 'STORED_RAW_REQUIRED';end if;update lab.jobs set status='running',lease_until=now()+interval '90 seconds' where id=j.id;
 else raise exception 'ATTEMPT_COMMAND_INVALID';end case;
 return jsonb_build_object('id',attempt);end $$;

create or replace function lab_private.analysis(w uuid,filters jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 with plans as(select * from lab.plans p where p.workspace_id=w and coalesce((p.protocol->>'diagnostic_only')::boolean,false)=false and (case when filters?'plan_ids' and jsonb_array_length(filters->'plan_ids')>0 then p.id in(select value::uuid from jsonb_array_elements_text(filters->'plan_ids')) else p.id=(select id from lab.plans where workspace_id=w and cohort=coalesce(filters->>'cohort','main') and transport=coalesce(filters->>'transport','api') order by created_at desc limit 1) end)),
 runs as(select r.*,p.k,p.cohort,p.transport,p.condition_hash,coalesce(p.protocol->'selected_providers','["google","openai","anthropic"]'::jsonb) selected_providers,coalesce((p.protocol->>'reveal_generator_identity')::boolean,false) reveal_generator_identity,pi.paper_id,pi.checkpoint_id,pi.snapshot->>'input_mode' input_mode,coalesce(pi.snapshot->>'task_type','idea') task_type,pi.snapshot->>'decision_point' decision_point from lab.runs r join plans p on p.id=r.plan_id join lab.plan_inputs pi on pi.plan_id=r.plan_id and pi.revision_id=r.revision_id where not coalesce((filters->>'external_share')::boolean,false) or exists(select 1 from lab.papers paper where paper.id=pi.paper_id and paper.workspace_id=w and paper.metadata->>'sharing_allowed'='true'))
 select jsonb_build_object('calculation_version','metrics-v5','filters',filters,'plans',coalesce((select jsonb_agg(to_jsonb(p)) from plans p),'[]'),
 'papers',coalesce((select jsonb_agg(to_jsonb(p)) from lab.papers p where p.workspace_id=w and p.id in(select paper_id from runs)),'[]'),
 'inputs',coalesce((select jsonb_agg(to_jsonb(pi)) from lab.plan_inputs pi where pi.workspace_id=w and pi.plan_id in(select id from plans)),'[]'),
 'models',coalesce((select jsonb_agg(to_jsonb(pm)) from lab.plan_models pm where pm.workspace_id=w and pm.plan_id in(select id from plans)),'[]'),
 'runs',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('research_response',(select to_jsonb(rr) from lab.research_responses rr where rr.run_id=r.id),'selected',(select candidate_id from lab.selections s where s.run_id=r.id),'selection',(select to_jsonb(s) from lab.selections s where s.run_id=r.id),
 'human_corrected',exists(select 1 from lab.attempts a join lab.jobs j on j.id=a.job_id where j.run_id=r.id and a.metadata->>'human_corrected'='true'),
 'ideas',coalesce((select jsonb_agg(to_jsonb(i)||i.body||jsonb_build_object('u',(select jsonb_agg(u.score order by u.judge) from lab.usefulness_ratings u where u.run_id=r.id and u.candidate_id=i.candidate_id),'match',(select jsonb_agg(g.label order by g.judge) from lab.agreement_ratings g where g.run_id=r.id and g.candidate_id=i.candidate_id),'usefulness',(select jsonb_agg(to_jsonb(u)) from lab.usefulness_ratings u where u.run_id=r.id and u.candidate_id=i.candidate_id),'agreement',(select jsonb_agg(to_jsonb(g)) from lab.agreement_ratings g where g.run_id=r.id and g.candidate_id=i.candidate_id))) from lab.ideas i where i.run_id=r.id),'[]'))) from runs r),'[]'),
 'jobs',coalesce((select jsonb_agg(to_jsonb(j)) from lab.jobs j where j.workspace_id=w and j.plan_id in(select id from plans)),'[]'),
 'attempts',coalesce((select jsonb_agg(to_jsonb(a)) from lab.attempts a join lab.jobs j on j.id=a.job_id where j.workspace_id=w and j.plan_id in(select id from plans)),'[]'),
 'assets',coalesce((select jsonb_agg(to_jsonb(a)) from lab.assets a where a.workspace_id=w and a.status='verified' and (a.id in(select request_asset_id from lab.attempts t join lab.jobs j on j.id=t.job_id where j.plan_id in(select id from plans)) or a.id in(select response_asset_id from lab.attempts t join lab.jobs j on j.id=t.job_id where j.plan_id in(select id from plans)) or a.id in(select (pi.snapshot->>'prepared_asset_id')::uuid from lab.plan_inputs pi where pi.plan_id in(select id from plans)))),'[]'),
 'research_reviews',coalesce((select jsonb_agg(to_jsonb(rr)) from lab.research_reviews rr where rr.workspace_id=w and rr.run_id in(select id from runs)),'[]'),
 'review_samples',coalesce((select jsonb_agg(to_jsonb(s)) from lab.review_samples s where s.workspace_id=w and exists(select 1 from lab.review_assignments ra join lab.ideas i on i.id=ra.idea_id where ra.sample_id=s.id and i.run_id in(select id from runs))),'[]'),
 'reviews',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('reviewer_id',ra.reviewer_id,'idea_id',ra.idea_id,'stratum',ra.stratum)) from lab.review_revisions v join lab.review_assignments ra on ra.id=v.assignment_id where v.workspace_id=w and ra.idea_id in(select id from lab.ideas where run_id in(select id from runs))),'[]')) $$;

create or replace function public.lab_research_reviews(w uuid,a uuid,plan_id uuid) returns jsonb language plpgsql set search_path='' as $$ begin perform lab_private.actor(w,a);return coalesce((select jsonb_agg(to_jsonb(rr)) from lab.research_reviews rr join lab.runs r on r.id=rr.run_id where rr.workspace_id=w and r.plan_id=lab_research_reviews.plan_id),'[]');end $$;
create or replace function public.lab_research_review_import(w uuid,a uuid,p jsonb,idem text) returns jsonb language plpgsql set search_path='' as $$
declare row jsonb;criterion jsonb;item jsonb;r lab.runs;v integer;code text;vphase text;prior lab_private.idempotency_requests;h text;result jsonb;n integer=0;begin
 perform lab_private.actor(w,a);if length(idem)<8 then raise exception 'IDEMPOTENCY_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||'review-import',0));h=lab_private.hash(p);
 select * into prior from lab_private.idempotency_requests where workspace_id=w and actor=a and key=idem;if found then if prior.payload_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;return prior.result;end if;
 code=trim(p->>'reviewer_code');vphase=p->>'phase';if coalesce(length(code),0)<2 or length(code)>100 or vphase not in('independent','consensus') or jsonb_typeof(p->'rows')<>'array' or jsonb_array_length(p->'rows')>1000 then raise exception 'REVIEW_IMPORT_INVALID';end if;
 for row in select value from jsonb_array_elements(p->'rows') loop
 select * into r from lab.runs where workspace_id=w and id=(row->>'run_id')::uuid;if not found or (not exists(select 1 from lab.research_responses where run_id=r.id) and not exists(select 1 from lab.ideas where run_id=r.id)) then raise exception 'REVIEW_RUN_NOT_READY';end if;
 select snapshot into item from lab.plan_inputs where plan_id=r.plan_id and revision_id=r.revision_id;
 if coalesce(item->>'task_type','idea')='idea' then
 item=jsonb_set(item,'{research}',jsonb_build_object('rubric',(select jsonb_agg(jsonb_build_object('id',candidate_id,'max_points',4)) from lab.ideas where run_id=r.id)));
 if exists(select 1 from lab.ideas i where i.run_id=r.id and coalesce(row#>>array['candidate_labels',i.candidate_id],'') not in('none','partial','core','undetermined')) then raise exception 'CANDIDATE_LABEL_REQUIRED';end if;end if;

 if vphase='consensus' and (select count(distinct reviewer_code) from lab.research_reviews rr where rr.run_id=r.id and rr.phase='independent' and version_no=1)<2 then raise exception 'TWO_INDEPENDENT_REVIEWS_REQUIRED';end if;
 for criterion in select value from jsonb_array_elements(item#>'{research,rubric}') loop
 if coalesce(row#>>array['scores',criterion->>'id'],'')!~'^[0-9]+$' or (row#>>array['scores',criterion->>'id'])::integer not between 0 and (criterion->>'max_points')::integer then raise exception 'RUBRIC_SCORE_INVALID';end if;end loop;
 if coalesce(length(trim(row->>'rationale')),0)<5 then raise exception 'REVIEW_RATIONALE_REQUIRED';end if;
 if item->>'task_type'='anchoring' and coalesce(row->>'anchor_outcome','') not in('corrected','followed','flagged_only','valid_preserved','other') then raise exception 'ANCHOR_OUTCOME_REQUIRED';end if;
 if item->>'task_type'='review' then
 if jsonb_typeof(row->'matched_evidence_ids') is distinct from 'array' or coalesce(row->>'false_positive_count','')!~'^[0-9]+$' then raise exception 'REVIEW_MATCHES_REQUIRED';end if;
 if exists(select 1 from jsonb_array_elements_text(row->'matched_evidence_ids') t(id) where not exists(select 1 from jsonb_array_elements(item#>'{research,evidence}') e where e->>'id'=t.id)) then raise exception 'UNKNOWN_EVIDENCE_ID';end if;
 if (row->>'false_positive_count')::integer>(select jsonb_array_length(body->'critiques') from lab.research_responses where run_id=r.id) then raise exception 'FALSE_POSITIVE_COUNT_INVALID';end if;end if;
 select coalesce(max(version_no),0)+1 into v from lab.research_reviews where run_id=r.id and reviewer_code=code and research_reviews.phase=vphase;
 if v>1 and coalesce(length(row->>'correction_reason'),0)<10 then raise exception 'CORRECTION_REASON_REQUIRED';end if;
 insert into lab.research_reviews(workspace_id,run_id,reviewer_code,phase,version_no,body) values(w,r.id,code,vphase,v,row);n=n+1;
 end loop;result=jsonb_build_object('imported',n);insert into lab_private.idempotency_requests values(w,a,idem,h,result,now());return result;
end $$;
revoke execute on function public.lab_research_reviews(uuid,uuid,uuid),public.lab_research_review_import(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.lab_research_reviews(uuid,uuid,uuid),public.lab_research_review_import(uuid,uuid,jsonb,text) to service_role;
notify pgrst,'reload schema';

-- SQL accounting for the constructed request, immediately before sending.
create function public.lab_admit_request(attempt uuid,input_bytes bigint,pdf_pages integer) returns boolean language plpgsql set search_path='' as $$
declare j lab.jobs;m jsonb;q lab_private.quota_reservations;pr lab_private.provider_runtime;tokens bigint;needed numeric;begin
 select j0.* into j from lab.jobs j0 join lab.attempts a on a.job_id=j0.id where a.id=attempt;
 select * into pr from lab_private.provider_runtime where provider=j.provider for update;
 if pr.paused or pr.blocked_reason is not null or not coalesce((select(settings->>'api_enabled')::boolean from lab.workspaces where id=j.workspace_id),false) then raise exception 'PROVIDER_PAUSED';end if;
 select * into q from lab_private.quota_reservations where attempt_id=attempt for update;
 if q.id is null or q.status<>'held' then raise exception 'RESERVATION_REQUIRED';end if;
 select snapshot into m from lab.plan_models where plan_id=j.plan_id and provider=j.provider;
 tokens=ceil((input_bytes+pdf_pages*4096+128)*1.25)+coalesce((m->>'output_cap')::integer,1000);
 needed=((tokens-coalesce((m->>'output_cap')::integer,1000))*coalesce((m#>>'{pricing,input_per_million}')::numeric,0)+coalesce((m->>'output_cap')::integer,1000)*coalesce((m#>>'{pricing,output_per_million}')::numeric,0))/1000000;
 if needed>q.reserved_usd then raise exception 'REQUEST_COST_CAP_TOO_LOW';end if;
 if tokens>pr.tpm then raise exception 'TPM_CAP_TOO_LOW';end if;
 if coalesce((select sum(estimated_tokens) from lab_private.quota_reservations where provider=j.provider and created_at>now()-interval '1 minute' and id<>q.id),0)+tokens>pr.tpm then raise exception 'TPM_WINDOW_FULL';end if;
 update lab_private.quota_reservations set estimated_tokens=tokens where id=q.id;return true;
end $$;
revoke execute on function public.lab_admit_request(uuid,bigint,integer) from public,anon,authenticated;
grant execute on function public.lab_admit_request(uuid,bigint,integer) to service_role;
notify pgrst,'reload schema';

create or replace function lab_private.write_research(w uuid,a uuid,action text,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m lab.members;h text;prior lab_private.idempotency_requests;v jsonb;rid uuid;pid uuid;cid uuid;ver integer;rev lab.checkpoint_revisions;pl lab.plans;gen text;judge text;rp integer;jid uuid;other text;item jsonb;k integer;rr integer;proto jsonb;models jsonb;dt timestamptz;budget lab_private.usage_budgets;cap jsonb;estimated_bytes bigint=0;max_output_bytes bigint=131072;
begin
 m=lab_private.actor(w,a);
 case action
 when 'analysis_create' then
 v=lab_private.analysis(w,p);if pg_database_size(current_database())+octet_length(v::text)*2>400000000 then raise exception 'DB_SNAPSHOT_CAPACITY';end if;
 insert into lab.analysis_snapshots(workspace_id,filters,body,sha256,created_by) values(w,p,v,lab_private.hash(v),a) returning id into rid;v=jsonb_build_object('id',rid,'sha256',(select sha256 from lab.analysis_snapshots where id=rid));
 when 'review_submit' then
 perform 1 from lab.review_assignments where workspace_id=w and id=(p->>'id')::uuid and reviewer_id=a;if not found then raise exception 'FORBIDDEN';end if;
 if p->>'phase'='agreement' and not exists(select 1 from lab.review_revisions where assignment_id=(p->>'id')::uuid and phase='usefulness') then raise exception 'USEFULNESS_FIRST';end if;
 if p->>'phase'='usefulness' and (not(p->'body'?'score') or (p->'body'->>'score')::integer not between 0 and 4) then raise exception 'SCORE_RANGE';end if;
 if p->>'phase'='agreement' and p->'body'->>'label' not in('none','partial','core','undetermined') then raise exception 'LABEL_INVALID';end if;
 select coalesce(max(version_no),0)+1 into ver from lab.review_revisions where assignment_id=(p->>'id')::uuid and phase=p->>'phase';if ver>1 and length(p->'body'->>'correction_reason')<10 then raise exception 'CORRECTION_REASON_REQUIRED';end if;
 insert into lab.review_revisions(workspace_id,assignment_id,phase,version_no,body,created_by) values(w,(p->>'id')::uuid,p->>'phase',ver,p->'body',a) returning id into rid;v=jsonb_build_object('id',rid);
 when 'backup_create' then perform lab_private.actor(w,a,true);v=lab_private.backup(w);if pg_database_size(current_database())+octet_length(v::text)*2>400000000 then raise exception 'BACKUP_DB_CAPACITY';end if;insert into lab.backup_manifests(workspace_id,body,created_by) values(w,v,a) returning id into rid;v=jsonb_build_object('id',rid,'workspace',v->'workspace','format','tisiif-backup-v3');
 when 'backup_downloaded' then perform lab_private.actor(w,a,true);if p->>'all_parts_downloaded'<>'true' then raise exception 'DOWNLOAD_CONFIRMATION_REQUIRED';end if;update lab.backup_manifests set status='downloaded',downloaded_at=now() where workspace_id=w and id=(p->>'id')::uuid and created_by=a;v=jsonb_build_object('saved',true);
 else raise exception 'WRITE_ACTION_INVALID';end case;
 return jsonb_build_object('result',v,'resource_id',rid);
end $$;

create or replace function public.lab_recover() returns integer language plpgsql security invoker set search_path='' as $$ declare j lab.jobs;at lab.attempts;n integer=0;begin
 if not pg_try_advisory_xact_lock(610242) then return 0;end if;perform 1 from lab_private.provider_runtime order by provider for update;
 for j in select * from lab.jobs where status='running' and lease_until<now() and plan_id in(select id from lab.plans where transport<>'manual_web') for update skip locked loop
 select * into at from lab.attempts where job_id=j.id and attempt_no=j.attempt_no;
 update lab.jobs set status=case when at.response_asset_id is not null then 'parse_failed' when at.send_started_at is not null then 'unknown_remote' else 'queued' end,last_error=case when at.send_started_at is not null and at.response_asset_id is null then 'unknown_remote' else 'STALE_LEASE' end,lease_until=null where id=j.id;
 if at.send_started_at is null then update lab_private.usage_budgets b set reserved_usd=greatest(0,b.reserved_usd-q.reserved_usd) from lab_private.quota_reservations q where q.attempt_id=at.id and q.status='held' and b.workspace_id=j.workspace_id and b.provider=j.provider;update lab_private.quota_reservations set status='released' where attempt_id=at.id and status='held';end if;if at.response_asset_id is not null or at.send_started_at is not null then perform public.lab_smoke_result(at.id);end if;n=n+1;
 end loop;return n;end $$;
