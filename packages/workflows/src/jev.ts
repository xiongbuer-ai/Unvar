import type { Store } from '@unvar/db';
import { JevOpenRouterDecisionEngine, RuleDecisionEngine, type ScoreQuestionInput } from '@unvar/decision';
import type { JevSettings, ScoreEvaluation } from '@unvar/shared';
export class JevScoringService {
  private active=new Map<string,AbortController>();
  private evaluations=new Set<AbortController>();
  private pending=new Set<Promise<unknown>>();
  async waitForIdle(){await Promise.allSettled([...this.pending]);}
  constructor(private store:Store,private settings:()=>JevSettings,private getKey:()=>Promise<string|null>,private transport?:(input:string,init?:RequestInit)=>Promise<Response>) {}
  enabled(){return this.settings().enabled;}
  cancel(id:string){this.active.get(id)?.abort();}
  stop(){for(const controller of [...this.active.values(),...this.evaluations])controller.abort();}
  evaluate(input:ScoreQuestionInput,signal?:AbortSignal):Promise<ScoreEvaluation> {
    const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();this.evaluations.add(controller);
    const task=this.evaluateInternal(input,controller.signal).finally(()=>{signal?.removeEventListener('abort',abort);this.evaluations.delete(controller);});this.pending.add(task);void task.finally(()=>this.pending.delete(task)).catch(()=>{});return task;
  }
  private async evaluateInternal(input:ScoreQuestionInput,signal:AbortSignal):Promise<ScoreEvaluation> {
    signal?.throwIfAborted();const config=this.settings();const started=Date.now();let error:string;
    if(config.enabled) {
      try {
        const key=await this.getKey();signal?.throwIfAborted();if(!key)throw new Error('Jev key is not configured.');
        const engine=new JevOpenRouterDecisionEngine(key,config.model,this.transport);const scores=await engine.scoreQuestion(input,signal);signal?.throwIfAborted();
        return {engine:'jev',model:engine.lastResult!.model,ruleVersion:'question-five-choice-v1',input,scores,rawAnswers:engine.lastResult!.answers,usage:engine.lastResult!.usage,durationMs:Date.now()-started,error:null};
      } catch(caught) {
        signal?.throwIfAborted();
        const safe=['Jev key is not configured.','Jev authentication failed.','OpenRouter balance is insufficient.','Jev rate limit reached.','Jev request failed or returned invalid scores.'];
        error=caught instanceof Error&&safe.includes(caught.message)?caught.message:'Jev is unavailable.';
      }
    } else error='Jev is disabled.';
    signal?.throwIfAborted();
    return {engine:'rules',model:null,ruleVersion:'conservative-rules-v1',input,scores:await new RuleDecisionEngine().scoreQuestion(input),rawAnswers:null,usage:null,durationMs:Date.now()-started,error};
  }
  scoreExisting(id:string,origin:'radar'|'pi',signal?:AbortSignal) {
    const task=this.execute(id,origin,signal);this.pending.add(task);void task.finally(()=>this.pending.delete(task)).catch(()=>{});return task;
  }
  private async execute(id:string,origin:'radar'|'pi',signal?:AbortSignal) {
    if(this.active.has(id))throw new Error('Question scoring is already running.');
    const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();this.active.set(id,controller);
    try {
      const question=this.store.radar.getQuestion(id);const researchFocus=this.store.getResearchSettings().researchFocus;
      const evaluation=await this.evaluate({question:question.text,claim:question.claim,proposedExperiment:question.proposedExperiment,researchFocus},controller.signal);
      controller.signal.throwIfAborted();const current=this.store.radar.getQuestion(id);
      if(current.text!==question.text||current.claim!==question.claim||current.proposedExperiment!==question.proposedExperiment||this.store.getResearchSettings().researchFocus!==researchFocus)throw new Error('Question changed while scoring.');
      return this.store.radar.applyEvaluation(id,evaluation,origin);
    } finally {signal?.removeEventListener('abort',abort);this.active.delete(id);}
  }
}
