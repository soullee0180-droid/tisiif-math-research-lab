-- TISIIF Math Research Lab 1.0 / PostgreSQL 15+ / Supabase
-- Canonical schema contract. Apply through a real migration on a NEW project.
-- Never expose lab or lab_private in Supabase Data API settings.
-- Auth users and Storage service are managed by Supabase, not recreated here.
begin;
create schema if not exists lab;
create schema if not exists lab_private;
revoke all on schema lab, lab_private from public, anon;
grant usage on schema lab, lab_private to authenticated;

create table lab.workspaces (
 id uuid primary key default gen_random_uuid(),
 name text not null default 'TISIIF Math Research Lab',
 timezone text not null default 'Asia/Seoul' check(timezone='Asia/Seoul'),
 is_active boolean not null default true,
 created_at timestamptz not null default now()
);
create unique index one_active_workspace on lab.workspaces ((is_active)) where is_active;
create table lab.workspace_members (
 workspace_id uuid not null references lab.workspaces(id),
 user_id uuid not null references auth.users(id),
 email text not null check(email=lower(email)),
 display_name text not null,
 role text not null check(role in ('admin','researcher')),
 active boolean not null default true,
 joined_at timestamptz not null default now(),
 primary key(workspace_id,user_id), unique(workspace_id,email)
);
create index workspace_members_user on lab.workspace_members(user_id,workspace_id) where active;
-- The owner is the migration owner. Do not FORCE RLS on this table:
-- this narrow membership helper must be able to read it without recursive RLS.
create function lab_private.is_member(p_workspace uuid) returns boolean
language sql stable security definer set search_path=''
as $f$
 select auth.uid() is not null and exists(
  select 1 from lab.workspace_members m
  where m.workspace_id=p_workspace and m.user_id=auth.uid() and m.active
 )
$f$;
revoke all on function lab_private.is_member(uuid) from public,anon;
grant execute on function lab_private.is_member(uuid) to authenticated;

