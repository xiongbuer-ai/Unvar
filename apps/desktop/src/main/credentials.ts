import { AsyncEntry } from '@napi-rs/keyring';

export interface CredentialStore {
  get(reference: string): Promise<string | null>;
  set(reference: string, secret: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

export class SystemCredentialStore implements CredentialStore {
  constructor(private service = 'org.unvar.desktop') {}
  async get(reference: string): Promise<string | null> {
    return (await new AsyncEntry(this.service, reference).getPassword()) ?? null;
  }
  async set(reference: string, secret: string): Promise<void> {
    await new AsyncEntry(this.service, reference).setPassword(secret);
  }
  async delete(reference: string): Promise<void> {
    await new AsyncEntry(this.service, reference).deletePassword();
  }
}
