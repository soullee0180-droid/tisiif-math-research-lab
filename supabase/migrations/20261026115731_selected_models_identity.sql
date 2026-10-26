-- Selected providers and identity disclosure are immutable per-plan conditions.
create or replace function lab_private.write_plans(w uuid,a uuid,action text,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m lab.members;h text;prior lab_private.idempotency_requests;v jsonb;rid uuid;pid uuid;cid uuid;ver integer;rev lab.checkpoint_revisions;pl lab.plans;gen text;judge text;rp integer;jid uuid;other text;item jsonb;k integer;rr integer;proto jsonb;models jsonb;dt timestamptz;budget lab_private.usage_budgets;cap jsonb;estimated_bytes bigint=0;max_output_bytes bigint=131072;chosen text[];n integer;reveal boolean;
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
 dt=coalesce((p->>'scheduled_at')::timestamptz,now());pid=gen_random_uuid();models=coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(p->'model_ids','{}')) where key=any(chosen)),'{}');
 insert into lab.plans(id,workspace_id,created_by,name,k,repeats,cohort,transport,scheduled_at,protocol,condition_hash) values(pid,w,a,p->>'name',k,rr,p->>'cohort',p->>'transport',dt,proto,lab_private.hash(jsonb_build_object('protocol',proto,'models',models,'transport',p->>'transport')));
 foreach gen in array chosen loop
 if p->>'transport'='api' then select to_jsonb(mp) into cap from lab.model_profiles mp where workspace_id=w and id=(models->>gen)::uuid;else cap=jsonb_build_object('provider',gen,'model_id',case when p->>'transport'='mock' then 'fixture-v3' else null end,'api_family',p->>'transport');end if;
 insert into lab.plan_models values(w,pid,gen,cap);end loop;
 for item in select value from jsonb_array_elements(p->'revision_ids') loop
 select * into rev from lab.checkpoint_revisions where workspace_id=w and id=(item#>>'{}')::uuid and status='approved';if not found then raise exception 'REVISION_NOT_APPROVED';end if;
 if p->>'transport'='api' then select least(1048576,coalesce(max((snapshot->>'output_cap')::bigint*32),131072)) into max_output_bytes from lab.plan_models where plan_id=pid;estimated_bytes=estimated_bytes+(2*n*octet_length(rev.body::text)+(4*n-1)*max_output_bytes)*n*rr*3/2;if lab_private.storage_admitted()+estimated_bytes>800000000 then raise exception 'PLAN_RAW_STORAGE_ESTIMATE_BLOCKED';end if;end if;
 if rev.body->>'input_mode'='pdf' and p->>'transport'='api' then
  perform 1 from lab.plan_models where plan_id=pid and (snapshot->'capabilities'->>'pdf' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,generate,status}' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,select,status}' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,usefulness,status}' is distinct from 'PASS' or snapshot#>>'{capabilities,pdf_stages,agreement,status}' is distinct from 'PASS');if found then raise exception 'PDF_CAPABILITY_BLOCKED';end if;
 end if;
 insert into lab.plan_inputs select w,pid,rev.id,c.paper_id,c.id,rev.body,rev.input_hash,rev.reference_hash from lab.checkpoints c where c.id=rev.checkpoint_id and c.workspace_id=w;
 for rp in 1..rr loop foreach gen in array chosen loop
 insert into lab.runs(workspace_id,plan_id,revision_id,generator,repeat_index) values(w,pid,rev.id,gen,rp) returning id into rid;
 insert into lab.jobs(workspace_id,run_id,plan_id,stage,provider,due_at) values(w,rid,pid,'generate',gen,dt) returning id into jid;
 insert into lab.jobs(workspace_id,run_id,plan_id,stage,provider,depends_on,due_at) values(w,rid,pid,'select',gen,jid,dt);
 foreach judge in array chosen loop if judge<>gen then insert into lab.jobs(workspace_id,run_id,plan_id,stage,provider,depends_on,due_at) values(w,rid,pid,'usefulness',judge,jid,dt),(w,rid,pid,'agreement',judge,jid,dt);end if;end loop;
 end loop;end loop;end loop;
 v=jsonb_build_object('id',pid);
 when 'plan_control' then
 select * into pl from lab.plans where workspace_id=w and id=(p->>'id')::uuid for update;if not found or(pl.created_by<>a and m.role<>'admin') then raise exception 'FORBIDDEN_PLAN_OWNER';end if;
 if p->>'status' not in('paused','running','cancelled') or pl.status in('cancelled','complete') then raise exception 'PLAN_STATE';end if;
 update lab.plans set status=p->>'status' where id=pl.id;v=jsonb_build_object('id',pl.id,'status',p->>'status');
 else raise exception 'WRITE_ACTION_INVALID';end case;
 return jsonb_build_object('result',v,'resource_id',rid);
