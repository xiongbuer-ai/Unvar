import { JevRepository } from './jev';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { desc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { signalInputSchema, signalQuerySchema, providerInputSchema, researchSettingsSchema,
  type Signal, type SignalInput, type SignalQuery, type ProviderInput, type ResearchSettings } from '@unvar/shared';
import { signals, signalTags, providers, appSettings } from './schema';
import { migrate, type Migration } from './migrations';
import { RadarRepository } from './radar';
import { LabRepository } from './lab';
import { FindingRepository } from './finding';
import { PiRepository } from './pi';
import { DecisionRepository } from './decisions';
import { WritingRepository } from './writing';
export { LabRepository } from './lab';

export { migrate, migrations } from './migrations';

export async function openStore(filename: string, backupDirectory: string, steps?: Migration[]) {
  const db = new Database(filename);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    await migrate(db, backupDirectory, steps);
    return new Store(db);
  } catch (error) { db.close(); throw error; }
}

export class Store {
  private orm;
  readonly jev: JevRepository;
  readonly lab: LabRepository;
  readonly findings: FindingRepository;
  readonly pi: PiRepository;
  readonly decisions: DecisionRepository;
  readonly writing: WritingRepository;
  readonly radar: RadarRepository;
  constructor(readonly db: Database.Database) { this.jev=new JevRepository(db); this.orm = drizzle(db); this.radar = new RadarRepository(db); this.lab = new LabRepository(db); this.findings = new FindingRepository(db); this.writing = new WritingRepository(db); this.decisions = new DecisionRepository(db); this.pi = new PiRepository(db); }
  close() { this.db.close(); }

  listSignals(query: SignalQuery): Signal[] {
    const input = signalQuerySchema.parse(query);
    const tags = this.orm.select().from(signalTags).all();
    return this.orm.select().from(signals).orderBy(desc(signals.updatedAt), desc(signals.id)).all()
      .map((row): Signal => ({ id: row.id, kind: row.kind as Signal['kind'], title: row.title, text: row.rawText,
        url: row.url ?? '', source: row.source, status: row.status as Signal['status'], createdAt: row.createdAt, updatedAt: row.updatedAt,
        tags: tags.filter((tag) => tag.signalId === row.id).map((tag) => tag.tag) }))
      .filter((row) => (input.status === 'all' || row.status === input.status)
        && `${row.title}\n${row.text}\n${row.url}\n${row.tags.join(' ')}`.toLowerCase().includes(input.search.toLowerCase()));
  }

  getSignal(id: string): Signal {
    const row = this.listSignals({ status: 'all' }).find((signal) => signal.id === id);
    if (!row) throw new Error('Signal not found.');
    return row;
  }

  saveSignal(raw: SignalInput): Signal {
    const input = signalInputSchema.parse(raw);
    const id = input.id ?? ulid();
    const now = new Date().toISOString();
    if (input.id) this.getSignal(id);
    this.db.transaction(() => {
      const values = { kind: input.kind, title: input.title, rawText: input.text, url: input.url || null, updatedAt: now };
      if (input.id) this.orm.update(signals).set(values).where(eq(signals.id, id)).run();
      else this.orm.insert(signals).values({ ...values, id, source: 'manual', status: 'inbox', createdAt: now }).run();
      this.orm.delete(signalTags).where(eq(signalTags.signalId, id)).run();
      for (const tag of input.tags) this.orm.insert(signalTags).values({ signalId: id, tag }).run();
    })();
    return this.getSignal(id);
  }

  setSignalStatus(id: string, status: Signal['status']): void {
    this.getSignal(id);
    this.orm.update(signals).set({ status, updatedAt: new Date().toISOString() }).where(eq(signals.id, id)).run();
  }

  listProviderRecords() { return this.orm.select().from(providers).orderBy(providers.createdAt).all(); }
  getProvider(id: string) {
    const provider = this.orm.select().from(providers).where(eq(providers.id, id)).get();
    if (!provider) throw new Error('Provider not found.');
    return provider;
  }
  saveProvider(raw: ProviderInput) {
    const input = providerInputSchema.parse(raw);
    const id = input.id ?? ulid();
    const now = new Date().toISOString();
    if (input.id) this.getProvider(id);
    const values = { ...input, id, updatedAt: now };
    if (input.id) this.orm.update(providers).set(values).where(eq(providers.id, id)).run();
    else this.orm.insert(providers).values({ ...values, credentialKeyRef: `provider:${id}`, createdAt: now }).run();
    return this.getProvider(id);
  }
  getResearchSettings(): ResearchSettings {
    const row = this.orm.select().from(appSettings).where(eq(appSettings.key, 'research')).get();
    return row ? researchSettingsSchema.parse(JSON.parse(row.valueJson)) : { researchFocus: '' };
  }
  saveResearchSettings(raw: ResearchSettings): void {
    const settings = researchSettingsSchema.parse(raw);
    const values = { key: 'research', valueJson: JSON.stringify(settings), updatedAt: new Date().toISOString() };
    this.orm.insert(appSettings).values(values).onConflictDoUpdate({ target: appSettings.key, set: values }).run();
  }
}
