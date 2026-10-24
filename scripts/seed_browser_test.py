"""Explicit synthetic CI seed. Refuses every database except tisiif_test."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests/integration'))
from conftest import initialize_database,reset_data,token,seed_input,create_mock,finish_plan
from fastapi.testclient import TestClient
initialize_database();reset_data()
from lab.api.app import create_app
with TestClient(create_app()) as client:
    client.headers['Authorization']='Bearer '+token()
    paper,cp,rev=seed_input(client)
    plan=create_mock(client,rev['id']);finish_plan(plan['plan_id'])
Path('test-results').mkdir(exist_ok=True)
Path('test-results/browser-fixture.json').write_text(json.dumps({'access_token':token(),'paper_id':paper['paper_id'],'revision_id':rev['id'],'checkpoint_id':cp['checkpoint']['id'],'plan_id':plan['plan_id']}))
