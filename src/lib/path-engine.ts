import {
  MODULES,
  SKILL_IDS,
  SKILLS,
  getTrack,
  type Level,
  type Module,
  type SkillId,
  type TrackId,
} from "./catalog";

export const PROGRAM_WEEKS = 8; // ~60 days; weeks 1..7 learning, week 8 capstone
export const LEARNING_WEEKS = PROGRAM_WEEKS - 1;
export const MIN_HOURS_PER_WEEK = 4;
export const MAX_HOURS_PER_WEEK = 40;

export interface PlanInput {
  track: TrackId;
  skills: Record<SkillId, Level>;
  hoursPerWeek: number;
}

export interface PlannedItem {
  moduleId: string;
  title: string;
  skill: SkillId;
  skillLabel: string;
  level: number;
  hours: number; // hours allocated to this week (a module can span weeks)
  deliverable: string;
  continues: boolean; // true if the module is not finished this week
}

export interface PlanWeek {
  week: number;
  theme: string;
  capacityHours: number;
  items: PlannedItem[];
  milestone: string;
}

export interface SkipSummary {
  skill: SkillId;
  skillLabel: string;
  currentLevel: Level;
  targetLevel: number;
  skippedHours: number;
}

export interface Plan {
  version: 1;
  track: TrackId;
  trackLabel: string;
  hoursPerWeek: number;
  /** Hours a beginner (all zeros) would need for this track's learning modules. */
  baselineHours: number;
  /** Hours this learner needs after skipping what they already know. */
  requiredHours: number;
  hoursSaved: number;
  /** Learning-hour capacity over weeks 1..7. */
  capacityHours: number;
  scheduledHours: number;
  /** Share of the learner's gap that fits inside the 60-day window (0-100). */
  coveragePct: number;
  weeks: PlanWeek[];
  deferred: { moduleId: string; title: string; skillLabel: string; hours: number }[];
  skips: SkipSummary[];
  strengths: string[];
  capstone: string;
}

function modulesFor(skill: SkillId, from: number, to: number): Module[] {
  return MODULES.filter((m) => m.skill === skill && m.level > from && m.level <= to).sort(
    (a, b) => a.level - b.level,
  );
}

export function clampHours(h: number): number {
  if (!Number.isFinite(h)) return MIN_HOURS_PER_WEEK;
  return Math.min(MAX_HOURS_PER_WEEK, Math.max(MIN_HOURS_PER_WEEK, Math.round(h)));
}

export function generatePlan(input: PlanInput): Plan {
  const track = getTrack(input.track);
  const hoursPerWeek = clampHours(input.hoursPerWeek);
  const label = (id: SkillId) => SKILLS.find((s) => s.id === id)!.label;

  const ordered = Object.entries(track.targets)
    .map(([skill, t]) => ({ skill: skill as SkillId, ...t! }))
    .sort((a, b) => a.priority - b.priority);

  const required: Module[] = [];
  const skips: SkipSummary[] = [];
  const strengths: string[] = [];
  let baselineHours = 0;

  for (const t of ordered) {
    const current = input.skills[t.skill] ?? 0;
    const baseline = modulesFor(t.skill, 0, t.level);
    const needed = modulesFor(t.skill, current, t.level);
    const baseHrs = baseline.reduce((s, m) => s + m.hours, 0);
    const needHrs = needed.reduce((s, m) => s + m.hours, 0);
    baselineHours += baseHrs;
    required.push(...needed);
    if (baseHrs - needHrs > 0) {
      skips.push({
        skill: t.skill,
        skillLabel: label(t.skill),
        currentLevel: current,
        targetLevel: t.level,
        skippedHours: baseHrs - needHrs,
      });
    }
    if (current >= t.level) strengths.push(label(t.skill));
  }

  const requiredHours = required.reduce((s, m) => s + m.hours, 0);

  // Greedy fill weeks 1..LEARNING_WEEKS in priority order; modules may span weeks.
  const weeks: PlanWeek[] = [];
  for (let w = 1; w <= LEARNING_WEEKS; w++) {
    weeks.push({ week: w, theme: "", capacityHours: hoursPerWeek, items: [], milestone: "" });
  }
  let weekIdx = 0;
  let free = hoursPerWeek;
  let scheduledHours = 0;
  const deferred: Plan["deferred"] = [];

  for (const mod of required) {
    let remaining = mod.hours;
    // Drop this module into the weeks only if at least some of it fits.
    while (remaining > 0 && weekIdx < LEARNING_WEEKS) {
      const take = Math.min(free, remaining);
      remaining -= take;
      free -= take;
      scheduledHours += take;
      weeks[weekIdx].items.push({
        moduleId: mod.id,
        title: mod.title,
        skill: mod.skill,
        skillLabel: label(mod.skill),
        level: mod.level,
        hours: take,
        deliverable: mod.deliverable,
        continues: remaining > 0,
      });
      if (free === 0) {
        weekIdx++;
        free = hoursPerWeek;
      }
    }
    if (remaining > 0) {
      deferred.push({
        moduleId: mod.id,
        title: mod.title,
        skillLabel: label(mod.skill),
        hours: remaining,
      });
    }
  }

  for (const w of weeks) {
    const done = w.items.filter((i) => !i.continues);
    const skillsInWeek = [...new Set(w.items.map((i) => i.skillLabel))];
    w.theme = skillsInWeek.length ? skillsInWeek.slice(0, 2).join(" + ") : "Stretch & review";
    w.milestone = done.length
      ? `Deliver: ${done.map((i) => i.deliverable).join("; ")}`
      : w.items.length
        ? "Checkpoint: finish carried-over module"
        : "Pair-review earlier work or take on a stretch task";
  }

  weeks.push({
    week: PROGRAM_WEEKS,
    theme: "Capstone",
    capacityHours: hoursPerWeek,
    items: [],
    milestone: track.capstone,
  });

  const capacityHours = hoursPerWeek * LEARNING_WEEKS;
  const coveragePct =
    requiredHours === 0 ? 100 : Math.round((scheduledHours / requiredHours) * 100);

  return {
    version: 1,
    track: input.track,
    trackLabel: track.label,
    hoursPerWeek,
    baselineHours,
    requiredHours,
    hoursSaved: baselineHours - requiredHours,
    capacityHours,
    scheduledHours,
    coveragePct,
    weeks,
    deferred,
    skips,
    strengths,
    capstone: track.capstone,
  };
}

/** Plain-text summary suitable for pasting into the "goals" field of an enrolment form. */
export function planToGoalsText(plan: Plan): string {
  const lines = [
    `Lab: ${plan.trackLabel}. ${plan.hoursPerWeek} h/week.`,
    `Plan: ${plan.scheduledHours} learning hours over ${LEARNING_WEEKS} weeks + capstone; skip ${plan.hoursSaved} h of known material.`,
  ];
  if (plan.strengths.length) lines.push(`Already strong in: ${plan.strengths.join(", ")}.`);
  if (plan.deferred.length)
    lines.push(`Would like extra support on: ${[...new Set(plan.deferred.map((d) => d.skillLabel))].join(", ")}.`);
  lines.push(`Capstone goal: ${plan.capstone}.`);
  return lines.join(" ");
}

export function emptySkills(): Record<SkillId, Level> {
  return Object.fromEntries(SKILL_IDS.map((id) => [id, 0])) as Record<SkillId, Level>;
}
