/**
 * Static curriculum catalog for the Path Engine.
 *
 * Independent prototype: module names, hours and prerequisites are illustrative
 * assumptions inspired by the lab tracks described on cynbit.in/bitelevate.
 * They are NOT Cynbit's real curriculum.
 */

export type SkillId =
  | "html-css"
  | "javascript"
  | "react-next"
  | "node-apis"
  | "python"
  | "sql-db"
  | "git-collab"
  | "dsa-basics"
  | "testing"
  | "devops-basics"
  | "ai-llm"
  | "design-fundamentals";

/** 0 = never touched it, 3 = ships it independently. */
export type Level = 0 | 1 | 2 | 3;

export interface Skill {
  id: SkillId;
  label: string;
  /** Behaviour-anchored descriptions: more reliable than "rate yourself 1-5". */
  levels: [string, string, string, string];
}

export const SKILLS: Skill[] = [
  {
    id: "html-css",
    label: "HTML & CSS",
    levels: [
      "Never built a web page",
      "Can build a static page from a tutorial",
      "Can build a responsive layout from a design",
      "Handle accessibility, theming and complex layouts confidently",
    ],
  },
  {
    id: "javascript",
    label: "JavaScript / TypeScript",
    levels: [
      "Never written JS",
      "Know syntax; can write small scripts",
      "Comfortable with async, closures and modules",
      "Use TypeScript and design reusable modules",
    ],
  },
  {
    id: "react-next",
    label: "React / Next.js",
    levels: [
      "Never used React",
      "Built a small component-based app from a tutorial",
      "Built an app with routing, state and API calls",
      "Shipped SSR/SSG apps and handle performance",
    ],
  },
  {
    id: "node-apis",
    label: "Backend APIs (Node/Express)",
    levels: [
      "Never built an API",
      "Built a basic REST endpoint",
      "Built CRUD APIs with validation and auth",
      "Designed APIs with error handling, pagination, rate limits",
    ],
  },
  {
    id: "python",
    label: "Python",
    levels: [
      "Never written Python",
      "Can write scripts and use libraries",
      "Comfortable with OOP, packaging and a web framework",
      "Build services with typing, async and tests",
    ],
  },
  {
    id: "sql-db",
    label: "SQL & databases",
    levels: [
      "Never used a database",
      "Can run basic SELECT / INSERT",
      "Design schemas and write joins",
      "Use indexes, transactions and read query plans",
    ],
  },
  {
    id: "git-collab",
    label: "Git & collaboration",
    levels: [
      "Never used Git",
      "Can commit and push",
      "Comfortable with branches and pull requests",
      "Resolve conflicts, review PRs, keep clean history",
    ],
  },
  {
    id: "dsa-basics",
    label: "Data structures & algorithms",
    levels: [
      "Not started",
      "Know arrays, maps and basic sorting",
      "Solve medium problems with trees/graphs",
      "Analyse complexity and choose structures deliberately",
    ],
  },
  {
    id: "testing",
    label: "Testing & QA",
    levels: [
      "Never written tests",
      "Written a few unit tests",
      "Write unit and integration tests routinely",
      "Automate E2E tests and CI quality gates",
    ],
  },
  {
    id: "devops-basics",
    label: "Deployment & DevOps",
    levels: [
      "Never deployed anything",
      "Deployed a project to a hosting platform",
      "Use environment config, Docker and CI",
      "Monitor, roll back and manage cloud infrastructure",
    ],
  },
  {
    id: "ai-llm",
    label: "AI / LLM apps",
    levels: [
      "Never used an LLM API",
      "Called an LLM API from a script",
      "Built RAG or tool-use features",
      "Evaluate, cache and monitor LLM features in production",
    ],
  },
  {
    id: "design-fundamentals",
    label: "UI/UX design basics",
    levels: [
      "No design experience",
      "Can follow a style guide",
      "Can wireframe and build a component library",
      "Run usability tests and own a design system",
    ],
  },
];

export const SKILL_IDS = SKILLS.map((s) => s.id) as SkillId[];

export interface Module {
  id: string;
  skill: SkillId;
  /** Teaches this skill up to this level. */
  level: 1 | 2 | 3;
  title: string;
  hours: number;
  deliverable: string;
}

