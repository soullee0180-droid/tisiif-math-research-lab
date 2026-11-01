-- Raise only the prepared PDF size limit; retain source/raw/archive limits and access policies.
alter table lab.assets drop constraint assets_check;
alter table lab.assets add constraint assets_check check (
  (kind='source' and bytes>0 and bytes<=41943040) or
  (kind='prepared' and bytes>0 and bytes<=33554432) or
  (kind='raw' and bytes<=1048576) or
  (kind='archives' and bytes<=16777216)
);
update storage.buckets set file_size_limit=33554432 where id='prepared';
