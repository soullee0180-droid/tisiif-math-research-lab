create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
alter table lab_private.dispatch_outbox add column net_request_id bigint;
-- The only DEFINER functions are private, non-user cron operations with no arbitrary URL/SQL.
create function lab_private.scheduler_tick() returns void language plpgsql security definer set search_path='' as $$
declare secret text;base text;ts text;nonce text;body jsonb='{}';signature text;rid bigint;begin
 update lab_private.scheduler_state set last_tick=now() where id;
 if not exists(select 1 from lab_private.scheduler_state where enabled) then return;end if;
 if not exists(select 1 from lab.jobs j join lab.plans p on p.id=j.plan_id join lab.workspaces w on w.id=p.workspace_id where w.active and p.status='running' and p.transport<>'manual_web' and ((j.status='queued' and j.due_at<=now() and p.scheduled_at<=now() and(j.depends_on is null or exists(select 1 from lab.jobs x where x.id=j.depends_on and x.status='complete')))or(j.status='running' and j.lease_until<now()))) then return;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='tisiif_scheduler_secret';select decrypted_secret into base from vault.decrypted_secrets where name='tisiif_project_url';if secret is null or base is null then return;end if;
 ts=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');nonce=gen_random_uuid()::text;
 signature=encode(extensions.hmac('/functions/v1/dispatch'||chr(10)||ts||chr(10)||nonce||chr(10)||encode(extensions.digest(body::text,'sha256'),'hex'),secret,'sha256'),'base64');
 select net.http_post(url:=base||'/functions/v1/dispatch',headers:=jsonb_build_object('Content-Type','application/json','x-lab-time',ts,'x-lab-nonce',nonce,'x-lab-signature',signature),body:=body,timeout_milliseconds:=5000) into rid;
 insert into lab_private.dispatch_outbox(net_request_id,delivered_at) values(rid,now());update lab_private.scheduler_state set last_dispatch=now() where id;
 delete from net._http_response where id in(select net_request_id from lab_private.dispatch_outbox where created_at<now()-interval '1 day');
 delete from lab_private.dispatch_outbox where created_at<now()-interval '2 days';
 delete from cron.job_run_details where jobid in(select jobid from cron.job where jobname='tisiif-free-dispatch') and start_time<now()-interval '2 days';end $$;
create function lab_private.install_scheduler(w uuid,a uuid,project_url text,secret text) returns boolean language plpgsql security definer set search_path='' as $$ declare sid uuid;begin
 perform lab_private.actor(w,a,true);
 if project_url!~'^https://[a-z]{20}\.supabase\.co$' or length(secret)<32 then raise exception 'SCHEDULER_CONFIG_INVALID';end if;
 select id into sid from vault.secrets where name='tisiif_scheduler_secret';if sid is null then perform vault.create_secret(secret,'tisiif_scheduler_secret');else perform vault.update_secret(sid,secret);end if;
 select id into sid from vault.secrets where name='tisiif_project_url';if sid is null then perform vault.create_secret(project_url,'tisiif_project_url');else perform vault.update_secret(sid,project_url);end if;
 if not exists(select 1 from cron.job where jobname='tisiif-free-dispatch') then perform cron.schedule('tisiif-free-dispatch','* * * * *','select lab_private.scheduler_tick()');end if;return true;end $$;
create function public.lab_install_scheduler(w uuid,a uuid,project_url text,secret text) returns boolean language sql security invoker set search_path='' as $$ select lab_private.install_scheduler(w,a,project_url,secret) $$;
revoke execute on function lab_private.scheduler_tick(),lab_private.install_scheduler(uuid,uuid,text,text),public.lab_install_scheduler(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function lab_private.install_scheduler(uuid,uuid,text,text),public.lab_install_scheduler(uuid,uuid,text,text) to service_role;