create table lab.assets (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references lab.workspaces(id),
 kind text not null check(kind in
 ('source_pdf','prepared_pdf','page_png','request_json','response_json','raw_text','export','research_backup')),
 bucket text not null check(bucket in ('lab-source','lab-prepared','lab-artifacts','lab-exports')),
 object_path text not null unique,
 sha256 text check(sha256 ~ '^[0-9a-f]{64}$'),
 byte_size bigint check(byte_size>=0),
 page_count integer check(page_count>0),
 original_name text not null,
 mime_type text not null,
 status text not null default 'reserved' check(status in ('reserved','uploaded','verified','failed')),
 created_by uuid not null,
 created_at timestamptz not null default now(),
 verified_at timestamptz,
 unique(workspace_id,id)
);
create index assets_workspace on lab.assets(workspace_id,created_at desc);
create table lab.papers (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 code text not null, title text not null, authors text not null default '',
 source_url text, doi_or_arxiv text, paper_version text, published_date date,
 subject text not null default '', rights_status text not null default 'unrecorded'
 check(rights_status in ('unrecorded','license_recorded','permission_recorded','team_review_recorded')),
 rights_note text not null default '', source_asset_id uuid,
 archived boolean not null default false, created_by uuid not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,code),
 foreign key(workspace_id,source_asset_id) references lab.assets(workspace_id,id)
);
create table lab.checkpoints (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 paper_id uuid not null, code text not null, title text not null,
 archived boolean not null default false, created_by uuid not null,
 created_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,paper_id,code),
 foreign key(workspace_id,paper_id) references lab.papers(workspace_id,id)
);
create table lab.checkpoint_revisions (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 checkpoint_id uuid not null, version_no integer not null check(version_no>0),
 status text not null default 'draft' check(status in ('draft','preparing','review','approved')),
 input_mode text not null default 'pdf' check(input_mode in ('pdf','text')),
 goal_md text not null default '', obstacle_md text not null default '',
 abstract_md text not null default '', public_text_md text not null default '',
 reference_idea_md text not null default '', reference_location text not null default '',
 stage_outline jsonb not null default '[]'::jsonb check(jsonb_typeof(stage_outline)='array'),
 page_recipe jsonb not null default '[]'::jsonb check(jsonb_typeof(page_recipe)='array'),
 source_asset_id uuid, prepared_asset_id uuid, public_input_sha256 text,
 reviewed_by uuid, reviewed_at timestamptz, review_note text not null default '',
 created_by uuid not null, created_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,checkpoint_id,version_no),
 foreign key(workspace_id,checkpoint_id) references lab.checkpoints(workspace_id,id),
 foreign key(workspace_id,source_asset_id) references lab.assets(workspace_id,id),
 foreign key(workspace_id,prepared_asset_id) references lab.assets(workspace_id,id),
 check(status<>'approved' or
  (reviewed_by is not null and reviewed_at is not null and length(goal_md)>0
   and length(obstacle_md)>0 and length(reference_idea_md)>0
   and public_input_sha256 is not null and public_input_sha256 ~ '^[0-9a-f]{64}$'
   and (input_mode='text' and length(public_text_md)>0 or input_mode='pdf' and prepared_asset_id is not null)))
);
create index checkpoint_revisions_latest on lab.checkpoint_revisions(workspace_id,checkpoint_id,version_no desc);
create table lab.model_profiles (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 provider text not null check(provider in ('openai','google','anthropic','mock')),
 label text not null, model_id text not null, config jsonb not null,
 capabilities jsonb not null, verification_status text not null default 'unverified'
 check(verification_status in ('unverified','passed','failed','manual_only')),
 verified_at timestamptz, created_by uuid not null, created_at timestamptz not null default now(),
 unique(workspace_id,id)
);
create table lab.protocol_versions (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 name text not null, version_no integer not null check(version_no>0),
 definition jsonb not null, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 created_by uuid not null, created_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,name,version_no)
);
create table lab.plans (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 title text not null, cohort text not null check(cohort in ('pilot','main','manual','fixture','diagnostic')),
 transport text not null check(transport in ('api','manual','mock')),
 status text not null default 'draft' check(status in
 ('draft','scheduled','running','paused','completed','partial','cancelled')),
 protocol_id uuid not null, frozen_config jsonb not null,
 frozen_sha256 text not null check(frozen_sha256 ~ '^[0-9a-f]{64}$'),
 scheduled_at timestamptz, created_by uuid not null,
 idempotency_key uuid not null, last_dispatched_at timestamptz,
 created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 unique(workspace_id,id), unique(workspace_id,created_by,idempotency_key),
 foreign key(workspace_id,protocol_id) references lab.protocol_versions(workspace_id,id)
);
create table lab.runs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 plan_id uuid not null, paper_id uuid not null, checkpoint_revision_id uuid not null,
 generator_provider text not null check(generator_provider in ('openai','google','anthropic','mock')),
 generator_model jsonb not null, judge_models jsonb not null,
 repeat_no integer not null check(repeat_no>0), candidate_count integer not null check(candidate_count between 1 and 10),
 transport text not null check(transport in ('api','manual','mock')),
 status text not null default 'queued' check(status in
 ('queued','running','needs_input','needs_review','completed','partial','failed','cancelled')),
 request_fingerprint text not null, display_seed text not null,
 created_at timestamptz not null default now(), finished_at timestamptz,
 unique(workspace_id,id),
 unique(plan_id,checkpoint_revision_id,generator_provider,repeat_no),
 foreign key(workspace_id,plan_id) references lab.plans(workspace_id,id),
 foreign key(workspace_id,paper_id) references lab.papers(workspace_id,id),
 foreign key(workspace_id,checkpoint_revision_id) references lab.checkpoint_revisions(workspace_id,id)
);
create index runs_plan on lab.runs(workspace_id,plan_id,status);
create index runs_checkpoint on lab.runs(workspace_id,checkpoint_revision_id,generator_provider);
create table lab.jobs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 run_id uuid, plan_id uuid,
 phase text not null check(phase in
 ('generate','select','usefulness','agreement','prepare_pdf','export','backup','diagnostic')),
 provider text check(provider in ('openai','google','anthropic','mock')),
 judge_provider text check(judge_provider in ('openai','google','anthropic','mock')),
 status text not null default 'blocked' check(status in
 ('blocked','queued','leased','dispatching','submitted','waiting_remote','waiting_rate','needs_input',
  'needs_review','unknown_remote','failed','completed','cancelled')),
 depends_on uuid[] not null default '{}', payload jsonb not null default '{}'::jsonb,
 priority integer not null default 100,
 available_at timestamptz not null default now(),
 lease_owner text, lease_expires_at timestamptz, heartbeat_at timestamptz,
 accepted_attempt_id uuid, error_class text, error_message text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,run_id) references lab.runs(workspace_id,id),
 foreign key(workspace_id,plan_id) references lab.plans(workspace_id,id),
 check((phase in ('usefulness','agreement'))=(judge_provider is not null))
);
create unique index one_logical_stage on lab.jobs(run_id,phase,coalesce(judge_provider,'')) where run_id is not null;
create index jobs_ready on lab.jobs(provider,available_at,priority,created_at)
 where status in ('queued','waiting_rate');
