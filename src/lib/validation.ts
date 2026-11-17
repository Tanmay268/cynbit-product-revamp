import { z } from "zod";
import { SKILL_IDS, TRACK_IDS } from "./catalog";
import { MAX_HOURS_PER_WEEK, MIN_HOURS_PER_WEEK } from "./path-engine";

const level = z.number().int().min(0).max(3);

/** Strict: unknown keys are rejected so the stored input stays well-formed. */
export const planInputSchema = z
  .object({
    track: z.enum(TRACK_IDS),
    hoursPerWeek: z.number().int().min(MIN_HOURS_PER_WEEK).max(MAX_HOURS_PER_WEEK),
    skills: z
      .object(Object.fromEntries(SKILL_IDS.map((id) => [id, level])) as Record<(typeof SKILL_IDS)[number], typeof level>)
      .strict(),
  })
  .strict();

export const eventSchema = z
  .object({
    name: z.enum(["wizard_started", "plan_viewed", "plan_shared", "enroll_clicked", "goals_copied"]),
    planId: z.string().regex(/^[A-Za-z0-9_-]{8,32}$/).optional(),
    track: z.enum(TRACK_IDS).optional(),
  })
  .strict();

export type PlanInputParsed = z.infer<typeof planInputSchema>;
