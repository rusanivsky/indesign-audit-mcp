# Security policy

## Reporting a vulnerability

Report privately, not in a public issue: open a **GitHub security advisory**
on this repository (Security → Report a vulnerability). Expect a first reply
within a week. If you get none, open a public issue saying only that you are
waiting on an advisory — no details.

There is no bounty. Version 0.1.0 is the only supported version; fixes land on
`main`.

## What this software is, before you judge its threat model

It drives Adobe InDesign on the operator's own machine through ExtendScript.
It is an MCP server and a local CLI — there is no network listener, no account
and no browser surface.
Several things that would be defects elsewhere are deliberate here, and are
documented rather than fixed. They are listed below so a reader can tell a
design decision from a bug.

**In scope** — please report:

- Any way for a *document's own content* to make the server run code or write
  outside the document. Untrusted text reaches the server through
  `pdf_read_annotations`, `story_read`, `doc_overview` and `text_find`; it is
  data, and must never become an instruction.
- A write tool that damages a document while reporting success, or that
  bypasses the backup / single-undo / text-check envelope.

**Out of scope** — known and deliberate:

- **`indesign_run_jsx` runs arbitrary ExtendScript.** That is the tool's
  purpose. It has one undo step and nothing else: no backup, no document-name
  check, no text check. Treat every call to it as running a script by hand.
- **A locked layer or a locked frame does not protect text from scripted
  writes.** Measured on live InDesign — see the Safety model in the README.
  `pagination_apply` refuses anyway, but that is its own policy, not an
  InDesign guarantee.
- Anything requiring physical access to an unlocked machine.

## Handling of the operator's data

Nothing leaves the machine. The server speaks only to the InDesign instance
running beside it; there is no network client, no account, no key storage. No
telemetry, no analytics, no crash reporting.

Client material must never enter this repository: `private/` is gitignored,
and [`tests/unit/privacy-gate.test.ts`](tests/unit/privacy-gate.test.ts) fails
the suite on a home path, an email address, an edition ISBN, a cloud-drive
folder named after an account, or an edition title. That gate cannot catch
personal *names* — it says so itself, and the rule for names stays human:
invented names in examples.