end $$;

create or replace function lab_private.analysis(w uuid,filters jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 with plans as(select * from lab.plans p where p.workspace_id=w and (case when filters?'plan_ids' and jsonb_array_length(filters->'plan_ids')>0 then p.id in(select value::uuid from jsonb_array_elements_text(filters->'plan_ids')) else p.id=(select id from lab.plans where workspace_id=w and cohort=coalesce(filters->>'cohort','main') and transport=coalesce(filters->>'transport','api') order by created_at desc limit 1) end)),
 runs as(select r.*,p.k,p.cohort,p.transport,p.condition_hash,coalesce(p.protocol->'selected_providers','["google","openai","anthropic"]'::jsonb) selected_providers,coalesce((p.protocol->>'reveal_generator_identity')::boolean,false) reveal_generator_identity,pi.paper_id,pi.checkpoint_id,pi.snapshot->>'input_mode' input_mode from lab.runs r join plans p on p.id=r.plan_id join lab.plan_inputs pi on pi.plan_id=r.plan_id and pi.revision_id=r.revision_id where not coalesce((filters->>'external_share')::boolean,false) or exists(select 1 from lab.papers paper where paper.id=pi.paper_id and paper.workspace_id=w and paper.metadata->>'sharing_allowed'='true'))
 select jsonb_build_object('calculation_version','metrics-v3.3-selected-providers','filters',filters,'plans',coalesce((select jsonb_agg(to_jsonb(p)) from plans p),'[]'),
 'papers',coalesce((select jsonb_agg(to_jsonb(p)) from lab.papers p where p.workspace_id=w and p.id in(select paper_id from runs)),'[]'),
 'inputs',coalesce((select jsonb_agg(to_jsonb(pi)) from lab.plan_inputs pi where pi.workspace_id=w and pi.plan_id in(select id from plans)),'[]'),
 'models',coalesce((select jsonb_agg(to_jsonb(pm)) from lab.plan_models pm where pm.workspace_id=w and pm.plan_id in(select id from plans)),'[]'),
 'runs',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('selected',(select candidate_id from lab.selections s where s.run_id=r.id),'selection',(select to_jsonb(s) from lab.selections s where s.run_id=r.id),
 'human_corrected',exists(select 1 from lab.attempts a join lab.jobs j on j.id=a.job_id where j.run_id=r.id and a.metadata->>'human_corrected'='true'),
 'ideas',coalesce((select jsonb_agg(to_jsonb(i)||i.body||jsonb_build_object('u',(select jsonb_agg(u.score order by u.judge) from lab.usefulness_ratings u where u.run_id=r.id and u.candidate_id=i.candidate_id),'match',(select jsonb_agg(g.label order by g.judge) from lab.agreement_ratings g where g.run_id=r.id and g.candidate_id=i.candidate_id),'usefulness',(select jsonb_agg(to_jsonb(u)) from lab.usefulness_ratings u where u.run_id=r.id and u.candidate_id=i.candidate_id),'agreement',(select jsonb_agg(to_jsonb(g)) from lab.agreement_ratings g where g.run_id=r.id and g.candidate_id=i.candidate_id))) from lab.ideas i where i.run_id=r.id),'[]'))) from runs r),'[]'),
 'jobs',coalesce((select jsonb_agg(to_jsonb(j)) from lab.jobs j where j.workspace_id=w and j.plan_id in(select id from plans)),'[]'),
 'attempts',coalesce((select jsonb_agg(to_jsonb(a)) from lab.attempts a join lab.jobs j on j.id=a.job_id where j.workspace_id=w and j.plan_id in(select id from plans)),'[]'),
 'assets',coalesce((select jsonb_agg(to_jsonb(a)) from lab.assets a where a.workspace_id=w and a.status='verified' and (a.id in(select request_asset_id from lab.attempts t join lab.jobs j on j.id=t.job_id where j.plan_id in(select id from plans)) or a.id in(select response_asset_id from lab.attempts t join lab.jobs j on j.id=t.job_id where j.plan_id in(select id from plans)) or a.id in(select (pi.snapshot->>'prepared_asset_id')::uuid from lab.plan_inputs pi where pi.plan_id in(select id from plans)))),'[]'),
 'review_samples',coalesce((select jsonb_agg(to_jsonb(s)) from lab.review_samples s where s.workspace_id=w),'[]'),
 'reviews',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('reviewer_id',ra.reviewer_id,'idea_id',ra.idea_id,'stratum',ra.stratum)) from lab.review_revisions v join lab.review_assignments ra on ra.id=v.assignment_id where v.workspace_id=w),'[]')) $$;

notify pgrst,'reload schema';
