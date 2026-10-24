create function public.lab_review_sample(w uuid,a uuid,filters jsonb,reviewers uuid[]) returns jsonb language plpgsql security invoker set search_path='' as $$ declare data jsonb;rid uuid;v jsonb;gen text;chosen boolean;pop integer;actual integer;stratum text;candidate record;reviewer uuid;v_manifest jsonb='[]';begin
 perform lab_private.actor(w,a,true);if cardinality(reviewers)<>2 or reviewers[1]=reviewers[2] then raise exception 'TWO_REVIEWERS_REQUIRED';end if;foreach reviewer in array reviewers loop perform lab_private.actor(w,reviewer);end loop;
 data=lab_private.analysis(w,filters);rid=gen_random_uuid();insert into lab.review_samples(id,workspace_id,manifest) values(rid,w,'[]');
 foreach gen in array array['google','openai','anthropic'] loop foreach chosen in array array[true,false] loop
 stratum=gen||':'||case when chosen then 'selected' else 'not_selected' end;
 select count(*) into pop from jsonb_array_elements(data->'runs') r,jsonb_array_elements(r->'ideas') i where r->>'generator'=gen and(r->>'selected'=i->>'candidate_id')=chosen and coalesce((r->>'human_corrected')::boolean,false)=false;
 actual=least(5,pop);v_manifest=v_manifest||jsonb_build_array(jsonb_build_object('stratum',stratum,'population',pop,'actual_n',actual,'shortage',5-actual,'inclusion_probability',case when pop>0 then actual::numeric/pop else null end));
 for candidate in select i->>'id' idea_id from jsonb_array_elements(data->'runs') r,jsonb_array_elements(r->'ideas') i where r->>'generator'=gen and(r->>'selected'=i->>'candidate_id')=chosen and coalesce((r->>'human_corrected')::boolean,false)=false order by encode(extensions.digest('20261023:'||coalesce(i->>'original_id',i->>'id'),'sha256'),'hex') limit 5 loop
 foreach reviewer in array reviewers loop insert into lab.review_assignments(workspace_id,sample_id,idea_id,reviewer_id,stratum) values(w,rid,candidate.idea_id::uuid,reviewer,stratum);end loop;end loop;
 end loop;end loop;
 update lab.review_samples s set manifest=v_manifest where s.id=rid;
 return jsonb_build_object('id',rid,'manifest',v_manifest);end $$;
