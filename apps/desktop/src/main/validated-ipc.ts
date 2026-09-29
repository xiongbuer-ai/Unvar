import type { ZodType } from 'zod';
import { assertTrustedRenderer, type Invocation, type TrustedRenderer } from './app-info';

/** Only application-authored, non-sensitive messages may cross IPC. */
export class SafeOperationError extends Error {}

export function validatedHandler<T>(schema: ZodType<T>, trusted: () => TrustedRenderer | null, operation: (input: T) => unknown) {
  return async (event: Invocation, ...args: unknown[]) => {
    assertTrustedRenderer(event, trusted());
    const result = schema.safeParse(args);
    if (!result.success) throw new Error('Invalid request. Check the form fields.');
    try { return await operation(result.data); }
    catch (error) {
      if (error instanceof SafeOperationError) throw error;
      // eslint-disable-next-line preserve-caught-error -- Raw errors may contain secrets and must not cross IPC.
      throw new Error('Operation could not be completed. Check system access and try again.');
    }
  };
}
