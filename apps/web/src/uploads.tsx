import React,{createContext,useContext,useRef,useState,useEffect} from 'react';
import type {ReactNode} from 'react';
import {Upload} from 'tus-js-client';
import {useQueryClient} from '@tanstack/react-query';
import {api,token} from './api/client';
import type {Row} from './api/client';
import {Modal,ErrorBox,Icon} from './components';
type Item={id:string;name:string;size:number;file?:File;asset_id?:string;paper_id?:string;bucket?:string;object_path?:string;upload_endpoint?:string;signed_upload_token?:string;status:string;progress:number;error?:string;job_id?:string};
const Context=createContext<{open:()=>void}>({open:()=>{}});
export const useUploads=()=>useContext(Context);
export function UploadProvider({children}:{children:ReactNode}){
 const[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const[items,setItems]=useState<Item[]>(()=>{
  try{return JSON.parse(localStorage.getItem('tisiif-pending-uploads')||'[]').map((i:Item)=>({...i,status:'파일 다시 선택'}))}catch{return []}
 });
 const ref=useRef(items);ref.current=items;
 const uploads=useRef(new Map<string,Upload>());
 const paused=useRef(new Set<string>());
 const aborters=useRef(new Map<string,()=>void>());
 const client=useQueryClient();
 function patch(id:string,data:Partial<Item>){setItems(old=>old.map(i=>i.id===id?{...i,...data}:i))}
 useEffect(()=>{
  localStorage.setItem('tisiif-pending-uploads',JSON.stringify(items.filter(i=>i.status!=='완료').map(({file,signed_upload_token,upload_endpoint,...i})=>i)));
  function leave(e:BeforeUnloadEvent){if(ref.current.some(i=>i.status==='업로드 중')){e.preventDefault();e.returnValue=''}}
  window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);
 },[items]);
 useEffect(()=>{
  const timer=setInterval(async()=>{
   const current=ref.current.filter(i=>i.job_id&&i.status==='검증 중');
   for(const item of current){
    try{const j=await api('/jobs/'+item.job_id);
     if(j.status==='completed'){
      const duplicate=j.payload?.result?.duplicate_paper;
      patch(item.id,{status:'완료',progress:100,error:duplicate?'같은 파일: '+duplicate.code:undefined});
      client.invalidateQueries();
     }else if(j.status==='failed')patch(item.id,{status:'오류',error:j.error_message||'PDF 검증에 실패했습니다.'});
    }catch{}
   }
  },3000);return()=>clearInterval(timer);
 },[]);
 function choose(files:FileList|File[]){
  setError('');const list=Array.from(files);
  if(list.some(f=>!f.name.toLowerCase().endsWith('.pdf')||f.size>104857600)){setError('PDF 파일당 100MiB까지 등록할 수 있습니다.');return}
  if(list.length+items.filter(i=>i.status!=='완료').length>100||list.reduce((n,f)=>n+f.size,0)+items.filter(i=>i.status!=='완료').reduce((n,f)=>n+f.size,0)>1073741824){setError('한 배치는 PDF 100개, 합계 1GiB까지입니다.');return}
  setItems(old=>{
   const next=old.filter(i=>i.status!=='완료');
   for(const f of list){
    const pending=next.find(i=>!i.file&&i.name===f.name&&i.size===f.size);
    if(pending){pending.file=f;pending.status='대기'}
    else next.push({id:crypto.randomUUID(),name:f.name,size:f.size,file:f,status:'대기',progress:0});
   }
   return next;
  });
 }
 async function send(item:Item){
  if(!item.file)return;
  paused.current.delete(item.id);
  try{
   let row:Row=item;
   if(!row.upload_endpoint||!row.signed_upload_token){
    row={...item,...await api('/uploads/'+item.asset_id+'/retry',{})};
   }
   patch(item.id,{status:'업로드 중',error:undefined});
   if(String(row.upload_endpoint).startsWith('/api/v1/test-upload')){
    const r=await fetch(row.upload_endpoint,{method:'PUT',headers:{Authorization:'Bearer '+await token(),'x-signature':row.signed_upload_token},body:item.file});
    if(!r.ok)throw new Error('파일을 전송하지 못했습니다.');
   }else{
    await new Promise<void>((resolve,reject)=>{
     aborters.current.set(item.id,()=>reject(new Error('paused')));
     const upload=new Upload(item.file!,{
      endpoint:row.upload_endpoint,headers:{'x-signature':row.signed_upload_token,'x-upsert':'false'},
      chunkSize:6*1024*1024,uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,
      retryDelays:[0,3000,5000,10000,20000],
      fingerprint:async()=>['tisiif',row.asset_id,item.name,item.size,item.file!.lastModified].join(':'),
      metadata:{bucketName:row.bucket,objectName:row.object_path,contentType:'application/pdf',cacheControl:'3600'},
      onProgress:(sent,total)=>patch(item.id,{progress:sent/total*100}),
      onError:()=>reject(new Error('업로드가 중단되었습니다. 재시도해 주세요.')),
      onSuccess:()=>resolve()
     });
     uploads.current.set(item.id,upload);
     upload.findPreviousUploads().then(previous=>{if(previous.length)upload.resumeFromPreviousUpload(previous[0]);upload.start()}).catch(reject);
    });
   }
   const completed=await api('/uploads/'+row.asset_id+'/complete',{});
   patch(item.id,{...row,status:completed.status==='verified'?'완료':'검증 중',job_id:completed.job_id,progress:100});
   client.invalidateQueries();
  }catch(e){if(!paused.current.has(item.id))patch(item.id,{status:'오류',error:e instanceof Error?e.message:'업로드 오류'})}
 }
 async function begin(onlyFailed=false){
  if(busy)return;setBusy(true);setError('');
  try{
   let pending=ref.current.filter(i=>i.file&&(onlyFailed?i.status==='오류':['대기','오류','일시정지'].includes(i.status)));
   const fresh=pending.filter(i=>!i.asset_id);
   if(fresh.length){
    const reserved=await api('/uploads/reserve',{files:fresh.map(i=>({client_file_id:i.id,name:i.name,byte_size:i.size,mime_type:'application/pdf'}))});
    const map=new Map<string,Row>(reserved.items.map((r:Row)=>[r.client_file_id,r]));
    pending=pending.map(i=>map.has(i.id)?{...i,...map.get(i.id)}:i);
    for(const i of pending)patch(i.id,{...i,error:typeof i.error==='object'?(i.error as any).message:i.error});
   }
   let index=0;
   await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{
    while(index<pending.length){const item=pending[index++];await send(item)}
   }));
  }catch(e){setError(e instanceof Error?e.message:'등록을 준비하지 못했습니다.')}
  finally{setBusy(false)}
 }
 function pause(item:Item){
  paused.current.add(item.id);uploads.current.get(item.id)?.abort();aborters.current.get(item.id)?.();patch(item.id,{status:'일시정지'});
 }
 const live=items.some(i=>!['완료','대기'].includes(i.status))||busy;
 return <Context.Provider value={{open:()=>setOpen(true)}}>{children}
  {open&&<Modal title="PDF 일괄 등록" width={800} onClose={()=>setOpen(false)} footer={<><span className="muted">{items.length}개 · 합계 {(items.reduce((a,i)=>a+i.size,0)/1024/1024).toFixed(1)} MB</span><button onClick={()=>setOpen(false)}>닫기</button><button disabled={busy||!items.some(i=>i.file)} className="primary" onClick={()=>begin()}>{busy?'업로드 중':'업로드 시작'}</button></>}>
   <div className="dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();choose(e.dataTransfer.files)}}><Icon name="upload"/><span>PDF를 끌어 놓거나 파일 선택</span><input aria-label="PDF 파일 선택" type="file" accept="application/pdf" multiple onChange={e=>{if(e.target.files)choose(e.target.files);e.target.value=''}}/></div>
   <ErrorBox error={error}/>
   <div className="file-list">{items.map(i=><div className="file-row" key={i.id}><span className="file-name" title={i.name}>{i.name}</span><span>{(i.size/1024/1024).toFixed(1)} MB</span><span>{i.status}</span><div className="actions">{i.status==='업로드 중'?<button onClick={()=>pause(i)}>일시정지</button>:i.status==='일시정지'?<button onClick={()=>send(i)}>재개</button>:!i.asset_id&&<button onClick={()=>setItems(old=>old.filter(x=>x.id!==i.id))}>제거</button>}</div>{i.error&&<span className="muted">{i.error}</span>}</div>)}</div>
   {items.some(i=>i.status==='오류')&&<button onClick={()=>begin(true)} disabled={busy}>실패 항목 재시도</button>}
  </Modal>}
  {live&&!open&&<section className="upload-panel" aria-label="업로드 진행"><div className="actions" style={{justifyContent:'space-between'}}><strong>PDF 등록</strong><button className="text-button" onClick={()=>setOpen(true)}>자세히</button></div>{items.filter(i=>i.status!=='완료').slice(0,5).map(i=><div className="file-row" key={i.id}><div className="file-name">{i.name}</div><span className="muted">{i.status}</span><div className="progress"><span style={{width:i.progress+'%'}}/></div></div>)}</section>}
 </Context.Provider>
}