create index jobs_lease on lab.jobs(lease_expires_at) where status in ('leased','dispatching');
create table lab.attempts (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 job_id uuid not null, attempt_no integer not null check(attempt_no>0),
 status text not null check(status in
 ('started','dispatching','response_saved','accepted','invalid','refused','truncated','error','unknown_remote')),
 transport text not null check(transport in ('api','manual','mock')),
 requested_model text, returned_model text, provider_request_id text, provider_job_id text,
 request_asset_id uuid, response_asset_id uuid, request_sha256 text,
 raw_text_asset_id uuid, usage jsonb, normalized_settings jsonb not null default '{}'::jsonb,
 http_status integer, error_class text, error_detail jsonb,
 sent_at timestamptz, received_at timestamptz, created_at timestamptz not null default now(),
 unique(workspace_id,id), unique(job_id,attempt_no),
 foreign key(workspace_id,job_id) references lab.jobs(workspace_id,id),
 foreign key(workspace_id,request_asset_id) references lab.assets(workspace_id,id),
 foreign key(workspace_id,response_asset_id) references lab.assets(workspace_id,id),
 foreign key(workspace_id,raw_text_asset_id) references lab.assets(workspace_id,id)
);
alter table lab.jobs add foreign key(workspace_id,accepted_attempt_id) references lab.attempts(workspace_id,id);
create table lab.ideas (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 run_id uuid not null, ordinal integer not null check(ordinal between 1 and 10),
 title text not null, idea_md text not null, why_helpful_md text not null,
 next_steps jsonb not null check(jsonb_typeof(next_steps)='array'),
 assumptions jsonb not null check(jsonb_typeof(assumptions)='array'),
 unverified_points jsonb not null check(jsonb_typeof(unverified_points)='array'),
 source_attempt_id uuid not null, created_at timestamptz not null default now(),
 unique(workspace_id,id), unique(workspace_id,run_id,ordinal),
 foreign key(workspace_id,run_id) references lab.runs(workspace_id,id),
 foreign key(workspace_id,source_attempt_id) references lab.attempts(workspace_id,id)
);
create table lab.selections (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 run_id uuid not null, selected_ordinal integer not null,
 rationale_md text not null, risks_md text not null, source_attempt_id uuid not null,
 created_at timestamptz not null default now(), unique(run_id,source_attempt_id),
 foreign key(workspace_id,run_id,selected_ordinal) references lab.ideas(workspace_id,run_id,ordinal),
 foreign key(workspace_id,source_attempt_id) references lab.attempts(workspace_id,id)
);
create table lab.usefulness_ratings (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 run_id uuid not null, idea_ordinal integer not null, judge_provider text not null,
 score integer check(score between 0 and 4),
 validity text not null check(validity in ('supported','promising_unverified','error_identified','undetermined')),
 rationale_md text not null, concerns jsonb not null default '[]'::jsonb,
 unable_reason text, source_attempt_id uuid not null, created_at timestamptz not null default now(),
 unique(run_id,idea_ordinal,judge_provider,source_attempt_id),
 foreign key(workspace_id,run_id,idea_ordinal) references lab.ideas(workspace_id,run_id,ordinal),
 foreign key(workspace_id,source_attempt_id) references lab.attempts(workspace_id,id),
 check(score is not null or coalesce(length(unable_reason),0)>0)
);
create table lab.agreement_ratings (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 run_id uuid not null, idea_ordinal integer not null, judge_provider text not null,
 label text not null check(label in ('none','partial','core','undetermined')),
 rationale_md text not null, corresponding_elements jsonb not null default '[]'::jsonb,
 unable_reason text, source_attempt_id uuid not null, created_at timestamptz not null default now(),
 unique(run_id,idea_ordinal,judge_provider,source_attempt_id),
 foreign key(workspace_id,run_id,idea_ordinal) references lab.ideas(workspace_id,run_id,ordinal),
 foreign key(workspace_id,source_attempt_id) references lab.attempts(workspace_id,id),
 check(label<>'undetermined' or coalesce(length(unable_reason),0)>0)
);
create table lab.review_batches (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 plan_ids uuid[] not null, seed text not null, sampling_definition jsonb not null,
 created_by uuid not null, created_at timestamptz not null default now(), unique(workspace_id,id)
);
create table lab.review_assignments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 review_batch_id uuid not null, idea_id uuid not null, reviewer_id uuid not null,
 stratum text not null, inclusion_probability numeric check(inclusion_probability>0 and inclusion_probability<=1),
 display_code text not null, phase text not null default 'usefulness'
 check(phase in ('usefulness','agreement','done')),
 created_at timestamptz not null default now(), unique(workspace_id,id),
 unique(review_batch_id,idea_id,reviewer_id),
 foreign key(workspace_id,review_batch_id) references lab.review_batches(workspace_id,id),
 foreign key(workspace_id,idea_id) references lab.ideas(workspace_id,id)
);
create table lab.human_reviews (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 assignment_id uuid not null, revision_no integer not null check(revision_no>0),
 phase text not null check(phase in ('usefulness','agreement')),
 score integer check(score between 0 and 4),
 validity text check(validity in ('supported','promising_unverified','error_identified','undetermined')),
 agreement_label text check(agreement_label in ('none','partial','core','undetermined')),
 rationale_md text not null, unable_reason text, correction_reason text,
 created_by uuid not null, created_at timestamptz not null default now(),
 unique(assignment_id,phase,revision_no),
 foreign key(workspace_id,assignment_id) references lab.review_assignments(workspace_id,id),
 check((phase='usefulness' and agreement_label is null and validity is not null
   and (score is not null or coalesce(length(unable_reason),0)>0)) or
  (phase='agreement' and score is null and validity is null and agreement_label is not null
   and (agreement_label<>'undetermined' or coalesce(length(unable_reason),0)>0)))
);
create table lab.exports (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 kind text not null check(kind in ('xlsx','research_zip','external_zip')),
 filters jsonb not null, status text not null default 'queued'
 check(status in ('queued','running','completed','failed')),
 asset_id uuid, created_by uuid not null, created_at timestamptz not null default now(),
 unique(workspace_id,id), foreign key(workspace_id,asset_id) references lab.assets(workspace_id,id)
);
create table lab.audit_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 actor_id uuid, action text not null, object_type text not null, object_id uuid,
 safe_detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index audit_events_workspace on lab.audit_events(workspace_id,created_at desc);
