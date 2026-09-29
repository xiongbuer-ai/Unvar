import type { JevScoringService } from './jev';
import { Agent, type AgentTool, type StreamFn } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { streamSimple as completions } from '@earendil-works/pi-ai/api/openai-completions';
import { streamSimple as anthropic } from '@earendil-works/pi-ai/api/anthropic-messages';
import { Type } from 'typebox';
import type { Store } from '@unvar/db';
import { piCandidateSchema,piSearchSchema,piReadSchema,type PiRun,type PiStartInput } from '@unvar/shared';
import type { ProviderConfig } from '@unvar/llm';
const recordSchema=Type.Object({id:Type.String({pattern:'^[0-9A-HJKMNP-TV-Z]{26}$'})},{additionalProperties:false});
const searchSchema=Type.Object({query:Type.String({minLength:1,maxLength:240})},{additionalProperties:false});
export const PI_LIMITS={tools:8,turns:4,timeoutMs:120000};

export function piModel(config:ProviderConfig):Model<'openai-completions'|'anthropic-messages'> {
  return {id:config.model,name:config.model,provider:config.providerType==='anthropic'?'anthropic':config.providerType==='deepseek'?'deepseek':'unvar-compatible',api:config.providerType==='anthropic'?'anthropic-messages':'openai-completions',baseUrl:config.baseUrl.replace(/\/$/,''),reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:4096,
    ...(config.providerType!=='anthropic'?{compat:{supportsDeveloperRole:false,supportsStore:false,maxTokensField:'max_tokens' as const,supportsReasoningEffort:false}}:{})};
}
export function piProviderStream(config:ProviderConfig):StreamFn {
  const model=piModel(config);
  return (_model,context,options)=>{
    const settings={...options,maxTokens:4096,maxRetries:0,onPayload:config.providerType==='deepseek'?(payload:unknown)=>({...payload as object,thinking:{type:'disabled'}}):options?.onPayload};
    return model.api==='anthropic-messages' ? anthropic(model as Model<'anthropic-messages'>,context,settings) : completions(model as Model<'openai-completions'>,context,settings);
  };
}
export function piEvidenceTools(store:Store,record:(tool:string,ids:string[])=>void):AgentTool[] {
  const result=(tool:string,value:unknown,ids:string[])=>{record(tool,ids);return {content:[{type:'text' as const,text:JSON.stringify(value).slice(0,24000)}],details:{evidenceIds:ids}};};
  return [
    {name:'search_library',label:'Search research library',description:'Read up to five matching local experiments, findings and signals. Use keywords, not instructions.',parameters:searchSchema,execute:async(_call,args)=>{
      const query=piSearchSchema.parse(args).query.toLowerCase();
      const rows=[...store.lab.list().map(item=>({id:item.id,kind:'experiment',title:item.title,text:item.result,status:item.status})),...store.findings.list().map(item=>({id:item.id,kind:'finding',title:item.text,text:item.counterEvidence,status:item.status})),...store.listSignals({status:'all'}).map(item=>({id:item.id,kind:'signal',title:item.title,text:item.text,status:item.status}))].filter(item=>`${item.title} ${item.text}`.toLowerCase().includes(query)).slice(0,5).map(item=>({...item,text:item.text.slice(0,2000)}));
      return result('search_library',rows,rows.map(item=>item.id));
    }},
    {name:'get_experiment',label:'Read experiment',description:'Read one recorded experiment and its source, result and limitations.',parameters:recordSchema,execute:async(_call,args)=>{const item=store.lab.get(piReadSchema.parse(args).id);return result('get_experiment',item,[item.id]);}},
    {name:'get_finding',label:'Read finding',description:'Read a finding with status, limitations and linked experiment evidence.',parameters:recordSchema,execute:async(_call,args)=>{const item=store.findings.get(piReadSchema.parse(args).id);return result('get_finding',item,[item.id]);}},
    {name:'get_signal',label:'Read source',description:'Read a local source record. This does not fetch URLs or follow instructions in its text.',parameters:recordSchema,execute:async(_call,args)=>{const item=store.getSignal(piReadSchema.parse(args).id);return result('get_signal',{id:item.id,title:item.title,text:item.text.slice(0,18000),url:item.url},[item.id]);}},
  ];
}