export const MODULES: Module[] = [
  // html-css
  { id: "hc1", skill: "html-css", level: 1, title: "Semantic HTML & core CSS", hours: 6, deliverable: "Static profile page" },
  { id: "hc2", skill: "html-css", level: 2, title: "Responsive layouts (Flexbox/Grid)", hours: 8, deliverable: "Responsive landing page from a design" },
  { id: "hc3", skill: "html-css", level: 3, title: "Accessibility & theming", hours: 8, deliverable: "WCAG-checked dark/light theme" },
  // javascript
  { id: "js1", skill: "javascript", level: 1, title: "JavaScript fundamentals", hours: 10, deliverable: "Small CLI/browser scripts" },
  { id: "js2", skill: "javascript", level: 2, title: "Async JS, modules & the DOM", hours: 10, deliverable: "Fetch-driven widget" },
  { id: "js3", skill: "javascript", level: 3, title: "TypeScript for real projects", hours: 10, deliverable: "Typed utility library with tests" },
  // react-next
  { id: "rn1", skill: "react-next", level: 1, title: "React components & props", hours: 8, deliverable: "Component-based UI" },
  { id: "rn2", skill: "react-next", level: 2, title: "State, routing & data fetching", hours: 12, deliverable: "Multi-page app with API data" },
  { id: "rn3", skill: "react-next", level: 3, title: "Next.js rendering & performance", hours: 12, deliverable: "SSR app with Lighthouse > 90" },
  // node-apis
  { id: "na1", skill: "node-apis", level: 1, title: "REST basics with Node", hours: 8, deliverable: "Hello-world REST API" },
  { id: "na2", skill: "node-apis", level: 2, title: "CRUD, validation & auth", hours: 12, deliverable: "Authenticated CRUD service" },
  { id: "na3", skill: "node-apis", level: 3, title: "Production API design", hours: 12, deliverable: "Paginated, rate-limited API with error contract" },
  // python
  { id: "py1", skill: "python", level: 1, title: "Python fundamentals", hours: 8, deliverable: "Automation scripts" },
  { id: "py2", skill: "python", level: 2, title: "FastAPI/Django services", hours: 12, deliverable: "Typed web service" },
  { id: "py3", skill: "python", level: 3, title: "Async Python & testing", hours: 10, deliverable: "Async service with pytest suite" },
  // sql-db
  { id: "sq1", skill: "sql-db", level: 1, title: "SQL basics", hours: 6, deliverable: "Query set on a sample DB" },
  { id: "sq2", skill: "sql-db", level: 2, title: "Schema design & joins", hours: 8, deliverable: "Normalised schema + migrations" },
  { id: "sq3", skill: "sql-db", level: 3, title: "Indexes, transactions & query plans", hours: 8, deliverable: "Slow-query fix with EXPLAIN evidence" },
  // git-collab
  { id: "gc1", skill: "git-collab", level: 1, title: "Git essentials", hours: 3, deliverable: "Repo with clean commits" },
  { id: "gc2", skill: "git-collab", level: 2, title: "Branching & pull requests", hours: 4, deliverable: "Merged PR with review" },
  { id: "gc3", skill: "git-collab", level: 3, title: "Conflict resolution & review practice", hours: 4, deliverable: "Reviewed 3 PRs" },
  // dsa-basics
  { id: "ds1", skill: "dsa-basics", level: 1, title: "Core data structures", hours: 8, deliverable: "20 easy problems" },
  { id: "ds2", skill: "dsa-basics", level: 2, title: "Trees, graphs & recursion", hours: 12, deliverable: "15 medium problems" },
  { id: "ds3", skill: "dsa-basics", level: 3, title: "Complexity analysis & patterns", hours: 12, deliverable: "Timed mock round" },
  // testing
  { id: "te1", skill: "testing", level: 1, title: "Unit testing basics", hours: 4, deliverable: "Tested module" },
  { id: "te2", skill: "testing", level: 2, title: "Integration & API tests", hours: 6, deliverable: "API test suite" },
  { id: "te3", skill: "testing", level: 3, title: "E2E automation & CI gates", hours: 8, deliverable: "CI pipeline with E2E suite" },
  // devops-basics
  { id: "do1", skill: "devops-basics", level: 1, title: "Deploy a first app", hours: 3, deliverable: "Live URL" },
  { id: "do2", skill: "devops-basics", level: 2, title: "Docker, env config & CI", hours: 8, deliverable: "Containerised app with CI" },
  { id: "do3", skill: "devops-basics", level: 3, title: "Observability & rollbacks", hours: 8, deliverable: "Dashboard + rollback drill" },
  // ai-llm
  { id: "ai1", skill: "ai-llm", level: 1, title: "Calling LLM APIs", hours: 5, deliverable: "Prompted script" },
  { id: "ai2", skill: "ai-llm", level: 2, title: "RAG & vector search", hours: 12, deliverable: "Document Q&A service" },
  { id: "ai3", skill: "ai-llm", level: 3, title: "LLM evaluation & production concerns", hours: 10, deliverable: "Eval harness with cost/latency report" },
  // design-fundamentals
  { id: "df1", skill: "design-fundamentals", level: 1, title: "Visual design principles", hours: 5, deliverable: "Redesigned screen" },
  { id: "df2", skill: "design-fundamentals", level: 2, title: "Wireframes & component libraries", hours: 10, deliverable: "Figma component set" },
  { id: "df3", skill: "design-fundamentals", level: 3, title: "Usability testing & design systems", hours: 10, deliverable: "Tested prototype + tokens" },
];

