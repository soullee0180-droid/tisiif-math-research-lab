import {afterEach,describe,expect,it,vi} from 'vitest';
import {api,ApiError,time} from './client';
afterEach(()=>vi.unstubAllGlobals());
describe('API mutations',()=>{
 it('keeps the request key after network failure and releases it only after success',async()=>{
  const headers:Record<string,string>[]=[];let calls=0;
  vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{headers.push(options.headers);if(++calls===1)throw new TypeError('network');return new Response(JSON.stringify({data:{id:'saved'}}),{status:200})}));
  await expect(api('/plans',{title:'synthetic'})).rejects.toThrow('network');
  expect(await api('/plans',{title:'synthetic'})).toEqual({id:'saved'});
  await api('/plans',{title:'synthetic'});
  expect(headers[0]['Idempotency-Key']).toBe(headers[1]['Idempotency-Key']);
  expect(headers[2]['Idempotency-Key']).not.toBe(headers[1]['Idempotency-Key']);
 });
 it('preserves conflict codes without treating errors as data',async()=>{
  vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({error:{code:'EDIT_CONFLICT',message:'최신 내용 확인',details:{current_hash:'sha'}}}),{status:409}));
  await expect(api('/checkpoint-revisions/id',{},'PATCH')).rejects.toMatchObject({code:'EDIT_CONFLICT',status:409,details:{current_hash:'sha'}});
 });
 it('renders timestamps in Seoul time',()=>expect(time('2026-10-24T00:00:00Z')).toContain('09:00'));
});
