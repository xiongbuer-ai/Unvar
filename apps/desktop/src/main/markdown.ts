import type { Signal } from '@unvar/shared';

export function signalMarkdown(signal: Signal): string {
  const title = signal.title.replace(/[\r\n]/g, ' ') || 'Untitled signal';
  return `# ${title}\n\nID: ${signal.id}\nKind: ${signal.kind}\nStatus: ${signal.status}\nCreated: ${signal.createdAt}\nTags: ${signal.tags.join(', ')}\n${signal.url ? `Source: ${signal.url}\n` : ''}\n${signal.text}\n`;
}

export function experimentMarkdown(item: import('@unvar/shared').Experiment, logs: import('@unvar/shared').ExperimentLog[]): string {
  return `# ${item.title.replace(/[\r\n]/g, ' ')}\n\nExperiment: ${item.id}\nStatus: ${item.status}\nSource: ${item.sourceUrl || item.sourceTitle}\nSignal: ${item.signalId}\nQuestion: ${item.questionId}\n\n## Original claim\n\n${item.claim}\n\n## Question\n\n${item.question}\n\n## Human Prediction\n\n${item.prediction}\n\n## Baseline\n\n${item.baseline}\n\n## Method\n\n${item.method}\n\n## Metrics\n\n${item.metrics}\n\n## Result\n\n${item.result}\n\n## Limitations\n\n${item.limitations}\n\n## Measurements\n\nTrust: ${item.trust ?? 'Not recorded'} / 5\nHuman time: ${item.humanTimeMinutes} min\nTimed duration: ${item.elapsedSeconds} sec\nInterventions: ${item.interventionCount}\nBugs: ${item.bugCount}\nRework: ${item.reworkCount}\n\n## Logs\n\n${logs.map(log => `- ${log.createdAt} · ${log.eventType} · ${log.elapsedSeconds}s\n\n${log.text}\n`).join('\n')}\n`;
}
