# Third-party notices

The project itself is MIT (see [`LICENSE`](LICENSE)). Two components inside it
are not ours, and neither is MIT. This file says which, and on what terms —
measured from the files themselves, not assumed.

## 1. `tests/fixtures/hunspell-oracle.json` — derived from Hunspell dictionaries

**This file is NOT covered by the project's MIT licence.** It holds 4,747
word/verdict pairs (uk_UA 1,596 · en_US · en_GB) produced by running the real
`hunspell` against the dictionaries Adobe InDesign 2026 ships, via
[`scripts/gen-hunspell-oracle.mjs`](scripts/gen-hunspell-oracle.mjs). Word
forms expanded from a dictionary's stems and affix rules are a derivative of
that dictionary, so each language block carries its source's terms:

| Block | Upstream | Terms |
|---|---|---|
| `uk_UA` | [spell-uk](http://ispell-uk.sourceforge.net/) — © 1999–2009 V. Yakovchuk, O. Podgurniy, D. Kovalyov, M. Polyakov, A. Rysin, V. Solomko, V. M. Lisivka, E. Meshcheryakov | Tri-licensed: **GPL-2.0-or-later OR LGPL-2.1-or-later OR MPL-1.1** — the recipient chooses. We take **MPL-1.1**. |
| `en_US` | [SCOWL](http://wordlist.sourceforge.net) — © 2000–2018 Kevin Atkinson; affix file BSD (Geoff Kuenning, Ispell) | Permissive. The notice grants use, copy, modify, distribute and sell of "the word lists, the associated scripts, **the output created from the scripts**, and its documentation", provided the copyright notice is preserved — which this file does. |
| `en_GB` | OpenOffice.org en_GB, from Kevin Atkinson's wordlist; affix file BSD (Kuenning) | **Copyleft, and the upstream is ambiguous about which one.** Its README says LGPL; the same folder ships a full GPL-2.0 `license.txt` and a WordNet licence. We do not resolve that ambiguity — both texts are vendored under [`licenses/`](licenses/). |

All three blocks are kept — Ukrainian, American and British. The licences do
not require dropping any of them; they require saying what they are, shipping
their texts, and not letting the file slip into something labelled MIT. That is
what the rest of this section does.

Full licence texts are vendored verbatim in [`licenses/`](licenses/) —
`GPL-2.0.txt`, `LGPL-2.1.txt`, `MPL-1.1.txt`. All three permit verbatim
copying; that permission is in their own opening lines.

A copy of these terms also sits next to the data, in
[`tests/fixtures/hunspell-oracle.LICENSE.md`](tests/fixtures/hunspell-oracle.LICENSE.md),
so that anyone who lifts the fixture out of this repository takes its terms
along. [`tests/unit/licensing.test.ts`](tests/unit/licensing.test.ts) fails the
suite if that notice disappears, if a language block appears in the fixture
without a line in the notice, or if `package.json`'s `files` ever grows an
entry that could pull `tests/` into the npm tarball.

Two consequences worth stating plainly:

- **The npm package is unaffected.** `package.json` ships only `dist`, so
  this fixture is not in the tarball. It exists in the git repository, for
  the test suite.
- **The `en_GB` block is the copyleft one.** It stays: a GPL/LGPL data file in
  a repository obliges you to carry its notice and text, not to relicense the
  code around it, and nothing in `src/` derives from it. If you nonetheless
  want a repository with no copyleft in it at all, regenerate the oracle
  without that language — the generator takes the language list as `LANGS`, and
  the affected tests then cover uk_UA and en_US only.

To rebuild the fixture from your own installation:

```
node scripts/gen-hunspell-oracle.mjs "/Applications/Adobe InDesign 2026/Resources/Dictionaries/LILO/Linguistics/Providers/Plugins2/AdobeHunspellPlugin.bundle/Contents/SharedSupport/Dictionaries"
```

`hunspell` must be on PATH. It is deliberately not a package dependency — it
runs once, on a development machine, not in CI.

## 2. The dictionaries themselves are not redistributed

Nothing under `/Applications/Adobe InDesign 2026/…` is copied into this
repository. `spelling_audit` reads Adobe's dictionaries at run time from the
user's own installation, and the response names the exact path, stem count and
attribution of every dictionary it loaded.
