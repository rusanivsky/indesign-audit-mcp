# Contributing

## Build and test

```bash
npm install
npm run build          # server + JSX copied into dist/
npm test               # unit + web projects, no InDesign needed
npm run typecheck
npm run test:integration   # needs InDesign 2026 running
```

The suites are separated by Vitest project (`unit`, `web`, `integration`), not
by path. `npm run test:integration -- tests/integration/x.test.ts` runs the
*whole* integration suite; scope it with `--project` instead.

CI runs everything except the integration project — that one needs a licensed
InDesign on a Mac, and a silently skipped suite would be worse than an absent
one.

## Four rules that are not style preferences

**1. Measure; don't reason from the scripting reference.** Claims about
InDesign's behaviour in this codebase come with a date, a version and a
document. When measurement contradicts the plan, the plan is wrong — that has
happened often enough that `docs/measured-facts-*.md` exists to record it. A
20× gap from a previous measurement is grounds to suspect your instrument, not
to announce a discovery.

**2. A check must be able to fail.** Prove a new test by execution in both
directions: it fails on the old code, passes on the new. A test that cannot
fail is not a gate, and `&& echo ok` after a command hides its exit code.

**3. `src/jsx/` is ExtendScript ES3.** `var`, `function`, plain loops. No
`let`, no arrow functions, no `JSON`. `node --check` on a `.jsx` file under a
modern Node lies about what InDesign will accept, so the syntax gate
(`tests/unit/jsx-syntax.test.ts`) is the authority. All matching and parsing
logic belongs in TypeScript, where it can be tested without InDesign.

**4. No book lives in this repository.** The tool serves many editions, so it
carries none: no titles, authors, ISBNs, document paths or client text. Real
configs go in `private/`, which is gitignored; `configs/` holds synthetic
examples only. The privacy gate enforces this on every run — but it cannot
catch personal names, so use invented ones in examples and comments.

## Language

The public interface — tool names, descriptions, parameter docs, error
messages, README — is **English**. Code comments, commit messages and test
prose are **Ukrainian**. Ukrainian that is *data* stays Ukrainian permanently:
orthography fixtures, typographic and DSTU rule inputs, InDesign style names,
quoted measured samples. Judge line by line, not file by file.

## Audit tools report candidates

An audit tool's job is to hand a human something to decide, with enough
context to decide it, and to name what it did **not** check. A tool that says
"clean" must be able to say why that zero is a real zero. Where a tool does
issue a verdict, its description says what standard it is judging against.

## Commits and versioning

Semantic versioning. The version lives in `package.json` only — the MCP server
reads it from there (`src/version.ts`), and a gate keeps a second copy from
appearing. Record changes in `CHANGELOG.md`.

Commit subjects are Ukrainian, in the form `область: що змінилось`. Say what
the change *does*, and if measurement drove it, say what was measured.
