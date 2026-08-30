# Licence of `hunspell-oracle.json`

**This file is not MIT.** The rest of the project is; this one is not, and if
you copy it out of here, copy this notice with it.

`hunspell-oracle.json` holds 4,747 word/verdict pairs produced by running
`hunspell` against the dictionaries Adobe InDesign ships
(`scripts/gen-hunspell-oracle.mjs`). Word forms expanded from a dictionary's
stems and affix rules are a derivative of that dictionary, so each language
block keeps its source's terms.

## `uk_UA`

From the [spell-uk](http://ispell-uk.sourceforge.net/) project.

    Copyright (C) 1999  Vladimir Yakovchuk, Oleg Podgurniy
    Copyright (C) 2001  Dmytro Kovalyov, Maksym Polyakov, Andriy Rysin
    Copyright (C) 2002  Valentyn Solomko, Volodymyr M. Lisivka
    Copyright (C) 2005  Andriy Rysin, Eugeniy Meshcheryakov, Dmytro Kovalyov
    Copyright (C) 2006-2009  Andriy Rysin

Tri-licensed: **GPL-2.0-or-later OR LGPL-2.1-or-later OR MPL-1.1**, at the
recipient's choice. This project takes **MPL-1.1**
([`licenses/MPL-1.1.txt`](../../licenses/MPL-1.1.txt)); you may take any of the
three.

## `en_US`

From [SCOWL](http://wordlist.sourceforge.net); the affix file is a modified
`english.aff` from Geoff Kuenning's Ispell, under his BSD licence.

    Copyright 2000-2018 by Kevin Atkinson

    Permission to use, copy, modify, distribute and sell these word lists, the
    associated scripts, the output created from the scripts, and its
    documentation for any purpose is hereby granted without fee, provided that
    the above copyright notice appears in all copies and that both that
    copyright notice and this permission notice appear in supporting
    documentation. Kevin Atkinson makes no representations about the
    suitability of this array for any purpose. It is provided "as is" without
    express or implied warranty.

"The output created from the scripts" is exactly what this file is, so the
grant covers it directly.

## `en_GB`

From the OpenOffice.org en_GB dictionary, itself based on Kevin Atkinson's
wordlist; affix file BSD (Kuenning).

**The upstream is ambiguous about which copyleft applies, and this notice does
not resolve it.** `README.txt` in that dictionary says the wordlist is covered
by Atkinson's **LGPL** licence, while the same folder ships a full **GPL-2.0**
`license.txt` (and a WordNet licence). Both texts are included here —
[`licenses/LGPL-2.1.txt`](../../licenses/LGPL-2.1.txt) and
[`licenses/GPL-2.0.txt`](../../licenses/GPL-2.0.txt) — and a recipient should
treat this block as copyleft under whichever of the two the upstream intended.

## Practical consequences

- **The npm package does not contain this file.** `package.json` ships only
  `dist`. Nothing in the built product derives from it.
- It is test data. No code in `src/` is a derivative of it.
- To rebuild it yourself, see
  [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md).
