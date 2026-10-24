import {fileURLToPath} from 'node:url';
import {defineConfig} from '../../apps/web/node_modules/@playwright/test/index';
const root=fileURLToPath(new URL('../..',import.meta.url));
export default defineConfig({testDir:'.',testMatch:'app.spec.ts',workers:1,retries:0,timeout:30000,
 outputDir:'../../test-results/browser',reporter:[['list'],['html',{outputFolder:'../../playwright-report',open:'never'}]],
 use:{baseURL:'http://127.0.0.1:8000',viewport:{width:1440,height:900},trace:'retain-on-failure'},
 webServer:{command:root+'/.venv/bin/python -m lab.cli web',cwd:root,url:'http://127.0.0.1:8000/healthz',reuseExistingServer:false,timeout:30000,
 env:{PYTHONPATH:root+'/src',DEFAULT_WORKSPACE_ID:'10000000-0000-4000-8000-000000000001',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',BOOTSTRAP_ADMIN_EMAIL:'admin@example.test'}}});