create table lab.worker_heartbeats (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 worker_name text not null, build_sha text not null, heartbeat_at timestamptz not null,
 active_jobs integer not null default 0, unique(workspace_id,worker_name)
);
create table lab.backup_runs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references lab.workspaces(id),
 status text not null check(status in ('running','completed','failed')),
 destination text not null, manifest_sha256 text, byte_size bigint, restored_test_at timestamptz,
 started_at timestamptz not null default now(), finished_at timestamptz, error_message text
);
create table lab_private.email_allowlist (
 workspace_id uuid not null references lab.workspaces(id),
 email text not null check(email=lower(email)),
 role text not null check(role in ('admin','researcher')),
 active boolean not null default true,
 updated_by uuid, updated_at timestamptz not null default now(),
 primary key(workspace_id,email)
);
create table lab_private.provider_secrets (
 workspace_id uuid not null references lab.workspaces(id), provider text not null,
 ciphertext bytea not null, nonce bytea not null, last_four text not null,
 key_version integer not null default 1, updated_by uuid not null, updated_at timestamptz not null default now(),
 primary key(workspace_id,provider),
 check(provider in ('openai','google','anthropic')), check(octet_length(nonce)=12)
);
create table lab_private.provider_runtime (
 provider text primary key check(provider in ('openai','google','anthropic','mock')),
 enabled boolean not null default false, max_concurrency integer not null default 1
 check(max_concurrency between 1 and 4), min_interval_seconds integer not null default 2 check(min_interval_seconds>=0),
 next_dispatch_at timestamptz not null default now(), paused_until timestamptz,
 blocked_reason text, rpm_limit integer check(rpm_limit>0), tpm_limit bigint check(tpm_limit>0),
 metadata jsonb not null default '{}'::jsonb
);
create table lab_private.idempotency_requests (
 workspace_id uuid not null references lab.workspaces(id), actor_id uuid not null,
 request_key uuid not null, route text not null, body_sha256 text not null,
 safe_response jsonb, created_at timestamptz not null default now(),
 primary key(workspace_id,actor_id,route,request_key)
);

