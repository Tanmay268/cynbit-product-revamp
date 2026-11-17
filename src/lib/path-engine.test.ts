import { describe, expect, it } from "vitest";
import { generatePlan, emptySkills, clampHours, LEARNING_WEEKS, PROGRAM_WEEKS, planToGoalsText } from "./path-engine";
import { planInputSchema } from "./validation";
import { MODULES, TRACKS } from "./catalog";

describe("generatePlan", () => {
  it("beginner needs the full baseline and gets no savings", () => {
    const p = generatePlan({ track: "fullstack", skills: emptySkills(), hoursPerWeek: 20 });
    expect(p.hoursSaved).toBe(0);
    expect(p.requiredHours).toBe(p.baselineHours);
    expect(p.skips).toHaveLength(0);
  });

  it("skips modules the learner already knows and reports the saved hours", () => {
    const skills = { ...emptySkills(), "html-css": 2 as const, javascript: 2 as const };
    const p = generatePlan({ track: "fullstack", skills, hoursPerWeek: 20 });
    const html = MODULES.filter((m) => m.skill === "html-css" && m.level <= 2).reduce((s, m) => s + m.hours, 0);
    const js = MODULES.filter((m) => m.skill === "javascript" && m.level <= 2).reduce((s, m) => s + m.hours, 0);
    expect(p.hoursSaved).toBe(html + js);
    const scheduled = p.weeks.flatMap((w) => w.items.map((i) => i.moduleId));
    expect(scheduled).not.toContain("hc1");
    expect(scheduled).not.toContain("js2");
    expect(scheduled).toContain("js3");
  });

  it("never schedules more than the weekly capacity", () => {
    const p = generatePlan({ track: "python-backend", skills: emptySkills(), hoursPerWeek: 10 });
    for (const w of p.weeks) {
      const used = w.items.reduce((s, i) => s + i.hours, 0);
      expect(used).toBeLessThanOrEqual(w.capacityHours);
    }
  });

  it("covers the whole gap with enough time, and defers the rest otherwise", () => {
    const full = generatePlan({ track: "uiux", skills: emptySkills(), hoursPerWeek: 40 });
    expect(full.coveragePct).toBe(100);
    expect(full.deferred).toHaveLength(0);

    const tight = generatePlan({ track: "fullstack", skills: emptySkills(), hoursPerWeek: 4 });
    expect(tight.coveragePct).toBeLessThan(100);
    expect(tight.deferred.length).toBeGreaterThan(0);
    expect(tight.scheduledHours).toBe(4 * LEARNING_WEEKS);
  });

  it("conserves hours: scheduled + deferred = required", () => {
    for (const t of TRACKS) {
      for (const h of [4, 7, 12, 25, 40]) {
        const p = generatePlan({ track: t.id, skills: emptySkills(), hoursPerWeek: h });
        const deferredHours = p.deferred.reduce((s, d) => s + d.hours, 0);
        expect(p.scheduledHours + deferredHours).toBe(p.requiredHours);
      }
    }
  });

  it("keeps skill levels in order (level 1 before level 2 of the same skill)", () => {
    const p = generatePlan({ track: "fullstack", skills: emptySkills(), hoursPerWeek: 15 });
    const seq = p.weeks.flatMap((w) => w.items).filter((i) => i.skill === "react-next");
    const levels = seq.map((i) => i.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it("an expert goes straight to the capstone with 100% coverage", () => {
    const skills = Object.fromEntries(Object.keys(emptySkills()).map((k) => [k, 3])) as ReturnType<typeof emptySkills>;
    const p = generatePlan({ track: "fullstack", skills, hoursPerWeek: 10 });
    expect(p.requiredHours).toBe(0);
    expect(p.coveragePct).toBe(100);
    expect(p.weeks).toHaveLength(PROGRAM_WEEKS);
    expect(p.weeks[PROGRAM_WEEKS - 1].theme).toBe("Capstone");
  });

  it("is deterministic", () => {
    const input = { track: "ai-vector" as const, skills: { ...emptySkills(), python: 2 as const }, hoursPerWeek: 14 };
    expect(generatePlan(input)).toEqual(generatePlan(input));
  });

  it("clamps hours per week", () => {
    expect(clampHours(0)).toBe(4);
    expect(clampHours(999)).toBe(40);
    expect(clampHours(NaN)).toBe(4);
  });

  it("builds a goals summary for the enrolment form", () => {
    const p = generatePlan({ track: "frontend", skills: emptySkills(), hoursPerWeek: 8 });
    const txt = planToGoalsText(p);
    expect(txt).toContain("Frontend Ops");
    expect(txt).toContain("8 h/week");
  });
});

describe("planInputSchema", () => {
  const ok = { track: "fullstack", hoursPerWeek: 12, skills: emptySkills() };
  it("accepts a valid input", () => {
    expect(planInputSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects unknown tracks, out-of-range values and extra keys", () => {
    expect(planInputSchema.safeParse({ ...ok, track: "devrel" }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...ok, hoursPerWeek: 3 }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...ok, hoursPerWeek: 12.5 }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...ok, skills: { ...emptySkills(), python: 4 } }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...ok, skills: { python: 1 } }).success).toBe(false);
  });
});
