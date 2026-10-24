import base64
import hashlib
import hmac
import io
import json
import os
import time
from pathlib import Path
from uuid import UUID, uuid4
import pytest
import psycopg
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

WS=UUID('10000000-0000-4000-8000-000000000001')
ADMIN=UUID('20000000-0000-4000-8000-000000000001')
OTHER=UUID('20000000-0000-4000-8000-000000000002')
OUTSIDER=UUID('20000000-0000-4000-8000-000000000003')

def token(uid=ADMIN,email='admin@example.test'):
    def b64(v):return base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
    data=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'id':str(uid),'sub':str(uid),'email':email,'exp':int(time.time())+7200})
    return data+'.'+hmac.new(os.environ['TEST_AUTH_SECRET'].encode(),data.encode(),hashlib.sha256).hexdigest()

def initialize_database():
    url=os.environ.get('DATABASE_URL','')
    if os.environ.get('APP_ENV')!='test' or not url.endswith('/tisiif_test'):
        raise RuntimeError('REFUSE_TO_PREPARE_NON_TEST_DATABASE')
    os.environ.update(DEFAULT_WORKSPACE_ID=str(WS),BOOTSTRAP_ADMIN_EMAIL='admin@example.test',TEAM_EMAIL_ALLOWLIST='researcher@example.test',SUPABASE_URL='https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY='fixture-public-key')
    from lab.config import settings
    settings.cache_clear()
    with psycopg.connect(url,autocommit=True) as conn:
        conn.execute("""do $$begin
         if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
         if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
         end$$;
         create schema if not exists auth;
         create table if not exists auth.users(id uuid primary key,email text);
         create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
         grant usage on schema auth to authenticated;
         grant execute on function auth.uid() to authenticated;
         create schema if not exists storage;
         create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
         create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
         alter table storage.objects enable row level security;
         grant usage on schema storage to authenticated;
         grant select on storage.objects to authenticated;
        """)
    from lab.cli import migrate
    migrate()

def reset_data():
    from lab.db import transaction
    from lab.cli import bootstrap
    with transaction() as conn:
        conn.execute('truncate lab.workspaces cascade')
        conn.execute('truncate auth.users cascade')
        conn.execute('truncate lab_private.provider_runtime')
        for uid,email in [(ADMIN,'admin@example.test'),(OTHER,'researcher@example.test'),(OUTSIDER,'outside@example.test')]:
            conn.execute('insert into auth.users(id,email) values(%s,%s)',(uid,email))
    bootstrap()

@pytest.fixture(scope='session',autouse=True)
def prepare_database():
    if not os.environ.get('DATABASE_URL','').endswith('/tisiif_test'):
        pytest.skip('Dedicated PostgreSQL 17 service required; unit tests do not depend on it')
    initialize_database()

@pytest.fixture
def client():
    reset_data()
    from lab.api.app import create_app
    with TestClient(create_app()) as c:
        c.headers['Authorization']='Bearer '+token()
        yield c

def request(client,path,body=None,method=None,key=None):
    response=client.request(method or ('POST' if body is not None else 'GET'),'/api/v1'+path,
        json=body,headers={'Idempotency-Key':key or str(uuid4())})
    assert response.status_code<300,(path,response.status_code,response.text)
    return response.json()['data']

def pdf_bytes():
    buf=io.BytesIO();c=canvas.Canvas(buf);c.drawString(40,760,'PUBLIC theorem setup');c.drawString(40,700,'SECRET proof trick');c.save();return buf.getvalue()

def seed_input(client,mode='text'):
    from lab.worker.engine import tick
    raw=pdf_bytes()
    reserved=request(client,'/uploads/reserve',{'files':[{'client_file_id':str(uuid4()),'name':'Synthetic.pdf','byte_size':len(raw),'mime_type':'application/pdf'}]})['items'][0]
    r=client.put(reserved['upload_endpoint'],content=raw,headers={'x-signature':reserved['signed_upload_token']});assert r.status_code==200,r.text
    request(client,'/uploads/'+reserved['asset_id']+'/complete',{})
    assert tick('test-worker')
    cp=request(client,'/papers/'+reserved['paper_id']+'/checkpoints',{'title':'Lemma obstruction'})
    rev=cp['revision']
    body={'expected_hash':rev['content_hash'],'input_mode':mode,'goal_md':'Prove boundedness.','obstacle_md':'The induction step fails.',
        'abstract_md':'A synthetic mathematical study.','public_text_md':'Let n be a positive integer. Analyze induction.',
        'reference_idea_md':'HIDDEN_CANARY use a stronger invariant.','reference_location':'p. 1',
        'stage_outline':[{'index':1,'title':'Public stage','body_md':'Define the sequence.','is_public':True},{'index':2,'body_md':'HIDDEN_STAGE_CANARY','is_public':False}],
        'page_recipe':[{'page':1,'include':True,'rotation':0,'masks':[{'x':0,'y':0.12,'w':1,'h':0.08}]}],'review_note':'Synthetic fixture only'}
    rev=request(client,'/checkpoint-revisions/'+rev['id'],body,'PATCH')
    request(client,'/checkpoint-revisions/'+rev['id']+'/prepare',{})
    if mode=='pdf':assert tick('test-worker')
    packet=request(client,'/checkpoint-revisions/'+rev['id']+'/public-packet')
    assert 'HIDDEN_CANARY' not in json.dumps(packet)
    assert 'HIDDEN_STAGE_CANARY' not in json.dumps(packet)
    request(client,'/checkpoint-revisions/'+rev['id']+'/approve',{'reviewed_hash':packet['hash'],'public_input_checked':True,'hidden_content_checked':True,'reference_checked':True})
    return reserved,cp,rev

def create_mock(client,revision_id,key=None):
    protocol=request(client,'/protocols')['items'][0]
    body={'title':'Fixture research flow','cohort':'fixture','transport':'mock','checkpoint_revision_ids':[revision_id],
        'protocol_id':protocol['id'],'generator_profile_ids':{},'schedule':{'mode':'now','timezone':'Asia/Seoul'}}
    check=request(client,'/plans/preflight',body)
    return request(client,'/plans',{**body,'preflight_hash':check['preflight_hash']},key=key)

def finish_plan(plan_id):
    from lab.worker.engine import tick
    from lab.db import transaction,one
    for _ in range(60):
        with transaction() as conn:
            p=one(conn,'select status from lab.plans where id=%s',(plan_id,))
        if p['status']=='completed':return
        assert tick('test-worker'),p
    raise AssertionError('Fixture plan did not finish')
