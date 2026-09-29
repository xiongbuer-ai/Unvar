import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const signals = sqliteTable('signals', {
  id: text('id').primaryKey(), kind: text('kind').notNull(), source: text('source').notNull(),
  title: text('title').notNull(), url: text('url'), normalizedUrl: text('normalized_url'),
  publishedAt: text('published_at'), contentHash: text('content_hash'), rawText: text('raw_text').notNull(),
  status: text('status').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const signalTags = sqliteTable('signal_tags', {
  signalId: text('signal_id').notNull().references(() => signals.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
});
export const providers = sqliteTable('provider_settings', {
  id: text('id').primaryKey(), providerType: text('provider_type').notNull(), displayName: text('display_name').notNull(),
  baseUrl: text('base_url').notNull(), model: text('model').notNull(), credentialKeyRef: text('credential_key_ref').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(), valueJson: text('value_json').notNull(), updatedAt: text('updated_at').notNull(),
});
