import type { UnvarAPI } from '@unvar/shared';

declare global {
  interface Window { unvar: UnvarAPI }
}
