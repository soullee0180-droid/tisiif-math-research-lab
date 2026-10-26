-- Public shared research, without Auth users, invitations, sessions or browser secrets.
-- Existing research and archived schemas are preserved.
create table lab_private.public_request_limits(kind text primary key check(kind in('read','write')),window_start timestamptz not null,requests integer not null);
alter table lab_private.public_request_limits enable row level security;
revoke all on lab_private.public_request_limits from public,anon,authenticated;
grant select,insert,update,delete on lab_private.public_request_limits to service_role;

create function public.lab_public_request(is_write boolean) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;begin
 if exists(select 1 from lab_private.scheduler_state where month=to_char(now(),'YYYY-MM') and edge_calls>=400000) or (is_write and pg_database_size(current_database())>400000000) then return false;end if;
 insert into lab_private.public_request_limits(kind,window_start,requests) values(case when is_write then 'write' else 'read' end,date_trunc('minute',clock_timestamp()),1)
 on conflict(kind) do update set window_start=excluded.window_start,requests=case when public_request_limits.window_start=excluded.window_start then public_request_limits.requests+1 else 1 end returning requests into n;
 return n<=case when is_write then 60 else 600 end;end $$;

create function public.lab_public_identity() returns jsonb language plpgsql security invoker set search_path='' as $$
declare w lab.workspaces;m lab.members;begin
 select * into w from lab.workspaces where active;if not found then raise exception 'WORKSPACE_NOT_CONFIGURED';end if;
 if w.settings->>'access_mode' is distinct from 'public' then raise exception 'PUBLIC_ACCESS_NOT_CONFIGURED';end if;
 select * into m from lab.members where workspace_id=w.id and id_email='public@lab.invalid' and active and role='researcher';
 if not found then raise exception 'PUBLIC_WORKSPACE_NOT_CONFIGURED';end if;
 return jsonb_build_object('user',jsonb_build_object('id',m.id,'role','researcher','display_name','공동 연구'),
 'workspace',jsonb_build_object('id',w.id,'name',w.name,'settings',jsonb_build_object('access_mode','public','api_enabled',false)), 'access','public');end $$;

-- Reuse the atomic queue and global concurrency guards. Raising rolls back a claim
-- if a future operator adds a non-mock job; this route can never execute paid calls.
create function public.lab_public_mock_claim(provider_name text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare identity jsonb;claim jsonb;begin
 identity=public.lab_public_identity();claim=public.lab_claim(provider_name);
 if claim is not null and not exists(select 1 from lab.jobs j join lab.plans p on p.id=j.plan_id where j.id=(claim->>'job_id')::uuid and p.workspace_id=(identity#>>'{workspace,id}')::uuid and p.transport='mock' and p.cohort='fixture') then raise exception 'PUBLIC_API_DISABLED';end if;
 return claim;end $$;

revoke execute on function public.lab_public_request(boolean),public.lab_public_identity(),public.lab_public_mock_claim(text) from public,anon,authenticated;
grant execute on function public.lab_public_request(boolean),public.lab_public_identity(),public.lab_public_mock_claim(text) to service_role;

update lab.workspaces set settings=settings||'{"access_mode":"public","api_enabled":false}'::jsonb where active;
insert into lab.members(id,workspace_id,id_email,role) select gen_random_uuid(),id,'public@lab.invalid','researcher' from lab.workspaces where active on conflict(workspace_id,id_email) do nothing;
update lab_private.usage_budgets set enabled=false,budget_usd=0 where workspace_id in(select id from lab.workspaces where active);
-- Remove the runtime Google/email invitation gate. Auth configuration is no longer used.
drop function public.lab_identity(uuid,text);
