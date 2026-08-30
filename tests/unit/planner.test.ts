import { describe, it, expect } from "vitest";
import {
  buildPlan,
  orderForApply,
  findConflicts,
  MAX_CANDIDATES_PER_REQUEST,
} from "../../src/corrections/planner.js";
import type { ContainerSnapshot, CorrectionRequest, AcceptedEdit } from "../../src/corrections/types.js";

function container(text: string, over: Partial<ContainerSnapshot> = {}): ContainerSnapshot {
  return {
    containerId: "story:0",
    text,
    pageRuns: [{ start: 0, end: text.length, page: "1" }],
    oversetFrom: null,
    isMaster: false,
    kind: "text",
    ...over,
  };
}

const req = (o: Partial<CorrectionRequest>): CorrectionRequest => ({
  id: "r1",
  action: "replace",
  old: "",
  new: "",
  ...o,
});

describe("buildPlan", () => {
  it("позначає єдиний збіг статусом unique і дає контекст", () => {
    const plan = buildPlan({
      planId: "p1",
      docName: "test.indd",
      requests: [req({ old: "столиця", new: "столиця" })],
      containers: [container("Київ — столиця України.")],
    });
    expect(plan.items[0]!.status).toBe("unique");
    const c = plan.items[0]!.candidates[0]!;
    expect(c.matchText).toBe("столиця");
    expect(c.contextBefore).toBe("Київ — ");
    expect(c.contextAfter).toBe(" України.");
    expect(c.page).toBe("1");
  });

  it("позначає кілька збігів статусом ambiguous", () => {
    const plan = buildPlan({
      planId: "p1",
      docName: "t.indd",
      requests: [req({ old: "кіт", new: "пес" })],
      containers: [container("кіт і кіт")],
    });
    expect(plan.items[0]!.status).toBe("ambiguous");
    expect(plan.items[0]!.candidates).toHaveLength(2);
  });

  it("позначає відсутній текст статусом not_found і дає підказки", () => {
    // ВІДХИЛЕННЯ ВІД БРИФІНГУ: у брифінгу тут new: "помилкове слово" — той самий
    // рядок, що вже дослівно є в контейнері. За визначенням already_applied із
    // самого брифінгу ("old не знайдено, але new уже присутній") такий вхід
    // зобов'язаний дати статус already_applied, а не not_found — тест
    // суперечив власному визначенню статусу. Тут new замінено на текст, якого
    // немає в контейнері, щоб ізолювати саме сценарій "нічого не знайдено,
    // повертаємо підказки".
    const plan = buildPlan({
      planId: "p1",
      docName: "t.indd",
      requests: [req({ old: "помилков слово", new: "правильне слово" })],
      containers: [container("Це речення містить помилкове слово.")],
    });
    expect(plan.items[0]!.status).toBe("not_found");
    expect(plan.items[0]!.suggestions.length).toBeGreaterThan(0);
  });

  it("позначає already_applied, коли old немає, а new уже стоїть", () => {
    const plan = buildPlan({
      planId: "p1",
      docName: "t.indd",
      requests: [req({ old: "Кыив", new: "Київ" })],
      containers: [container("Місто Київ.")],
    });
    expect(plan.items[0]!.status).toBe("already_applied");
  });

  /*
   * I1 (фінальна рецензія). Спек §4.2: already_applied означає, що `new` уже
   * стоїть НА МІСЦІ правки. Пошук ішов по всьому документу, тож на макеті з
   * 547 story будь-яке коротке `new` («і», «та», «не») знаходилось напевно —
   * правило спрацьовувало хибно й правка ТИХО не застосовувалась.
   */
  describe("already_applied — місце, а не весь документ (I1)", () => {
    it("коротке new, що трапляється всюди, не дає already_applied", () => {
      const plan = buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old: "spolucnyk zh", new: "i" })],
        containers: [
          container("Kit i pes i mysha i ptah."),
          container("Sonce i misiats i zori.", { containerId: "story:1" }),
        ],
      });
      expect(plan.items[0]!.status).not.toBe("already_applied");
      expect(plan.items[0]!.status).toBe("not_found");
    });

    it("унікальне входження new лишається already_applied і показує місце", () => {
      const plan = buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old: "Kyiiv-misto", new: "Kyiv - stolytsia" })],
        containers: [
          container("Zvychainyi tekst bez zbihu.", { containerId: "story:0" }),
          container("Misto Kyiv - stolytsia Ukrainy.", { containerId: "story:1" }),
        ],
      });
      const item = plan.items[0]!;
      expect(item.status).toBe("already_applied");
      expect(item.appliedAt).toBeTruthy();
      expect(item.appliedAt!.containerId).toBe("story:1");
      expect(item.appliedAt!.matchText).toBe("Kyiv - stolytsia");
      expect(item.appliedAt!.page).toBe("1");
    });

    it("два входження new у різних контейнерах — місце невизначене, already_applied не ставиться", () => {
      const plan = buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old: "Kyiiv", new: "Kyiv" })],
        containers: [
          container("Misto Kyiv odyn.", { containerId: "story:0" }),
          container("Misto Kyiv dva.", { containerId: "story:1" }),
        ],
      });
      expect(plan.items[0]!.status).toBe("not_found");
      expect(plan.items[0]!.appliedAt).toBeUndefined();
    });
  });

  it("ранжує кандидатів за близькістю до pageHint", () => {
    const plan = buildPlan({
      planId: "p1",
      docName: "t.indd",
      requests: [req({ old: "кіт", new: "пес", pageHint: 7 })],
      containers: [
        container("кіт .......... кіт", {
          pageRuns: [
            { start: 0, end: 5, page: "2" },
            { start: 5, end: 18, page: "7" },
          ],
        }),
      ],
    });
    expect(plan.items[0]!.candidates[0]!.page).toBe("7");
  });

  it("зсуває pageHint на pageOffset — нумерація PDF не збігається з макетом", () => {
    const containers = [
      container("кіт .......... кіт", {
        pageRuns: [
          { start: 0, end: 5, page: "2" },
          { start: 5, end: 18, page: "7" },
        ],
      }),
    ];
    // Коректор бачить це на 5 сторінці PDF, у макеті це сторінка 7.
    const plan = buildPlan({
      planId: "p1",
      docName: "t.indd",
      requests: [req({ old: "кіт", new: "пес", pageHint: 5 })],
      containers,
      pageOffset: 2,
    });
    expect(plan.items[0]!.candidates[0]!.page).toBe("7");
  });

  it("pageOffset не звужує пошук — обидва збіги лишаються в кандидатах", () => {
    const plan = buildPlan({
      planId: "p1",
      docName: "t.indd",
      requests: [req({ old: "кіт", new: "пес", pageHint: 99 })],
      containers: [container("кіт і кіт")],
      pageOffset: 5,
    });
    expect(plan.items[0]!.status).toBe("ambiguous");
    expect(plan.items[0]!.candidates).toHaveLength(2);
  });

  /*
   * I3 (фінальна рецензія). Кількість кандидатів нічим не обмежувалась, а на
   * кожного кандидата припадає один діапазон у ranges_inspect. Коротке `old`
   * на макеті в 196 сторінок дає тисячі кандидатів: план стає нечитним, а
   * інспекція стилів — таймаутом. Понад MAX_CANDIDATES_PER_REQUEST кандидатів
   * усе одно не є придатною для людини поверхнею вибору.
   */
  describe("обмеження кількості кандидатів (I3)", () => {
    const many = () => container("kit ".repeat(80).trim());

    it("кандидатів не більше за ліміт, а повна кількість не ховається", () => {
      const plan = buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old: "kit", new: "pes" })],
        containers: [many()],
      });
      const item = plan.items[0]!;
      expect(item.status).toBe("ambiguous");
      expect(item.candidates).toHaveLength(MAX_CANDIDATES_PER_REQUEST);
      expect(item.candidatesTruncated).toEqual({
        shown: MAX_CANDIDATES_PER_REQUEST,
        total: 80,
      });
    });

    it("обрізання йде ПІСЛЯ ранжування за pageHint — лишаються найближчі сторінки", () => {
      const text = "kit ".repeat(80).trim();
      const plan = buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old: "kit", new: "pes", pageHint: 9 })],
        containers: [
          container(text, {
            // Останні 20 входжень — на сторінці 9, решта — на сторінці 1.
            pageRuns: [
              { start: 0, end: 240, page: "1" },
              { start: 240, end: text.length, page: "9" },
            ],
          }),
        ],
      });
      expect(plan.items[0]!.candidates[0]!.page).toBe("9");
    });

    it("менше за ліміт — поле про обрізання не з'являється", () => {
      const plan = buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old: "kit", new: "pes" })],
        containers: [container("kit i kit")],
      });
      expect(plan.items[0]!.candidatesTruncated).toBeUndefined();
    });
  });

  it("додає попередження про overset, майстер-сторінку, виноску й таблицю", () => {
    const plan = buildPlan({
      planId: "p1",
      docName: "t.indd",
      requests: [req({ old: "текст", new: "текст" })],
      containers: [
        container("хвіст текст", { oversetFrom: 3, isMaster: true, kind: "footnote" }),
      ],
    });
    const w = plan.items[0]!.candidates[0]!.warnings;
    expect(w).toContain("in-overset");
    expect(w).toContain("on-master-page");
    expect(w).toContain("in-footnote");
  });

  /*
   * Виправлення 3 (свідомо відкладене з Task 3 саме до Task 8): попередження
   * "in-overset" виставлялося лише за початком збігу (start >= oversetFrom).
   * Збіг, який ПОЧИНАЄТЬСЯ у видимому тексті, а ЗАКІНЧУЄТЬСЯ за межею overset,
   * попередження не отримував — і саме такий збіг Task 8 запише частково в
   * невидимий текст. Межа тут одна для всіх трьох випадків: oversetFrom = 5,
   * тобто перший невидимий символ — пробіл на індексі 5.
   *   "слово хвіст"
   *    01234 5 678910
   */
  describe("межа overset (виправлення 3)", () => {
    const overset = () => container("слово хвіст", { oversetFrom: 5 });

    const warningsOf = (old: string) =>
      buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old, new: "інше" })],
        containers: [overset()],
      }).items[0]!.candidates[0]!.warnings;

    it("збіг цілком до межі — попередження немає (кінець збігу точно на межі)", () => {
      // "слово" — це [0,5), останній символ 4, межа 5. Нічого невидимого не зачеплено.
      expect(warningsOf("слово")).not.toContain("in-overset");
    });

    it("збіг цілком за межею — попередження є", () => {
      // "хвіст" — це [6,11), увесь у невидимій частині.
      expect(warningsOf("хвіст")).toContain("in-overset");
    });

    it("збіг перетинає межу — попередження є", () => {
      // "во хв" — це [3,8): починається у видимому тексті, закінчується за межею.
      expect(warningsOf("во хв")).toContain("in-overset");
    });
  });

  /*
   * C1: правка з хвостовим пробілом у `old` не сміє знищити межу абзаців.
   * Тут перевіряється саме те, що піде в запис: candidate.matchText стає
   * expectedOld, а [start, end) — діапазоном заміни (toAcceptedEdits).
   */
  describe("межа абзацу в кандидаті (C1)", () => {
    const twoParagraphs = "Persha fraza abzatsu.\rDruhyi abzats tut.";

    it("кандидат для old із хвостовим пробілом не містить знака кінця абзацу", () => {
      const plan = buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old: "abzatsu. ", new: "abzatsu, " })],
        containers: [container(twoParagraphs)],
      });
      const c = plan.items[0]!.candidates[0]!;
      expect(plan.items[0]!.status).toBe("unique");
      expect(c.matchText).not.toContain("\r");
      expect(twoParagraphs.slice(c.start, c.end)).not.toContain("\r");
    });

    it("сторінка кандидата береться від обрізаного початку, а не від роздільника", () => {
      // Роздільник (індекс 21) належить першому pageRun, сам збіг — другому.
      const plan = buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old: " Druhyi", new: " Tretii" })],
        containers: [
          container(twoParagraphs, {
            pageRuns: [
              { start: 0, end: 22, page: "1" },
              { start: 22, end: twoParagraphs.length, page: "2" },
            ],
          }),
        ],
      });
      expect(plan.items[0]!.candidates[0]!.page).toBe("2");
    });

    it("обрізаний хвіст знімає хибне попередження in-overset", () => {
      // "vydymyi tekst." — [0,14), роздільник на 14, невидиме починається з 14.
      // До обрізки діапазон збігу для "tekst. " закінчувався на 15 і тягнув за
      // собою попередження про overset, хоча запис іде цілком у видимий текст.
      const text = "vydymyi tekst.\rnevydymyi hvist";
      expect(text.charCodeAt(14)).toBe(13);
      const plan = buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old: "tekst. ", new: "tekst, " })],
        containers: [container(text, { oversetFrom: 14 })],
      });
      const c = plan.items[0]!.candidates[0]!;
      expect(c.end).toBe(14);
      expect(c.warnings).not.toContain("in-overset");
    });

    /*
     * T-trim (рецензія хвилі C1). Обрізка діапазону запису мовчить, а `new`
     * пишеться дослівно (Global Constraint) — на стику обрізаного краю з
     * пробільним краєм `new` може лишитися зайвий пробіл перед/після знака
     * абзацу. Два окремих попередження: сам факт обрізки (clamped-to-paragraph,
     * завжди при обрізці) і прицільний сигнал ризику (possible-stray-space,
     * лише коли обрізаний край межує з пробілом у `new`).
     */
    describe("попередження про обрізку по межі абзацу (T-trim)", () => {
      it("обрізаний хвіст + new закінчується пробілом → обидва попередження", () => {
        const plan = buildPlan({
          planId: "p1",
          docName: "t.indd",
          requests: [req({ old: "abzatsu. ", new: "abzatsu, " })],
          containers: [container(twoParagraphs)],
        });
        const w = plan.items[0]!.candidates[0]!.warnings;
        expect(w).toContain("clamped-to-paragraph");
        expect(w).toContain("possible-stray-space");
      });

      it("обрізаний хвіст, але new БЕЗ пробілу на кінці → лише факт обрізки, без ризик-попередження", () => {
        const plan = buildPlan({
          planId: "p1",
          docName: "t.indd",
          requests: [req({ old: "abzatsu. ", new: "abzatsu," })],
          containers: [container(twoParagraphs)],
        });
        const w = plan.items[0]!.candidates[0]!.warnings;
        expect(w).toContain("clamped-to-paragraph");
        expect(w).not.toContain("possible-stray-space");
      });

      it("обрізана голова + new починається пробілом → обидва попередження", () => {
        const plan = buildPlan({
          planId: "p1",
          docName: "t.indd",
          requests: [req({ old: " Druhyi", new: " Tretii" })],
          containers: [container(twoParagraphs)],
        });
        const w = plan.items[0]!.candidates[0]!.warnings;
        expect(w).toContain("clamped-to-paragraph");
        expect(w).toContain("possible-stray-space");
      });

      it("обрізана голова, але new БЕЗ пробілу на початку → лише факт обрізки", () => {
        const plan = buildPlan({
          planId: "p1",
          docName: "t.indd",
          requests: [req({ old: " Druhyi", new: "Tretii" })],
          containers: [container(twoParagraphs)],
        });
        const w = plan.items[0]!.candidates[0]!.warnings;
        expect(w).toContain("clamped-to-paragraph");
        expect(w).not.toContain("possible-stray-space");
      });

      it("немає обрізки → жодного з двох попереджень", () => {
        const plan = buildPlan({
          planId: "p1",
          docName: "t.indd",
          requests: [req({ old: "fraza", new: "word" })],
          containers: [container(twoParagraphs)],
        });
        const w = plan.items[0]!.candidates[0]!.warnings;
        expect(w).not.toContain("clamped-to-paragraph");
        expect(w).not.toContain("possible-stray-space");
      });

      it("delete: обрізаний хвіст дає факт обрізки, але не ризик-попередження — писати нічого не буде", () => {
        // Global Constraint для delete: newText завжди "" (toAcceptedEdits), тож
        // не має значення, що стоїть у полі request.new — стрибка пробілу з
        // порожнього запису статися не може.
        const plan = buildPlan({
          planId: "p1",
          docName: "t.indd",
          requests: [req({ old: "abzatsu. ", new: "будь-що ", action: "delete" })],
          containers: [container(twoParagraphs)],
        });
        const w = plan.items[0]!.candidates[0]!.warnings;
        expect(w).toContain("clamped-to-paragraph");
        expect(w).not.toContain("possible-stray-space");
      });
    });

    it("збіг через межу абзацу не стає кандидатом", () => {
      const plan = buildPlan({
        planId: "p1",
        docName: "t.indd",
        requests: [req({ old: "abzatsu. Druhyi", new: "abzatsu, druhyi" })],
        containers: [container(twoParagraphs)],
      });
      expect(plan.items[0]!.candidates).toEqual([]);
      expect(plan.items[0]!.status).not.toBe("unique");
    });
  });

  it("шукає в усіх контейнерах, а не лише в першому", () => {
    const plan = buildPlan({
      planId: "p1",
      docName: "t.indd",
      requests: [req({ old: "підпис", new: "підпис" })],
      containers: [
        container("основний текст", { containerId: "story:0" }),
        container("підпис під фото", { containerId: "story:1" }),
      ],
    });
    expect(plan.items[0]!.status).toBe("unique");
    expect(plan.items[0]!.candidates[0]!.containerId).toBe("story:1");
  });

  it("K1: однобуквена правка з контекстом дає рівно одного кандидата", () => {
    const containers: ContainerSnapshot[] = [
      {
        containerId: "story:0",
        text: "Усе своє життя вона мріяла про знаннь і про спокій, бо знаннь мало варте.",
        pageRuns: [{ start: 0, end: 200, page: "12" }],
        oversetFrom: null,
        isMaster: false,
        kind: "text",
      },
    ];
    const plan = buildPlan({
      planId: "p1",
      docName: "d.indd",
      containers,
      requests: [
        {
          id: "r1",
          action: "replace",
          old: "ь",
          new: "я",
          contextBefore: "вона мріяла про знанн",
          contextAfter: " і про спокій",
        },
      ],
    });
    expect(plan.items[0]!.status).toBe("unique");
    expect(plan.items[0]!.candidates[0]!.matchText).toBe("ь");
  });

  it("K1: без контексту однобуквена правка лишається неоднозначною", () => {
    const containers: ContainerSnapshot[] = [
      {
        containerId: "story:0",
        text: "знаннь і знаннь",
        pageRuns: [{ start: 0, end: 40, page: "12" }],
        oversetFrom: null,
        isMaster: false,
        kind: "text",
      },
    ];
    const plan = buildPlan({
      planId: "p2",
      docName: "d.indd",
      containers,
      requests: [{ id: "r1", action: "replace", old: "ь", new: "я" }],
    });
    expect(plan.items[0]!.status).toBe("ambiguous");
  });

  it("K1 + B4: якірний шлях (collectByAnchor) теж несе нормалізований writeText", () => {
    /*
     * Кроки 5-6 брифу додають seam-нормалізацію в ОБИДВА шляхи збору
     * кандидатів — collectCandidates і collectByAnchor (K1, Task 5). Попередні
     * B4-тести цього файлу перевіряли лише collectCandidates (запити без
     * contextBefore/contextAfter). Цей тест форсує якірний шлях (old — одна
     * літера + контекст із PDF, як у K1-тестах вище) і водночас дає `new`,
     * що зазнає нормалізації (дефіс між словами → тире), щоб довести, що
     * writeText/normalizations прокинуті в collectByAnchor так само, як і в
     * collectCandidates, а не лише в одному з двох шляхів.
     */
    const containers: ContainerSnapshot[] = [
      {
        containerId: "story:0",
        text: "Усе своє життя вона мріяла про знаннь і про спокій, бо знаннь мало варте.",
        pageRuns: [{ start: 0, end: 200, page: "12" }],
        oversetFrom: null,
        isMaster: false,
        kind: "text",
      },
    ];
    const plan = buildPlan({
      planId: "p3",
      docName: "d.indd",
      containers,
      requests: [
        {
          id: "r1",
          action: "replace",
          old: "ь",
          new: "мама - це все",
          contextBefore: "вона мріяла про знанн",
          contextAfter: " і про спокій",
        },
      ],
    });
    expect(plan.items[0]!.status).toBe("unique");
    const cand = plan.items[0]!.candidates[0]!;
    expect(cand.matchText).toBe("ь");
    expect(cand.writeText).toBe("мама — це все");
    expect(cand.normalizations.map((n) => n.ruleId)).toContain("dash-separator");
  });
});