create function lab_private.reject_mutation() returns trigger
language plpgsql set search_path='' as $f$
begin raise exception 'IMMUTABLE_RESEARCH_RECORD: create a new version or attempt'; end
$f$;
create function lab_private.guard_revision() returns trigger
language plpgsql set search_path='' as $f$
declare a record;
begin
 if TG_OP='UPDATE' and OLD.status='approved' then
  raise exception 'APPROVED_REVISION_IMMUTABLE';
 end if;
 if NEW.status='approved' and NEW.input_mode='pdf' then
  select * into a from lab.assets where id=NEW.prepared_asset_id and workspace_id=NEW.workspace_id;
  if not found or a.kind<>'prepared_pdf' or a.bucket<>'lab-prepared' or a.status<>'verified'
   or a.sha256 is null then raise exception 'PREPARED_PDF_REQUIRED'; end if;
 end if;
 return NEW;
end $f$;
create trigger revision_guard before insert or update on lab.checkpoint_revisions
 for each row execute function lab_private.guard_revision();
create function lab_private.no_self_judge() returns trigger
language plpgsql set search_path='' as $f$
declare g text;
begin
 select generator_provider into g from lab.runs where id=NEW.run_id and workspace_id=NEW.workspace_id;
 if g=NEW.judge_provider then raise exception 'SELF_JUDGING_FORBIDDEN'; end if;
 return NEW;
end $f$;
create trigger usefulness_no_self before insert on lab.usefulness_ratings
 for each row execute function lab_private.no_self_judge();
create trigger agreement_no_self before insert on lab.agreement_ratings
 for each row execute function lab_private.no_self_judge();
do $f$
declare t text;
begin
 foreach t in array array['protocol_versions','ideas','selections','usefulness_ratings',
 'agreement_ratings','human_reviews','audit_events'] loop
  execute format('create trigger %I before update or delete on lab.%I for each row execute function lab_private.reject_mutation()','immutable_'||t,t);
 end loop;
end $f$;
create function lab_private.guard_plan_snapshot() returns trigger
language plpgsql set search_path='' as $f$
begin
 if NEW.workspace_id is distinct from OLD.workspace_id
 or NEW.protocol_id is distinct from OLD.protocol_id
 or NEW.transport is distinct from OLD.transport
 or NEW.cohort is distinct from OLD.cohort
 or NEW.frozen_config is distinct from OLD.frozen_config
 or NEW.frozen_sha256 is distinct from OLD.frozen_sha256
 or NEW.created_by is distinct from OLD.created_by
 or NEW.idempotency_key is distinct from OLD.idempotency_key
 or NEW.scheduled_at is distinct from OLD.scheduled_at then
  raise exception 'PLAN_SNAPSHOT_IMMUTABLE';
 end if;
 return NEW;
