-- Paper metadata and reference location are optional; preserve scientific input checks.
create or replace function lab_private.write_papers(w uuid,a uuid,action text,p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m lab.members;h text;prior lab_private.idempotency_requests;v jsonb;rid uuid;pid uuid;cid uuid;ver integer;rev lab.checkpoint_revisions;pl lab.plans;gen text;judge text;rp integer;jid uuid;other text;item jsonb;k integer;rr integer;proto jsonb;models jsonb;dt timestamptz;budget lab_private.usage_budgets;cap jsonb;estimated_bytes bigint=0;max_output_bytes bigint=131072;
begin
 m=lab_private.actor(w,a);
 case action
 when 'paper_create' then insert into lab.papers(workspace_id,created_by,title,metadata) values(w,a,left(p->>'title',500),coalesce(p->'metadata','{}')) returning id into rid;v=jsonb_build_object('id',rid);
 when 'paper_update' then update lab.papers set title=coalesce(p->>'title',title),metadata=coalesce(p->'metadata',metadata),archived=coalesce((p->>'archived')::boolean,archived) where workspace_id=w and id=(p->>'id')::uuid returning id into rid;if rid is null then raise exception 'NOT_FOUND';end if;v=jsonb_build_object('id',rid);
 when 'checkpoint_create' then
 perform 1 from lab.papers where workspace_id=w and id=(p->>'paper_id')::uuid;if not found then raise exception 'NOT_FOUND';end if;
 insert into lab.checkpoints(workspace_id,paper_id,title,created_by) values(w,(p->>'paper_id')::uuid,p->>'title',a) returning id into cid;
 insert into lab.checkpoint_revisions(workspace_id,checkpoint_id,version_no,body,created_by) values(w,cid,1,coalesce(p->'body','{"input_mode":"text","goal":"","obstacle":"","public_text":"","reference_idea_md":"","reference_location":"","steps":[],"page_recipe":[]}'),a) returning id into rid;v=jsonb_build_object('id',rid,'checkpoint_id',cid);
 when 'revision_clone' then
 select * into rev from lab.checkpoint_revisions where workspace_id=w and id=(p->>'id')::uuid;if not found then raise exception 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended(rev.checkpoint_id::text,0));select max(version_no)+1 into ver from lab.checkpoint_revisions where workspace_id=w and checkpoint_id=rev.checkpoint_id;
 insert into lab.checkpoint_revisions(workspace_id,checkpoint_id,version_no,body,created_by) values(w,rev.checkpoint_id,ver,rev.body-'prepared_asset_id'-'prepared_sha256'-'approval',a) returning id into rid;v=jsonb_build_object('id',rid);
 when 'revision_save' then
 update lab.checkpoint_revisions set body=p->'body',status='draft' where workspace_id=w and id=(p->>'id')::uuid and edit_version=(p->>'if_match')::integer returning id,edit_version into rid,ver;if rid is null then raise exception 'EDIT_CONFLICT';end if;v=jsonb_build_object('id',rid,'edit_version',ver);
 when 'revision_approve' then
 select * into rev from lab.checkpoint_revisions where workspace_id=w and id=(p->>'id')::uuid for update;if not found or rev.edit_version<>(p->>'if_match')::integer then raise exception 'EDIT_CONFLICT';end if;
 if coalesce(trim(rev.body->>'goal'),'')='' or coalesce(trim(rev.body->>'obstacle'),'')='' or coalesce(trim(rev.body->>'reference_idea_md'),'')='' then raise exception 'REVISION_INCOMPLETE';end if;
 if p->'checks' is distinct from '[true,true,true]'::jsonb then raise exception 'APPROVAL_CHECKS_REQUIRED';end if;
 if rev.body->>'input_mode'='pdf' then
  perform 1 from lab.assets where workspace_id=w and id=(rev.body->>'prepared_asset_id')::uuid and kind='prepared' and status='verified' and server_hash and sha256=rev.body->>'prepared_sha256' and metadata->>'preview_sha256'=sha256 and metadata->'inspection'->>'status'='PASS';if not found then raise exception 'PREPARED_NOT_VERIFIED';end if;
 elsif rev.body->>'input_mode' is distinct from 'text' or coalesce(length(trim(rev.body->>'public_text')),0)=0 then raise exception 'PUBLIC_INPUT_REQUIRED';end if;
 update lab.checkpoint_revisions set status='approved',input_hash=lab_private.hash(rev.body-'reference_idea_md'-'reference_location'-'recognition_scope'-'private_notes'),reference_hash=lab_private.hash(rev.body->'reference_idea_md'),approved_by=a,approved_at=now(),body=body||jsonb_build_object('approval',jsonb_build_object('checks',p->'checks','hash',lab_private.hash(rev.body),'actor',a,'at',now())) where id=rev.id returning id into rid;v=jsonb_build_object('id',rid);
 else raise exception 'WRITE_ACTION_INVALID';end case;
 return jsonb_build_object('result',v,'resource_id',rid);
end $$;
revoke execute on function lab_private.write_papers(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function lab_private.write_papers(uuid,uuid,text,jsonb) to service_role;
