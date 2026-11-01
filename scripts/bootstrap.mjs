// Generate reviewed bootstrap SQL on the client. Execute only after migrations.
import{readFile}from'node:fs/promises';const quote=s=>"'"+s.replaceAll("'","''")+"'";const protocol=await readFile('packages/contracts/research-protocol.json','utf8');JSON.parse(protocol);
process.stdout.write(`do $$ declare w uuid;begin
if exists(select 1 from lab.workspaces where active) then raise exception 'BOOTSTRAP_ALREADY_RUN';end if;
insert into lab.workspaces(name,active,settings) values('TISIIF Math Research Lab',true,'{"api_enabled":false,"scheduler_enabled":false,"access_mode":"public"}') returning id into w;
insert into lab.members(id,workspace_id,id_email,role) values(gen_random_uuid(),w,'public@lab.invalid','researcher');
insert into lab.protocol_versions(workspace_id,body,sha256) values(w,${quote(protocol)}::jsonb,lab_private.hash(${quote(protocol)}::jsonb));
insert into lab_private.usage_budgets(workspace_id,provider) values(w,'google'),(w,'openai'),(w,'anthropic');
end $$;\n`);
