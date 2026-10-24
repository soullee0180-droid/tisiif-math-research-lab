import json
import signal
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4, uuid5
from lab.config import ROOT, settings
from lab.db import transaction, one, many, insert, value
from lab.domain.research import assemble, parse_output, canonical, digest
from lab.domain.plans import refresh_progress
from lab.providers.adapters import Adapter, mock_send, ProviderResponse
from lab.providers.errors import ProviderFailure
from lab.providers.secrets import decrypt
from lab.storage.client import Storage

STOP = threading.Event()

def actor_for(conn, job):
    if job.get('plan_id'):
        row = one(conn, 'select created_by from lab.plans where workspace_id=%s and id=%s',
                  (job['workspace_id'], job['plan_id']))
        actor = row['created_by']
    else:
        actor = job['payload']['actor_id']
    return {'workspace_id':job['workspace_id'], 'user_id':actor}

def reserve_response(conn, user, attempt):
    ident = uuid5(attempt['id'], 'response')
    row = one(conn,'select * from lab.assets where workspace_id=%s and id=%s',(user['workspace_id'],ident))
    if not row:
        row = insert(conn,'lab.assets',dict(id=ident,workspace_id=user['workspace_id'],kind='response_json',
            bucket='lab-artifacts',object_path=str(user['workspace_id'])+'/'+str(ident)+'/response.json',
            original_name='response.json',mime_type='application/json',status='reserved',created_by=user['user_id']))
    conn.execute('update lab.attempts set response_asset_id=%s where id=%s and workspace_id=%s',
                 (ident,attempt['id'],user['workspace_id']))
    return row

def recover():
    ws=settings().default_workspace_id
    with transaction() as conn:
        if not one(conn,'select pg_try_advisory_xact_lock(hashtextextended(%s,983204)) locked',(str(ws),))['locked']:return
        conn.execute("""update lab.jobs set status='queued',lease_owner=null,lease_expires_at=null,updated_at=now()
            where workspace_id=%s and status='leased' and lease_expires_at<now()""",(ws,))
        rows=many(conn,"""select j.id job_id,j.workspace_id,a.id attempt_id,a.response_asset_id
            from lab.jobs j join lab.attempts a on a.job_id=j.id and a.workspace_id=j.workspace_id
            where j.workspace_id=%s and j.status in ('dispatching','submitted','waiting_remote')
            and j.lease_expires_at<now() and a.attempt_no=(select max(x.attempt_no) from lab.attempts x where x.job_id=j.id)""",(ws,))
    # Our own durable storage may already have the response even if the DB commit was interrupted.
    for row in rows:
        raw=None
        if row['response_asset_id']:
            with transaction() as conn:
                asset=one(conn,'select * from lab.assets where id=%s and workspace_id=%s',
                          (row['response_asset_id'],ws))
            if asset:
                try:
                    raw=Storage().get(asset)
                    obj=json.loads(raw)
                    if not isinstance(obj.get('text'),str): raw=None
                except (Exception,): raw=None
        with transaction() as conn:
            current=one(conn,'select status,lease_expires_at from lab.jobs where id=%s and workspace_id=%s for update',(row['job_id'],ws))
            if not current or current['status'] not in ('dispatching','submitted','waiting_remote') or not current['lease_expires_at'] or current['lease_expires_at']>datetime.now(timezone.utc):continue
            if raw is not None:
                conn.execute("update lab.assets set status='verified',sha256=%s,byte_size=%s,verified_at=now() where id=%s and workspace_id=%s",
                             (digest(raw),len(raw),row['response_asset_id'],ws))
                conn.execute("update lab.attempts set status='response_saved' where id=%s and workspace_id=%s",
                             (row['attempt_id'],ws))
                conn.execute("update lab.jobs set status='queued',lease_owner=null,lease_expires_at=null where id=%s and workspace_id=%s",
                             (row['job_id'],ws))
            else:
                conn.execute("update lab.jobs set status='unknown_remote',error_class='remote_unknown',lease_owner=null where id=%s and workspace_id=%s",
                             (row['job_id'],ws))
                conn.execute("update lab.attempts set status='unknown_remote',error_class='remote_unknown' where id=%s and workspace_id=%s",
                             (row['attempt_id'],ws))
    with transaction() as conn:
        # Multiple worker processes can otherwise lock ready dependants in different orders.
        if not one(conn,'select pg_try_advisory_xact_lock(hashtextextended(%s,983204)) locked',(str(ws),))['locked']:return
        conn.execute("""update lab.jobs j set status=case when r.transport='manual' then 'needs_input' else 'queued' end,updated_at=now()
            from lab.runs r where j.run_id=r.id and j.workspace_id=r.workspace_id and j.workspace_id=%s
            and j.status='blocked' and j.error_class is null
            and not exists(select 1 from unnest(j.depends_on) d(id) left join lab.jobs x on x.id=d.id
                where x.id is null or x.status<>'completed')""",(ws,))