end $f$;
create trigger plan_snapshot_guard before update on lab.plans
 for each row execute function lab_private.guard_plan_snapshot();
create function lab_private.guard_run_snapshot() returns trigger
language plpgsql set search_path='' as $f$
begin
 if NEW.workspace_id is distinct from OLD.workspace_id
 or NEW.plan_id is distinct from OLD.plan_id
 or NEW.paper_id is distinct from OLD.paper_id
 or NEW.checkpoint_revision_id is distinct from OLD.checkpoint_revision_id
 or NEW.generator_provider is distinct from OLD.generator_provider
 or NEW.generator_model is distinct from OLD.generator_model
 or NEW.judge_models is distinct from OLD.judge_models
 or NEW.repeat_no is distinct from OLD.repeat_no
 or NEW.candidate_count is distinct from OLD.candidate_count
 or NEW.transport is distinct from OLD.transport
 or NEW.request_fingerprint is distinct from OLD.request_fingerprint
 or NEW.display_seed is distinct from OLD.display_seed then
  raise exception 'RUN_SNAPSHOT_IMMUTABLE';
 end if;
 return NEW;
end $f$;
create trigger run_snapshot_guard before update on lab.runs
 for each row execute function lab_private.guard_run_snapshot();
alter table lab.attempts add unique(workspace_id,job_id,id);
alter table lab.jobs add foreign key(workspace_id,id,accepted_attempt_id)
 references lab.attempts(workspace_id,job_id,id);

-- All research rows can be SELECTed by any active member of that workspace.
-- No browser INSERT/UPDATE/DELETE grants on business tables. Mutations use FastAPI.
do $f$
declare t text;
begin
 for t in select tablename from pg_tables where schemaname='lab' loop
  execute format('alter table lab.%I enable row level security',t);
  execute format('revoke all on lab.%I from anon, authenticated',t);
  execute format('grant select on lab.%I to authenticated',t);
  if t='workspaces' then
   execute format('create policy team_read on lab.%I for select to authenticated using (lab_private.is_member(id))',t);
  else
   execute format('create policy team_read on lab.%I for select to authenticated using (lab_private.is_member(workspace_id))',t);
  end if;
 end loop;
 for t in select tablename from pg_tables where schemaname='lab_private' loop
  execute format('alter table lab_private.%I enable row level security',t);
  execute format('revoke all on lab_private.%I from public,anon,authenticated',t);
 end loop;
end $f$;
revoke all on all functions in schema lab_private from public,anon,authenticated;
grant execute on function lab_private.is_member(uuid) to authenticated;
alter default privileges in schema lab_private revoke execute on functions from public;
alter default privileges in schema lab revoke all on tables from anon,authenticated;
alter default privileges in schema lab_private revoke all on tables from anon,authenticated;

-- Managed Storage bucket rows. Signed upload tokens are issued by the server
-- ONLY for a pre-reserved exact asset path. Browser receives no bucket credentials.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('lab-source','lab-source',false,104857600,array['application/pdf']),
 ('lab-prepared','lab-prepared',false,104857600,array['application/pdf','image/png']),
 ('lab-artifacts','lab-artifacts',false,104857600,array['application/json','text/plain']),
 ('lab-exports','lab-exports',false,2147483648,array[
  'application/zip','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do nothing;
-- No browser write policies: use signed, exact-path uploads with upsert=false.
-- SELECT requires real workspace membership, never merely the file uploader.
create policy lab_team_storage_read on storage.objects for select to authenticated using (
 bucket_id in ('lab-source','lab-prepared','lab-artifacts','lab-exports')
 and exists (
  select 1 from lab.assets a where a.bucket=storage.objects.bucket_id
  and a.object_path=storage.objects.name and a.status in ('uploaded','verified')
  and lab_private.is_member(a.workspace_id)
 )
);
commit;