describe("orderForApply", () => {
  const edit = (o: Partial<AcceptedEdit>): AcceptedEdit => ({
    requestId: "r",
    candidateId: "c",
    containerId: "story:0",
    start: 0,
    end: 1,
    expectedOld: "x",
    newText: "y",
    action: "replace",
    ...o,
  });

  it("сортує правки за спаданням офсетів у межах контейнера", () => {
    const out = orderForApply([
      edit({ candidateId: "a", start: 10, end: 12 }),
      edit({ candidateId: "b", start: 50, end: 52 }),
      edit({ candidateId: "c", start: 30, end: 32 }),
    ]);
    expect(out.map((e) => e.candidateId)).toEqual(["b", "c", "a"]);
  });

  it("групує правки за контейнерами, не перемішуючи їх", () => {
    const out = orderForApply([
      edit({ candidateId: "a1", containerId: "story:1", start: 5 }),
      edit({ candidateId: "b1", containerId: "story:0", start: 5 }),
      edit({ candidateId: "a2", containerId: "story:1", start: 50 }),
      edit({ candidateId: "b2", containerId: "story:0", start: 50 }),
    ]);
    const ids = out.map((e) => e.containerId);
    // Усі правки одного контейнера мають іти підряд.
    expect(ids).toEqual([ids[0], ids[0], ids[2], ids[2]]);
    expect(ids[0]).not.toBe(ids[2]);
    // І всередині кожної групи — за спаданням офсетів.
    expect(out.map((e) => e.candidateId)).toEqual(["a2", "a1", "b2", "b1"]);
  });
});

