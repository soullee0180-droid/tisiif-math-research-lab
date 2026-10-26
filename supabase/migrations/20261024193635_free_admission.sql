create function lab_private.admit() returns void language plpgsql security invoker set search_path='' as $$ declare s lab_private.scheduler_state;begin
 select * into s from lab_private.scheduler_state where id;
 if pg_database_size(current_database())>400000000 or(s.month=to_char(now(),'YYYY-MM') and(s.edge_calls>=400000 or s.egress_bytes>=4000000000)) then raise exception 'FREE_INFRA_ADMISSION_BLOCKED';end if;end $$;
create function lab_private.reserve_batch(w uuid,a uuid,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$ declare f jsonb;rid uuid;total bigint;result jsonb='[]';begin
 perform lab_private.actor(w,a);perform pg_advisory_xact_lock(610241);perform lab_private.admit();
 if jsonb_array_length(p->'files')<1 or jsonb_array_length(p->'files')>100 then raise exception 'BATCH_FILE_COUNT';end if;
 select sum((value->>'bytes')::bigint) into total from jsonb_array_elements(p->'files');if total>209715200 or lab_private.storage_admitted()+total>800000000 then raise exception 'BATCH_CAPACITY_BLOCKED';end if;
 for f in select value from jsonb_array_elements(p->'files') loop
  if(f->>'bytes')::bigint not between 1 and 41943040 then raise exception 'SOURCE_FILE_SIZE';end if;rid=gen_random_uuid();
  insert into lab.assets(id,workspace_id,paper_id,kind,path,bytes,sha256,metadata,created_by) values(rid,w,(f->>'paper_id')::uuid,'source',w::text||'/'||rid::text||'/source.pdf',(f->>'bytes')::bigint,f->>'sha256',coalesce(f->'metadata','{}'),a);
  result=result||jsonb_build_array(jsonb_build_object('id',rid,'client_id',f->>'client_id'));
 end loop;return result;end $$;
create function public.lab_duplicate(w uuid,a uuid,hash text) returns jsonb language plpgsql security invoker set search_path='' as $$ declare v jsonb;begin perform lab_private.actor(w,a);select jsonb_agg(jsonb_build_object('id',id,'paper_id',paper_id,'kind',kind)) into v from lab.assets where workspace_id=w and sha256=hash and status='verified' and kind='source';return coalesce(v,'[]');end $$;
create function public.lab_manual_correction(w uuid,a uuid,old_attempt uuid) returns uuid language plpgsql security invoker set search_path='' as $$ declare t lab.attempts;j lab.jobs;n uuid;begin
 perform public.lab_authorize_attempt(w,a,old_attempt);select * into t from lab.attempts where id=old_attempt;select * into j from lab.jobs where id=t.job_id for update;
 if t.completed_at is not null or t.response_asset_id is null or j.status<>'parse_failed' or not exists(select 1 from lab.plans where id=j.plan_id and transport='manual_web' and status='running') then raise exception 'MANUAL_CORRECTION_STATE';end if;
 update lab.jobs set attempt_no=attempt_no+1,status='running',lease_until=null where id=j.id returning * into j;
 insert into lab.attempts(workspace_id,job_id,attempt_no,request_snapshot,request_asset_id,metadata) values(w,j.id,j.attempt_no,t.request_snapshot,t.request_asset_id,jsonb_build_object('human_corrected',true,'original_attempt_id',t.id,'original_response_hash',t.response_hash)) returning id into n;return n;end $$;
grant usage on schema extensions to service_role;
revoke execute on function lab_private.admit(),lab_private.reserve_batch(uuid,uuid,jsonb),public.lab_duplicate(uuid,uuid,text),public.lab_manual_correction(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function lab_private.admit(),lab_private.reserve_batch(uuid,uuid,jsonb),public.lab_duplicate(uuid,uuid,text),public.lab_manual_correction(uuid,uuid,uuid) to service_role;