def claim(worker):
    ws=settings().default_workspace_id
    for provider in ('mock','google','openai','anthropic'):
        with transaction() as conn:
            runtime=one(conn,'select * from lab_private.provider_runtime where provider=%s for update skip locked',(provider,))
            now=datetime.now(timezone.utc)
            if not runtime or not runtime['enabled'] or runtime['blocked_reason']: continue
            if runtime['next_dispatch_at']>now or runtime['paused_until'] and runtime['paused_until']>now: continue
            active=one(conn,"select count(*) n from lab.jobs where provider=%s and status in ('leased','dispatching','submitted','waiting_remote')",(provider,))['n']
            if active>=runtime['max_concurrency']: continue
            recent=one(conn,"""select count(*) n,coalesce(sum((a.normalized_settings->>'reserved_tokens')::bigint),0) tokens
                from lab.attempts a join lab.jobs j on j.id=a.job_id
                where j.provider=%s and a.sent_at>now()-interval '60 seconds'""",(provider,)) if runtime['rpm_limit'] or runtime['tpm_limit'] else {'n':0,'tokens':0}
            if runtime['rpm_limit'] and recent['n']>=runtime['rpm_limit']: continue
            query=(ROOT/'contracts/002_claim_job.sql').read_text()
            query=query.replace("p.status in ('running','scheduled')", "p.status in ('running','scheduled','partial')")
            # Contract claim additionally restricts this worker to its configured active workspace.
            query=query.replace("where j.provider = %(provider)s", "where j.workspace_id = %(workspace)s and j.provider = %(provider)s")
            if '%(workspace)s' not in query:
                query=query.replace("where j.provider=%(provider)s", "where j.workspace_id=%(workspace)s and j.provider=%(provider)s")
            job=one(conn,query,dict(provider=provider,worker=worker,workspace=ws))
            if not job: continue
            if str(job['workspace_id'])!=str(ws):
                conn.execute("update lab.jobs set status='queued',lease_owner=null,lease_expires_at=null where id=%s",(job['id'],))
                continue
            run=one(conn,'select * from lab.runs where id=%s and workspace_id=%s',(job['run_id'],ws))
            model=run['generator_model'] if not job['judge_provider'] else run['judge_models'][job['judge_provider']]
            cap=model.get('config',{}).get('max_visible_output_target_by_stage',{}).get(job['phase'],8000)
            reservation=cap+model.get('capabilities',{}).get('estimated_input_reservation',32000)
            used=recent['tokens']
            if runtime['tpm_limit'] and used+reservation>runtime['tpm_limit']:
                conn.execute("update lab.jobs set status='waiting_rate',available_at=now()+interval '10 seconds',lease_owner=null,lease_expires_at=null where id=%s",(job['id'],))
                continue
            attempt=one(conn,"select * from lab.attempts where job_id=%s and workspace_id=%s and status='response_saved' order by attempt_no desc limit 1",(job['id'],ws))
            if not attempt:
                n=one(conn,'select coalesce(max(attempt_no),0)+1 n from lab.attempts where job_id=%s',(job['id'],))['n']
                attempt=insert(conn,'lab.attempts',dict(id=uuid4(),workspace_id=job['workspace_id'],job_id=job['id'],
                    attempt_no=n,status='started',transport=run['transport'],requested_model=model['model_id'],
                    normalized_settings={'reserved_tokens':reservation,'reservation_is_estimate':True,'profile':model}))
            conn.execute("update lab.plans set last_dispatched_at=now(),started_at=coalesce(started_at,now()),status=case when status='scheduled' then 'running' else status end where workspace_id=%s and id=%s",(ws,job['plan_id']))
            conn.execute('update lab_private.provider_runtime set next_dispatch_at=now()+make_interval(secs=>min_interval_seconds) where provider=%s',(provider,))
            return job,attempt
    with transaction() as conn:
        conn.execute('select pg_advisory_xact_lock(983201)')
        if one(conn,"select id from lab.jobs where status='leased' and phase in ('prepare_pdf','export','backup','diagnostic') and lease_expires_at>now() limit 1"):
            return None
        job=one(conn,"""select * from lab.jobs where workspace_id=%s and status='queued'
            and phase in ('prepare_pdf','export','backup','diagnostic') and available_at<=now()
            order by priority,created_at for update skip locked limit 1""",(ws,))
        if job:
            conn.execute("update lab.jobs set status='leased',lease_owner=%s,lease_expires_at=now()+interval '90 seconds' where workspace_id=%s and id=%s",(worker,ws,job['id']))
            return job,None
    return None

