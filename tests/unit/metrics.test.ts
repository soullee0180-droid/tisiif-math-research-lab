import{it,expect}from'vitest';import fixture from'../fixtures/metric_cases.json';import{runMetrics,summarize}from'../../packages/metrics';
function base(){return{...structuredClone(fixture),k:5}}
it('M01 exact expected metrics',()=>{expect(runMetrics(base())).toMatchObject(fixture.expected)});for(const variant of fixture.variants)it(variant.case_id+' missingness',()=>{const r=base();if('selected'in variant)r.selected=variant.selected as any;for(const[path,value]of Object.entries(('patch'in variant?variant.patch:{})||{})){const[id,key]=path.split('.');(r.ideas.find(i=>i.id===id)! as any)[key]=value}expect(runMetrics(r)).toMatchObject(variant.expected)});
it('equal paper weights after repeat/checkpoint averaging and per-metric common sets',()=>{const runs:any[]=[];for(const generator of['google','openai','anthropic'])for(const[paper,checkpoint,u]of[['A','a',4],['A','b',4],['B','c',0]])runs.push({k:1,selected:'I1',ideas:[{id:'I1',u:[u,u],match:['none','none']}],generator,paper_id:paper,checkpoint_id:checkpoint,revision_id:checkpoint,repeat_index:1,cohort:'main',transport:'api',input_mode:'text',condition_hash:'same'});const s=summarize(runs)[0];expect(s.metrics.selected_usefulness.google.value).toBe(2);runs.find(r=>r.generator==='openai'&&r.paper_id==='B').ideas[0].u=[null,0];const changed=summarize(runs)[0];expect(changed.metrics.selected_usefulness.google.value).toBe(4);expect(changed.metrics.any_core_match.google.common_pairs).toBe(3);expect(changed.metrics.selected_usefulness.google.common_pairs).toBe(2)});
it('human corrections and transport conditions stay separate',()=>{const r={...base(),generator:'google',cohort:'main',transport:'manual_web',condition_hash:'x',input_mode:'text',paper_id:'a',checkpoint_id:'a',revision_id:'a',repeat_index:1};expect(summarize([{...r,human_corrected:true}])).toEqual([]);expect(summarize([r,{...r,transport:'api'}])).toHaveLength(2)});

it('two-provider metrics need the one expected peer, incomplete scores remain null, and one provider has no peer metrics',()=>{
 const run={k:2,selected:'I1',selected_providers:['google','openai'],ideas:[{id:'I1',u:[2],match:['core']},{id:'I2',u:[4],match:['none']}]};
 expect(runMetrics(run)).toMatchObject({selected_usefulness:2,best_usefulness:4,selection_regret:2,any_core_match:1,selected_core_match:1});
 expect(runMetrics({...run,ideas:[{id:'I1',u:[],match:[]},{id:'I2',u:[4],match:['none']}]}).selected_usefulness).toBeNull();
 expect(runMetrics({...run,selected_providers:['google'],ideas:[{id:'I1',u:[],match:[]}]})).toMatchObject({selected_usefulness:null,best_usefulness:null,any_core_match:null});
});
it('two selected generators form a common set without Claude and identity conditions never pool',()=>{
 const common={k:1,selected:'I1',ideas:[{id:'I1',u:[3],match:['core']}],selected_providers:['google','openai'],paper_id:'p',checkpoint_id:'c',revision_id:'v',repeat_index:1,cohort:'pilot',transport:'api',condition_hash:'same'};
 const runs=['google','openai'].map(generator=>({...common,generator}));
 const group=summarize(runs)[0];expect(group.providers).toEqual(['google','openai']);expect(Object.keys(group.metrics.selected_usefulness)).toEqual(['google','openai']);expect(group.metrics.selected_usefulness.google).toMatchObject({value:3,common_pairs:1});
 expect(summarize([runs[0]])[0].metrics.selected_usefulness.google.value).toBeNull();
 expect(summarize([...runs,...runs.map(r=>({...r,reveal_generator_identity:true}))])).toHaveLength(2);
});
