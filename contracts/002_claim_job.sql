-- Server/worker-only query. The caller begins a SHORT transaction, executes this,
-- commits BEFORE any external network request, and heartbeats the acquired lease.
-- Parameters: %(provider)s, %(worker)s. The application MUST lock the corresponding
-- provider_runtime row FIRST and inspect enabled/blocked_reason/paused_until,
-- next_dispatch_at, max_concurrency and sliding-window RPM/TPM reservations.
-- provider_runtime is GLOBAL across all members/plans/workspaces in this deployment.
with ready as (
 select j.id
 from lab.jobs j join lab.plans p on p.id=j.plan_id and p.workspace_id=j.workspace_id
 where j.provider=%(provider)s and j.status in ('queued','waiting_rate')
 and j.phase in ('generate','select','usefulness','agreement','diagnostic')
 and j.available_at<=now() and p.status in ('running','scheduled')
 and (p.scheduled_at is null or p.scheduled_at<=now())
 and p.transport in ('api','mock')
 and not exists (
  select 1 from unnest(j.depends_on) as deps(dependency_id)
  left join lab.jobs d on d.id=dependency_id and d.workspace_id=j.workspace_id
  where d.id is null or d.status<>'completed'
 )
 order by p.last_dispatched_at asc nulls first,j.priority asc,j.created_at asc,j.id asc
 for update of j skip locked limit 1
), claimed as (
 update lab.jobs j set status='leased',lease_owner=%(worker)s,
 lease_expires_at=now()+interval '90 seconds',heartbeat_at=now(),updated_at=now()
 from ready r where j.id=r.id returning j.*
)
select * from claimed;
-- In the SAME transaction: update the plan's last_dispatched_at; reserve estimated
-- RPM/TPM usage; move provider_runtime.next_dispatch_at forward; insert attempt.
-- A general read-then-update outside this transaction is forbidden.
-- Auxiliary PDF/export/backup jobs use a separate SKIP LOCKED claim query
-- without provider quotas, with one PDF process and one export process maximum.