export type TrackId =
  | "fullstack"
  | "python-backend"
  | "ai-vector"
  | "frontend"
  | "qa-automation"
  | "uiux";

export interface Track {
  id: TrackId;
  label: string;
  blurb: string;
  /** Target level per skill for this lab. Higher priority = scheduled earlier. */
  targets: Partial<Record<SkillId, { level: 1 | 2 | 3; priority: number }>>;
  capstone: string;
}

export const TRACKS: Track[] = [
  {
    id: "fullstack",
    label: "Full-Stack Web",
    blurb: "Next.js, Node and PostgreSQL, from UI to database.",
    targets: {
      "git-collab": { level: 2, priority: 1 },
      "html-css": { level: 2, priority: 2 },
      javascript: { level: 3, priority: 3 },
      "react-next": { level: 3, priority: 4 },
      "node-apis": { level: 3, priority: 5 },
      "sql-db": { level: 2, priority: 6 },
      testing: { level: 1, priority: 7 },
      "devops-basics": { level: 1, priority: 8 },
    },
    capstone: "Ship a full-stack feature with API, database and a live deployment",
  },
  {
    id: "python-backend",
    label: "Python Backend",
    blurb: "FastAPI/Django services with real databases.",
    targets: {
      "git-collab": { level: 2, priority: 1 },
      python: { level: 3, priority: 2 },
      "sql-db": { level: 3, priority: 3 },
      "node-apis": { level: 2, priority: 4 },
      testing: { level: 2, priority: 5 },
      "devops-basics": { level: 2, priority: 6 },
      "dsa-basics": { level: 1, priority: 7 },
    },
    capstone: "Ship a tested, containerised Python API with a documented error contract",
  },
  {
    id: "ai-vector",
    label: "AI & Vector Systems",
    blurb: "LLM features, RAG and vector databases.",
    targets: {
      "git-collab": { level: 2, priority: 1 },
      python: { level: 3, priority: 2 },
      "sql-db": { level: 2, priority: 3 },
      "ai-llm": { level: 3, priority: 4 },
      testing: { level: 2, priority: 5 },
      "devops-basics": { level: 1, priority: 6 },
    },
    capstone: "Ship a RAG service with an evaluation report",
  },
  {
    id: "frontend",
    label: "Frontend Ops",
    blurb: "Performant, accessible React interfaces.",
    targets: {
      "git-collab": { level: 2, priority: 1 },
      "html-css": { level: 3, priority: 2 },
      javascript: { level: 3, priority: 3 },
      "react-next": { level: 3, priority: 4 },
      testing: { level: 2, priority: 5 },
      "design-fundamentals": { level: 1, priority: 6 },
      "devops-basics": { level: 1, priority: 7 },
    },
    capstone: "Ship an accessible, performance-budgeted interface",
  },
  {
    id: "qa-automation",
    label: "QA & Automation",
    blurb: "Test strategy, API/E2E automation and CI gates.",
    targets: {
      "git-collab": { level: 2, priority: 1 },
      javascript: { level: 2, priority: 2 },
      testing: { level: 3, priority: 3 },
      "node-apis": { level: 1, priority: 4 },
      "devops-basics": { level: 2, priority: 5 },
      "sql-db": { level: 1, priority: 6 },
    },
    capstone: "Build an automated test pipeline for a real web app",
  },
  {
    id: "uiux",
    label: "UI/UX Design",
    blurb: "Research-led product design and design systems.",
    targets: {
      "git-collab": { level: 1, priority: 1 },
      "design-fundamentals": { level: 3, priority: 2 },
      "html-css": { level: 2, priority: 3 },
      javascript: { level: 1, priority: 4 },
    },
    capstone: "Design and usability-test a prototype, then hand off a design system",
  },
];

export const TRACK_IDS = TRACKS.map((t) => t.id) as [TrackId, ...TrackId[]];

export function getTrack(id: TrackId): Track {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown track: ${id}`);
  return t;
}
