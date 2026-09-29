import { describe,it,expect,vi } from 'vitest';
import { decisionQuerySchema,decisionOutcomeSchema } from '../packages/shared/src/decisions';
import { validatedHandler } from '../apps/desktop/src/main/validated-ipc';
const id='01ARZ3NDEKTSV4RRFFQ69G5FAV';
describe('Decision history contracts',()=>{
  it('bounds queries and prevents mutation of historical proposals',()=>{
    for(const query of [{limit:101},{offset:-1},{search:'x'.repeat(241)},{entityType:'credentials'},{sql:'SELECT'}]) expect(decisionQuerySchema.safeParse(query).success).toBe(false);
    const input={id,revision:0,text:'Human observed outcome.',operationId:'550e8400-e29b-41d4-a716-446655440000'};
    expect(decisionOutcomeSchema.safeParse(input).success).toBe(true);
    for(const patch of [{text:''},{revision:-1},{aiRecommendation:'replace'},{humanDecision:'replace'}]) expect(decisionOutcomeSchema.safeParse({...input,...patch}).success).toBe(false);
  });
  it('rejects untrusted callers and unknown payloads',async()=>{
    const sender={};const mainFrame={url:'file:///app/index.html'};const action=vi.fn();
    const handler=validatedHandler(decisionQuerySchema.array().length(1),()=>({sender,mainFrame,url:mainFrame.url}),action);
    await expect(handler({sender:{},senderFrame:mainFrame},{})).rejects.toThrow('Untrusted');
    await expect(handler({sender,senderFrame:{url:mainFrame.url}},{})).rejects.toThrow('Untrusted');
    await expect(handler({sender,senderFrame:mainFrame},{sql:'DELETE'})).rejects.toThrow('Invalid request');
    expect(action).not.toHaveBeenCalled();await handler({sender,senderFrame:mainFrame},{});expect(action).toHaveBeenCalledTimes(1);
  });
});
