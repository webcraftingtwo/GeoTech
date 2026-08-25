/**
 * How this build is deployed. See the field application's equivalent — the
 * two must agree, because they are two halves of one workflow.
 */
export type Deployment = 'networked' | 'standalone';

export const DEPLOYMENT: Deployment =
  (import.meta.env.VITE_DEPLOYMENT as Deployment | undefined) === 'standalone' ? 'standalone' : 'networked';

export const IS_STANDALONE = DEPLOYMENT === 'standalone';
