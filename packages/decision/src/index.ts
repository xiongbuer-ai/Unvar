import { scoresSchema, type QuestionScores, type QuestionStatus } from '@unvar/shared';
import type { LLMProvider } from '@unvar/llm';

export interface ScoreQuestionInput { question: string; proposedExperiment: string; claim: string; researchFocus: string }
export interface DecisionEngine { scoreQuestion(input: ScoreQuestionInput, signal?: AbortSignal): Promise<QuestionScores> }
export function routeQuestion(scores: QuestionScores): QuestionStatus {
  return scores.workRelevance < 2 || scores.experimentability < 2 || scores.evidencePotential < 2 ? 'backlog' : 'candidate';
}
/** Conservative fallback: the rules do not pretend to infer semantic relevance. */
export class RuleDecisionEngine implements DecisionEngine {
  async scoreQuestion(input: ScoreQuestionInput): Promise<QuestionScores> {
    return { workRelevance: 0, experimentability: input.proposedExperiment.trim() ? 1 : 0, evidencePotential: 0, uniqueness: 0, seriesPotential: 0 };
  }
}
export class LLMDecisionEngine implements DecisionEngine {
  constructor(private provider: LLMProvider, private prompt: string) {}
  async scoreQuestion(input: ScoreQuestionInput, signal?: AbortSignal): Promise<QuestionScores> {
    const scores = await this.provider.generateStructured({ system: this.prompt, prompt: JSON.stringify(input), schema: scoresSchema, signal });
    return { ...scores, workRelevance: input.researchFocus.trim() ? scores.workRelevance : 0 };
  }
}
export { JevOpenRouterDecisionEngine } from './jev';
