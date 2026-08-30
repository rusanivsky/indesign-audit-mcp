# Measured facts — the bilingual typography block (2026-08-25)

## M1. The Ukrainian rules fire on English text, and mostly at "high" confidence

Probe: `runRules(englishSample, UK_RULES)` over nine English sentences
(`tests/unit/rules-en.test.ts` now keeps a regression form of this).

    [quotes-uk]      "I don't know,"   ->  «I don't know,»    x4   high
    [dialogue-dash]  "- First item"    ->  "— First item"     x2   high
    [dash-separator] "period - a long" ->  "period — a long"  x2   high
    [range-dash-numeric] 1939-1945     ->  1939–1945          x1   high   (correct in English)
    [range-dash-words]   London-Paris  ->  London–Paris       x2   needs-review (correct)
    [apostrophe]     don't             ->  don’t              x1   high   (correct)
    [ellipsis]       ...               ->  …                  x1   high   (correct)
    TOTAL 14

`typography_apply` applies `high` matches by default, so three rule families
would have silently damaged an English edition. The claim in `rule.ts` that the
non-2019 rules are "language-neutral" was true for spaces, apostrophe and the
numeric range dash, and false for quotes, the dialogue dash and the spaced
separator dash.

## M2. Blanket language-gating those three rules would have regressed the seam

`src/typography/seam.ts:47` filters `r.language === undefined` — the seam has no
language dimension (three strings, not a container with `appliedLanguage`
ranges), so every gated rule is dropped there by design.

Consequence had we added `language: UK_LANGUAGE` to `quotes-uk`: the corrector's
edit seam would stop turning `"` into `«»`. That behaviour is asserted by
`tests/integration/corrections.test.ts:699`. The bug fix would have removed a
feature the user relies on daily.

## M3. Two different kinds of language binding, and they need opposite defaults

- **Orthography** (`uk2019-*`): applying it to another language *corrupts* the
  text — «проект» is a correct Russian word. Unknown language must mean DENY,
  and `scanContainers` must throw when ranges are missing. Unchanged.
- **House convention** (quotes, parenthetical dash): applying the wrong one is
  the wrong *style*, not corruption, and the operator states which convention
  they want by choosing the pack. Unknown language must mean ALLOW, or the rule
  goes silent on every document InDesign does not label.

Hence `locale` (pack selection, soft) is a separate field from `language`
(hard gate). They are not merged.

## M4. MEASURED — InDesign's own language names (InDesign 21.5.1.73, 2026-08-25)

`app.languagesWithVendors` returns 61 names. `app.languages` DOES NOT EXIST —
`Error: Object does not support the property or method 'languages'`. The
relevant ones:

    [No Language]
    Ukrainian                <- exact, no colon; matches UK_LANGUAGE from Phase 9
    English: Canadian
    English: UK
    English: USA
    English: USA Medical
    English: USA Legal

So the shape assumed by `familyOf()` is confirmed: regional variants are
qualified after a colon, and the head is the family. `"Ukrainian"` has no colon
and is therefore its own family, which is why the split changes nothing for the
existing Ukrainian rules.

Two consequences that were NOT obvious before the measurement:

1. **Five English names, not two.** A document can be labelled `English: USA
   Medical` or `English: USA Legal`; a gate matching the literal string
   `"English: USA"` would go silent on both. Family matching handles all five.
2. **`[No Language]` is a real value**, not a null. It is its own family and
   matches no locale, so a cross-locale skip can never fire on it — which is
   the ALLOW-on-unknown default doing its job rather than a special case.

`English: Canadian` deliberately does NOT auto-select a school: Canadian
practice mixes British spelling with American punctuation, so guessing would be
worse than asking. The school stays an explicit operator choice; the audit only
REPORTS which English regions it saw.

## M5. MEASURED — a new document's default language is `English: USA`

Probe on InDesign 21.5.1.73: `app.documents.add()`, then
`doc.textDefaults.appliedLanguage.name` returns **`English: USA`**.

Real applied ranges read back exactly as expected:

    {start: 0,  len: 16, lang: "English: UK", text: "She said hello. "}
    {start: 16, len: 20, lang: "Ukrainian",   text: "Вона сказала привіт."}

So `familyOf()` resolves real text correctly. But the default matters more than
the confirmation: **a Ukrainian book whose typesetter never changed the language
is labelled `English: USA`.**

That reintroduced the silent-zero cliff through a different door. With a naive
cross-locale skip, running `locale: "uk"` on such a book would find every quote
and dash match sitting inside an "English" family range, skip all of them, and
report a confident zero — the exact failure the ALLOW-on-unknown default was
designed to prevent, arriving via a language that IS known.

**Fix: the skip only engages when the document actually contains more than one
known family.** The skip exists to protect bilingual documents; on a document
labelled with a single family there is nothing to protect and skipping can only
destroy correct work. `typography_audit` reports `languages.crossLocaleActive` so
the state is visible either way.
