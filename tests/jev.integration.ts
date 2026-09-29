import assert from 'node:assert/strict';
import type { Store } from '../packages/db/src/index';
import { JevScoringService } from '../packages/workflows/src/jev';
import { RadarWorkflow } from '../packages/workflows/src/index';
import { scoreKeys } from '../packages/shared/src/radar';
export async function verifyJev(store:Store) {
  let enabled=true;let mode:'ok'|'invalid'|'stall'|number='ok';let calls=0;
  const transport=async(_url:string,init?:RequestInit)=>{
    calls++;
    if(mode==='stall')return new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('canceled')),{once:true});});
    if(typeof mode==='number')return Response.json({error:'private upstream error'},{status:mode});
    return Response.json({model:'typesafe/jev-mock',answers:mode==='invalid'?{}:Object.fromEntries(scoreKeys.map(key=>[key,{type:'choice',choice:'3',confidence:1,probabilities:{'0':0,'1':0,'2':0,'3':1}}])),usage:{input_tokens:20,output_tokens:10,cost:0.001}});
  };
  const scoring=new JevScoringService(store,()=>({enabled,model:'typesafe/jev-1.13'}),async()=>'fake-jev-integration',transport);
  const question=store.radar.listQuestions()[0];store.saveResearchSettings({researchFocus:'Reliable transactions'});
  try {
    const result=await scoring.scoreExisting(question.id,'radar');assert.equal(result.engine,'jev');assert.equal(result.model,'typesafe/jev-mock');assert.ok(result.rawAnswers);assert.equal(store.jev.list(question.id)[0].id,result.id);
    const scores={...question.scores,workRelevance:0};store.radar.overrideScore(question.id,scores,'Human scope decision');
    await scoring.scoreExisting(question.id,'radar');assert.deepEqual(store.radar.getQuestion(question.id).scores,scores);assert.equal(store.radar.getQuestion(question.id).overrideReason,'Human scope decision');
    const before=store.radar.getQuestion(question.id);await scoring.scoreExisting(question.id,'pi');assert.deepEqual(store.radar.getQuestion(question.id),before);
    const count=store.jev.list(question.id).length;store.db.exec("CREATE TEMP TRIGGER fail_jev_decision BEFORE INSERT ON decisions BEGIN SELECT RAISE(ABORT,'injected'); END;");
    await assert.rejects(scoring.scoreExisting(question.id,'radar'));assert.equal(store.jev.list(question.id).length,count);assert.deepEqual(store.radar.getQuestion(question.id),before);store.db.exec('DROP TRIGGER fail_jev_decision');
    for(mode of [401,402,429,500,'invalid'] as const){const fallback=await scoring.scoreExisting(question.id,'radar');assert.equal(fallback.engine,'rules');assert.equal(fallback.model,null);assert.ok(fallback.error);assert.equal(JSON.stringify(fallback).includes('private upstream'),false);}
    mode='stall';const pending=scoring.scoreExisting(question.id,'radar');await new Promise(resolve=>setTimeout(resolve,20));const preCancel=store.jev.list(question.id).length;await assert.rejects(scoring.scoreExisting(question.id,'radar'),/already running/);scoring.cancel(question.id);await assert.rejects(pending);assert.equal(store.jev.list(question.id).length,preCancel,'Cancellation writes no fallback');
    mode='ok';enabled=false;const beforeCalls=calls;assert.equal((await scoring.scoreExisting(question.id,'pi')).engine,'rules');assert.equal(calls,beforeCalls);
    // Normal Radar keeps LLM scoring when Jev is off, switches only the scoring phase when on.
    for(enabled of [false,true]) {
      let generated=0;const source=store.saveSignal({kind:'note',title:'Jev routing fixture',text:'Transactions preserve writes.',url:'',tags:[]});
      const analysis={claims:[{text:source.text,type:'claim',evidenceText:source.text}],questions:[{claimIndex:0,text:'Are writes atomic?',whyRelevant:'Reliability',proposedExperiment:'Inject failure',estimatedMinutes:10}]};
      const workflow=new RadarWorkflow(store,{analysis:'',score:''},undefined,scoring);
      workflow.start(source.id,{id:'mock',name:'mock',generateText:async()=>({text:'',model:'mock'}),generateStructured:async({schema})=>{generated++;return schema.parse(generated===1?analysis:{workRelevance:2,experimentability:2,evidencePotential:2,uniqueness:2,seriesPotential:2});}});await workflow.waitForIdle();
      const saved=store.radar.listQuestions().find(item=>item.signalId===source.id)!;assert.ok(saved);assert.equal(generated,enabled?1:2);assert.equal(store.jev.list(saved.id).length,enabled?1:0);assert.equal(saved.engine,enabled?'jev':'llm:mock');
    }
    console.log('Jev integration passed: actual SDK/mock transport, Radar routing, Pi proposals, atomic provenance, human overrides, auth/quota/rate/invalid fallback, cancellation, duplicate guard.');
    return question.id;
  } finally {scoring.stop();await scoring.waitForIdle();}
}
