import { z } from "zod";

// Reasoning is first-class data for the experiment.
// Keep it structured enough for analytics, but flexible enough that agents don't brick.
export const ReasoningSchema = z.object({
  intent: z.string().min(1).max(240),
  plan: z.string().min(1).max(400),
  confidence: z.number().min(0).max(1),
  why_now: z.string().min(1).max(240),

  claim: z.string().max(240).optional(),
  evidence: z.array(z.string().min(1).max(180)).max(10).optional(),
  alternatives: z.array(z.string().min(1).max(180)).max(10).optional(),
  risk: z.string().max(240).optional(),
});

export type Reasoning = z.infer<typeof ReasoningSchema>;

export function summarizeReasoning(r?: any) {
  const parsed = ReasoningSchema.safeParse(r);
  if (!parsed.success) return null;
  const rr = parsed.data;
  const conf = Math.round(rr.confidence * 100);
  return {
    intent: rr.intent,
    plan: rr.plan,
    why_now: rr.why_now,
    confidence_pct: conf,
  };
}