@contextmanager
def heartbeat(job,worker):
    done=threading.Event()
    def beat():
        while not done.wait(15):
            try:
                with transaction() as conn:
                    conn.execute("update lab.jobs set heartbeat_at=now(),lease_expires_at=now()+interval '90 seconds' where id=%s and workspace_id=%s and lease_owner=%s",
                                 (job['id'],job['workspace_id'],worker))

            except Exception: pass
    thread=threading.Thread(target=beat,daemon=True);thread.start()
    try: yield
    finally: done.set();thread.join(timeout=2)

def load_packet(job):
    ws=job['workspace_id']
    with transaction() as conn:
        run=one(conn,'select * from lab.runs where id=%s and workspace_id=%s',(job['run_id'],ws))
        plan=one(conn,'select * from lab.plans where id=%s and workspace_id=%s',(job['plan_id'],ws))
        ideas=many(conn,'select * from lab.ideas where run_id=%s and workspace_id=%s order by ordinal',(run['id'],ws))
    return assemble(run,job['phase'],job['judge_provider'],plan['frozen_config'],ideas),run,plan

def accept(job,attempt,packet,response,human_corrected=False):
    ws=job['workspace_id']
    with transaction() as conn:
        plan=one(conn,'select * from lab.plans where id=%s and workspace_id=%s',(job['plan_id'],ws))
        run=one(conn,'select * from lab.runs where id=%s and workspace_id=%s',(job['run_id'],ws))
    try:
        if response.finish!='stop': raise ValueError(response.finish)
        parsed=parse_output(response.text,job['phase'],plan['frozen_config']['protocol'],run['candidate_count'])
    except Exception:
        status=response.finish if response.finish in ('refused','truncated') else 'invalid'
        with transaction() as conn:
            conn.execute('update lab.attempts set status=%s,error_class=%s where id=%s and workspace_id=%s',(status,status,attempt['id'],ws))
            conn.execute("update lab.jobs set status='needs_review',error_class=%s,lease_owner=null,lease_expires_at=null,updated_at=now() where id=%s and workspace_id=%s",(status,job['id'],ws))
            refresh_progress(conn,ws,job['plan_id'],job.get('run_id'))
        return False
    with transaction() as conn:
        locked=one(conn,'select * from lab.jobs where id=%s and workspace_id=%s for update',(job['id'],ws))
        if locked['accepted_attempt_id']: return str(locked['accepted_attempt_id'])==str(attempt['id'])
        base=dict(workspace_id=ws,run_id=run['id'],source_attempt_id=attempt['id'])
        phase=job['phase']
        if phase=='generate':
            for row in parsed['ideas']:
                data={k:v for k,v in row.items() if k!='candidate_id'}
                insert(conn,'lab.ideas',{**base,**data,'id':uuid4(),'ordinal':int(row['candidate_id'][1:])})
        elif phase=='select':
            label=packet['display_to_canonical'][parsed['selected_candidate_id']]
            insert(conn,'lab.selections',{**base,'selected_ordinal':int(label[1:]),
                'rationale_md':parsed['rationale_md'],'risks_md':parsed['risks_md']})
        else:
            for row in parsed['ratings']:
                label=packet['display_to_canonical'][row['candidate_id']]
                data={k:v for k,v in row.items() if k!='candidate_id'}
                insert(conn,'lab.'+phase+'_ratings',{**base,**data,'idea_ordinal':int(label[1:]),'judge_provider':job['judge_provider']})
        conn.execute("update lab.attempts set status='accepted',normalized_settings=normalized_settings||%s where id=%s and workspace_id=%s",
                     (value({'human_corrected':human_corrected}),attempt['id'],ws))
        conn.execute("update lab.jobs set status='completed',accepted_attempt_id=%s,lease_owner=null,lease_expires_at=null,error_class=null,error_message=null,updated_at=now() where id=%s and workspace_id=%s",
                     (attempt['id'],job['id'],ws))
        refresh_progress(conn,ws,job['plan_id'],job.get('run_id'))
    return True

