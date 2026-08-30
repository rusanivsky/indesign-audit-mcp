/**
 * The FORM of the live CIP record, reproduced exactly — proper nouns
 * substituted.
 *
 * The substitution is not tidying. The privacy gate forbids the repository to
 * carry an edition's identity, and no rule in this family depends on which
 * name stands there. What survives verbatim is the shape, and every part of it
 * is something a rule points at:
 *
 *   - `Surname Firstname` — an inverted name with NO comma;
 *   - `\r` — the heading sits in its own paragraph;
 *   - ` / Firstname Surname` — the author repeated, which Chicago has no zone for;
 *   - ` \u2014 ` — the ГОСТ zone separator. MEASURED on the live record: it is
 *     U+2014 EM DASH, not the U+2013 the standard prescribes. The pattern must
 *     accept a CLASS of dash-like marks, or it will miss the real document;
 *   - `City :` — a space before the colon;
 *   - `\n` — a forced line break INSIDE the paragraph, between colon and publisher;
 *   - `PUBLISHER` — the publisher in full caps;
 *   - `\u0018` — InDesign's page-number marker where a page count is expected.
 *
 * `\u0018` is written ESCAPED and must stay that way. As a literal it is
 * invisible in every editor, and it was silently lost twice while this work
 * was being written down.
 *
 * Character census of the live record (2026-08-27, 86 chars): `\r` at 15,
 * U+2014 at 43, `\n` at 51, U+2014 at 80, `\u0018` at 82. Everything else ASCII.
 */
export const CIP_RECORD =
  "Surname Firstname.\rTitle / Firstname Surname. \u2014 City :\nPUBLISHER, 2026. \u2014 \u0018 p.";

/** The same record as Chicago would have it. Nothing here may produce a finding. */
export const CIP_CORRECT = "Surname, Firstname. Title. City: Publisher, 2026.";
