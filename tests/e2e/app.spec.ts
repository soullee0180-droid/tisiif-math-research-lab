import {test,expect} from '../../apps/web/node_modules/@playwright/test/index';
import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync('../../test-results/browser-fixture.json','utf8'));
test.beforeEach(async({page})=>{
 await page.addInitScript(({token})=>localStorage.setItem('sb-fixture-auth-token',JSON.stringify({access_token:token,token_type:'bearer',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+7200,expires_in:7200,user:{id:'20000000-0000-4000-8000-000000000001',email:'admin@example.test',aud:'authenticated'}})),{token:fixture.access_token});
});
test('researcher can inspect paper, frozen experiment, results, and real service health',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/papers');await expect(page.getByRole('heading',{name:'논문',exact:true})).toBeVisible();
 await expect(page.getByText('Synthetic',{exact:true})).toBeVisible();
 await page.screenshot({path:'../../test-results/papers-desktop.png',fullPage:true});
 await page.goto('/experiments/'+fixture.plan_id);
 await expect(page.getByRole('heading',{name:'Fixture research flow'})).toBeVisible();
 await page.getByRole('button',{name:'고정 입력·설정',exact:true}).click();
 await expect(page.getByText('프로토콜 고정',{exact:false})).toBeVisible();
 await page.goto('/results?plan='+fixture.plan_id);
 await expect(page.getByRole('heading',{name:'결과',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'유용성',exact:true})).toBeVisible();
 await page.screenshot({path:'../../test-results/results-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'아이디어',exact:true}).click();
 await page.getByRole('button',{name:/P001 · CP01/}).first().click();
 await expect(page.getByText('선택됨',{exact:true})).toBeVisible();
 await page.goto('/settings');await expect(page.getByRole('heading',{name:'설정',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
test('mobile navigation remains operable without exposing editing controls',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/papers');
 await expect(page.getByRole('heading',{name:'논문',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'메뉴',exact:true}).click();
 await page.getByRole('link',{name:'진행 상황',exact:true}).click();
 await expect(page.getByRole('heading',{name:'진행 상황',exact:true})).toBeVisible();
 await page.screenshot({path:'../../test-results/queue-mobile.png',fullPage:true});
});