def process(job,attempt):
    if attempt is None:
        from lab.worker.tasks import process_aux
        process_aux(job)
        return
    storage=Storage()
    packet,run,plan=load_packet(job)
    ws=job['workspace_id']
    with transaction() as conn:
        actor=actor_for(conn,job)
        saved=one(conn,'select * from lab.attempts where id=%s and workspace_id=%s',(attempt['id'],ws))
        response_asset=one(conn,'select * from lab.assets where id=%s and workspace_id=%s',(saved['response_asset_id'],ws)) if saved['response_asset_id'] else None
    if saved['status']=='response_saved':
        obj=json.loads(storage.get(response_asset))
        accept(job,attempt,packet,ProviderResponse(obj['text'],obj.get('raw',{}),obj.get('model'),obj.get('request_id'),obj.get('usage'),obj.get('finish','stop')))
        return
    pdf=None
    if packet['prepared_pdf_asset_id']:
        with transaction() as conn:
            asset=one(conn,'select * from lab.assets where workspace_id=%s and id=%s',(ws,packet['prepared_pdf_asset_id']))
        pdf=storage.get(asset)
        if digest(pdf)!=asset['sha256']: raise ValueError('PREPARED_ASSET_HASH_MISMATCH')
    key=None;version=None
    if run['transport']=='api':
        provider=job['judge_provider'] or run['generator_provider']
        with transaction() as conn:
            secret=one(conn,'select * from lab_private.provider_secrets where workspace_id=%s and provider=%s',(ws,provider))
        if not secret: raise ProviderFailure('credential_blocked','API 키 설정이 필요합니다.')
        key=decrypt(secret);version=secret['key_version']
    request_asset=storage.persist(actor,'request_json',canonical(packet).encode(),'request.json','application/json',ident=uuid5(attempt['id'],'request'))
    with transaction() as conn:
        response_asset=reserve_response(conn,actor,attempt)
        conn.execute("update lab.attempts set status='dispatching',request_asset_id=%s,request_sha256=%s,sent_at=now(),normalized_settings=normalized_settings||%s where id=%s and workspace_id=%s",
            (request_asset['id'],digest(packet),value({'key_version':version,'display_to_canonical':packet['display_to_canonical']}),attempt['id'],ws))
        conn.execute("update lab.jobs set status='dispatching',updated_at=now() where id=%s and workspace_id=%s",(job['id'],ws))
    # Deliberately outside all database transactions.
    response=mock_send(packet) if run['transport']=='mock' else Adapter(provider,key).send(packet,pdf)
    body=canonical({'text':response.text,'raw':response.raw,'model':response.model,'request_id':response.request_id,
                    'usage':response.usage,'finish':response.finish}).encode()
    storage.put(response_asset['bucket'],response_asset['object_path'],body,'application/json')
    with transaction() as conn:
        conn.execute("update lab.assets set status='verified',sha256=%s,byte_size=%s,verified_at=now() where workspace_id=%s and id=%s",
                     (digest(body),len(body),ws,response_asset['id']))
        conn.execute("update lab.attempts set status='response_saved',returned_model=%s,provider_request_id=%s,usage=%s,received_at=now() where id=%s and workspace_id=%s",
            (response.model,response.request_id,value(response.usage),attempt['id'],ws))
    raw=storage.persist(actor,'raw_text',response.text.encode(),'response.txt','text/plain',ident=uuid5(attempt['id'],'raw-text'))
    with transaction() as conn:
        conn.execute('update lab.attempts set raw_text_asset_id=%s where id=%s and workspace_id=%s',(raw['id'],attempt['id'],ws))
    accept(job,attempt,packet,response)

