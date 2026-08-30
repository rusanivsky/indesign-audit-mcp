# Measured facts — Phase 11 (2019 orthography)

## MOE's "§36 overview" is §35 of the full text, and there are THREE lists in it

Spec §10 named the phase's biggest risk as: the Ministry of Education's
overview gives two lists for the first component, but its own headline
example — `вебсайт` — is in neither list. So the overview is not
exhaustive.

**Cross-checked 2026-08-14** against three independent sources (full text +
two secondary ones, the composition matches):

- [2019.pravopys.net §35](https://2019.pravopys.net/sections/35/) — full text;
- [onlinecorrector.com.ua](https://onlinecorrector.com.ua/%D1%96%D0%BD%D1%88%D0%BE%D0%BC%D0%BE%D0%B2%D0%BD%D1%96-%D0%BA%D0%BE%D0%BC%D0%BF%D0%BE%D0%BD%D0%B5%D0%BD%D1%82%D0%B8-%D1%80%D0%B0%D0%B7%D0%BE%D0%BC/) — §35 п.5.2;
- [Kyiv Dictionary, comparison tables](https://www.kyivdictionary.com/uk/grammar/uk/pravopys2019-porivniannia/).

Composition of the lists:

- §35 п.2 — regularly used components: абро-, авіа-, авто-, агро-, аеро-,
  аква-, алко-, арт-, астро-, аудіо-, біо-, боди-, боді-, **веб-**, геліо-,
  гео-, гідро-, дендро-, екзо-, еко-, економ-, етно-, євро-, зоо-, ізо-,
  кібер-, мета-, метео-, моно-, мото-, нарко-, нео-, онко-, палео-, пан-,
  пара-, поп-, **прес-**, псевдо-, смарт-, соціо-, теле-, фіто-, фолк-,
  фольк-, фоно-;
- §35 п.3 — a quantitative marker (verbatim from the MOE overview): архі-,
  архи-, бліц-, гіпер-, екстра-, макро-, максі-, міді-, мікро-, міні-,
  мульти-, нано-, полі-, преміум-, супер-, топ-, ультра-, флеш-;
- §35 п.4 (the second verbatim list from the MOE overview): анти-, віце-,
  екс-, контр-, лейб-, обер-, штабс-, унтер-.

**An exception the source itself names:** with a PROPER noun, these same
components are hyphenated — «пан-Європа», «Анти-Дюринг», «екс-Югославія»,
«веб-API». The rule already accounts for this by construction: a match only
occurs for a hyphen before a LOWERCASE letter.

**Discrepancies between copies of the source** (recorded, not hidden):
`смарт-` and `фольк-` are not in all three copies. Both were included —
no copy contradicts them. `лже-`, `іно-`, `іншо-`, `інако-` are named
right next to them in the full text, but were NOT included: they are
native, not foreign-borrowed.

**The paragraph number in the rule's name is NOT written as "§36."** The
MOE overview and the full text number differently; the code uses §35 — the
one from the full text.

---

# Proof (Task 10)

Taken 2026-08-14. Test suite at mutation time: **107 files, 1783 tests, all
green.**

## Mutants: killed by EXECUTION, not by reasoning

Each mutant was inserted into the code, `npm test` was run, the names of
the failing tests were recorded, and the code was reverted. No mutant
survived, so no test needed to be added.

| # | Mutant | File | Failing tests (full names) |
|---|---|---|---|
| 1 | Gate REMOVED: the `fullyInLanguage` check dropped from `scanContainers` | `src/tools/typography.ts` | `tools-typography.test.ts > scanContainers — мовний гейт > збіг в українському діапазоні лишається, у російському — ні`; `tools-typography.test.ts > scanContainers — мовний гейт > збіг НА МЕЖІ мов відкидається й рахується, а не зникає мовчки` (2 of 1783) |
| 2 | Gate WEAKENED from "fully inside" to "overlaps": `start < r.end && end > r.start` | `src/typography/langgate.ts` | `tools-typography.test.ts > scanContainers — мовний гейт > збіг НА МЕЖІ мов відкидається й рахується, а не зникає мовчки`; `typography-langgate.test.ts > fullyInLanguage > збіг НА МЕЖІ мов відкидається, хоч і починається в українській` (2 of 1783) |
| 3 | `mixed` always `true` | `src/typography/spelling2019.ts` | `typography-spelling2019.test.ts > collectVariantPairs > пара в ОДНІЙ формі — рядок інвентаря, але НЕ знахідка`; `typography-spelling2019.test.ts > collectVariantPairs > знахідки стоять перед рядками інвентаря` (2 of 1783) |
| 4 | `mixed` always `false` | `src/typography/spelling2019.ts` | `typography-spelling2019.test.ts > collectVariantPairs > пара в ОБОХ формах — знахідка з числами кожної`; `typography-spelling2019.test.ts > collectVariantPairs > знахідки стоять перед рядками інвентаря` (2 of 1783) |
| 5 | Component list truncated by one: `"веб"` removed from `COMPOUND_REGULAR` | `src/typography/rules-uk.ts` | `rules-uk2019.test.ts > uk2019-compound > зліплює компонент із наступним словом`; `… > зберігає регістр першої літери компонента`; `… > ІДЕМПОТЕНТНЕ: злите слово збігом не є (а розділене — є)`; `… > компонент-омограф понижується до сумнівного, а не пишеться мовчки` (4 of 1783) |
| 6 | The merge branch removed from `mergedRuns` | `src/typography/langgate.ts` | `typography-langgate.test.ts > mergedRuns > СКЛЕЮЄ сусідні діапазони однієї мови`; `typography-langgate.test.ts > countLanguageRuns > рахує СКЛЕЄНІ діапазони, не сирі` (2 of 1783) |

Mutant 4 is worth reading carefully: it is killed TWICE — by the test on
the finding itself, and by the test on ordering. Mutants 3 and 4 together
cover both sides of the condition, so "always the same answer" fails in
neither direction.

## The run on the book — and why it is the branch's OWN build

Measured with the branch's OWN build (`npm run build`, then invoking the
registered `typography_audit` handler through `dist/`). The
`mcp__indesign__*` tools are UNSUITABLE for this: they run the MAIN
checkout's build, which does not have this phase's code at all, and would
show `main`'s state disguised as the branch's state.

**How exactly the handler was invoked.** Not by retelling its body (a
retelling would diverge from the original and would measure itself), but by
INTERCEPTION: a fake server is passed to `registerTypographyTools`, whose
`registerTool` merely collects handlers into a `Map`, after which the real
`typography_audit` handler is invoked. So exactly the code that ships to
the user is what gets measured:

```js
const { runJsx } = await import(url("bridge/runner.js"));
const { registerTypographyTools } = await import(url("tools/typography.js"));

const handlers = new Map();
const fakeServer = { registerTool: (name, _cfg, fn) => handlers.set(name, fn) };
registerTypographyTools(fakeServer);
const audit = handlers.get("typography_audit");

const r = await audit({ sampleSize: 10 });     // ruleIds not passed — i.e. all
const text = r.content[0].text;                 // what the user would see
```

`url(p)` here is `pathToFileURL(join(distDir, p)).href`, where `distDir` is
passed as an argument: the same script is pointed this way at the branch's
`dist/` and then at the deployed `main`'s `dist/` (Step 2 below).
`sampleSize: 10` is passed explicitly because the default value is filled
in by zod in the real MCP, and there is none here.

Document: `Book 260811-1645.indd`, 196 pages, InDesign 21.5.1.73, the
only document open. 574 containers, of which 534 are non-master, 219,154
characters.

| What | Value |
|---|---|
| `spelling2019.ukrainianRuns` | **534** |
| `spelling2019.skippedByLanguage` | 0 |
| `spelling2019.mixedCount` | **0** |
| `spelling2019.pairs.length` | 3 |
| `groups[uk2019-proiekt].total` | **0** (the group is absent from the response) |
| `groups[uk2019-compound].total` | **0** (of which `needsReview` — 0) |
| `groups[uk2019-sviashchennyk].total` | **0** |
| `totalMatches` (everything — existing rules) | 131 |
| Response size | 109,768 B (on `main` — 107,350 B; +2,418 B) |
| Time of the second bridge call (`language_runs_read`) | 0.857 / 0.842 / 0.845 s |
| For comparison, `containers_read` | 1.200 / 1.209 / 1.199 s |

**The one claim stated BEFORE the run held: `ukrainianRuns` = 534 > 0.**
The build is not localized, and the book's language is indeed `Ukrainian`,
so the rest of the zeros really are "clean," not "unmeasured."

### Zero in three rules is a ZERO IN THE TEXT, not a zero in the gate

A raw zero-match count is ambiguous by itself: it is produced equally by
clean text and by a gate that ate everything. What tells them apart is a
control — the same three rules run over the same book with the `language`
field STRIPPED:

- the ungated `uk2019-*` run also gives **0 matches**. So the gate rejected
  nothing, and `skippedByLanguage` = 0 is a real report, not silence;
- `прое(?=к)` — 0 occurrences, and `проєк` — **3**: the book is already
  written post-reform. This is also proof of `uk2019-proiekt`'s
  IDEMPOTENCE on live text, not on a fixture;
- `священик` — 0, `священник` — 0: the lemma simply is not in the book;
- there are 132 hyphens in the book, of which 83 have the form "start of
  word + hyphen + lowercase Cyrillic letter" — exactly the form
  `uk2019-compound` catches. Distinct first components — 47 (`будь-`,
  `по-`, `лікарем-`, `резус-`, `бебі-`, `шлунково-`, `серцево-`,
  `онлайн-`, `стрес-`, `фаст-`, `клініко-`, `інформаційно-`, `бета-`,
  `фітнес-`, `уф-` …). **Not one of them is a §35 component** — checked
  not by eye, but by running the rule itself over a synthetic
  `«голова-яблуко»` ("head-apple") for each of the 47 heads: zero matches.

So the book gives the `uk2019-compound` rule 83 chances to get it wrong,
and it did not get a single one wrong. A false positive on a proper name
(`ТОВ "Проект"`, spec §6) could not have arisen given the absence of any
matches at all; the one match downgraded to `needs-review` in the entire
response belongs to the pre-existing `range-dash-words` rule (`La
Roche-Posay`, three times) — the 2019 family downgraded nothing.

#### What EXACTLY was measured here (so it can be re-measured and argued about)

The run that gave zero is this phase's most closely scrutinized claim,
because "nothing found" is produced equally by clean text and by a broken
measurement. So the method is recorded verbatim here, not paraphrased. The
scripts lived in the scratchpad outside the repository, so THIS record is
what remains in the repository.

**The shared setup for both controls** — the same as above: `distDir` as
an argument, `url(p) = pathToFileURL(join(distDir, p)).href`, one bridge
call to `containers_read`. The book's body is taken WITHOUT master
containers and joined with `\n` (only for the plain regex counters;
`scanContainers` filters out masters itself):

```js
const read = await runJsx("containers_read", {});
const body = read.containers.filter((c) => c.isMaster !== true);
const text = body.map((c) => c.text).join("\n");
const count = (re) => (text.match(re) ?? []).length;
```

**(1) The ungated run.** The `language` field is stripped from a COPY of
the rule — the rule itself is untouched, since `scanContainers` without
ranges would throw:

```js
const ungated = UK_RULES.filter((r) => r.id.startsWith("uk2019-")).map((r) => {
  const { language, ...rest } = r;
  return rest;
});
const scan = scanContainers(read.containers, ungated);   // → matches.length === 0
```

**(2) Lemma and hyphen counters** — the verbatim regexes that produced the
numbers "0 / 3," "132," and "83":

```js
count(/прое(?=к)/giu)        // 0   — pre-reform form
count(/проєк/giu)            // 3   — modern form
count(/священик/giu)         // 0
count(/священник/giu)        // 0
count(/-/gu)                 // 132 — hyphens in the book overall
count(/(?<![\p{L}\p{N}])\p{L}+-(?=\p{Script=Cyrillic})(?=\p{Ll})/gu)   // 83
```

The last pattern deliberately repeats `uk2019-compound`'s own shape, but
with `\p{L}+` instead of the §35 list — i.e. it counts "how many places in
the book have the required FORM," regardless of whether the rule
recognizes the word.

**(3) Extracting the 47 heads.** With the same pattern using a captured
group; case is lowercased so "Веб" and "веб" are not counted twice:

```js
const heads = new Map();
for (const m of text.matchAll(
  /(?<![\p{L}\p{N}])(\p{L}+)-(?=\p{Script=Cyrillic})(?=\p{Ll})/gu,
)) {
  const h = m[1].toLocaleLowerCase("uk");
  heads.set(h, (heads.get(h) ?? 0) + 1);
}
// → 47 distinct heads; most frequent: будь- 10, по- 10, лікарем- 5, акушером- 3,
//   резус- 3, torch- 3, тільки- 3, бебі- 3, подарунок- 2, мама- 2 …
```

**(4) A synthetic probe — the strongest of the three controls.** For EACH
of the 47 heads, a synthetic container is built with the string «
голова-яблуко »" ("head-apple"), and the rule `uk2019-compound` ITSELF is
run over it (also with `language` stripped), not a retelling of it:

```js
const compound = UK_RULES.find((r) => r.id === "uk2019-compound");
const hits = [];
for (const [h, n] of control.compoundHeads) {
  const snap = {
    containerId: "probe",
    text: ` ${h}-яблуко `,
    pageRuns: [{ start: 0, end: 99, page: "1" }],
    isMaster: false,
  };
  const { language, ...ungatedRule } = compound;
  const r = scanContainers([snap], [ungatedRule]);
  if (r.matches.length > 0) hits.push([h, n]);
}
// → hits === []  (none of the book's 47 heads is a §35 component)
```

`«-яблуко»` was chosen because `я` is a lowercase Cyrillic letter,
satisfying both of the rule's lookaheads; the spaces on either side give a
word boundary for `(?<![\p{L}\p{N}])`. The probe answers the question "would
the rule have GLUED this head, had it stood before an ordinary Ukrainian
word" — and the answer for all 47 heads is "no."

**Being honest about a dead end in the same script.** Next to `hits` there
remained a variable, `inList` — an unfinished attempt to match heads
against the list via a constructed regex; its predicate ends with `return
false`, meaning it is ALWAYS empty and is NOT evidence. In the output it
printed as `inList: []`; it must not be read as confirmation. Only `hits`
is the evidence.

**(5) Language distribution and a second, independent lemma search** — a
separate script, also through the branch's `dist/`:

```js
const langs = await readLanguageRuns();           // second bridge call
const merged = mergedRuns(langs);                 // → 551 merged runs
// byLang count over merged  → Ukrainian 548, Vietnamese 1, [No Language] 2
// rawByLang count over langs → 2336 raw: Ukrainian 2333, the rest the same

for (const q of ["конвейєр", "плейєр", "фойє", "фейєрверк",
                 "конвеєр", "проект", "священик"]) {
  const r = await runJsx("grep_find", { pattern: q, limit: 20 });
  // → all 0, except «конвеєр»: 1 (story:137, offset 1934)
}
```

`grep_find` matters here specifically because it searches THROUGH
InDesign's own eyes, not over text from `containers_read`: two independent
paths to the same numbers. They matched.

**What was NOT measured** (so it doesn't look measured): probe (4) checks
heads that are ALREADY in the book before a hyphen. It does not check
whether the rule would recognize a §35 component if one occurred in the
book — that is checked by the `rules-uk2019.test.ts` unit tests and mutant
5, not by this run.

### The variant half: three pairs, none mixed

| Pair | Class | Form | Times | Pages |
|---|---|---|---|---|
| `пауза/павза` | au | `пауза` | 2 | 2 (84, 136) |
| `ефір/етер` | th | `ефір` | 2 | 1 (46) |
| `міф/міт` | th | `міф` | 13 | 9 |

Each pair is represented by EXACTLY ONE form, so `mixedCount` = 0: the
edition is consistent, and there is nothing to fault it for — exactly the
case `mixed` exists as a finding condition for.

### The book's language landscape — and why the gate barely did anything here

Across ALL 574 containers: 2,336 raw ranges merge into 551, of which
`Ukrainian` — 548, `Vietnamese` — 1, `[No Language]` — 2.

- `Vietnamese` is ONE paragraph mark (`\r`) on p. 66 (`story:109`, offset
  3594). Clearly a stray language assignment, not text;
- `[No Language]` is **520 characters of the book's own Ukrainian body
  text on p. 31** (`story:335`, two ranges: 192 and 328 characters).

The second item is worth remembering: this is genuine book text with no
language assigned to it, and any 2019-orthography rule will SKIP it.
Today it costs nothing (there is no match there), but tomorrow it will —
and that is exactly why `skippedByLanguage` exists as its own field: this
skip will be counted, not swallowed.

The consequence for the strength of this proof, stated out loud: **the
book is practically monolingual, so it does not exercise the gate's
SAFEGUARD.** The gate's proof is mutants 1 and 2 and their tests, not this
run.

## Existing rules: byte-for-byte unchanged

`main` = `f7f420e` = this branch's merge-base, i.e. `main` did not move.
The `main` tree was checked out separately with `git archive` and built
with its own `tsc`; the MAIN checkout was untouched — its `dist/` serves
the user's MCP server.

Comparing the `groups` section without `uk2019-*`, sorted by `ruleId`:

```
IDENTICAL
```

Lines of equal length (11,285 characters on each side), `totalMatches` =
131 on each side, `auditOnly` also byte-for-byte identical (53,900
characters). The only difference in the response is the ADDED
`spelling2019` key; the phase did not touch a single existing key. The
twelve already-merged rules behave exactly as they did before the phase.

## Four §126 lemmas, deferred by Task 4

Searched TWICE and independently: with InDesign's own `grep_find` over the
book, and again over the text from `containers_read`.

| Pre-reform form | Occurrences | Modern form | Occurrences |
|---|---|---|---|
| `конвейєр` | 0 | `конвеєр` | 1 (`story:137`) |
| `плейєр` | 0 | `плеєр` | 0 |
| `фойє` | 0 | `фоє` | 0 |
| `фейєрверк` | 0 | `феєрверк` | 0 |

**Conclusion: none of the four lemmas occurs in its pre-reform form, so the
rule is NOT extended** — an empty rule does not get written (spec §4.2).
The one occurrence of `конвеєр` already has the modern form, meaning the
rule would have had nothing to do with it anyway.

## Proof of read-only-ness — by a content signature, not a flag

`modified` is monotonic and proves nothing, so a CONTENT SIGNATURE was
taken: sha256 over `containerId` + `isMaster` + the full text + `pageRuns`
of all 574 containers.

```
before: db88e0444d635759bd7d55aab428ef012aa1b2ff4994f326dd63a8bd9b90c68f  (574 containers, 219,154 characters)
after : db88e0444d635759bd7d55aab428ef012aa1b2ff4994f326dd63a8bd9b90c68f
```

Between the two snapshots, TWO full runs of the branch's `typography_audit`
took place. The third, control snapshot — taken after everything: a run of
`main`'s build of `typography_audit`, two control runs, and six timing
reads — gave the SAME hash. No `typography_apply`, no write, no save ever
happened.

## The price of the second bridge call

`language_runs_read` — a steady **0.85 s** (0.857 / 0.842 / 0.845), against
1.20 s for `containers_read` on the same document. So the language
measurement adds ≈70% to the time of the first read and ≈40% to the full
audit (a warm run of the whole `typography_audit` is 2.2 s).

This is noticeable, so the boundary is stated explicitly (spec §10):
**ranges are cached WITHIN ONE tool call, not across calls.** Both
`typography_audit` and `typography_apply` re-read the language every time.
This is intentional: between two calls the user could have changed the
text's language, and a cache surviving across calls would silently apply
yesterday's gate to today's document — exactly the class of silent error
this phase was built against.
