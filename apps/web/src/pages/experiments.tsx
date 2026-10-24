import {useState,useEffect} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import {api,time,names,providers,downloadAsset} from '../api/client';
import type {Row,PlanBody} from '../api/client';
import {useData,useActions,useUser,PageHeading,Table,Pager,Status,Empty,Loading,ErrorBox,Field,Modal,Tabs,SummaryCards,Markdown,Icon} from '../components';
export function PlanModal({onClose,revisionIds=[],paperIds=[]}:{onClose:()=>void;revisionIds?:string[];paperIds?:string[]}){
 const navigate=useNavigate(),action=useActions();
 const inputs=useData('/experiment-inputs'),profiles=useData('/model-profiles'),protocols=useData('/protocols');
 const[title,setTitle]=useState('실험 '+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date()));
 const[cohort,setCohort]=useState('pilot'),[transport,setTransport]=useState('api'),[chosen,setChosen]=useState(new Set(revisionIds)),[models,setModels]=useState<Row>({}),[protocol,setProtocol]=useState(''),[scheduled,setScheduled]=useState(false),[date,setDate]=useState(''),[search,setSearch]=useState('');
 useEffect(()=>{if(!protocol&&protocols.data?.items.length)setProtocol(protocols.data.items[0].id)},[protocols.data]);
 useEffect(()=>{if(paperIds.length&&inputs.data)setChosen(new Set(inputs.data.items.filter((r:Row)=>paperIds.includes(r.paper_id)).map((r:Row)=>r.id)))},[inputs.data]);
 const p=protocols.data?.items.find((p:Row)=>p.id===protocol);
 const count=chosen.size*3*(p?.definition.independent_repeats||2);
 async function begin(){
  const body:PlanBody={title,cohort:(transport==='mock'?'fixture':transport==='manual'?'manual':cohort) as PlanBody['cohort'],transport:transport as PlanBody['transport'],
   checkpoint_revision_ids:[...chosen],protocol_id:protocol,generator_profile_ids:transport==='mock'?{}:models,
   schedule:{mode:scheduled?'scheduled':'now',local_datetime:scheduled?date:null,timezone:'Asia/Seoul'}};
  const result=await action.act(async()=>{
   const checked=await api('/plans/preflight',body);
   return api('/plans',{...body,preflight_hash:checked.preflight_hash});
  });
  if(result){onClose();navigate('/experiments/'+result.plan_id)}
 }
 return <Modal title="새 실험" width={960} onClose={onClose} footer={<><span className="muted">입력·설정은 실행 시 고정됩니다.</span><button onClick={onClose}>취소</button><button disabled={action.busy||!chosen.size||!protocol} className="primary" onClick={begin}>{action.busy?'등록 중':scheduled?'예약 등록':'실험 시작'}</button></>}>
  <Field label="실험 이름"><input value={title} onChange={e=>setTitle(e.target.value)}/></Field>
  <div className="form-row"><Field label="구분"><select value={cohort} onChange={e=>setCohort(e.target.value)} disabled={transport!=='api'}><option value="pilot">예비실험</option><option value="main">본실험</option></select></Field><Field label="실행 경로"><div className="segmented">{[['api','API 자동'],['manual','웹 채팅 수동'],['mock','가상 검수']].map(([v,label])=><button key={v} className={transport===v?'active':''} onClick={()=>setTransport(v)}>{label}</button>)}</div></Field></div>
  <h3>분기점</h3><input aria-label="분기점 검색" placeholder="논문·분기점 검색" value={search} onChange={e=>setSearch(e.target.value)} style={{marginBottom:12}}/>
  <div className="actions" style={{marginBottom:12}}><button className="text-button" onClick={()=>setChosen(new Set((inputs.data?.items||[]).map((r:Row)=>r.id)))}>전체 선택</button><button className="text-button" onClick={()=>setChosen(new Set())}>선택 해제</button></div>
  <div className="checkbox-list">{inputs.isLoading?<Loading/>:inputs.data?.items.filter((r:Row)=>(r.paper_title+r.checkpoint_title+r.paper_code).toLowerCase().includes(search.toLowerCase())).map((r:Row)=><label key={r.id} className="check"><input type="checkbox" checked={chosen.has(r.id)} onChange={e=>setChosen(old=>{const n=new Set(old);e.target.checked?n.add(r.id):n.delete(r.id);return n})}/><span>{r.paper_code} · {r.checkpoint_code} {r.checkpoint_title} · v{r.version_no}</span></label>)}{inputs.data?.items.length===0&&<p className="muted">승인된 분기점이 없습니다. 공개 입력을 먼저 확인해 주세요.</p>}</div>
  <div className="grid-3">{providers.map(provider=><div className="model-card" key={provider}><h3>{names[provider]}</h3>{transport==='mock'?<p className="muted">합성 응답 · 실제 API 호출 없음</p>:<select aria-label={names[provider]+' 모델'} value={models[provider]||''} onChange={e=>setModels(old=>({...old,[provider]:e.target.value}))}><option value="">모델 선택</option>{profiles.data?.items.filter((m:Row)=>m.provider===provider).map((m:Row)=><option key={m.id} value={m.id} disabled={transport==='api'&&m.verification_status!=='passed'}>{m.label} · {m.model_id}{m.verification_status==='passed'?'':' · 미검증'}</option>)}</select>}</div>)}</div>
  <Field label="연구 프로토콜"><select value={protocol} onChange={e=>setProtocol(e.target.value)} style={{marginTop:16}}>{protocols.data?.items.map((p:Row)=><option value={p.id} key={p.id}>{p.name} · v{p.version_no}</option>)}</select><span className="muted">후보 {p?.definition.candidate_count||5}개 · 독립 반복 {p?.definition.independent_repeats||2}회</span></Field>
  <Field label="실행 시각"><div className="segmented"><button className={!scheduled?'active':''} onClick={()=>setScheduled(false)}>지금</button><button className={scheduled?'active':''} onClick={()=>setScheduled(true)}>예약</button></div>{scheduled&&<><input aria-label="예약 시각" type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/><span className="muted">Asia/Seoul</span></>}</Field>
  <div className="card" style={{background:'#F9FAFB',marginBottom:0}}>{chosen.size}분기점 × 3모델 × {p?.definition.independent_repeats||2}반복 = <strong>{count} run</strong><br/><span className="muted">기본 요청 {count*6}개 · 생성 후보 {count*(p?.definition.candidate_count||5)}개 · 추가 재시도 비용 미포함</span></div>
  <ErrorBox error={action.error||inputs.error||profiles.error||protocols.error}/>
 </Modal>
}
export function ExperimentsPage(){
 const navigate=useNavigate();const[open,setOpen]=useState(false),[q,setQ]=useState(''),[state,setState]=useState(''),[owner,setOwner]=useState(''),[cohort,setCohort]=useState(''),[fixture,setFixture]=useState(false),[page,setPage]=useState(0);
 const team=useData('/team');
 const query=useData('/plans?'+new URLSearchParams({q,status:state,created_by:owner,cohort,include_fixture:String(fixture),cursor:String(page)}),true);
 return <><PageHeading title="실험"><button className="primary" style={{width:144}} onClick={()=>setOpen(true)}>실험 만들기</button></PageHeading>
  <div className="toolbar"><input placeholder="실험 검색" aria-label="실험 검색" value={q} onChange={e=>{setQ(e.target.value);setPage(0)}}/><select aria-label="상태" value={state} onChange={e=>setState(e.target.value)}><option value="">전체 상태</option>{['running','scheduled','paused','completed','partial','cancelled'].map(s=><option key={s} value={s}>{({running:'실행 중',scheduled:'예약',paused:'일시정지',completed:'완료',partial:'일부 완료',cancelled:'취소'} as Row)[s]}</option>)}</select><select aria-label="등록자" value={owner} onChange={e=>setOwner(e.target.value)}><option value="">전체 팀원</option>{team.data?.items.map((m:Row)=><option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select><select aria-label="실험 구분" value={cohort} onChange={e=>setCohort(e.target.value)}><option value="">전체 구분</option><option value="pilot">예비실험</option><option value="main">본실험</option><option value="manual">수동</option><option value="fixture">가상 검수</option></select><label className="check"><input type="checkbox" checked={fixture} onChange={e=>setFixture(e.target.checked)}/>가상 검수 포함</label></div>
  <ErrorBox error={query.error} retry={()=>query.refetch()}/>
  {query.isLoading?<Loading/>:!query.data?.items.length?<Empty action={<button className="primary" onClick={()=>setOpen(true)}>실험 만들기</button>}>등록된 실험이 없습니다.</Empty>:<><Table rows={query.data.items} onRow={r=>navigate('/experiments/'+r.id)} columns={[{title:'제목',key:'title'},{title:'구분',render:r=><span className="badge">{r.cohort}</span>},{title:'전체 실행',key:'run_count'},{title:'진행률',render:r=><><div className="progress" style={{width:100}}><span style={{width:(r.job_count?r.completed_jobs/r.job_count*100:0)+'%'}}/></div><small className="muted">{r.completed_jobs}/{r.job_count}</small></>},{title:'상태',render:r=><Status value={r.status}/>},{title:'등록자',key:'created_by_name'},{title:'시작 시각',render:r=>time(r.scheduled_at||r.started_at||r.created_at)}]}/><Pager page={page} total={query.data.total} setPage={setPage}/></>}
  {open&&<PlanModal onClose={()=>setOpen(false)}/>}
 </>;
}
const stages:Row={generate:'생성',select:'선택',usefulness:'유용성',agreement:'일치도',prepare_pdf:'PDF 준비',export:'내보내기',backup:'백업',diagnostic:'연결 검사'};
export function JobDrawer({id,onClose}:{id:string;onClose:()=>void}){
 const query=useData('/jobs/'+id,true);const[tab,setTab]=useState('응답'),[reason,setReason]=useState(''),[raw,setRaw]=useState(''),[screen,setScreen]=useState(''),[mode,setMode]=useState(''),[when,setWhen]=useState(new Date().toISOString()),[tools,setTools]=useState('unknown'),[search,setSearch]=useState('unknown'),[memory,setMemory]=useState('unknown'),[mapped,setMapped]=useState(''),[correction,setCorrection]=useState('');
 const action=useActions();const job=query.data;const latest=job?.attempts.at(-1);
 const manual=useData('/jobs/'+id+'/manual-prompt',false,['needs_input','needs_review'].includes(job?.status));
 const[manualTab,setManualTab]=useState('원문 응답');
 const row=latest&&job?.contents;
 const request=latest&&row?.[latest.request_asset_id],response=latest&&row?.[latest.raw_text_asset_id];
 return <div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="drawer" role="dialog" aria-modal="true" aria-label="단계 상세"><div className="modal-title"><h2>{stages[job?.phase]||'단계'} 상세</h2><button aria-label="닫기" className="icon-button" onClick={onClose}><Icon name="close"/></button></div><ErrorBox error={query.error||action.error}/>{job&&<><Status value={job.status}/><p className="muted">{latest?.returned_model||latest?.requested_model||''} · 요청 {time(latest?.sent_at)} · 응답 {time(latest?.received_at)}</p><Tabs items={['응답','실제 입력','오류']} value={tab} onChange={setTab}/>
  {tab==='응답'&&(response?<><Markdown text={response}/><button onClick={()=>downloadAsset(latest.raw_text_asset_id)}>원문 응답 다운로드</button></>:<p className="muted">저장된 응답이 없습니다.</p>)}
  {tab==='실제 입력'&&(request?<pre>{request}</pre>:<p className="muted">아직 전송하지 않았습니다.</p>)}
  {tab==='오류'&&<><p>{job.error_message||'기록된 오류가 없습니다.'}</p><p className="muted">{job.error_class}</p>{['failed','needs_review','unknown_remote','blocked'].includes(job.status)&&<><Field label="재시도 이유"><input value={reason} onChange={e=>setReason(e.target.value)}/></Field>{job.status==='unknown_remote'&&<button onClick={()=>action.act(async()=>{const r=await api('/jobs/'+id+'/check-remote',{});action.setError(r.message);return r})}>원격 상태 확인</button>}<button disabled={!reason.trim()||action.busy} onClick={()=>{const uncertain=job.status==='unknown_remote';if(uncertain&&!confirm('원격 처리가 이미 완료되어 중복 실행·과금될 수 있습니다. 새 시도를 등록하시겠습니까?'))return;action.act(()=>api('/jobs/'+id+'/retry',{reason,acknowledge_duplicate_risk:uncertain}))}}>{job.status==='unknown_remote'?'중복 실행 가능성을 확인하고 새 시도':'이 단계 재시도'}</button></>}</>}
  {manual.data&&<section className="card" style={{marginTop:24}}><h3>수동 응답 등록</h3><div className="actions"><button onClick={()=>navigator.clipboard.writeText(manual.data!.prompt)}>질문 복사</button><a href={manual.data.service_url} target="_blank" rel="noopener noreferrer">서비스 열기</a>{manual.data.prepared_asset_id&&<button onClick={()=>downloadAsset(manual.data!.prepared_asset_id)}>전송 PDF 다운로드</button>}</div><details><summary>질문 보기</summary><pre>{manual.data.prompt}</pre></details><Field label="원문 응답"><textarea rows={10} value={raw} onChange={e=>setRaw(e.target.value)}/></Field><div className="grid-2"><Field label="실제 화면 모델명"><input value={screen} onChange={e=>setScreen(e.target.value)}/></Field><Field label="모드"><input value={mode} onChange={e=>setMode(e.target.value)}/></Field></div><Field label="응답 시각 (ISO8601)"><input value={when} onChange={e=>setWhen(e.target.value)}/></Field><div className="grid-3">{[['도구',tools,setTools],['검색',search,setSearch],['메모리',memory,setMemory]].map(([label,v,set]:any)=><Field label={label} key={label}><select value={v} onChange={e=>set(e.target.value)}><option value="unknown">미확인</option><option value="off">꺼짐</option><option value="on">켜짐</option></select></Field>)}</div><details><summary>JSON이 아닌 응답 수동 대응</summary><Field label="대응 JSON"><textarea rows={8} value={mapped} onChange={e=>setMapped(e.target.value)}/></Field><Field label="보정 이유"><input value={correction} onChange={e=>setCorrection(e.target.value)}/></Field></details><button className="primary" disabled={!raw||!screen||action.busy} onClick={()=>action.act(()=>api('/jobs/'+id+'/manual-response',{raw_text:raw,screen_model:screen,mode,occurred_at:when,tools,web_search:search,memory,conversation_url:null,mapped_response:mapped?JSON.parse(mapped):null,correction_reason:correction||null}))}>응답 등록</button></section>}
 </>}</aside></div>
}
export function ExperimentPage(){
 const{id}=useParams();const navigate=useNavigate();const user=useUser();const action=useActions();
 const plan=useData('/plans/'+id,true),runs=useData('/plans/'+id+'/runs',true);
 const[tab,setTab]=useState('실행 목록'),[job,setJob]=useState<string|null>(null);
 if(plan.isLoading)return <Loading/>;
 if(plan.error)return <ErrorBox error={plan.error} retry={()=>plan.refetch()}/>;
 const row=plan.data!,control=user.role==='admin'||user.user_id===row.created_by;
 const progress=row.progress.total?row.progress.completed/row.progress.total*100:0;
 async function change(actionName:string){if(actionName==='cancel'&&!confirm('미전송 작업을 취소하시겠습니까? 이미 전송한 요청은 계속 수집합니다.'))return;await action.act(()=>api('/plans/'+id+'/'+actionName,{}))}
 function stage(r:Row,phase:string){return <div className="actions">{r.jobs.filter((j:Row)=>j.phase===phase).map((j:Row)=><button key={j.id} className="text-button" title={(names[j.judge_provider]||'')+' '+stages[phase]} onClick={()=>setJob(j.id)}><Status value={j.status}/></button>)}</div>}
 return <><PageHeading title={row.title}><Status value={row.status}/><button onClick={()=>navigate('/results?plan='+id)}>결과 보기</button>{control&&!['completed','cancelled'].includes(row.status)&&<><button disabled={action.busy} onClick={()=>change(row.status==='paused'?'resume':'pause')}>{row.status==='paused'?'재개':'일시정지'}</button><button className="danger" onClick={()=>change('cancel')}>취소</button></>}</PageHeading><p className="subtitle">{time(row.created_at)} · {row.transport} · 프로토콜 고정</p><ErrorBox error={action.error}/>
  <SummaryCards items={[{label:'전체 실행',value:runs.data?.total||0},{label:'완료 단계',value:row.progress.completed},{label:'확인 필요',value:row.progress.review},{label:'진행률',value:progress.toFixed(1)+'%'}]}/><div className="progress"><span style={{width:progress+'%'}}/></div><p className="muted" style={{marginTop:8}}>{row.progress.completed} / {row.progress.total} 단계</p>
  <Tabs items={['실행 목록','고정 입력·설정','오류 이력']} value={tab} onChange={setTab}/>
  {tab==='실행 목록'&&(runs.isLoading?<Loading/>:<Table rows={runs.data?.items||[]} columns={[{title:'논문',key:'paper_code'},{title:'분기점·버전',render:r=>r.checkpoint_code+' · v'+r.version_no},{title:'생성 모델',render:r=>names[r.generator_provider]},{title:'반복',key:'repeat_no'},{title:'생성',render:r=>stage(r,'generate')},{title:'선택',render:r=>stage(r,'select')},{title:'유용성 2개',render:r=>stage(r,'usefulness')},{title:'일치도 2개',render:r=>stage(r,'agreement')},{title:'전체 상태',render:r=><Status value={r.status}/>} ]}/> )}
  {tab==='고정 입력·설정'&&<div className="card"><pre>{JSON.stringify(row.frozen_config,null,2)}</pre><p className="muted">{row.frozen_sha256}</p></div>}
  {tab==='오류 이력'&&<Table rows={(runs.data?.items||[]).flatMap((r:Row)=>r.jobs.filter((j:Row)=>j.error_class))} onRow={r=>setJob(r.id)} columns={[{title:'단계',render:r=>stages[r.phase]},{title:'오류 유형',key:'error_class'},{title:'안내',key:'error_message'},{title:'상태',render:r=><Status value={r.status}/>}]}/>}
  {job&&<JobDrawer id={job} onClose={()=>setJob(null)}/>}
 </>;
}
export function QueuePage(){
 const[status,setStatus]=useState(''),[provider,setProvider]=useState(''),[plan,setPlan]=useState(''),[page,setPage]=useState(0),[job,setJob]=useState<string|null>(null);
 const query=useData('/jobs?'+new URLSearchParams({status,provider,plan_id:plan,cursor:String(page)}),true);
 const plans=useData('/plans?include_fixture=true&limit=100'),user=useUser(),action=useActions();
 const beats=query.data?.heartbeats||[];const stale=!beats.length||beats.every((b:Row)=>Date.now()-new Date(b.heartbeat_at).getTime()>45000);
 return <><PageHeading title="진행 상황">{user.role==='admin'&&<button disabled={action.busy} onClick={()=>action.act(async()=>{const current=await api('/admin/providers');for(const r of current.items)await api('/admin/providers/'+r.provider+'/runtime',{enabled:false,max_concurrency:r.max_concurrency,min_interval_seconds:r.min_interval_seconds,rpm_limit:r.rpm_limit,tpm_limit:r.tpm_limit},'PATCH');return true})}>전체 일시정지</button>}</PageHeading>
  {stale&&<div className="notice">실행기 연결 확인 필요 {user.role==='admin'&&<a href="/settings">진단 보기</a>}</div>}
  <div className="grid-3" style={{marginBottom:24}}>{providers.map(p=>{const r=query.data?.providers.find((r:Row)=>r.provider===p);return <div className="card" key={p}><h3>{names[p]}</h3><Status value={r?.blocked_reason?'needs_review':r?.enabled?'running':'paused'}/><p className="muted">{r?.blocked_reason|| (r?.paused_until?'한도 대기 · '+time(r.paused_until):'대기열의 제공사 공통 제한 적용')}</p>{user.role==='admin'&&<a href="/settings">설정</a>}</div>})}</div>
  <div className="toolbar"><select aria-label="작업 상태" value={status} onChange={e=>setStatus(e.target.value)}><option value="">전체 상태</option><option value="queued">대기</option><option value="dispatching">진행</option><option value="review">확인 필요·오류</option></select><select aria-label="제공사" value={provider} onChange={e=>setProvider(e.target.value)}><option value="">전체 제공사</option>{[...providers,'mock'].map(p=><option value={p} key={p}>{names[p]}</option>)}</select><select aria-label="계획" value={plan} onChange={e=>setPlan(e.target.value)}><option value="">전체 계획</option>{plans.data?.items.map((p:Row)=><option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
  <ErrorBox error={query.error||action.error} retry={()=>query.refetch()}/>
  {query.isLoading?<Loading/>:!query.data?.items.length?<Empty>등록된 작업이 없습니다.</Empty>:<><Table rows={query.data.items} onRow={r=>setJob(r.id)} columns={[{title:'계획',key:'plan_title'},{title:'논문·분기점',render:r=>(r.paper_code||'')+' '+(r.checkpoint_code||'')},{title:'단계',render:r=>stages[r.phase]},{title:'제공사',render:r=>names[r.provider]||'—'},{title:'상태',render:r=><Status value={r.status}/>},{title:'시도 수',key:'attempt_count'},{title:'최근 변경',render:r=>time(r.updated_at)},{title:'',render:()=> '보기'}]}/><Pager size={50} page={page} total={query.data.total} setPage={setPage}/></>}
  {job&&<JobDrawer id={job} onClose={()=>setJob(null)}/>}
 </>;
}

