/** Classified errors from InDesign interaction via osascript. */
export type IndesignErrorKind =
  | "not-running"
  | "no-permission"
  | "busy"
  | "jsx-error"
  | "no-document"
  /**
   * The caller named `expectedDocName`, which didn't match the measured
   * document. A separate kind, not "unknown": this is the one case where
   * failure means not a breakage but a triggered safeguard — and its hint
   * differs accordingly.
   */
  | "wrong-document"
  | "unknown";

export class IndesignError extends Error {
  readonly kind: IndesignErrorKind;
  /** What the user should do to fix it. */
  readonly hint: string;
  /**
   * ЩО ВЖЕ ВСТИГЛО СТАТИСЯ ДО ЗБОЮ — необов'язково, і додано 2026-08-26.
   *
   * `apply.jsx` навмисно будує ОДИН спільний об'єкт звіту, щоб при виключенні
   * всередині `withUndo` віддати його ж, із уже накопиченими
   * `applied`/`skipped`/`failed`. Коментар там про це каже прямо. А
   * `runWrite` перетворював його на помилку, яка несла лише `message` і
   * `hint`, — тобто перелік «які саме правки лягли» будувався й одразу
   * викидався.
   *
   * Ціна видима на пакеті з 40 правок, де падає 23-тя: оператор діставав
   * одне речення «якісь правки могли лягти — перевірте оком» замість
   * двадцяти двох відомих `requestId`. `unknown`, а не конкретний тип:
   * `errors.ts` — листковий модуль, і знати форму звіту `apply_edits` йому
   * не належить.
   */
  readonly payload?: unknown;

  constructor(kind: IndesignErrorKind, message: string, hint: string, payload?: unknown) {
    super(message);
    this.name = "IndesignError";
    this.kind = kind;
    this.hint = hint;
    this.payload = payload;
  }
}

/**
 * Turns raw osascript stderr and a timeout flag into a classified error.
 *
 * `target` — the application the failed osascript call was addressed to
 * (InDesign by default). macOS grants Automation permission separately for
 * each target application, so the hint must name the exact application that
 * actually failed — otherwise the user goes to grant access to the wrong one
 * (e.g. InDesign, when the missing permission is actually for System Events)
 * and nothing changes. With the default (target not passed), behavior is
 * byte-for-byte the same as before.
 */
export function classifyOsascriptFailure(
  stderr: string,
  timedOut: boolean,
  target: string = "InDesign",
): IndesignError {
  const isInDesign = target === "InDesign";

  if (timedOut) {
    return new IndesignError(
      "busy",
      `${target} did not respond in time.`,
      isInDesign
        ? "A modal dialog is most likely open. Switch to InDesign, close the dialog, and retry."
        : `Check whether ${target} is responding, and retry.`,
    );
  }
  /*
   * -1712 is a timeout from AppleScript ITSELF (`AppleEvent timed out`), not our
   * kill of the osascript process: it arrives with timedOut === false and used to
   * fall into the "unknown" branch with a raw stderr dump. The difference from a
   * kill matters for the hint: at -1712 the script inside InDesign may well still
   * be running, so a blind retry can collide with the previous call.
   */
  if (stderr.includes("-1712") || stderr.includes("AppleEvent timed out")) {
    return new IndesignError(
      "busy",
      `${target} did not respond within AppleScript's allotted time (-1712).`,
      isInDesign
        ? "The script may still be running inside InDesign. Wait for it to finish, " +
          "narrow the scope of the call (e.g. pass fewer pages), or increase timeoutMs."
        : `Wait for the operation in ${target} to finish, or increase timeoutMs.`,
    );
  }
  if (stderr.includes("-1743") || stderr.includes("Not authorized")) {
    return new IndesignError(
      "no-permission",
      `No permission to control ${target}.`,
      isInDesign
        ? "System Settings → Privacy & Security → Automation → allow access to Adobe InDesign 2026."
        : `System Settings → Privacy & Security → Automation → allow access to ${target}.`,
    );
  }
  if (stderr.includes("-600") || stderr.includes("isn't running") || stderr.includes("не запущено")) {
    return new IndesignError(
      "not-running",
      isInDesign ? "Adobe InDesign is not running." : `${target} is not running.`,
      isInDesign
        ? "Launch Adobe InDesign 2026 and open a document."
        : `Check whether ${target} is available, and retry.`,
    );
  }
  return new IndesignError(
    "unknown",
    `Error calling ${target}: ${stderr}`,
    `Check whether ${target} is responding.`,
  );
}