create function lab_private.remap(v jsonb,m jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$ declare r jsonb;pair record;begin
 if jsonb_typeof(v)='string' then return coalesce(m->(v#>>'{}'),v);elsif jsonb_typeof(v)='array' then select coalesce(jsonb_agg(lab_private.remap(value,m)),'[]') into r from jsonb_array_elements(v);return r;elsif jsonb_typeof(v)='object' then r='{}';for pair in select * from jsonb_each(v) loop r=r||jsonb_build_object(pair.key,case when pair.key in('original_id','seed','input_hash','reference_hash','condition_hash','sha256') then pair.value else lab_private.remap(pair.value,m) end);end loop;return r;end if;return v;end $$;
create function public.lab_restore_begin(w uuid,a uuid,manifest jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$ declare target uuid;sid uuid;bytes bigint;begin
 perform lab_private.actor(w,a,true);if manifest->>'format'<>'tisiif-backup-v3' or manifest->>'verified_by_edge'<>'true' then raise exception 'VERIFIED_MANIFEST_REQUIRED';end if;
 perform pg_advisory_xact_lock(610241);bytes=(manifest->>'storage_bytes')::bigint;if bytes<0 or lab_private.storage_admitted()+bytes>800000000 then raise exception 'RESTORE_CAPACITY_BLOCKED';end if;
 target=gen_random_uuid();insert into lab.workspaces(id,name,active,restored_from,settings) values(target,'복원 검수 공간',false,(manifest->>'workspace_id')::uuid,'{"api_enabled":false,"scheduler_enabled":false}');
 insert into lab.members select a,target,id_email,'admin',true from lab.members where workspace_id=w and id=a;
 insert into lab_private.email_allowlist select target,id_email,'admin',true from lab.members where workspace_id=w and id=a;
 insert into lab.restore_sessions(workspace_id,target_workspace_id,manifest,reserved_bytes,created_by,id_map,progress) values(w,target,manifest,bytes,a,jsonb_build_object(manifest->>'workspace_id',target::text,a::text,a::text),'{"job_dependencies":{}}') returning id into sid;
 return jsonb_build_object('id',sid,'target_workspace_id',target);end $$;
create function public.lab_restore_chunk(w uuid,a uuid,session uuid,section text,rows jsonb,proof_verified boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s lab.restore_sessions;item jsonb;r jsonb;old_id text;new_id uuid;m jsonb;col text;cols text;vals text;t text;expected text;hash text;idx integer;begin
 perform lab_private.actor(w,a,true);select * into s from lab.restore_sessions where id=session and workspace_id=w and created_by=a for update;if not found or s.status<>'importing' then raise exception 'RESTORE_STATE';end if;
 if not proof_verified or section not in('members','papers','assets','checkpoints','checkpoint_revisions','revision_assets','protocol_versions','model_profiles','plans','plan_inputs','plan_models','runs','jobs','attempts','ideas','selections','usefulness_ratings','agreement_ratings','review_samples','review_assignments','review_revisions','analysis_snapshots','export_manifests','audit_events') or jsonb_array_length(rows)>100 then raise exception 'RESTORE_SECTION_INVALID';end if;
 m=s.id_map;
 for item in select value from jsonb_array_elements(rows) loop
 idx=(item->>'index')::integer;hash=item->>'hash';if exists(select 1 from lab_private.restore_rows where session_id=session and restore_rows.section=lab_restore_chunk.section and row_index=idx and row_hash=hash) then continue;end if;
 r=item->'row';
 -- Allocate every UUID reference before insertion; table and columns remain a fixed whitelist.
 for col in select column_name from information_schema.columns where table_schema='lab' and table_name=section and udt_name='uuid' loop
 old_id=r->>col;if old_id is not null and col not in('original_id') and not(m?old_id) then m=m||jsonb_build_object(old_id,gen_random_uuid()::text);end if;
 end loop;
 if section in('checkpoint_revisions','plan_inputs') and coalesce(r#>>'{body,prepared_asset_id}',r#>>'{snapshot,prepared_asset_id}') is not null then old_id=coalesce(r#>>'{body,prepared_asset_id}',r#>>'{snapshot,prepared_asset_id}');if not(m?old_id)then m=m||jsonb_build_object(old_id,gen_random_uuid()::text);end if;end if;
 old_id=r->>'id';r=lab_private.remap(r,m)||jsonb_build_object('workspace_id',s.target_workspace_id);
 if section='members' then
 if r->>'id'=a::text then insert into lab_private.restore_rows values(session,section,idx,hash);continue;end if;
 r=r||jsonb_build_object('active',false,'id_email','historical-'||(r->>'id')||'@restore.invalid');
 elsif section='assets' then
 r=r||jsonb_build_object('path',s.target_workspace_id::text||'/'||(r->>'id')||'/restored','status','reserved','server_hash',false);
 if item->'row'->>'status'='verified' then insert into lab_private.restore_files(session_id,asset_id,sha256) values(session,(r->>'id')::uuid,r->>'sha256');end if;
 elsif section='plans' then r=r||jsonb_build_object('status','paused');
 elsif section='model_profiles' then r=r||jsonb_build_object('enabled',false,'capabilities','{}'::jsonb);
 elsif section='runs' or section='ideas' then r=r||jsonb_build_object('original_id',coalesce(item->'row'->>'original_id',old_id));
 elsif section='jobs' then
 if r->>'depends_on' is not null then s.progress=jsonb_set(s.progress,array['job_dependencies',r->>'id'],r->'depends_on');end if;
 r=r||jsonb_build_object('depends_on',null,'lease_until',null,'status',case when r->>'status'='running' then 'unknown_remote' else r->>'status' end);
 end if;
 select string_agg(format('%I',column_name),',' order by ordinal_position),string_agg(format('(jsonb_populate_record(null::lab.%I,$1)).%I',section,column_name),',' order by ordinal_position) into cols,vals from information_schema.columns where table_schema='lab' and table_name=section;
 execute format('insert into lab.%I(%s) select %s',section,cols,vals) using r;
 insert into lab_private.restore_rows values(session,section,idx,hash);
 end loop;
 update lab.restore_sessions set id_map=m,progress=s.progress where id=session;return jsonb_build_object('accepted',true);end $$;
create function public.lab_restore_file(w uuid,a uuid,session uuid,old_asset uuid,verified_hash text default null) returns jsonb language plpgsql security invoker set search_path='' as $$ declare s lab.restore_sessions;asset lab.assets;begin
 perform lab_private.actor(w,a,true);select * into s from lab.restore_sessions where id=session and workspace_id=w and created_by=a and status in('importing','verified');if not found then raise exception 'RESTORE_STATE';end if;
 select * into asset from lab.assets where workspace_id=s.target_workspace_id and id=(s.id_map->>old_asset::text)::uuid;if not found or not exists(select 1 from lab_private.restore_files where session_id=session and asset_id=asset.id) then raise exception 'RESTORE_FILE_NOT_FOUND';end if;
 if verified_hash is not null then if verified_hash<>asset.sha256 then raise exception 'RESTORE_FILE_HASH';end if;update lab_private.restore_files set checked=true where session_id=session and asset_id=asset.id;update lab.assets set status='verified',server_hash=true where id=asset.id;end if;return to_jsonb(asset);end $$;
create function public.lab_restore_finish(w uuid,a uuid,session uuid) returns jsonb language plpgsql security invoker set search_path='' as $$ declare s lab.restore_sessions;r record;begin
 perform lab_private.actor(w,a,true);select * into s from lab.restore_sessions where id=session and workspace_id=w and created_by=a for update;if not found or s.status<>'importing' then raise exception 'RESTORE_STATE';end if;
 for r in select key,value from jsonb_each(s.manifest->'sections') loop if(select count(*) from lab_private.restore_rows where session_id=session and section=r.key)<>(r.value->>'count')::integer then raise exception 'RESTORE_ROW_COUNT';end if;end loop;
 if exists(select 1 from lab_private.restore_files where session_id=session and not checked) then raise exception 'RESTORE_FILES_INCOMPLETE';end if;
 for r in select key,value from jsonb_each(s.progress->'job_dependencies') loop update lab.jobs set depends_on=(r.value#>>'{}')::uuid where workspace_id=s.target_workspace_id and id=r.key::uuid;end loop;
 update lab.restore_sessions set status='verified' where id=session;return jsonb_build_object('verified',true,'target_workspace_id',s.target_workspace_id,'active',false);end $$;
create function public.lab_restore_activate(w uuid,a uuid,session uuid,evidence text) returns jsonb language plpgsql security invoker set search_path='' as $$ declare s lab.restore_sessions;begin
 perform lab_private.actor(w,a,true);select * into s from lab.restore_sessions where id=session and workspace_id=w and created_by=a and status='verified' for update;if not found or length(evidence)<20 then raise exception 'RESTORE_VALIDATION_REQUIRED';end if;
 update lab.workspaces set active=false where active;update lab.workspaces set active=true where id=s.target_workspace_id;update lab.restore_sessions set status='active' where id=session;insert into lab.audit_events(workspace_id,actor,action,body) values(s.target_workspace_id,a,'restore_activated',jsonb_build_object('evidence',evidence));return jsonb_build_object('active',true);end $$;
create function lab_private.plan_guard() returns trigger language plpgsql security invoker set search_path='' as $$ begin if(to_jsonb(old)-'status')<>(to_jsonb(new)-'status') then raise exception 'IMMUTABLE_PLAN_SNAPSHOT';end if;return new;end $$;
create trigger plan_snapshot_guard before update on lab.plans for each row execute function lab_private.plan_guard();
create function lab_private.attempt_guard() returns trigger language plpgsql security invoker set search_path='' as $$ begin if old.completed_at is not null then raise exception 'IMMUTABLE_COMPLETED_ATTEMPT';end if;if old.response_asset_id is not null and(old.response_asset_id is distinct from new.response_asset_id or old.response_hash is distinct from new.response_hash) then raise exception 'IMMUTABLE_RAW_RESPONSE';end if;return new;end $$;
create trigger attempt_guard before update on lab.attempts for each row execute function lab_private.attempt_guard();
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','lab_private') and (p.proname like 'lab_%' or n.nspname='lab_private') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;

create function public.lab_restore_manifest(w uuid,a uuid,session uuid) returns jsonb language plpgsql security invoker set search_path='' as $$ declare v jsonb;begin perform lab_private.actor(w,a,true);select manifest into v from lab.restore_sessions where id=session and workspace_id=w and created_by=a;if v is null then raise exception 'NOT_FOUND';end if;return v;end $$;
revoke execute on function public.lab_restore_manifest(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.lab_restore_manifest(uuid,uuid,uuid) to service_role;

create function public.lab_restore_inspect(w uuid,a uuid,session uuid) returns jsonb language plpgsql security invoker set search_path='' as $$ declare s lab.restore_sessions;filters jsonb;begin perform lab_private.actor(w,a,true);select * into s from lab.restore_sessions where id=session and workspace_id=w and created_by=a and status='verified';if not found then raise exception 'RESTORE_NOT_VERIFIED';end if;select jsonb_build_object('plan_ids',coalesce(jsonb_agg(id),'[]')) into filters from lab.plans where workspace_id=s.target_workspace_id;return jsonb_build_object('workspace_id',s.target_workspace_id,'active',false,'manifest',s.manifest,'analysis',lab_private.analysis(s.target_workspace_id,filters),'files',(select jsonb_agg(to_jsonb(f)) from lab_private.restore_files f where session_id=session));end $$;
revoke execute on function public.lab_restore_inspect(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.lab_restore_inspect(uuid,uuid,uuid) to service_role;
