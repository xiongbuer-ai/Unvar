import {describe,it,expect,vi} from 'vitest';
import {piCandidateSchema,piAnswersSchema,piStartSchema,piSettingsSchema} from '../packages/shared/src/pi';
import {validatedHandler} from '../apps/desktop/src/main/validated-ipc';
const id='01ARZ3NDEKTSV4RRFFQ69G5FAV';
describe('Pi application gates',()=>{
  it('keeps candidate questions separate from human answers and confirmation',()=>{
    const candidate={summary:'Bounded evidence.',evidenceIds:[id],questions:[{field:'unknowns',text:'What remains untested?'}]};
    expect(piCandidateSchema.safeParse(candidate).success).toBe(true);
    for(const patch of [{confirmed:true},{answers:['fabricated']},{questions:[]},{evidenceIds:[]},{questions:[{field:'prediction',text:'Assumed answer'}]}])expect(piCandidateSchema.safeParse({...candidate,...patch}).success).toBe(false);
    expect(piAnswersSchema.safeParse({runId:id,articleRevision:0,answers:[{index:0,text:'A'},{index:0,text:'B'}]}).success).toBe(false);
    expect(piSettingsSchema.safeParse({enabled:true,shell:true}).success).toBe(false);
  });
  it('rejects untrusted callers before starting a paid agent',async()=>{
    const sender={};const mainFrame={url:'file:///app/index.html'};const operation=vi.fn();
    const handler=validatedHandler(piStartSchema.array().length(1),()=>({sender,mainFrame,url:mainFrame.url}),operation);
    const input={articleId:id,providerId:id,operationId:'550e8400-e29b-41d4-a716-446655440000'};
    await expect(handler({sender:{},senderFrame:mainFrame},input)).rejects.toThrow('Untrusted');
    await expect(handler({sender,senderFrame:mainFrame},{...input,tools:['shell']})).rejects.toThrow('Invalid request');
    expect(operation).not.toHaveBeenCalled();await handler({sender,senderFrame:mainFrame},input);expect(operation).toHaveBeenCalledTimes(1);
  });
});
