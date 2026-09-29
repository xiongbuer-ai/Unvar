import { describe,it,expect,vi } from 'vitest';
import { JevOpenRouterDecisionEngine } from '../packages/decision/src/jev';
import { jevSettingsSchema, jevSecretSchema } from '../packages/shared/src/jev';
import { scoreKeys } from '../packages/shared/src/radar';
import { validatedHandler } from '../apps/desktop/src/main/validated-ipc';
const input={question:'Test?',claim:'Claim',proposedExperiment:'Measure',researchFocus:'Research'};
function response() {return {model:'typesafe/jev-1.13',answers:Object.fromEntries(scoreKeys.map(key=>[key,{type:'choice',choice:'2',confidence:0.8,probabilities:{'0':0,'1':0.1,'2':0.8,'3':0.1}}])),usage:{input_tokens:10,output_tokens:5}};}
describe('Jev System One',()=>{
  it('uses the official endpoint, five choice rubrics and selected labels rather than probabilities',async()=>{
    const fetch=vi.fn(async(url:string,init?:RequestInit)=>{expect(url).toBe('https://openrouter.ai/api/v1/systemone');const body=JSON.parse(String(init?.body));expect(Object.keys(body.questions)).toEqual([...scoreKeys]);expect(body.model).toBe('typesafe/jev-1.13');return Response.json(response());});
    const engine=new JevOpenRouterDecisionEngine('test-only','typesafe/jev-1.13',fetch);
    expect(await engine.scoreQuestion(input)).toEqual(Object.fromEntries(scoreKeys.map(key=>[key,2])));
    expect(engine.lastResult?.model).toBe('typesafe/jev-1.13');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('requires complete legal scores and sanitizes provider errors without retry or fake success',async()=>{
    for(const malformed of [{...response(),answers:{}},{...response(),answers:{...response().answers,workRelevance:{type:'choice',choice:'4'}}}]) {
      const engine=new JevOpenRouterDecisionEngine('test-only','typesafe/jev-1.13',async()=>Response.json(malformed));
      await expect(engine.scoreQuestion(input)).rejects.toThrow('invalid scores');expect(engine.lastResult).toBeNull();
    }
    const fetch=vi.fn(async()=>Response.json({error:'sensitive-provider-details'},{status:401}));
    await expect(new JevOpenRouterDecisionEngine('test-only','typesafe/jev-1.13',fetch).scoreQuestion(input)).rejects.toThrow('Jev authentication failed.');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds stalled requests and preserves explicit cancellation',async()=>{
    vi.useFakeTimers();
    try {
      const fetch=vi.fn((_url:string,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}));
      const engine=new JevOpenRouterDecisionEngine('test-only','typesafe/jev-1.13',fetch);
      const timeout=expect(engine.scoreQuestion(input)).rejects.toThrow('Jev request failed');
      await vi.advanceTimersByTimeAsync(31000);await timeout;expect(fetch).toHaveBeenCalledTimes(1);expect(engine.lastResult).toBeNull();
      const controller=new AbortController();const canceled=expect(engine.scoreQuestion(input,controller.signal)).rejects.toThrow('canceled');controller.abort();await canceled;expect(engine.lastResult).toBeNull();
    } finally {vi.useRealTimers();}
  });
  it('validates configuration and caller identity before credentials can be saved',async()=>{
    expect(jevSettingsSchema.safeParse({enabled:true,model:'typesafe/jev-1.13',apiKey:'secret'}).success).toBe(false);
    expect(jevSettingsSchema.safeParse({enabled:true,model:'other/model'}).success).toBe(false);
    const sender={};const mainFrame={url:'file:///app/index.html'};const operation=vi.fn();
    const handler=validatedHandler(jevSecretSchema.array().length(1),()=>({sender,mainFrame,url:mainFrame.url}),operation);
    await expect(handler({sender:{},senderFrame:mainFrame},'test-only')).rejects.toThrow('Untrusted');
    await expect(handler({sender,senderFrame:mainFrame},'')).rejects.toThrow('Invalid request');expect(operation).not.toHaveBeenCalled();
  });
});
