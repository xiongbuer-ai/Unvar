import type { Store } from '@unvar/db';
import type { ProviderSettings, ProviderInput } from '@unvar/shared';
import type { CredentialStore } from './credentials';

/** Public projections deliberately omit credential references and secret values. */
export class WorkspaceService {
  constructor(readonly store: Store, readonly credentials: CredentialStore) {}
  async publicProvider(row: ReturnType<Store['getProvider']>): Promise<ProviderSettings> {
    const { id, providerType, displayName, baseUrl, model, enabled } = row;
    return { id, providerType: providerType as ProviderSettings['providerType'], displayName, baseUrl, model, enabled,
      configured: (await this.credentials.get(row.credentialKeyRef)) !== null };
  }
  async listProviders(): Promise<ProviderSettings[]> {
    return Promise.all(this.store.listProviderRecords().map((row) => this.publicProvider(row)));
  }
  async saveProvider(input: ProviderInput): Promise<ProviderSettings> {
    return this.publicProvider(this.store.saveProvider(input));
  }
  async setCredential(id: string, secret: string): Promise<void> {
    const provider = this.store.getProvider(id);
    await this.credentials.set(provider.credentialKeyRef, secret);
  }
  async deleteCredential(id: string): Promise<void> {
    const provider = this.store.getProvider(id);
    await this.credentials.delete(provider.credentialKeyRef);
  }
}
