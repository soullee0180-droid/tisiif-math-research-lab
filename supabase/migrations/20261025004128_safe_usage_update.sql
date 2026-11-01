-- Supabase REST sessions enable safe-update checks; target the singleton explicitly.
create or replace function public.lab_usage(bytes_count bigint default 0) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update lab_private.scheduler_state set egress_bytes=case when month<>to_char(now(),'YYYY-MM') then bytes_count else egress_bytes+bytes_count end,
 edge_calls=case when month<>to_char(now(),'YYYY-MM') then 1 else edge_calls+1 end,month=to_char(now(),'YYYY-MM') where id=true;
 return true;
end $$;
revoke execute on function public.lab_usage(bigint) from public,anon,authenticated;
grant execute on function public.lab_usage(bigint) to service_role;
notify pgrst,'reload schema';
