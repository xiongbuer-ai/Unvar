import { JevScoringService } from '../packages/workflows/src/jev';
import { scoreKeys } from '../packages/shared/src/radar';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer,type ServerResponse } from 'node:http';
import type { Store } from '../packages/db/src/index';
import { PiWorkflowAdapter,piEvidenceTools } from '../packages/workflows/src/pi';

export async function verifyPi(store:Store){
  const experiment=store.lab.list().find(item=>['done','archived'].includes(item.status))!;
  let article=store.writing.create({title:'Synthetic Pi interview',source:{kind:'experiment',id:experiment.id},operationId:randomUUID()});
  let scoreTools=false;
  let mode:'normal'|'invalid'|'loop'|'stall'|'injection'='normal';let calls=0;const sockets=new Set<ServerResponse>();
  const candidate={summary:'The recorded local transaction has limited evidence.',evidenceIds:[experiment.id],questions:[{field:'unknowns' as const,text:'Which failure mode remains untested?'}]};
  const server=createServer(async(req,res)=>{
    sockets.add(res);res.on('close',()=>sockets.delete(res));
    try{
      assert.equal(req.headers.authorization,'Bearer fake-pi-integration');
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks).toString());calls++;
      if(mode==='stall')return;
      const toolNames=input.tools.map((tool:{function:{name:string}})=>tool.function.name);assert.deepEqual(toolNames.sort(),(scoreTools?['get_experiment','get_finding','get_signal','search_library','score_question']:['get_experiment','get_finding','get_signal','search_library']).sort());
      const tools=mode==='loop'||mode==='injection'||!input.messages.some((message:{role:string})=>message.role==='tool');
      res.writeHead(200,{'content-type':'text/event-stream'});
      const chunk=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:'mock-pi',object:'chat.completion.chunk',created:0,model:'mock:pi-tool-model',choices:[{index:0,delta,finish_reason}]})+'\n\n');
      if(tools){chunk({role:'assistant',tool_calls:[{index:0,id:'read-'+calls,type:'function',function:{name:mode==='injection'?'confirm_fact_pack':'get_experiment',arguments:JSON.stringify({id:experiment.id})}},{index:1,id:'search-'+calls,type:'function',function:{name:'search_library',arguments:JSON.stringify({query:'transaction'})}},...(scoreTools?[{index:2,id:'score-'+calls,type:'function',function:{name:'score_question',arguments:JSON.stringify({id:store.radar.listQuestions()[0].id})}}]:[])]});chunk({},'tool_calls');}
      else {chunk({role:'assistant',content:JSON.stringify({...candidate,...(mode==='invalid'?{confirmed:true}:{})})});chunk({},'stop');}
      res.write('data: '+JSON.stringify({id:'mock-pi',choices:[],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})+'\n\ndata: [DONE]\n\n');res.end();
    }catch{res.writeHead(500);res.end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');
  const config=store.saveProvider({providerType:'openai-compatible',displayName:'Pi integration mock',baseUrl:`http://127.0.0.1:${address.port}/v1`,model:'mock:pi-tool-model',enabled:true});
  const workflow=new PiWorkflowAdapter(store,'Read evidence then return questions.');
  const input=()=>({articleId:article.id,providerId:config.id,operationId:randomUUID()});
  try{
    assert.throws(()=>workflow.start(input(),config,async()=>'fake-pi-integration'),/disabled/);store.pi.configure({enabled:true});
    const tools=piEvidenceTools(store,()=>{});assert.equal(tools.length,4);assert.equal(tools.some(tool=>/shell|write|confirm/.test(tool.name)),false);
    await assert.rejects(tools.find(tool=>tool.name==='get_experiment')!.execute('test',{id:experiment.id,shell:'no'}));
    const request=input();const run=workflow.start(request,config,async()=>'fake-pi-integration');assert.equal(workflow.start(request,config,async()=>'fake-pi-integration').id,run.id);
    await workflow.waitForIdle();const result=store.pi.get(run.id);assert.equal(result.status,'completed',result.error??'');assert.equal(result.traces.length,2);assert.equal(result.calls.length,2);assert.equal(result.calls[0].model,'mock:pi-tool-model');assert.equal(result.candidate!.questions.length,1);assert.equal(store.writing.get(article.id).interview.unknowns,'');assert.equal(store.writing.get(article.id).factPack,null);
    const answers={runId:run.id,articleRevision:article.revision,answers:[{index:0,text:'Power failure remains untested in this synthetic fixture.'}]};
    store.db.exec("CREATE TEMP TRIGGER pi_answer_rollback BEFORE INSERT ON pi_interview_answers BEGIN SELECT RAISE(ABORT,'injected'); END;");
    assert.throws(()=>store.pi.applyAnswers(answers));assert.equal(store.writing.get(article.id).factPack,null);assert.equal(store.writing.get(article.id).revision,article.revision);
    store.db.exec('DROP TRIGGER pi_answer_rollback');store.pi.applyAnswers(answers);store.pi.applyAnswers(answers);article=store.writing.get(article.id);
    assert.match(article.interview.unknowns,/Power failure/);assert.equal(article.confirmationValid,false);assert.equal(article.factPack!.version,1);assert.equal(store.pi.get(run.id).applied,true);
    assert.throws(()=>store.writing.start({articleId:article.id,providerId:config.id,stage:'outline',operationId:randomUUID()}),/Confirm/);
    const canceled=workflow.start(input(),config,async()=>'fake-pi-integration');const before=calls;workflow.cancel(canceled.id);await workflow.waitForIdle();assert.equal(store.pi.get(canceled.id).status,'canceled');assert.equal(calls,before);
    mode='invalid';const invalid=workflow.start(input(),config,async()=>'fake-pi-integration');await workflow.waitForIdle();assert.equal(store.pi.get(invalid.id).status,'failed');assert.equal(store.pi.get(invalid.id).candidate,null);
    mode='injection';const injected=workflow.start(input(),config,async()=>'fake-pi-integration');await workflow.waitForIdle();assert.equal(store.pi.get(injected.id).status,'failed');assert.equal(store.writing.get(article.id).confirmationValid,false);
    mode='loop';const bounded=new PiWorkflowAdapter(store,'test',{tools:1,turns:3,timeoutMs:3000});const limited=bounded.start(input(),config,async()=>'fake-pi-integration');await bounded.waitForIdle();assert.equal(store.pi.get(limited.id).status,'failed');assert.match(store.pi.get(limited.id).error!,/limit/);assert.ok(store.pi.get(limited.id).traces.some(trace=>trace.status==='blocked'));
    mode='stall';const timed=new PiWorkflowAdapter(store,'test',{tools:8,turns:4,timeoutMs:100});const timeout=timed.start(input(),config,async()=>'fake-pi-integration');await timed.waitForIdle();assert.match(store.pi.get(timeout.id).error!,/timed out/);
    mode='normal';const pending=store.pi.start(input());const old=store.writing.get(article.id);store.writing.saveInterview({id:old.id,revision:old.revision,title:old.title,answers:{...old.interview,opinions:'Concurrent human edit.'}});
    assert.throws(()=>store.pi.complete(pending.id,candidate,[{tool:'get_experiment',status:'completed',evidenceIds:[experiment.id],at:new Date().toISOString()}],[]),/changed/);store.pi.recover();assert.equal(store.pi.get(pending.id).status,'failed');
    store.pi.configure({enabled:false});assert.throws(()=>workflow.start(input(),config,async()=>'fake-pi-integration'),/disabled/);
    assert.ok(store.writing.get(article.id).interview.unknowns.includes('Power failure'));
    scoreTools=true;mode='normal';let jevCalls=0;
    for(const jevEnabled of [false,true])for(const piEnabled of [false,true]) {
      store.pi.configure({enabled:piEnabled});
      const scoring=new JevScoringService(store,()=>({enabled:jevEnabled,model:'typesafe/jev-1.13'}),async()=>'fake-jev',async()=>{jevCalls++;return Response.json({model:'typesafe/jev-mock',answers:Object.fromEntries(scoreKeys.map(key=>[key,{type:'choice',choice:'2',confidence:1,probabilities:{'0':0,'1':0,'2':1,'3':0}}])),usage:{input_tokens:1,output_tokens:1}});});
      const combined=new PiWorkflowAdapter(store,'Read evidence, score question, return interview.',undefined,scoring);const beforeJev=jevCalls;
      if(!piEnabled)assert.throws(()=>combined.start(input(),config,async()=>'fake-pi-integration'),/disabled/);
      else {
        const run=combined.start(input(),config,async()=>'fake-pi-integration');await combined.waitForIdle();const result=store.pi.get(run.id);assert.equal(result.status,'completed',result.error??'');assert.ok(result.traces.some(trace=>trace.tool==='score_question'&&trace.status==='completed'));
        const evaluation=store.jev.list(store.radar.listQuestions()[0].id)[0];assert.equal(evaluation.origin,'pi');assert.equal(evaluation.engine,jevEnabled?'jev':'rules');assert.equal(store.writing.get(article.id).confirmationValid,false);
      }
      assert.equal(jevCalls-beforeJev,piEnabled&&jevEnabled?1:0);combined.stop();scoring.stop();await Promise.all([combined.waitForIdle(),scoring.waitForIdle()]);
    }
    store.pi.configure({enabled:false});
    console.log('Pi integration passed: actual Agent Core with mocked HTTP SSE tool calls, read-only allowlist, human answers/Fact Pack gate, atomic rollback, disable, idempotency, repair rejection, budget, cancellation/timeout and stale recovery.');return run.id;
  }finally{workflow.stop();await workflow.waitForIdle();for(const response of sockets)response.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
