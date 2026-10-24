import {useEffect,useRef,useState} from 'react';
import {useNavigate,useParams,useSearchParams,Link} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {api,time,downloadAsset} from '../api/client';
import type {Row,RevisionPatch} from '../api/client';
import {useData,useActions,PageHeading,Table,Pager,Status,Empty,Loading,ErrorBox,Field,Modal,Tabs,BlobImage,Icon,Markdown} from '../components';
import {useUploads} from '../uploads';
import {PlanModal} from './experiments';

export function PapersPage(){
 const navigate=useNavigate();const upload=useUploads();const action=useActions();
 const[q,setQ]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[archived,setArchived]=useState(false),[page,setPage]=useState(0),[selected,setSelected]=useState(new Set<string>()),[plan,setPlan]=useState(false);
 useEffect(()=>{const t=setTimeout(()=>{setSearch(q);setPage(0)},250);return()=>clearTimeout(t)},[q]);
 const query=useData('/papers?'+new URLSearchParams({q:search,status,archived:String(archived),cursor:String(page)}),true);
 const rows=query.data?.items||[];
 function select(id:string){setSelected(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next})}
 return <><PageHeading title="논문"><button className="primary" style={{width:128}} onClick={upload.open}><Icon name="upload"/>PDF 등록</button></PageHeading>
  <div className="toolbar"><input aria-label="논문 검색" placeholder="제목·코드 검색" value={q} onChange={e=>setQ(e.target.value)}/><select aria-label="준비 상태" value={status} onChange={e=>{setStatus(e.target.value);setPage(0)}}><option value="">전체</option><option value="preparing">준비 중</option><option value="review">검토 필요</option><option value="ready">실험 가능</option><option value="error">오류</option></select><label className="check"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>보관된 논문 포함</label><span className="total muted">총 {query.data?.total||0}편</span></div>
  <ErrorBox error={query.error||action.error} retry={()=>query.refetch()}/>
  {selected.size>0&&<div className="selection-bar"><span>{selected.size}편 선택</span><div className="actions"><button onClick={()=>navigate('/papers/'+[...selected][0])}>분기점 보기</button><button className="primary" onClick={()=>setPlan(true)}>실험 만들기</button></div></div>}
  {query.isLoading?<Loading/>:!rows.length?<Empty action={<button className="primary" onClick={upload.open}>PDF 등록</button>}>등록된 논문이 없습니다.</Empty>:<><Table rows={rows} onRow={r=>navigate('/papers/'+r.id)} columns={[
   {title:<input type="checkbox" aria-label="현재 페이지 전체 선택" checked={rows.length>0&&rows.every((r:Row)=>selected.has(r.id))} onChange={e=>setSelected(prev=>{const n=new Set(prev);rows.forEach((r:Row)=>e.target.checked?n.add(r.id):n.delete(r.id));return n})}/>,width:44,render:r=><input aria-label={r.code+' 선택'} type="checkbox" checked={selected.has(r.id)} onClick={e=>e.stopPropagation()} onChange={()=>select(r.id)}/>},
   {title:'코드',key:'code',width:96},{title:'제목',render:r=><div className="row-title" title={r.title}>{r.title}</div>},
   {title:'분기점',key:'checkpoint_count',width:96},{title:'준비 상태',width:120,render:r=><Status value={r.preparation_status}/>},
   {title:'등록자',key:'created_by_name',width:96},{title:'등록일',width:140,render:r=>time(r.created_at)},
   {title:'',width:48,render:r=><button className="text-button" onClick={e=>{e.stopPropagation();action.act(()=>api('/papers/'+r.id+'/archive',{}))}}>보관</button>}
  ]}/><Pager page={page} total={query.data?.total||0} setPage={setPage}/></>}
  {plan&&<PlanModal paperIds={[...selected]} onClose={()=>setPlan(false)}/>}
 </>;
}
export function PaperPage(){
 const{id}=useParams();const navigate=useNavigate();const query=useData('/papers/'+id,true);const action=useActions();
 const[tab,setTab]=useState('분기점'),[add,setAdd]=useState(false),[edit,setEdit]=useState(false),[title,setTitle]=useState(''),[fields,setFields]=useState<Row>({}),[pdfPage,setPdfPage]=useState(1),[planRevision,setPlanRevision]=useState<string|null>(null);
 if(query.isLoading)return <Loading/>;
 if(query.error)return <ErrorBox error={query.error} retry={()=>query.refetch()}/>;
 const row=query.data!;
 async function addCheckpoint(){
  const r=await action.act(()=>api('/papers/'+id+'/checkpoints',{title}));
  if(r){setAdd(false);navigate('/checkpoints/'+r.checkpoint.id+'/edit?revision=1')}
 }
 const metaFields=[['title','제목'],['authors','저자'],['source_url','출처 URL'],['doi_or_arxiv','DOI/arXiv'],['paper_version','버전'],['published_date','발표일'],['subject','분야'],['rights_note','권리 메모']];
 return <><div className="breadcrumb"><Link to="/papers">논문</Link> / {row.code}</div><PageHeading title={row.title}><button onClick={()=>{setFields(Object.fromEntries(metaFields.map(([k])=>[k,row[k]||''])));setEdit(true)}}>정보 수정</button><button className="primary" onClick={()=>{setTitle('');setAdd(true)}}>분기점 추가</button></PageHeading><p className="subtitle">{row.authors||'저자 미입력'} · {row.paper_version||'버전 미입력'}</p>
  <ErrorBox error={action.error}/><Tabs items={['분기점','원본 PDF','논문 정보']} value={tab} onChange={setTab}/>
  {tab==='분기점'&&(!row.checkpoints.length?<Empty action={<button className="primary" onClick={()=>setAdd(true)}>분기점 추가</button>}>등록된 분기점이 없습니다.</Empty>:row.checkpoints.map((cp:Row)=>{const latest=cp.revisions[0],approved=cp.revisions.find((r:Row)=>r.status==='approved');return <div className="card" key={cp.id} style={{minHeight:104,display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}><div><strong>{cp.code} · {cp.title}</strong><div className="muted">v{latest?.version_no} · <Status value={latest?.status}/></div></div><div className="actions"><button onClick={()=>navigate('/checkpoints/'+cp.id+'/edit?revision='+latest?.version_no)}>편집</button>{approved&&<button className="primary" onClick={()=>setPlanRevision(approved.id)}>실험 만들기</button>}</div></div>}))}
  {tab==='원본 PDF'&&row.source_asset&&<div className="card"><div className="toolbar"><button disabled={pdfPage<=1} onClick={()=>setPdfPage(n=>n-1)}>이전</button><span>{pdfPage} / {row.source_asset.page_count||'—'}</span><button disabled={pdfPage>=(row.source_asset.page_count||1)} onClick={()=>setPdfPage(n=>n+1)}>다음</button><button onClick={()=>downloadAsset(row.source_asset.id)}>원본 다운로드</button></div><BlobImage asset={row.source_asset.id} page={pdfPage} alt={'원본 PDF '+pdfPage+'쪽'} className="full-page"/></div>}
  {tab==='논문 정보'&&<div className="card">{metaFields.map(([key,label])=><Field label={label} key={key}>{key==='source_url'&&row[key]?<a href={row[key]} target="_blank" rel="noopener noreferrer">{row[key]}</a>:<span>{row[key]||'—'}</span>}</Field>)}</div>}
  {add&&<Modal title="분기점 추가" width={440} onClose={()=>setAdd(false)} footer={<><button onClick={()=>setAdd(false)}>취소</button><button className="primary" disabled={action.busy||!title.trim()} onClick={addCheckpoint}>추가</button></>}><Field label="분기점 제목"><input value={title} onChange={e=>setTitle(e.target.value)}/></Field><ErrorBox error={action.error}/></Modal>}
  {edit&&<Modal title="논문 정보 수정" width={640} onClose={()=>setEdit(false)} footer={<><button onClick={()=>setEdit(false)}>취소</button><button className="primary" disabled={action.busy} onClick={async()=>{const r=await action.act(()=>api('/papers/'+id,{...fields,published_date:fields.published_date||null,rights_status:row.rights_status,expected_hash:row.content_hash},'PATCH'));if(r)setEdit(false)}}>저장</button></>}>{metaFields.map(([key,label])=><Field key={key} label={label}><input type={key==='published_date'?'date':'text'} value={fields[key]||''} onChange={e=>setFields(v=>({...v,[key]:e.target.value}))}/></Field>)}<ErrorBox error={action.error}/></Modal>}
  {planRevision&&<PlanModal revisionIds={[planRevision]} onClose={()=>setPlanRevision(null)}/>}
 </>;
}
const editable=['input_mode','goal_md','obstacle_md','abstract_md','public_text_md','reference_idea_md','reference_location','stage_outline','page_recipe','review_note'];
function pick(row:Row){return Object.fromEntries(editable.map(k=>[k,row[k]]))}
export function CheckpointEditor(){
 const{id}=useParams();const[params,setParams]=useSearchParams();const navigate=useNavigate();const client=useQueryClient();
 const cp=useData('/checkpoints/'+id);const version=Number(params.get('revision')||0);
 const rid=cp.data?.revisions.find((r:Row)=>r.version_no===version)?.id||cp.data?.revisions[0]?.id;
 const rev=useData('/checkpoint-revisions/'+rid,true,!!rid);
 const[form,setForm]=useState<Row|null>(null),[page,setPage]=useState(1),[tab,setTab]=useState('원본'),[masking,setMasking]=useState(false),[zoom,setZoom]=useState(100);
 const[error,setError]=useState(''),[saving,setSaving]=useState(false),[savedAt,setSavedAt]=useState(''),[preparing,setPreparing]=useState(false),[review,setReview]=useState(false),[checks,setChecks]=useState([false,false,false]),[draftMask,setDraftMask]=useState<Row|null>(null);
 const currentId=useRef(''),hash=useRef(''),saved=useRef(''),formRef=useRef<Row|null>(null),flight=useRef<Promise<any>|null>(null),start=useRef<Row|null>(null);
 formRef.current=form;
 const readonly=rev.data?.status==='approved';
 useEffect(()=>{if(rev.data&&currentId.current!==rid){currentId.current=rid;hash.current=rev.data.content_hash;saved.current=JSON.stringify(pick(rev.data));setForm(pick(rev.data));setError('');setPage(1)}},[rev.data,rid]);
 function change(key:string,val:any){setForm(old=>({...old!,[key]:val}))}
 async function save(){
  if(readonly||!formRef.current)return;
  if(flight.current){await flight.current;return save()}
  const data={...formRef.current};const text=JSON.stringify(data);
  if(text===saved.current)return rev.data;
  setSaving(true);setError('');
  const task=api('/checkpoint-revisions/'+rid,{...data,expected_hash:hash.current},'PATCH').then(row=>{
   hash.current=row.content_hash;saved.current=text;setSavedAt(new Date().toLocaleTimeString('ko-KR'));client.setQueryData(['/checkpoint-revisions/'+rid],row);return row;
  }).catch(e=>{setError(e.message+(e.code==='EDIT_CONFLICT'?' 작성 중인 내용을 보존했습니다. 최신 버전을 새 창에서 확인해 주세요.':''));throw e}).finally(()=>{setSaving(false);flight.current=null});
  flight.current=task;return task;
 }
 useEffect(()=>{if(!form||readonly||error||JSON.stringify(form)===saved.current)return;const t=setTimeout(()=>save().catch(()=>{}),1000);return()=>clearTimeout(t)},[form,readonly,savedAt,error]);
 useEffect(()=>{if(preparing&&rev.data?.status==='review'){hash.current=rev.data.content_hash;setPreparing(false);setChecks([false,false,false]);setReview(true)}},[preparing,rev.data?.status]);
 const packet=useData('/checkpoint-revisions/'+rid+'/public-packet',false,review&&!!rid);
 if(cp.isLoading||rev.isLoading||!form)return <Loading/>;
 if(cp.error||rev.error)return <ErrorBox error={cp.error||rev.error} retry={()=>{cp.refetch();rev.refetch()}}/>;
 const row=rev.data!;const recipe:Row[]=form.page_recipe||[];const rec=recipe.find(p=>p.page===page)||{page,include:true,rotation:0,masks:[]};
 const preview=tab==='전송 미리보기';const included=recipe.filter(p=>p.include);
 const preparedPage=Math.max(1,included.findIndex(p=>p.page===page)+1);
 function patchPage(fields:Row){change('page_recipe',recipe.map(p=>p.page===page?{...p,...fields}:p))}
 function point(e:React.PointerEvent){const r=e.currentTarget.getBoundingClientRect();return{x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))}}
 function down(e:React.PointerEvent){
  if(!masking||readonly||preview||innerWidth<1024)return;
  e.currentTarget.setPointerCapture(e.pointerId);start.current=point(e);setDraftMask(null);
 }
 function move(e:React.PointerEvent){if(!start.current)return;const p=point(e),s=start.current;setDraftMask({x:Math.min(p.x,s.x),y:Math.min(p.y,s.y),w:Math.abs(p.x-s.x),h:Math.abs(p.y-s.y)})}
 function up(e:React.PointerEvent){
  if(!start.current)return;const p=point(e),s=start.current;const mask={x:Math.min(p.x,s.x),y:Math.min(p.y,s.y),w:Math.abs(p.x-s.x),h:Math.abs(p.y-s.y)};
  if(mask.w>.002&&mask.h>.002)patchPage({masks:[...rec.masks,mask]});start.current=null;setDraftMask(null);
 }
 async function prepare(){
  try{await save();const result=await api('/checkpoint-revisions/'+rid+'/prepare',{});await rev.refetch();
   if(result.ready){setChecks([false,false,false]);setReview(true)}else setPreparing(true);
  }catch(e){setError(e instanceof Error?e.message:'미리보기를 준비하지 못했습니다.')}
 }
 function textField(key:string,label:string,rows=3,note?:string){return <Field key={key} label={label}><textarea disabled={readonly} rows={rows} value={form![key]||''} onChange={e=>change(key,e.target.value)}/>{note&&<small className="muted">{note}</small>}</Field>}
 return <><div className="breadcrumb"><Link to="/papers">논문</Link> / <Link to={'/papers/'+cp.data!.paper_id}>분기점</Link> / {cp.data!.code}</div><PageHeading title="분기점 편집"><span className="badge">{readonly?'승인된 ':''}v{row.version_no}</span>{readonly?<button className="primary" onClick={async()=>{const next=await api('/checkpoints/'+id+'/revisions',{source_revision_id:rid});await cp.refetch();setParams({revision:String(next.version_no)})}}>새 버전 만들기</button>:<><button disabled={saving} onClick={()=>save().catch(()=>{})}>{saving?'저장 중':'초안 저장'}</button><button className="primary" disabled={preparing||saving} onClick={prepare}>{preparing?'미리보기 준비 중':'입력 확인'}</button></>}</PageHeading>
  <ErrorBox error={error}/>
  <div className="editor"><section className="card">
   <Tabs items={['원본','전송 미리보기']} value={tab} onChange={setTab}/>
   {innerWidth<1024&&<p className="notice">가림 편집은 넓은 화면에서 사용해 주세요.</p>}
   <div className="viewer-toolbar"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page} / {recipe.length}</span><button disabled={page>=recipe.length} onClick={()=>setPage(p=>p+1)}>다음</button><button onClick={()=>setZoom(z=>Math.max(50,z-25))}>−</button><span>{zoom}%</span><button onClick={()=>setZoom(z=>Math.min(250,z+25))}>＋</button><button disabled={readonly||preview||form.input_mode!=='pdf'} onClick={()=>setMasking(!masking)} className={masking?'primary':''}>영역 가리기</button></div>
   {preview&&!row.prepared_asset_id?<div className="empty"><p>미리보기 갱신 필요</p><button onClick={prepare} disabled={preparing}>미리보기 생성</button></div>:<div className="viewer">
    <div className="thumbnails">{recipe.map(p=><div key={p.page} className={'thumbnail'+(page===p.page?' active':'')+(!p.include?' excluded':'')}><label className="check"><input aria-label={p.page+'쪽 포함'} type="checkbox" disabled={readonly} checked={p.include} onChange={e=>change('page_recipe',recipe.map(v=>v.page===p.page?{...v,include:e.target.checked}:v))}/>{p.page}</label><div onClick={()=>setPage(p.page)}><BlobImage asset={row.source_asset_id} page={p.page} rotation={p.rotation} alt={p.page+'쪽 썸네일'}/></div></div>)}</div>
    <div className="page-canvas-wrap"><div className="page-canvas" style={{width:zoom+'%',cursor:masking?'crosshair':'default'}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{start.current=null;setDraftMask(null)}}>
     <BlobImage asset={preview?row.prepared_asset_id:row.source_asset_id} page={preview?preparedPage:page} rotation={preview?0:rec.rotation} alt={preview?'실제 전송 PDF':'원본 PDF'}/>
     {!preview&&rec.masks.map((m:Row,i:number)=><div className="mask" key={i} style={{left:m.x*100+'%',top:m.y*100+'%',width:m.w*100+'%',height:m.h*100+'%'}}>{!readonly&&<button aria-label={'가림 '+(i+1)+' 제거'} onPointerDown={e=>e.stopPropagation()} onClick={()=>patchPage({masks:rec.masks.filter((_:any,j:number)=>i!==j)})}>×</button>}</div>)}
     {draftMask&&<div className="mask-draft" style={{left:draftMask.x*100+'%',top:draftMask.y*100+'%',width:draftMask.w*100+'%',height:draftMask.h*100+'%'}}/>}
    </div></div>
   </div>}
   {!preview&&<div className="toolbar" style={{marginTop:12,marginBottom:0}}><label className="check"><input type="checkbox" checked={rec.include} disabled={readonly} onChange={e=>patchPage({include:e.target.checked})}/>이 페이지 포함</label><button className="text-button" disabled={readonly} onClick={()=>patchPage({masks:[]})}>가림 모두 해제</button><button className="text-button" disabled={readonly} onClick={()=>patchPage({rotation:(rec.rotation+90)%360})}>90° 회전</button></div>}
   {preview&&row.prepared_asset_id&&<button className="text-button" onClick={()=>downloadAsset(row.prepared_asset_id)}>실제 전송 PDF 다운로드</button>}
  </section><section className="card">
   <Field label="분기점 제목"><input disabled value={cp.data!.title}/></Field><Field label="입력 방식"><div className="segmented">{[['pdf','PDF'],['text','텍스트']].map(([v,label])=><button key={v} disabled={readonly} className={form.input_mode===v?'active':''} onClick={()=>change('input_mode',v)}>{label}</button>)}</div></Field>
   {textField('goal_md','연구 목표')}{textField('obstacle_md','현재 장애')}<details><summary>공개 초록</summary>{textField('abstract_md','공개 초록')}</details>
   <h3 style={{marginTop:24}}>공개 단계</h3>{(form.stage_outline||[]).map((stage:Row,index:number)=><div className="stage-card" key={index}><div className="actions"><label className="check"><input type="checkbox" checked={stage.is_public} disabled={readonly} onChange={e=>change('stage_outline',form.stage_outline.map((s:Row,i:number)=>i===index?{...s,is_public:e.target.checked}:s))}/>공개</label><div className="actions"><button disabled={readonly||index===0} className="text-button" onClick={()=>{const arr=[...form.stage_outline];[arr[index-1],arr[index]]=[arr[index],arr[index-1]];change('stage_outline',arr.map((s,i)=>({...s,index:i+1})))}}>위</button><button disabled={readonly||index===form.stage_outline.length-1} className="text-button" onClick={()=>{const arr=[...form.stage_outline];[arr[index+1],arr[index]]=[arr[index],arr[index+1]];change('stage_outline',arr.map((s,i)=>({...s,index:i+1})))}}>아래</button></div></div><Field label={stage.index+'단계 제목'}><input disabled={readonly} value={stage.title} onChange={e=>change('stage_outline',form.stage_outline.map((s:Row,i:number)=>i===index?{...s,title:e.target.value}:s))}/></Field><textarea aria-label={stage.index+'단계 본문'} disabled={readonly} value={stage.body_md} onChange={e=>change('stage_outline',form.stage_outline.map((s:Row,i:number)=>i===index?{...s,body_md:e.target.value}:s))}/></div>)}
   {!readonly&&<button onClick={()=>change('stage_outline',[...form.stage_outline,{index:form.stage_outline.length+1,title:'',body_md:'',is_public:true}])}>＋ 단계 추가</button>}
   {form.input_mode==='text'&&<div style={{marginTop:20}}>{textField('public_text_md','공개 텍스트',10)}<button disabled={readonly} className="text-button" onClick={()=>{if(!form.public_text_md||confirm('편집된 공개 텍스트를 단계 내용으로 바꾸시겠습니까?'))change('public_text_md',form.stage_outline.filter((s:Row)=>s.is_public).map((s:Row)=>s.title+'\n'+s.body_md).join('\n\n'))}}>공개 단계에서 채우기</button></div>}
   <div style={{marginTop:24}}>{textField('reference_idea_md','기준 아이디어',6,'일치도 평가에만 전송')}</div><Field label="원문 위치"><input disabled={readonly} value={form.reference_location} onChange={e=>change('reference_location',e.target.value)}/></Field>{textField('review_note','검토 메모')}
   <p className="muted" style={{textAlign:'right'}}>{saving?'저장 중':savedAt?'마지막 저장 '+savedAt:''}</p>
  </section></div>
  {review&&<Modal title="공개 입력 확인" width={1080} onClose={()=>setReview(false)} footer={<><div style={{marginRight:'auto'}}>{['공개 입력을 확인했습니다.','숨긴 기준 내용이 전송 자료에 남지 않았습니다.','기준 아이디어와 원문 위치를 확인했습니다.'].map((s,i)=><label className="check" key={s}><input type="checkbox" checked={checks[i]} onChange={e=>setChecks(v=>v.map((x,j)=>i===j?e.target.checked:x))}/>{s}</label>)}</div><button onClick={()=>setReview(false)}>돌아가기</button><button className="primary" disabled={!checks.every(Boolean)||!packet.data} onClick={async()=>{try{await api('/checkpoint-revisions/'+rid+'/approve',{reviewed_hash:packet.data!.hash,public_input_checked:true,hidden_content_checked:true,reference_checked:true});navigate('/papers/'+cp.data!.paper_id)}catch(e){setError((e as Error).message)}}}>이 버전 승인</button></>}>
   <ErrorBox error={packet.error||error}/>{packet.data&&<div className="context-preview"><div>{form.input_mode==='pdf'&&row.prepared_asset_id?<BlobImage asset={row.prepared_asset_id} page={1} alt="전송 자료 미리보기"/>:<Markdown text={packet.data.packet.public_context.public_text}/>}</div><div><Field label="연구 목표"><Markdown text={form.goal_md}/></Field><Field label="현재 장애"><Markdown text={form.obstacle_md}/></Field><p className="muted">{included.length}개 페이지 · v{row.version_no}</p><details><summary>전송 텍스트</summary><pre>{JSON.stringify(packet.data.packet,null,2)}</pre></details><details><summary>일치도 평가 입력</summary><Markdown text={form.reference_idea_md}/></details></div></div>}
  </Modal>}
 </>;
}