describe("findConflicts", () => {
  const edit = (start: number, end: number, id: string): AcceptedEdit => ({
    requestId: id,
    candidateId: id,
    containerId: "story:0",
    start,
    end,
    expectedOld: "x",
    newText: "y",
    action: "replace",
  });

  it("виявляє правки, що перетинаються", () => {
    expect(findConflicts([edit(0, 10, "a"), edit(5, 15, "b")])).toHaveLength(1);
  });

  it("сусідні правки без перетину не конфліктують", () => {
    expect(findConflicts([edit(0, 10, "a"), edit(10, 20, "b")])).toHaveLength(0);
  });

  it("правки в різних контейнерах не конфліктують", () => {
    const a = edit(0, 10, "a");
    const b = { ...edit(0, 10, "b"), containerId: "story:1" };
    expect(findConflicts([a, b])).toHaveLength(0);
  });
});

describe("buildPlan — B4 (нормалізація new на шві)", () => {
  it("B4: кандидат несе нормалізований writeText, а не сире new", () => {
    const containers: ContainerSnapshot[] = [
      {
        containerId: "story:0",
        text: "вона сказала: стара фраза, і замовкла",
        pageRuns: [{ start: 0, end: 100, page: "7" }],
        oversetFrom: null,
        isMaster: false,
        kind: "text",
      },
    ];
    const plan = buildPlan({
      planId: "p",
      docName: "d.indd",
      containers,
      requests: [{ id: "r1", action: "replace", old: "стара фраза", new: "мама - це все" }],
    });
    const cand = plan.items[0]!.candidates[0]!;
    expect(cand.writeText).toBe("мама — це все");
    expect(cand.normalizations.length).toBeGreaterThan(0);
  });

  it("B4: повторний прогін плану не дублює нормалізовану правку", () => {
    const containers: ContainerSnapshot[] = [
      {
        containerId: "story:0",
        text: "вона сказала: мама — це все, і замовкла",
        pageRuns: [{ start: 0, end: 100, page: "7" }],
        oversetFrom: null,
        isMaster: false,
        kind: "text",
      },
    ];
    const plan = buildPlan({
      planId: "p",
      docName: "d.indd",
      containers,
      requests: [{ id: "r1", action: "replace", old: "стара фраза", new: "мама - це все" }],
    });
    expect(plan.items[0]!.status).toBe("already_applied");
  });
});
