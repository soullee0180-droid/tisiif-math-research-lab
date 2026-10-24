begin;
create table if not exists lab_private.provider_files (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references lab.workspaces(id),
 provider text not null check(provider in ('google','openai','anthropic')),
 prepared_asset_id uuid not null, prepared_sha256 text not null,
 remote_file_id text not null, uploaded_at timestamptz not null default now(),
 expires_at timestamptz, last_verified_at timestamptz,
 status text not null check(status in ('active','expired','failed')),
 foreign key(workspace_id,prepared_asset_id) references lab.assets(workspace_id,id)
);
alter table lab_private.provider_files enable row level security;
revoke all on lab_private.provider_files from public,anon,authenticated;
create index if not exists provider_files_asset on lab_private.provider_files(workspace_id,provider,prepared_asset_id,status);
alter table lab.exports add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table lab.backup_runs add column if not exists metadata jsonb not null default '{}'::jsonb;
commit;


