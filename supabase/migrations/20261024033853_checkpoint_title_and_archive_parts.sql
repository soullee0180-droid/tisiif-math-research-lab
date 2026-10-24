begin;
alter table lab.checkpoint_revisions add column if not exists title text not null default '' check(length(title)<=300);
update storage.buckets set allowed_mime_types=array['application/zip','application/json','application/octet-stream','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] where id='lab-exports';
commit;