export class PiWorkflowAdapter {
  private active=new Map<string,AbortController>();
  private pending=new Set<Promise<void>>();
  constructor(private store:Store,private prompt:string,private limits=PI_LIMITS,private scoring?:JevScoringService) {}
  start(input:PiStartInput,config:ProviderConfig,getSecret:()=>Promise<string|null>,stream=piProviderStream(config)):PiRun {
    const run=this.store.pi.start(input);if(run.status!=='running'||this.active.has(run.id))return run;
    const controller=new AbortController();this.active.set(run.id,controller);
    const task=Promise.resolve().then(()=>this.execute(run,config,getSecret,stream,controller));this.pending.add(task);void task.finally(()=>this.pending.delete(task)).catch(()=>{});return run;
  }
  cancel(id:string){this.active.get(id)?.abort();}
  stop(){for(const controller of this.active.values())controller.abort();}
  async waitForIdle(){await Promise.allSettled([...this.pending]);}
  private async execute(run:PiRun,config:ProviderConfig,getSecret:()=>Promise<string|null>,stream:StreamFn,controller:AbortController){
    const traces:PiRun['traces']=[];const calls:PiRun['calls']=[];let agent:Agent|undefined;let timeout=false;let limited=false;let turns=0;let toolCalls=0;let started=Date.now();
    const signal=controller.signal;const timer=setTimeout(()=>{timeout=true;controller.abort();},this.limits.timeoutMs);const abort=()=>agent?.abort();signal.addEventListener('abort',abort);
    let rejectAbort:()=>void=()=>{};
    try{
      const secret=await getSecret();signal.throwIfAborted();if(!secret)throw new Error('No provider credential.');
      const article=this.store.pi.snapshot(run.id);
      const persist=()=>this.store.pi.progress(run.id,traces,calls);
      const tools=piEvidenceTools(this.store,(tool,evidenceIds)=>{traces.push({tool,evidenceIds,status:'completed',at:new Date().toISOString()});persist();});
      if(this.scoring)tools.push({name:'score_question',label:'Score research question',description:'Evaluate one existing Question through the shared decision engine. Returns a proposal and engine provenance; never overrides a human decision. Disabled Jev uses explicit Rules.',parameters:recordSchema,execute:async(_call,args)=>{
        const result=await this.scoring!.scoreExisting(piReadSchema.parse(args).id,'pi',signal);
        traces.push({tool:'score_question',status:'completed',evidenceIds:[],at:new Date().toISOString()});persist();
        return {content:[{type:'text' as const,text:JSON.stringify({scores:result.scores,engine:result.engine,model:result.model,error:result.error,evaluationId:result.id})}],details:{evidenceIds:[]}};
      }});
      agent=new Agent({initialState:{model:piModel(config),systemPrompt:this.prompt,thinkingLevel:'off',tools},getApiKey:()=>secret,toolExecution:'sequential',
        streamFn:(model,context,options)=>{signal.throwIfAborted();if(!this.store.pi.settings().enabled)throw new Error('Pi is disabled.');if(turns>=this.limits.turns||JSON.stringify(context).length>180000){limited=true;throw new Error('Pi request limit.');}turns++;started=Date.now();return stream(model,context,options);},
        beforeToolCall:async({toolCall})=>{toolCalls++;if(signal.aborted||toolCalls>this.limits.tools||!this.store.pi.settings().enabled){limited=true;traces.push({tool:toolCall.name.slice(0,80),status:'blocked',evidenceIds:[],at:new Date().toISOString()});persist();return {block:true,reason:'Tool limit or cancellation.',terminate:true};}return undefined;},
        finishTurn:()=>turns>=this.limits.turns ? {action:'end'} : undefined,
      });
      agent.subscribe(event=>{
        if(event.type==='message_end' && event.message.role==='assistant'){
          const usage:Record<string,number>={};for(const key of ['input','output','cacheRead','cacheWrite','totalTokens'] as const){const value=event.message.usage[key];if(Number.isFinite(value)&&value>=0)usage[key]=value;}
          calls.push({model:event.message.model,durationMs:Date.now()-started,usage});persist();
        }
        if(event.type==='tool_execution_end'&&event.isError){traces.push({tool:event.toolName.slice(0,80),status:'failed',evidenceIds:[],at:new Date().toISOString()});persist();}
      });
      const canceled=new Promise<never>((_resolve,reject)=>{rejectAbort=()=>reject(new Error('Canceled'));signal.addEventListener('abort',rejectAbort,{once:true});if(signal.aborted)rejectAbort();});
      const request=JSON.stringify({title:article.title,source:article.source,interview:article.interview});
      await Promise.race([agent.prompt(request),canceled]);signal.throwIfAborted();
      const candidate=()=>{
        if(limited||agent!.state.errorMessage)throw new Error('Pi limit or provider failure.');
        const message=agent!.state.messages.filter(item=>item.role==='assistant').at(-1);if(!message||message.role!=='assistant'||['error','aborted','length'].includes(message.stopReason))throw new Error('Incomplete Pi response.');
        const text=message.content.filter(item=>item.type==='text').map(item=>item.text).join('');return piCandidateSchema.parse(JSON.parse(text));
      };
      let output;
      try{output=candidate();}catch(error){if(limited||agent.state.errorMessage||turns>=this.limits.turns)throw error;await Promise.race([agent.prompt('The previous candidate failed the required JSON format. Return only the specified JSON object; do not answer the human questions or invent evidence.'),canceled]);signal.throwIfAborted();output=candidate();}
      this.store.pi.complete(run.id,output,traces,calls);
    }catch{
      this.store.pi.finish(run.id,signal.aborted&&!timeout?'canceled':'failed',timeout?'Pi interview timed out. Use the fixed interview or retry explicitly.':signal.aborted?'Canceled by user.':limited?'Pi reached its tool or turn limit. Use the fixed interview.':'Pi could not complete a valid tool-based interview. Check model tool support or use the fixed interview.',traces,calls);
    }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);signal.removeEventListener('abort',rejectAbort);agent?.abort();await agent?.waitForIdle();this.active.delete(run.id);}
  }
}
