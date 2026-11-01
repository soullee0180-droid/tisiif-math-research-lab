-- Only a fixed-name, server-role-only reader can access these Vault values.
-- No plaintext secret is included in migration history or application responses.
do $$ begin
 if not exists(select 1 from vault.secrets where name='tisiif_api_master') then perform vault.create_secret(encode(extensions.gen_random_bytes(32),'base64'),'tisiif_api_master');end if;
 if not exists(select 1 from vault.secrets where name='tisiif_scheduler_secret') then perform vault.create_secret(encode(extensions.gen_random_bytes(48),'hex'),'tisiif_scheduler_secret');end if;
end $$;
create function lab_private.runtime_secret(secret_name text) returns text language plpgsql security definer set search_path='' as $$ declare v text;begin
 if secret_name not in('api_master','scheduler') then raise exception 'SECRET_NAME_INVALID';end if;
 select decrypted_secret into v from vault.decrypted_secrets where name=case secret_name when 'api_master' then 'tisiif_api_master' else 'tisiif_scheduler_secret' end;return v;end $$;
create function public.lab_runtime_secret(secret_name text) returns text language sql security invoker set search_path='' as $$ select lab_private.runtime_secret(secret_name) $$;
revoke execute on function lab_private.runtime_secret(text),public.lab_runtime_secret(text) from public,anon,authenticated;
grant execute on function lab_private.runtime_secret(text),public.lab_runtime_secret(text) to service_role;
-- Uses the existing validated project URL. No service key is stored in cron.
do $$ declare w uuid;a uuid;secret text;begin
 select id into w from lab.workspaces where active;a=lab_private.shared_operator(w);secret=lab_private.runtime_secret('scheduler');
 perform public.lab_install_scheduler(w,a,'https://bugnhvehtrsgehgnhlvm.supabase.co',secret);
 update lab.workspaces set settings=settings||'{"scheduler_enabled":true}'::jsonb where id=w;
 update lab_private.scheduler_state set enabled=true where id=true;
end $$;
notify pgrst,'reload schema';
