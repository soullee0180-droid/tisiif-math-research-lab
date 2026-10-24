"""Real PostgreSQL, isolated CI container. No provider or cloud requests."""
import concurrent.futures, hashlib, json, os, pathlib, re, subprocess, uuid
root = pathlib.Path(__file__).resolve().parents[2]
container = os.environ['TEST_PG_CONTAINER']
def sql(query):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q'], input=query, text=True, capture_output=True, check=True)
    return result.stdout.strip()
def quote(value):
    return "'" + str(value).replace("'", "''") + "'"
def rpc(name, **args):
    assert re.fullmatch(r'lab_[a-z_]+', name)
    values = []
    for key, value in args.items():
        assert re.fullmatch(r'[a-z_]+', key)
        values.append(key + '=>' + (quote(json.dumps(value)) + '::jsonb' if isinstance(value, (dict, list)) else quote(value)))
    raw = sql('set role service_role;select to_json(public.' + name + '(' + ','.join(values) + '));')
    return json.loads(raw) if raw else None

def parallel(fn, n=24):
    with concurrent.futures.ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(fn, range(n)))

sql('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);')
for path in sorted((root / 'supabase/migrations').glob('*.sql')):
    if 'scheduler' not in path.name:
        sql(path.read_text())
w, a = str(uuid.uuid4()), str(uuid.uuid4())
protocol = json.loads((root / 'packages/contracts/research-protocol.json').read_text())
sql(f"insert into lab.workspaces(id,name,active) values({quote(w)},'CI contention fixture',true);insert into lab_private.email_allowlist values({quote(w)},'concurrency@fixture.invalid','admin',true);insert into lab.protocol_versions(workspace_id,body,sha256) values({quote(w)},{quote(json.dumps(protocol))}::jsonb,'fixture');update lab_private.provider_runtime set min_interval_ms=0,rpm=100000,tpm=2000000000;")
rpc('lab_identity', a=a, email_verified='concurrency@fixture.invalid')
def write(action, p, idem=None):
    return rpc('lab_write', w=w, a=a, action=action, p=p, idem=idem or str(uuid.uuid4()))
key = str(uuid.uuid4())
replays = parallel(lambda _: write('paper_create', {'title': 'One concurrent paper'}, key))
assert len({v['id'] for v in replays}) == 1
paper = replays[0]['id']
assert sql('select count(*) from lab.papers;') == '1'
cp = write('checkpoint_create', {'paper_id': paper, 'title': 'Fixture checkpoint', 'body': {'input_mode': 'text', 'goal': 'Fixture goal', 'obstacle': 'Fixture obstacle', 'public_text': 'PUBLIC_CANARY', 'reference_idea_md': 'SECRET_CANARY', 'reference_location': 'fixture', 'steps': []}})
write('revision_approve', {'id': cp['id'], 'if_match': 1, 'checks': [True, True, True]})
plan = write('plan_create', {'name': 'Concurrent claim fixture', 'k': 1, 'repeats': 2, 'cohort': 'fixture', 'transport': 'mock', 'revision_ids': [cp['id']]})
write('plan_control', {'id': plan['id'], 'status': 'running'})
b = str(uuid.uuid4())
sql(f"insert into lab_private.email_allowlist values({quote(w)},'second@fixture.invalid','researcher',true);")
rpc('lab_identity', a=b, email_verified='second@fixture.invalid')
second = rpc('lab_write', w=w, a=b, action='plan_create', p={'name': 'Second owner fixture', 'k': 1, 'repeats': 1, 'cohort': 'fixture', 'transport': 'mock', 'revision_ids': [cp['id']]}, idem=str(uuid.uuid4()))
rpc('lab_write', w=w, a=b, action='plan_control', p={'id': second['id'], 'status': 'running'}, idem=str(uuid.uuid4()))
claims = [c for c in parallel(lambda _: rpc('lab_claim', provider_name='google'), 32) if c]
assert len(claims) == 1, claims
assert sql("select count(*) from lab.jobs where provider='google' and status='running';") == '1'
nonce = str(uuid.uuid4())
assert sum(parallel(lambda _: rpc('lab_nonce', value=nonce))) == 1
attempt, job = claims[0]['attempt_id'], claims[0]['job_id']
sql(f"update lab.attempts set send_started_at=now(),milestone='send_started' where id={quote(attempt)};update lab.jobs set lease_until=now()-interval '1 second' where id={quote(job)};")
assert sum(parallel(lambda _: rpc('lab_recover'))) == 1
assert sql(f"select status from lab.jobs where id={quote(job)};") == 'unknown_remote'
assert sql(f"select count(*) from lab.attempts where job_id={quote(job)};") == '1'
next_claim = rpc('lab_claim', provider_name='google')
assert next_claim
first_owner = sql(f"select p.created_by from lab.plans p join lab.jobs j on j.plan_id=p.id where j.id={quote(job)};")
next_owner = sql(f"select p.created_by from lab.plans p join lab.jobs j on j.plan_id=p.id where j.id={quote(next_claim['job_id'])};")
assert first_owner != next_owner, (first_owner, next_owner)
rpc('lab_attempt', attempt=next_claim['attempt_id'], command='fail', p={'class': 'cancelled', 'safe_rejection': True})
sql("update lab_private.provider_runtime set rpm=0 where provider='google';")
assert rpc('lab_claim', provider_name='google') is None
sql("update lab_private.provider_runtime set rpm=100000,tpm=1 where provider='google';")
assert rpc('lab_claim', provider_name='google') is None
sql("update lab_private.provider_runtime set tpm=2000000000 where provider='google';")
# Eight simultaneous 100 MiB reservations must admit seven at most under 800 MB.
def reserve(index):
    files = [{'paper_id': paper, 'client_id': f'{index}:{i}', 'bytes': 10485760, 'sha256': hashlib.sha256(f'{index}:{i}'.encode()).hexdigest()} for i in range(10)]
    try:
        write('asset_batch_reserve', {'files': files})
        return True
    except subprocess.CalledProcessError as error:
        assert 'BATCH_CAPACITY_BLOCKED' in error.stderr, error.stderr
        return False
accepted = sum(parallel(reserve, 8))
assert accepted == 7, accepted
admitted = int(sql('select lab_private.storage_admitted();'))
assert admitted <= 800000000
report = {'status': 'PASS', 'environment': 'isolated PostgreSQL 17 CI container', 'actual_cloud': False, 'owners': 2, 'fair_owner_switch': True, 'rpm_tpm_blocked': True, 'concurrent_claimants': 32, 'claimed_jobs': 1, 'idempotency_replays': 24, 'nonce_acceptances': 1, 'stale_recoveries': 1, 'unknown_remote_not_resent': True, 'concurrent_storage_reservations': 8, 'accepted_100_mib_batches': accepted, 'storage_admitted_bytes': admitted, 'provider_network_calls': 0}
(root / 'test-results').mkdir(exist_ok=True)
(root / 'test-results/postgres-concurrency.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
