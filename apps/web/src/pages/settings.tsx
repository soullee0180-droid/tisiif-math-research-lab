import {useEffect,useState} from 'react';
import {api,names,providers,time,downloadAsset} from '../api/client';
import type {Row} from '../api/client';
import {useData,useActions,PageHeading,Tabs,Field,Modal,ErrorBox,Status,Table,Loading} from '../components';

function ProviderCard({provider,runtime,profiles}:{provider:string;runtime:Row;profiles:Row[]}){
 const action=useActions();
 const[key,setKey]=useState(''),[modal,setModal]=useState(false),[modelList,setModelList]=useState<Row[]>([]);
 const[enabled,setEnabled]=useState(runtime.enabled),[eligible,setEligible]=useState(!!runtime.metadata?.eligibility_confirmed),[concurrency,setConcurrency]=useState(runtime.max_concurrency),[interval,setInterval]=useState(runtime.min_interval_seconds),[rpm,setRpm]=useState(runtime.rpm_limit||''),[tpm,setTpm]=useState(runtime.tpm_limit||''),[profile,setProfile]=useState(profiles[0]?.id||'');
 const[label,setLabel]=useState(''),[modelId,setModelId]=useState(''),[reasoning,setReasoning]=useState('{}'),[cap,setCap]=useState('8000'),[maxBytes,setMaxBytes]=useState('20'),[maxPages,setMaxPages]=useState('60'),[maxContext,setMaxContext]=useState(''),[source,setSource]=useState(''),[manual,setManual]=useState(false),[pdf,setPdf]=useState(true),[structured,setStructured]=useState(true),[jobId,setJobId]=useState('');
 const diagnostic=useData('/jobs/'+jobId,true,!!jobId);
 useEffect(()=>{if(!profile&&profiles.length)setProfile(profiles[0].id)},[profiles]);
 async function saveRuntime(clear=false){return action.act(()=>api('/admin/providers/'+provider+'/runtime',{enabled,max_concurrency:Number(concurrency),min_interval_seconds:Number(interval),rpm_limit:rpm?Number(rpm):null,tpm_limit:tpm?Number(tpm):null,clear_block:clear,eligibility_confirmed:eligible},'PATCH'))}
 async function saveProfile(){
  const result=await action.act(()=>api('/admin/model-profiles',{provider,label,model_id:modelId,
   config:{api_family:provider==='google'?'generate_content':provider==='openai'?'responses':'messages',reasoning:{mode:'configured',provider_parameters:JSON.parse(reasoning)},max_visible_output_target_by_stage:{generate:Number(cap),select:2500,usefulness:Number(cap),agreement:Number(cap)},temperature:null,tools:[],store:false,sdk_auto_retries:0},
   capabilities:{pdf_supported:pdf,structured_output_supported:structured,max_pdf_bytes:Number(maxBytes)*1024*1024,max_pdf_pages:Number(maxPages),max_context_tokens:maxContext?Number(maxContext):null,official_source_url:source,verified_at:null},manual_only:manual}));
  if(result){setModal(false);setProfile(result.id)}
 }
 return <section className="card"><div className="settings-card-heading"><h3>{names[provider]}</h3><button disabled={!profile||action.busy} onClick={()=>action.act(async()=>{const r=await api('/admin/providers/'+provider+'/test',{profile_id:profile,allow_one_paid_request:true});setJobId(r.job_id);return r})}>연결 검사</button></div>
  <div className="muted" style={{textAlign:'right',marginTop:-12,marginBottom:16}}>실제 요청 1회</div>
  <div className="form-row"><Field label={runtime.key?'API 키 · 설정됨 (…'+runtime.key.last_four+')':'API 키 · 미설정'}><input type="password" autoComplete="new-password" placeholder="새 API 키 입력" value={key} onChange={e=>setKey(e.target.value)}/></Field><button disabled={!key||action.busy} style={{marginBottom:16}} onClick={()=>action.act(async()=>{const r=await api('/admin/providers/'+provider+'/key',{key},'PUT');setKey('');return r})}>저장</button></div>
  <div className="form-row"><Field label="모델 프로필"><select value={profile} onChange={e=>setProfile(e.target.value)}><option value="">모델 선택</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.label} · {p.model_id} · {p.verification_status}</option>)}</select></Field><button style={{marginBottom:16}} onClick={()=>setModal(true)}>새 프로필</button></div>
  <div className="grid-3"><Field label="동시성"><input type="number" min={1} max={4} value={concurrency} onChange={e=>setConcurrency(e.target.value)}/></Field><Field label="최소 간격 (초)"><input type="number" min={0} value={interval} onChange={e=>setInterval(e.target.value)}/></Field><Field label="RPM · 비우면 미확인"><input type="number" min={1} value={rpm} onChange={e=>setRpm(e.target.value)}/></Field></div>
  <Field label="TPM · 비우면 미확인"><input type="number" min={1} value={tpm} onChange={e=>setTpm(e.target.value)}/></Field>
  <label className="check"><input type="checkbox" checked={eligible} onChange={e=>setEligible(e.target.checked)}/>이 제공사의 API 이용 조건을 확인했습니다.</label><label className="check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>새 작업 배정</label>
  <div className="actions" style={{marginTop:16}}><button disabled={action.busy} onClick={()=>saveRuntime(false)}>한도·상태 저장</button>{runtime.blocked_reason&&<button disabled={action.busy} onClick={()=>saveRuntime(true)}>차단 사유 확인 후 재개</button>}<span className="muted">{runtime.blocked_reason||''}</span></div>
  {diagnostic.data&&<p className="muted"><Status value={diagnostic.data.status}/> · {diagnostic.data.payload?.result?.scope||diagnostic.data.error_message||'합성 자료로 JSON·PDF 연결을 검사합니다.'}</p>}
  <ErrorBox error={action.error}/>
  {modal&&<Modal title={names[provider]+' 모델 프로필'} width={800} onClose={()=>setModal(false)} footer={<><button onClick={()=>setModal(false)}>취소</button><button className="primary" disabled={!label||!modelId||!source||action.busy} onClick={saveProfile}>새 버전 저장</button></>}>
   <div className="actions" style={{marginBottom:16}}><button disabled={action.busy} onClick={()=>action.act(async()=>{const r=await api('/admin/providers/'+provider+'/models');setModelList(r.items);return r})}>실제 모델 목록 조회</button><span className="muted">목록 조회와 실제 응답 검사는 별도입니다.</span></div>
   {modelList.length>0&&<Field label="현재 접근 가능한 모델"><select value={modelId} onChange={e=>setModelId(e.target.value)}><option value="">모델 선택</option>{modelList.map(m=><option key={m.id} value={m.id}>{m.id}</option>)}</select></Field>}
   <div className="grid-2"><Field label="표시명"><input value={label} onChange={e=>setLabel(e.target.value)}/></Field><Field label="정확한 model ID"><input value={modelId} onChange={e=>setModelId(e.target.value)}/></Field></div>
   <label className="check"><input type="checkbox" checked={manual} onChange={e=>setManual(e.target.checked)}/>웹 채팅 수동용 프로필</label>
   <Field label="추론·thinking 파라미터 (공식 API JSON)"><textarea value={reasoning} onChange={e=>setReasoning(e.target.value)}/></Field>
   <div className="grid-3"><Field label="가시 출력 목표"><input type="number" value={cap} onChange={e=>setCap(e.target.value)}/></Field><Field label="PDF 한도 (MiB)"><input type="number" value={maxBytes} onChange={e=>setMaxBytes(e.target.value)}/></Field><Field label="PDF 페이지 한도"><input type="number" value={maxPages} onChange={e=>setMaxPages(e.target.value)}/></Field></div>
   <Field label="문맥 한도 (미확인 시 비움)"><input type="number" value={maxContext} onChange={e=>setMaxContext(e.target.value)}/></Field><Field label="검증한 공식 문서 URL"><input value={source} onChange={e=>setSource(e.target.value)}/></Field>
   <div className="actions"><label className="check"><input type="checkbox" checked={pdf} onChange={e=>setPdf(e.target.checked)}/>PDF 지원</label><label className="check"><input type="checkbox" checked={structured} onChange={e=>setStructured(e.target.checked)}/>구조화 출력 지원</label></div><ErrorBox error={action.error}/>
  </Modal>}
 </section>;
}
function Protocols(){
 const query=useData('/admin/protocols'),action=useActions();const[draft,setDraft]=useState<Row|null>(null),[name,setName]=useState(''),[reason,setReason]=useState('');
 return <>{query.isLoading?<Loading/>:query.data?.items.map((p:Row)=><div className="card" key={p.id}><div className="settings-card-heading"><h3>{p.name} · v{p.version_no}</h3><button onClick={()=>{setDraft(JSON.parse(JSON.stringify(p.definition)));setName(p.name);setReason('')}}>복제하여 새 버전</button></div><p className="muted">후보 {p.definition.candidate_count}개 · 독립 반복 {p.definition.independent_repeats}회</p><details><summary>고정 질문·척도</summary><pre>{JSON.stringify(p.definition,null,2)}</pre></details></div>)}<ErrorBox error={query.error||action.error}/>
 {draft&&<Modal title="새 프로토콜 버전" width={960} onClose={()=>setDraft(null)} footer={<><button onClick={()=>setDraft(null)}>취소</button><button className="primary" disabled={!reason||action.busy} onClick={async()=>{const r=await action.act(()=>api('/admin/protocols',{name,definition:draft,change_reason:reason}));if(r)setDraft(null)}}>새 버전 저장</button></>}>
  <Field label="이름"><input value={name} onChange={e=>setName(e.target.value)}/></Field><div className="grid-2"><Field label="후보 수"><input type="number" min={1} max={10} value={draft.candidate_count} onChange={e=>setDraft({...draft,candidate_count:Number(e.target.value)})}/></Field><Field label="독립 반복"><input type="number" min={1} max={10} value={draft.independent_repeats} onChange={e=>setDraft({...draft,independent_repeats:Number(e.target.value)})}/></Field></div>
  {['generate','select','usefulness','agreement'].map(phase=><details key={phase}><summary>{phase}</summary>{['system','user_template'].map(field=><Field key={field} label={field}><textarea rows={8} value={draft.prompts[phase][field]} onChange={e=>setDraft({...draft,prompts:{...draft.prompts,[phase]:{...draft.prompts[phase],[field]:e.target.value}}})}/></Field>)}</details>)}
  <Field label="변경 이유"><textarea value={reason} onChange={e=>setReason(e.target.value)}/></Field><ErrorBox error={action.error}/>
 </Modal>}</>;
}
function Members(){
 const query=useData('/admin/members'),action=useActions();
 const[email,setEmail]=useState(''),[role,setRole]=useState('researcher');
 return <><div className="card"><h3>팀원 추가</h3><div className="form-row"><Field label="Google 이메일"><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field label="역할"><select value={role} onChange={e=>setRole(e.target.value)}><option value="researcher">연구자</option><option value="admin">관리자</option></select></Field><button disabled={!email||action.busy} style={{marginBottom:16}} onClick={()=>action.act(async()=>{const r=await api('/admin/members',{email,role,active:true},'PATCH');setEmail('');return r})}>추가</button></div></div>
  <Table rows={query.data?.items||[]} columns={[{title:'허용 이메일',key:'email'},{title:'역할',render:r=><select aria-label={r.email+' 역할'} value={r.role} disabled={action.busy} onChange={e=>action.act(()=>api('/admin/members',{email:r.email,role:e.target.value,active:r.active},'PATCH'))}><option value="researcher">연구자</option><option value="admin">관리자</option></select>},{title:'로그인',render:r=>r.user_id?'등록됨':'로그인 전'},{title:'활성',render:r=><input aria-label={r.email+' 활성'} type="checkbox" checked={r.active} disabled={action.busy} onChange={e=>action.act(()=>api('/admin/members',{email:r.email,role:r.role,active:e.target.checked},'PATCH'))}/>} ]}/>
  <ErrorBox error={query.error||action.error}/>
 </>;
}
function Operations(){
 const query=useData('/admin/health',true),backups=useData('/admin/backups',true),action=useActions();
 const[asset,setAsset]=useState(''),[restore,setRestore]=useState<Row|null>(null),[jobId,setJobId]=useState('');
 const job=useData('/jobs/'+jobId,true,!!jobId);const health=query.data;
 return <><div className="card"><h3>운영 상태</h3>{health&&<><Field label="Build SHA"><span className="filename">{health.build_sha||'미설정'}</span></Field><Field label="DB 연결"><Status value={health.database?'passed':'failed'}/></Field><Field label="실행기"><span>{health.heartbeats.length?health.heartbeats.map((b:Row)=>b.worker_name+' · '+time(b.heartbeat_at)).join(' / '):'실행기 연결 확인 필요'}</span></Field><Field label="최근 백업"><span>{health.latest_backup?time(health.latest_backup.started_at)+' · '+health.latest_backup.status:'백업 없음'}</span></Field><Field label="최근 복원 검수"><span>{health.latest_restore?time(health.latest_restore.created_at):'미검증'}</span></Field><p className="muted">{health.independent_copy}</p><details><summary>연결·버킷 세부 상태</summary><pre>{JSON.stringify({settings_present:health.settings_present,buckets:health.buckets},null,2)}</pre></details></>}</div>
  <div className="card"><h3>연구 백업·복원</h3><div className="actions" style={{marginBottom:20}}><button disabled={action.busy} onClick={()=>action.act(async()=>{const r=await api('/admin/backups',{include_source:true});setJobId(r.job_id);return r})}>연구 백업 생성</button><button disabled={!health?.latest_backup?.metadata?.asset_id} onClick={()=>downloadAsset(health!.latest_backup.metadata.asset_id)}>백업 다운로드</button></div>
  {!!health?.latest_backup?.metadata?.parts?.length&&<details><summary>백업 분할 파일</summary>{health.latest_backup.metadata.parts.map((p:Row)=><button key={p.asset_id} onClick={()=>downloadAsset(p.asset_id)}>{p.name}</button>)}</details>}
  <Field label="복원할 연구 백업"><select value={asset} onChange={e=>setAsset(e.target.value)}><option value="">백업 선택</option>{backups.data?.items.filter((b:Row)=>b.status==='completed'&&b.metadata?.asset_id).map((b:Row)=><option key={b.id} value={b.metadata.asset_id}>{time(b.started_at)} · {(b.byte_size/1024/1024).toFixed(1)} MiB</option>)}</select></Field><button disabled={!asset||action.busy} onClick={()=>action.act(async()=>{const r=await api('/admin/restore-preflight',{asset_id:asset});setRestore(r);return r})}>새 공간으로 복원</button>
  {job.data&&<p className="muted"><Status value={job.data.status}/> {job.data.error_message||''}{job.data.payload?.result?.workspace_id?' · 새 비활성 공간 '+job.data.payload.result.workspace_id:''}</p>}
  <ErrorBox error={query.error||action.error}/>
  </div>
  {restore&&<Modal title="새 비활성 공간으로 복원" width={640} onClose={()=>setRestore(null)} footer={<><button onClick={()=>setRestore(null)}>취소</button><button className="primary" disabled={action.busy} onClick={()=>action.act(async()=>{const r=await api('/admin/restore',{asset_id:asset,expected_manifest_hash:restore.manifest_hash});setJobId(r.job_id);setRestore(null);return r})}>복원</button></>}><p>파일 {restore.asset_count}개를 새 비활성 연구 공간에 복원합니다.</p><pre>{JSON.stringify(restore.table_counts,null,2)}</pre><p className="muted">현재 연구 공간을 덮어쓰지 않습니다. 복원된 실험은 일시정지 상태로 유지합니다.</p></Modal>}
 </>;
}
export function SettingsPage(){
 const[tab,setTab]=useState('연결·모델');const query=useData('/admin/providers',true),profiles=useData('/model-profiles',true);
 return <><PageHeading title="설정"/><Tabs items={['연결·모델','프로토콜','팀원','운영']} value={tab} onChange={setTab}/>
 {tab==='연결·모델'?<>{query.isLoading?<Loading/>:providers.map(provider=>{const r=query.data?.items.find((r:Row)=>r.provider===provider);return r?<ProviderCard key={provider} provider={provider} runtime={r} profiles={profiles.data?.items.filter((p:Row)=>p.provider===provider)||[]}/>:null})}<ErrorBox error={query.error||profiles.error}/></>:tab==='프로토콜'?<Protocols/>:tab==='팀원'?<Members/>:<Operations/>}
 </>;
}

