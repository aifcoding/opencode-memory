import { z } from 'zod';

export const CandidateDraftSchema = z
  .object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(50000),
    summary: z.string().max(500).optional(),
    type: z.enum(['preference', 'fact', 'decision', 'solution', 'convention']),
    tags: z.array(z.string().min(1).max(100)).max(20).optional(),
    suggestedDomain: z.enum(['code', 'user', 'business', 'uncertain']),
    /** 从材料中原样摘录的依据，用于本地核对。 */
    evidenceQuote: z.string().min(1).max(200),
  })
  .strict();

export const captureOutputSchema = (maxCandidates: number) =>
  z.object({ candidates: z.array(CandidateDraftSchema).max(maxCandidates) }).strict();
