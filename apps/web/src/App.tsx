import {useEffect,useState} from 'react';
import {Routes,Route,Navigate,NavLink,useLocation,useNavigate} from 'react-router-dom';
import {initialize,supabase,api} from './api/client';
import type {Row} from './api/client';
import {UserContext,Icon,ErrorBox} from './components';
import {UploadProvider} from './uploads';
import {PapersPage,PaperPage,CheckpointEditor} from './pages/papers';
import {ExperimentsPage,ExperimentPage,QueuePage} from './pages/experiments';
import {ResultsPage} from './pages/results';
import {SettingsPage} from './pages/settings';

function Callback(){
 const[error,setError]=useState('');const navigate=useNavigate();
 useEffect(()=>{
  const code=new URLSearchParams(location.search).get('code');
  if(!code||!supabase){setError('로그인 연결을 확인해 주세요.');return}
  const key='oauth-exchange:'+code;
  // StrictMode must not exchange a one-use PKCE code twice.
  const exchange=(window as any)[key]||((window as any)[key]=supabase.auth.exchangeCodeForSession(code));
  exchange.then(({error}:Row)=>{if(error)setError('로그인에 실패했습니다. 다시 시도해 주세요.');else navigate('/papers',{replace:true})});
 },[]);
 return <div className="login"><p>{error||'로그인 확인 중'}</p>{error&&<a href="/login">로그인으로 돌아가기</a>}</div>
}
function Login({error}:{error:string}){
 const[busy,setBusy]=useState(false),[ownError,setError]=useState('');
 async function signIn(){
  if(!supabase)return;setBusy(true);
  const{error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/auth/callback',scopes:'openid email profile'}});
  if(error){setError('로그인 연결을 시작하지 못했습니다.');setBusy(false)}
 }
 return <div className="login"><div className="login-card"><h1>TISIIF Lab</h1><p>공동 수학 연구 실험실</p><button className="google-login" disabled={busy||!supabase} onClick={signIn}><span className="google-g">G</span>{busy?'로그인 중':'Google로 로그인'}</button><ErrorBox error={error||ownError||(!supabase?'관리자 로그인 연결 설정이 필요합니다.':'')}/></div><div className="login-note">초대된 팀원만 이용할 수 있습니다.</div></div>
}
export default function App(){
 const[ready,setReady]=useState(false),[session,setSession]=useState<any>(undefined),[user,setUser]=useState<Row|null>(null),[error,setError]=useState('');
 const[menu,setMenu]=useState(false),[userMenu,setUserMenu]=useState(false);
 const where=useLocation();
 useEffect(()=>{
  let unsub:(()=>void)|undefined;
  initialize().then(async()=>{
   setReady(true);
   if(!supabase){setSession(null);return}
   const{data}=await supabase.auth.getSession();setSession(data.session);
   const{data:listener}=supabase.auth.onAuthStateChange((_event,s)=>setSession(s));
   unsub=()=>listener.subscription.unsubscribe();
  }).catch(()=>{setError('연결 설정을 불러오지 못했습니다.');setReady(true)});
  return()=>unsub?.();
 },[]);
 useEffect(()=>{
  if(session===undefined)return;
  if(!session){setUser(null);return}
  let active=true;setError('');
  api('/me').then(u=>{if(active)setUser(u)}).catch(e=>{if(active){setError(e.message);setUser(null)}});
  return()=>{active=false};
 },[session?.access_token]);
 if(!ready)return <div className="login">로그인 확인 중</div>;
 if(where.pathname==='/auth/callback')return <Callback/>;
 if(!user){
  if(session&&!error)return <div className="login">로그인 확인 중</div>;
  return <Login error={error}/>;
 }
 const links=[['/papers','논문','file'],['/experiments','실험','flask'],['/queue','진행 상황','queue'],['/results','결과','chart']];
 return <UserContext.Provider value={user}><UploadProvider>
  <aside className={'sidebar'+(menu?' open':'')}><div className="brand"><span className="brand-mark">T</span>TISIIF Lab</div><nav>{links.map(([url,label,icon])=><NavLink key={url} to={url} onClick={()=>setMenu(false)}><Icon name={icon}/>{label}</NavLink>)}</nav>{user.role==='admin'&&<NavLink className="settings-link" to="/settings"><Icon name="settings"/>설정</NavLink>}</aside>
  <header className="topbar"><button className="mobile-menu icon-button" aria-label="메뉴" onClick={()=>setMenu(!menu)}><Icon name="menu"/></button><span>{user.workspace.name}</span><button className="user-button" onClick={()=>setUserMenu(!userMenu)}>{user.display_name}<span className="avatar">{user.display_name.slice(0,1).toUpperCase()}</span></button>{userMenu&&<div className="floating-menu"><button onClick={()=>supabase?.auth.signOut()}>로그아웃</button></div>}</header>
  <main className="main"><Routes>
   <Route path="/papers" element={<PapersPage/>}/><Route path="/papers/:id" element={<PaperPage/>}/>
   <Route path="/checkpoints/:id/edit" element={<CheckpointEditor/>}/>
   <Route path="/experiments" element={<ExperimentsPage/>}/><Route path="/experiments/:id" element={<ExperimentPage/>}/>
   <Route path="/queue" element={<QueuePage/>}/><Route path="/results" element={<ResultsPage/>}/>
   <Route path="/settings" element={user.role==='admin'?<SettingsPage/>:<ErrorBox error="접근 권한이 없습니다."/>}/>
   <Route path="*" element={<Navigate to="/papers" replace/>}/>
  </Routes></main>
 </UploadProvider></UserContext.Provider>
}

