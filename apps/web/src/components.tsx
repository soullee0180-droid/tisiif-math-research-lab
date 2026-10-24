import React,{useEffect,useRef,useState,createContext,useContext} from 'react';
import type {ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {api,image,time} from './api/client';
import type {Row} from './api/client';
export const UserContext=createContext<Row|null>(null);
export const useUser=()=>useContext(UserContext)!;
export function useData<T=Row>(path:string,poll=false,enabled=true){
  return useQuery<T>({queryKey:[path],queryFn:()=>api<T>(path),enabled,
    refetchInterval:poll?()=>document.hidden?15000:3000:false,retry:1});
}
export function useActions(){
  const client=useQueryClient();const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  async function act<T>(fn:()=>Promise<T>):Promise<T|undefined>{
    if(busy)return;
    setBusy(true);setError('');
    try{const r=await fn();await client.invalidateQueries();return r}
    catch(e){setError(e instanceof Error?e.message:'요청을 완료하지 못했습니다.');return}
    finally{setBusy(false)}
  }
  return{busy,error,setError,act};
}
export function ErrorBox({error,retry}:{error:unknown;retry?:()=>void}){
  if(!error)return null;
  return <div className="error" role="alert">{error instanceof Error?error.message:String(error)}{retry&&<button onClick={retry}>다시 시도</button>}</div>
}
export function Loading(){return <div className="skeleton" aria-label="불러오는 중">{Array.from({length:8},(_,i)=><div key={i}/>)}</div>}
export function Empty({children,action}:{children:ReactNode;action?:ReactNode}){
 return <div className="empty"><Icon name="file"/><p>{children}</p>{action}</div>
}
const labels:Row={queued:'대기',scheduled:'예약',running:'실행 중',completed:'완료',partial:'일부 완료',failed:'오류',paused:'일시정지',needs_input:'입력 대기',needs_review:'확인 필요',unknown_remote:'원격 결과 불명',cancelled:'취소',blocked:'대기',leased:'실행 중',dispatching:'전송 중',waiting_rate:'한도 대기',draft:'초안',preparing:'준비 중',review:'검토 필요',approved:'승인',verified:'등록 완료',reserved:'업로드 대기',uploaded:'검증 중',passed:'연결 확인',unverified:'미검증',manual_only:'수동 전용',ready:'실험 가능',error:'오류'};
export function Status({value}:{value:string}){return <span className={'status '+value}><span/>{labels[value]||value}</span>}
export function Icon({name='file'}:{name?:string}){
 const paths:Row={file:'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',flask:'M9 3h6 M10 3v7L4 20h16l-6-10V3 M7 15h10',queue:'M9 6h12 M9 12h12 M9 18h12 M3 6h1 M3 12h1 M3 18h1',chart:'M4 3v18h17 M8 17v-5 M13 17V7 M18 17v-9',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',upload:'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6',plus:'M12 4v16 M4 12h16',close:'M5 5l14 14 M19 5L5 19',menu:'M3 5h18 M3 12h18 M3 19h18'};
 return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.file}/></svg>
}
export function Field({label,children}:{label:string;children:ReactNode}){
 return <label className="field"><span>{label}</span>{children}</label>
}
export function Modal({title,children,onClose,width=800,footer}:{title:string;children:ReactNode;onClose:()=>void;width?:number;footer?:ReactNode}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;ref.current?.querySelector<HTMLElement>('input,button,textarea,select')?.focus();return()=>previous?.focus()},[]);
 function key(e:React.KeyboardEvent){
  if(e.key==='Escape')onClose();
  if(e.key==='Tab'){
   const elements=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]')||[]);
   const first=elements[0],last=elements.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
  }
 }
 return <div className="backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div role="dialog" aria-modal="true" aria-label={title} className="modal" ref={ref} onKeyDown={key} style={{width}}>
   <div className="modal-title"><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><Icon name="close"/></button></div>
   <div className="modal-body">{children}</div>{footer&&<div className="modal-footer">{footer}</div>}
 </div></div>
}
export function Markdown({text}:{text:string}){
 const[plain,setPlain]=useState(false);
 return <div className="markdown"><button className="text-button" onClick={()=>setPlain(!plain)}>{plain?'수식으로 보기':'텍스트로 보기'}</button>{plain?<pre>{text}</pre>:<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex,{throwOnError:false}]]}>{text}</ReactMarkdown>}</div>
}
export function Tabs({items,value,onChange}:{items:string[];value:string;onChange:(s:string)=>void}){
 return <div className="tabs" role="tablist">{items.map(s=><button key={s} role="tab" aria-selected={value===s} className={value===s?'active':''} onClick={()=>onChange(s)}>{s}</button>)}</div>
}
export function PageHeading({title,children}:{title:string;children?:ReactNode}){
 return <div className="page-heading"><h1>{title}</h1><div className="actions">{children}</div></div>
}
export function Table({columns,rows,onRow}:{columns:{title:string;key?:string;width?:number;render?:(r:Row)=>ReactNode}[];rows:Row[];onRow?:(r:Row)=>void}){
 return <div className="table-scroll"><table><thead><tr>{columns.map((c,i)=><th key={i} style={c.width?{width:c.width}:undefined}>{c.title}</th>)}</tr></thead>
 <tbody>{rows.map((r,i)=><tr key={r.id||i} tabIndex={onRow?0:undefined} onClick={()=>onRow?.(r)} onKeyDown={e=>{if(e.key==='Enter'&&e.target===e.currentTarget)onRow?.(r)}}>
 {columns.map((c,j)=><td key={j}>{c.render?c.render(r):String(r[c.key||'']??'—')}</td>)}</tr>)}</tbody></table></div>
}
export function Pager({page,total,setPage,size=25}:{page:number;total:number;setPage:(n:number)=>void;size?:number}){
 return <div className="pager"><span>{total?Math.min(total,page+1):0}–{Math.min(total,page+size)} / {total}</span><button disabled={!page} onClick={()=>setPage(Math.max(0,page-size))}>이전</button><button disabled={page+size>=total} onClick={()=>setPage(page+size)}>다음</button></div>
}
export function BlobImage({asset,page,rotation=0,...props}:{asset:string;page:number;rotation?:number;alt:string;className?:string;onLoad?:()=>void}){
 const ref=useRef<HTMLSpanElement>(null);const[seen,setSeen]=useState(false);const[url,setUrl]=useState('');
 useEffect(()=>{const observer=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting))setSeen(true)});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect()},[]);
 const query=useQuery({queryKey:['page-image',asset,page,rotation],queryFn:()=>image('/assets/'+asset+'/pages/'+page+'?rotation='+rotation),enabled:seen&&!!asset,staleTime:Infinity});
 useEffect(()=>{if(query.data){const u=URL.createObjectURL(query.data);setUrl(u);return()=>URL.revokeObjectURL(u)}},[query.data]);
 return <span ref={ref} className="image-holder">{query.isError?<span className="error">미리보기 오류</span>:url?<img {...props} src={url}/>:<span className="image-placeholder">페이지 {page}</span>}</span>
}
export function SummaryCards({items}:{items:{label:string;value:ReactNode}[]}){
 return <div className="summary-cards">{items.map(i=><div className="card" key={i.label}><span>{i.label}</span><strong>{i.value}</strong></div>)}</div>
}

