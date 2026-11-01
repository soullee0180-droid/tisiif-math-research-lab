import {spawnSync} from 'node:child_process';
for (const name of ['database','pipeline','admission','public-access','shared-api','provider-files','reliability','research']) {
  const result=spawnSync(process.execPath,['--import','tsx',`tests/integration/${name}.ts`],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