def record_failure(job,attempt,error):
    ws=job['workspace_id']
    with transaction() as conn:
        current=one(conn,'select status from lab.jobs where id=%s and workspace_id=%s',(job['id'],ws))
        if not current or current['status']=='completed': return
        saved=one(conn,'select status from lab.attempts where id=%s and workspace_id=%s',(attempt['id'],ws)) if attempt else None
        if saved and saved['status']=='response_saved':
            conn.execute("update lab.jobs set status='needs_review',error_class='saved_response_processing',error_message='응답은 저장했습니다. 이 단계를 재시도하면 저장 응답을 다시 해석합니다.',lease_owner=null,lease_expires_at=null where id=%s and workspace_id=%s",(job['id'],ws))
            if job['plan_id']: refresh_progress(conn,ws,job['plan_id'],job.get('run_id'))
            return
        if isinstance(error,ProviderFailure):
            cls=error.error_class
            state='unknown_remote' if error.remote_uncertain else 'waiting_rate' if cls in ('rate_transient','quota_daily') else 'blocked'
            seconds=error.retry_after if cls=='rate_transient' else None
            if cls=='rate_transient' and seconds is None: seconds=min(300,15*2**min(attempt['attempt_no'] if attempt else 1,4))
            if cls=='rate_transient' and attempt and attempt['attempt_no']>=4:state='blocked'
            if cls=='quota_daily' and seconds is None: state='blocked'
            if state=='blocked':
                conn.execute('update lab_private.provider_runtime set blocked_reason=%s where provider=%s',(cls,job['provider']))
            if state=='waiting_rate':
                conn.execute("update lab_private.provider_runtime set paused_until=now()+make_interval(secs=>%s) where provider=%s",(seconds,job['provider']))
            if cls in ('model_or_input','input_size'): state='failed'
            message=error.message
        else:
            cls='storage_or_processing'
            state='unknown_remote' if current['status'] in ('dispatching','submitted','waiting_remote') else 'failed'
            message='처리를 완료하지 못했습니다. 저장 상태를 확인해 주세요.'
            seconds=None
        conn.execute("update lab.jobs set status=%s,error_class=%s,error_message=%s,available_at=now()+make_interval(secs=>%s),lease_owner=null,lease_expires_at=null,updated_at=now() where id=%s and workspace_id=%s",
                     (state,cls,message,seconds or 0,job['id'],ws))
        if attempt:
            conn.execute('update lab.attempts set status=%s,error_class=%s,http_status=%s,error_detail=%s where id=%s and workspace_id=%s',
                ('unknown_remote' if state=='unknown_remote' else 'error',cls,getattr(error,'http_status',None),
                 value({'exception_type':type(error).__name__,'retry_after':seconds}),attempt['id'],ws))
        if job['plan_id']: refresh_progress(conn,ws,job['plan_id'],job.get('run_id'))

def tick(worker):
    recover()
    claimed=claim(worker)
    if not claimed: return False
    job,attempt=claimed
    try:
        with heartbeat(job,worker): process(job,attempt)
    except Exception as error: record_failure(job,attempt,error)
    return True

def run_worker():
    cfg=settings()
    if not cfg.default_workspace_id: raise RuntimeError('DEFAULT_WORKSPACE_ID is required')
    for signum in (signal.SIGTERM,signal.SIGINT): signal.signal(signum,lambda *_:STOP.set())
    with transaction() as conn:
        conn.execute("""insert into lab.worker_heartbeats(workspace_id,worker_name,build_sha,heartbeat_at)
            values(%s,%s,%s,now()) on conflict(workspace_id,worker_name) do update set build_sha=excluded.build_sha,heartbeat_at=now()""",
            (cfg.default_workspace_id,cfg.worker_name,cfg.build_sha))
    from concurrent.futures import ThreadPoolExecutor
    def execute(claimed):
        job,attempt=claimed
        try:
            with heartbeat(job,cfg.worker_name):process(job,attempt)
        except Exception as error:record_failure(job,attempt,error)
    # Keep peak PDF/base64 memory bounded on the minimum 2 GiB instance.
    with ThreadPoolExecutor(max_workers=4,thread_name_prefix="research") as executor:
        pending=set()
        while not STOP.is_set():
            try:
                pending={f for f in pending if not f.done()}
                with transaction() as conn:
                    conn.execute('update lab.worker_heartbeats set heartbeat_at=now(),active_jobs=%s where workspace_id=%s and worker_name=%s',
                                 (len(pending),cfg.default_workspace_id,cfg.worker_name))
                from lab.worker.tasks import schedule_backup
                schedule_backup();recover()
                while len(pending)<4 and not STOP.is_set():
                    claimed=claim(cfg.worker_name)
                    if not claimed:break
                    pending.add(executor.submit(execute,claimed))
                STOP.wait(1 if pending else 2)
            except Exception:
                print('{"event":"worker_cycle_failed","details":"redacted"}',flush=True)
                STOP.wait(5)
        # Stop claiming immediately. In-flight tasks retain their leases until durable save;
        # a platform hard stop is recovered as saved response or unknown_remote.
