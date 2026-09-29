import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { scoresSchema, type ScoreEvaluation, type JevEvaluation } from '@unvar/shared';
export class JevRepository {
  constructor(private db:Database.Database) {}
  list(questionId:string):JevEvaluation[] {
    const rows=this.db.prepare('SELECT id,question_id AS questionId,origin,evaluation_json AS data,created_at AS createdAt FROM jev_evaluations WHERE question_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(questionId) as {id:string;questionId:string;origin:'radar'|'pi';data:string;createdAt:string}[];
    return rows.map(({data,...row})=>({...JSON.parse(data),...row}));
  }
  append(questionId:string,origin:'radar'|'pi',evaluation:ScoreEvaluation):JevEvaluation {
    scoresSchema.parse(evaluation.scores);const id=ulid();const createdAt=new Date().toISOString();
    this.db.prepare('INSERT INTO jev_evaluations VALUES (?,?,?,?,?)').run(id,questionId,origin,JSON.stringify(evaluation),createdAt);
    return {...evaluation,id,questionId,origin,createdAt};
  }
}
