import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFixtureActive, closeFixtureDoc, makeFixtureDoc } from "./fixture-doc.js";
import { runJsx } from "../../src/bridge/runner.js";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import { readLanguageRuns, assertLanguageCoverage } from "../../src/spelling/langruns.js";

let DOC = "";

describe("spelling_audit на живому InDesign", () => {
  beforeAll(async () => {
    DOC = await makeFixtureDoc();
  });

  afterAll(async () => {
    await closeFixtureDoc(DOC);
  });

  it("мовні діапазони покривають увесь текст кожного контейнера", async () => {
    await assertFixtureActive(DOC);
    const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
      "containers_read",
      {},
    );
    const langs = await readLanguageRuns();
    /* Головна властивість шва: офсети двох викликів моста (containers_read
     * і language_runs_read) збігаються. */
    expect(() => assertLanguageCoverage(read.containers, langs)).not.toThrow();
  });

  it("контейнери й мовні діапазони читаються, не змінюючи документа", async () => {
    /*
     * Брифінг Задачі 12 (Step 3) звіряв `app.documents[0].modified`. Це та
     * сама помилка, що вже задокументована й виправлена в map.test.ts
     * («layout_measure нічого не змінює», Раунд виправлень 1): фікстура сама
     * пише в документ під час побудови (`__fixture_make` додає рамки, стилі,
     * таблицю, виноску — і тепер ще й чотири мовні стани), тож `modified`
     * стає `true` ще ДО першого читання й лишається `true` незалежно від
     * того, чи щось дописав сам тест, — прапорець монотонний і не годиться
     * як доказ читальності в жодну сторону (порівняння з `false` тут не
     * могло б ПРОЙТИ ніколи, порівняння з `true` не могло б ВПАСТИ ніколи —
     * обидва «завжди зелені» тести, не перевірки).
     *
     * Замість прапорця — та сама сигнатура вмісту, що й у map.test.ts
     * (`__fixture_signature`, src/jsx/_fixtures.jsx): незалежний від
     * containers_read/language_runs_read обхід документа. Знімок ДО і ПІСЛЯ
     * обох читань мають збігатися ПОБАЙТОВО.
     *
     * ІЗОЛЬОВАНИЙ документ, а не спільний DOC: попередній тест уже викликав
     * containers_read/language_runs_read на DOC, і застережений у
     * map.test.ts (Раунд виправлень 2) мутант з ІДЕМПОТЕНТНИМ записом
     * пройшов би непоміченим на вже "розігрітій" спільній фікстурі. Власний
     * документ і закриття в finally гарантують, що жодне з двох читань
     * тут не викликалося на ньому раніше.
     */
    const isolatedName = await makeFixtureDoc();
    try {
      await assertFixtureActive(isolatedName);
      const before = await runJsx<unknown>("__fixture_signature", {});
      await runJsx("containers_read", {});
      await readLanguageRuns();
      const after = await runJsx<unknown>("__fixture_signature", {});
      expect(after).toEqual(before);
    } finally {
      await closeFixtureDoc(isolatedName);
    }
  });
});
