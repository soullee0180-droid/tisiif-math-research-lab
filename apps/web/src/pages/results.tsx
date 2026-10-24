import {useEffect,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {api,time,names,providers,downloadAsset} from '../api/client';
import type {Row} from '../api/client';
import {useData,useActions,PageHeading,Tabs,Table,Pager,Empty,Loading,ErrorBox,Field,Modal,Markdown,useUser} from '../components';

function NumberBar({value,max=4,percent=false}:{value:number|null|undefined;max?:number;percent?:boolean}){
 if(value===null||value===undefined)return <span className="muted">자료 없음</span>;
 return <span><span className="bar"><i style={{width:Math.max(0,Math.min(100,value/max*100))+'%'}}/></span>{percent?(value*100).toFixed(1)+'%':value.toFixed(2)}</span>
}
function IdeaDetail({id}:{id:string}){
 const query=useData('/runs/'+id,true);
 if(query.isLoading)return <Loading/>;
 if(query.error)return <ErrorBox error={query.error}/>;
 const r=query.data!;
 const snap=r.frozen_config?.inputs[r.checkpoint_revision_id];
 return <><details className="card"><summary>공개 입력</summary><Markdown text={snap?.goal||''}/><Markdown text={snap?.public_context.public_text||''}/>{snap?.prepared_asset_id&&<button onClick={()=>downloadAsset(snap.prepared_asset_id)}>전송 PDF 다운로드</button>}</details>
  {r.ideas?.map((i:Row)=><article className="idea-card" key={i.id}><div className="idea-heading"><strong>{i.candidate_id} · {i.title}</strong>{i.selected&&<span className="badge">선택됨</span>}</div><p className="muted">유용성 {i.u.length===2&&i.u.every((x:unknown)=>typeof x==='number')?((i.u[0]+i.u[1])/2).toFixed(2):'판단 자료 부족'} · 일치도 {i.match.join(' / ')||'평가 대기'}{r.metrics.review_flags.includes(i.candidate_id)?' · 검토 필요':''}</p><Markdown text={i.idea_md}/><details open><summary>도움이 되는 이유</summary><Markdown text={i.why_helpful_md}/></details><details><summary>다음 단계·가정·미검증 사항</summary>{[['다음 단계',i.next_steps],['가정',i.assumptions],['미검증',i.unverified_points]].map(([s,vals]:any)=><div key={s}><strong>{s}</strong>{vals.map((v:string,j:number)=><Markdown key={j} text={v}/>)}</div>)}</details><details><summary>평가 근거</summary>{i.usefulness_ratings.map((v:Row)=><div key={v.id}><strong>{names[v.judge_provider]} · {v.score===null?'판단 불가':v.score+'점'} · {v.validity}</strong><Markdown text={v.rationale_md}/><p className="muted">{v.unable_reason}</p></div>)}{i.agreement_ratings.map((v:Row)=><div key={v.id}><strong>{names[v.judge_provider]} · {v.label}</strong><Markdown text={v.rationale_md}/><p className="muted">{v.unable_reason}</p></div>)}</details></article>)}
  <details className="card"><summary>기준 아이디어</summary><Markdown text={r.frozen_config?.references[r.checkpoint_revision_id]||''}/></details>
 </>;
}
function ReviewDetail({id,onDone}:{id:string;onDone:()=>void}){
 const query=useData('/review-assignments/'+id);const action=useActions();
 const[editing,setEditing]=useState(''),[correction,setCorrection]=useState('');
 const[score,setScore]=useState(''),[validity,setValidity]=useState('promising_unverified'),[label,setLabel]=useState('none'),[reason,setReason]=useState(''),[unable,setUnable]=useState('');
 useEffect(()=>{setScore('');setReason('');setUnable('')},[id,query.data?.phase]);
 if(query.isLoading)return <Loading/>;
 if(query.error)return <ErrorBox error={query.error}/>;
 const row=query.data!;const usefulness=(editing||row.phase)==='usefulness';const done=row.phase==='done'&&!editing;
 const previous=row.own_reviews.filter((r:Row)=>r.phase===(usefulness?'usefulness':'agreement')).at(-1);
 async function submit(){
  const body={phase:usefulness?'usefulness':'agreement',score:usefulness&&score!==''?Number(score):null,
   validity:usefulness?validity:null,agreement_label:usefulness?null:label,rationale_md:reason,
   unable_reason:unable||null,expected_revision_no:previous?.revision_no||0,correction_reason:editing?correction:null};
  const result=await action.act(()=>api('/review-assignments/'+id+'/submit',body));
  if(result){setEditing('');setCorrection('');await query.refetch();onDone()}
 }
 return <div className="card"><h3>{row.display_code} · {done?'검토 완료':usefulness?'유용성 검토':'일치도 검토'}</h3>
  <details><summary>공개 입력</summary><Markdown text={row.public_input.goal}/><Markdown text={row.public_input.obstacle}/><Markdown text={row.public_input.public_context.public_text}/>{row.public_input.prepared_asset_id&&<button onClick={()=>downloadAsset(row.public_input.prepared_asset_id)}>공개 PDF</button>}</details>
  <h3 style={{marginTop:24}}>{row.idea.title}</h3><Markdown text={row.idea.idea_md}/><Markdown text={row.idea.why_helpful_md}/>
  {row.reference_idea_md&&<section><h3>기준 아이디어</h3><Markdown text={row.reference_idea_md}/></section>}
  {done?<><p className="muted">최초 판단은 보존됩니다.</p><div className="actions"><button onClick={()=>setEditing('usefulness')}>유용성 수정본 등록</button><button onClick={()=>setEditing('agreement')}>일치도 수정본 등록</button></div>{row.own_reviews.map((v:Row)=><div key={v.phase+v.revision_no}><strong>{v.phase} · v{v.revision_no}</strong><Markdown text={v.rationale_md}/></div>)}</>:<><div className="grid-2">{usefulness?<><Field label="유용성 점수"><select value={score} onChange={e=>setScore(e.target.value)}><option value="">판단 불가</option>{[0,1,2,3,4].map(i=><option key={i} value={i}>{i}</option>)}</select></Field><Field label="수학적 판단"><select value={validity} onChange={e=>setValidity(e.target.value)}>{['supported','promising_unverified','error_identified','undetermined'].map(s=><option key={s}>{s}</option>)}</select></Field></>:<Field label="일치도"><select value={label} onChange={e=>setLabel(e.target.value)}>{['none','partial','core','undetermined'].map(s=><option key={s}>{s}</option>)}</select></Field>}</div><Field label="판단 근거"><textarea rows={5} value={reason} onChange={e=>setReason(e.target.value)}/></Field>{(usefulness&&score===''||!usefulness&&label==='undetermined')&&<Field label="판단 불가 이유"><textarea value={unable} onChange={e=>setUnable(e.target.value)}/></Field>}<>{editing&&<Field label="수정 이유"><input value={correction} onChange={e=>setCorrection(e.target.value)}/></Field>}</><button className="primary" disabled={action.busy||!reason||!!editing&&!correction.trim()} onClick={submit}>{usefulness?'유용성 제출':'일치도 제출'}</button></>}
  <ErrorBox error={action.error}/>
 </div>;
}
export function ResultsPage(){
 const[params]=useSearchParams();const plans=useData('/plans?include_fixture=true&limit=100'),protocols=useData('/protocols');
 const[plan,setPlan]=useState(params.get('plan')||''),[transport,setTransport]=useState('api'),[fixture,setFixture]=useState(false),[corrected,setCorrected]=useState(false),[group,setGroup]=useState(''),[common,setCommon]=useState(true),[tab,setTab]=useState('비교 요약'),[run,setRun]=useState(''),[exportId,setExportId]=useState(''),[exportDone,setExportDone]=useState(''),[companion,setCompanion]=useState(''),[zip,setZip]=useState(false),[external,setExternal]=useState(false);
 const action=useActions();const[batch,setBatch]=useState(false),[assignment,setAssignment]=useState('');
 const team=useData('/team'),assigned=useData('/review-assignments',true);
 const[reviewers,setReviewers]=useState<string[]>([]),[seed,setSeed]=useState('20261023');
 useEffect(()=>{
  if(!plan&&plans.data?.items.length){const p=plans.data.items.find((p:Row)=>p.cohort==='main')||plans.data.items.find((p:Row)=>p.cohort==='pilot');if(p)setPlan(p.id)}
 },[plans.data]);
 const current=plans.data?.items.find((p:Row)=>p.id===plan);
 useEffect(()=>{if(current){setTransport(current.transport);setFixture(['fixture','diagnostic'].includes(current.cohort));setGroup('');setRun('')}},[plan,current?.transport,current?.cohort]);
 const[paper,setPaper]=useState(''),[revision,setRevision]=useState(''),[generator,setGenerator]=useState(''),[repeat,setRepeat]=useState(''),[status,setStatus]=useState(''),[flag,setFlag]=useState(false),[cursor,setCursor]=useState(0);
 const paperOptions=useData('/papers?limit=100'),inputOptions=useData('/experiment-inputs');
 const reliability=useData('/review-reliability',true);
 useEffect(()=>setCursor(0),[plan,group,paper,revision,generator,repeat,status,flag]);
 const queryString=new URLSearchParams({plan_id:plan,transport,include_fixture:String(fixture),include_human_corrected:String(corrected),common:String(common),group_hash:group,paper_id:paper,checkpoint_revision_id:revision,generator_provider:generator,repeat_no:repeat,status,review_flag:String(flag)});
 const summary=useData('/results/summary?'+queryString,true,!!plan),ideas=useData('/results/ideas?'+queryString+'&cursor='+cursor,false,!!plan);
 const exported=useData('/exports/'+exportId,true,!!exportId);
 useEffect(()=>{const r=exported.data;if(r?.status==='completed'&&exportDone!==exportId){setExportDone(exportId);downloadAsset(r.asset_id);if(r.metadata?.companion_asset_id)setCompanion(r.metadata.companion_asset_id)}},[exported.data,exportId]);
 async function exportKind(kind:string){
  const result=await action.act(()=>api('/exports',{kind,filters:{plan_id:plan,transport,include_fixture:fixture,include_human_corrected:corrected,common,group_hash:group,paper_id:paper,checkpoint_revision_id:revision,generator_provider:generator,repeat_no:repeat,status,review_flag:flag},include_source:kind!=='external_zip'}));
  if(result){setExportId(result.export_id);setZip(false)}
 }
 async function createBatch(){const r=await action.act(()=>api('/review-batches',{plan_ids:[plan],reviewer_ids:reviewers,seed,per_stratum:5}));if(r){setBatch(false);assigned.refetch()}}
 return <><PageHeading title="결과"><button disabled={!plan||action.busy} onClick={()=>setZip(true)}>원문 ZIP</button><button className="primary" disabled={!plan||action.busy||exported.data?.status==='queued'||exported.data?.status==='running'} onClick={()=>exportKind('xlsx')}>{exportId&&exported.data?.status!=='completed'&&exported.data?.status!=='failed'?'파일 준비 중':'엑셀 다운로드'}</button></PageHeading>
  <div className="toolbar"><select aria-label="실험 선택" value={plan} onChange={e=>setPlan(e.target.value)}><option value="">실험 선택</option>{plans.data?.items.map((p:Row)=><option key={p.id} value={p.id}>{p.title}</option>)}</select><select aria-label="프로토콜" value={current?.protocol_id||''} disabled><option value="">프로토콜</option>{protocols.data?.items.map((p:Row)=><option key={p.id} value={p.id}>{p.name} v{p.version_no}</option>)}</select><select aria-label="실행 경로" value={transport} onChange={e=>setTransport(e.target.value)}><option value="api">API</option><option value="manual">수동</option><option value="mock">가상 검수</option></select><select aria-label="모델 프로필 조건" value={group} onChange={e=>setGroup(e.target.value)}><option value="">선택된 조건</option>{summary.data?.groups.map((g:Row)=><option key={g.hash} value={g.hash}>{g.conditions.input_mode} · {g.conditions.cohort} · {g.hash.slice(0,8)}</option>)}</select><label className="check"><input type="checkbox" checked={fixture} onChange={e=>setFixture(e.target.checked)}/>가상 검수 포함</label></div>
  <div className="toolbar"><select aria-label="논문 필터" value={paper} onChange={e=>{setPaper(e.target.value);setRevision('')}}><option value="">전체 논문</option>{paperOptions.data?.items.map((p:Row)=><option key={p.id} value={p.id}>{p.code} {p.title}</option>)}</select><select aria-label="분기점 필터" value={revision} onChange={e=>setRevision(e.target.value)}><option value="">전체 분기점</option>{inputOptions.data?.items.filter((r:Row)=>!paper||r.paper_id===paper).map((r:Row)=><option key={r.id} value={r.id}>{r.paper_code} {r.checkpoint_code} v{r.version_no}</option>)}</select><select aria-label="생성 제공사 필터" value={generator} onChange={e=>setGenerator(e.target.value)}><option value="">전체 생성 제공사</option>{providers.map(p=><option key={p} value={p}>{names[p]}</option>)}</select><select aria-label="반복 필터" value={repeat} onChange={e=>setRepeat(e.target.value)}><option value="">전체 반복</option>{Array.from({length:10},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select><select aria-label="완료 상태 필터" value={status} onChange={e=>setStatus(e.target.value)}><option value="">전체 상태</option><option value="completed">완료</option><option value="partial">일부 완료</option><option value="needs_review">확인 필요</option></select><label className="check"><input type="checkbox" checked={flag} onChange={e=>setFlag(e.target.checked)}/>검토 플래그</label></div>
  <ErrorBox error={action.error||summary.error||ideas.error||exported.error} retry={()=>summary.refetch()}/>
  {exported.data?.status==='failed'&&<ErrorBox error="파일을 만들지 못했습니다. 진행 상황에서 오류를 확인해 주세요."/>}
  {companion&&<p className="notice">긴 본문은 별도 파일로 함께 보관해 주세요. <button className="text-button" onClick={()=>downloadAsset(companion)}>긴 본문 ZIP 다운로드</button></p>}
  {!!exported.data?.metadata?.parts?.length&&<details className="card"><summary>분할 파일 다운로드 · 모든 파일을 함께 보관해 주세요.</summary>{exported.data.metadata.parts.map((p:Row)=><button key={p.asset_id} onClick={()=>downloadAsset(p.asset_id)}>{p.name}</button>)}</details>}
  <Tabs items={['비교 요약','아이디어','사람 검토']} value={tab} onChange={setTab}/>
  {!plan?<Empty>결과를 볼 실험을 선택해 주세요.</Empty>:tab==='비교 요약'?<><div className="segmented" style={{width:'fit-content',marginBottom:24}}><button className={common?'active':''} onClick={()=>setCommon(true)}>공통 완료 자료</button><button className={!common?'active':''} onClick={()=>setCommon(false)}>모델별 가용 자료</button></div>
   {summary.isLoading?<Loading/>:<><div className="card"><h3>유용성</h3><Table rows={providers.map(p=>({id:p,provider:p,...summary.data?.summary[p]}))} columns={[{title:'제공사',render:r=>names[r.provider]},{title:'선택 후보',render:r=><NumberBar value={r.selected_usefulness?.value}/>},{title:'최고 후보',render:r=><NumberBar value={r.best_usefulness?.value}/>},{title:'선택 손실',render:r=><NumberBar value={r.selection_regret?.value}/>},{title:'적격 실행 수',render:r=>r.selected_usefulness?.eligible_runs||0},{title:'논문 수',render:r=>r.selected_usefulness?.papers||0}]}/></div>
    <div className="card"><h3>논문 아이디어와의 일치도</h3><Table rows={providers.map(p=>({id:p,provider:p,...summary.data?.summary[p]}))} columns={[{title:'제공사',render:r=>names[r.provider]},{title:'전체 후보 핵심 포함률',render:r=><NumberBar value={r.any_core_match?.value} max={1} percent/>},{title:'선택 후보 핵심 일치율',render:r=><NumberBar value={r.selected_core_match?.value} max={1} percent/>},{title:'적격 실행 수',render:r=>r.any_core_match?.eligible_runs||0}]}/></div>
    <details className="card"><summary>분모·제외 사유</summary><label className="check"><input type="checkbox" checked={corrected} onChange={e=>setCorrected(e.target.checked)}/>사람 보정 포함</label><pre>{JSON.stringify(summary.data?.summary,null,2)}</pre><p className="muted">평가자별 엄격도 차이가 비교에 영향을 줄 수 있습니다. 원점수와 판단 불가는 아이디어의 평가 근거에서 확인합니다.</p></details>
   </>}
  </>:tab==='아이디어'?<div className="split-results"><div className="run-list">{ideas.data?.items.map((r:Row)=><button key={r.id} className={run===r.id?'active':''} onClick={()=>setRun(r.id)}><strong>{r.paper_code} · {r.checkpoint_code}</strong><br/><span className="muted">{names[r.generator_provider]} · 반복 {r.repeat_no}</span></button>)}<Pager page={cursor} total={ideas.data?.total||0} setPage={setCursor}/></div><div>{run?<IdeaDetail id={run}/>:<Empty>실행을 선택해 주세요.</Empty>}</div></div>:<><div className="toolbar"><button onClick={()=>setBatch(true)}>검토 표본 만들기</button><span className="muted">본인 배정 {assigned.data?.items.filter((a:Row)=>a.phase==='done').length||0} / {assigned.data?.items.length||0} 완료</span></div><div className="card"><h3>층별 검토 신뢰성</h3><p className="muted">최초 독립 판단 기준 · 유용성은 AI 두 점수의 평균과 비교 · 라벨은 AI 평가별 비교 · 모집단 정확도로 합산하지 않습니다.</p><Table rows={reliability.data?.items||[]} columns={[{title:'층',key:'stratum'},{title:'절대 점수차',render:r=>r.mean_absolute_score_difference?.toFixed(2)??'자료 없음'},{title:'점수 정확 일치',render:r=>r.score_exact_rate===null?'자료 없음':(r.score_exact_rate*100).toFixed(1)+'%'},{title:'점수 n',key:'score_n'},{title:'라벨 일치',render:r=>r.agreement_exact_rate===null?'자료 없음':(r.agreement_exact_rate*100).toFixed(1)+'%'},{title:'라벨 n',key:'agreement_n'}]}/></div><div className="split-results"><div className="run-list">{assigned.data?.items.map((a:Row)=><button key={a.id} className={assignment===a.id?'active':''} onClick={()=>setAssignment(a.id)}>{a.display_code}<br/><span className="muted">{a.phase==='done'?'완료':a.phase==='usefulness'?'유용성 대기':'일치도 대기'}</span></button>)}</div><div>{assignment?<ReviewDetail id={assignment} onDone={()=>assigned.refetch()}/>:<Empty>검토할 항목을 선택해 주세요.</Empty>}</div></div></>}
  {zip&&<Modal title="원문 ZIP" width={440} onClose={()=>setZip(false)} footer={<><button onClick={()=>setZip(false)}>취소</button><button className="primary" disabled={action.busy} onClick={()=>exportKind(external?'external_zip':'research_zip')}>내보내기</button></>}><Field label="자료 범위"><select value={external?'external':'internal'} onChange={e=>setExternal(e.target.value==='external')}><option value="internal">팀 내부 연구 자료 (원본 포함)</option><option value="external">외부 공유용 (원본·개인정보 기본 제외)</option></select></Field><p className="muted">논문과 자료의 외부 전송·재배포 권한은 팀이 확인합니다.</p></Modal>}
  {batch&&<Modal title="검토 표본 만들기" width={640} onClose={()=>setBatch(false)} footer={<><button onClick={()=>setBatch(false)}>취소</button><button className="primary" disabled={!reviewers.length||action.busy} onClick={createBatch}>표본 만들기</button></>}><Field label="표본 seed"><input value={seed} onChange={e=>setSeed(e.target.value)}/></Field><p className="muted">생성 제공사 × 선택/비선택의 여섯 층에서 각각 최대 5개를 뽑습니다.</p><h3>검토자</h3>{team.data?.items.map((m:Row)=><label className="check" key={m.user_id}><input type="checkbox" checked={reviewers.includes(m.user_id)} onChange={e=>setReviewers(old=>e.target.checked?[...old,m.user_id]:old.filter(x=>x!==m.user_id))}/>{m.display_name}</label>)}<ErrorBox error={action.error}/></Modal>}
 </>;
}

