import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TEMP_FIXTURE_DIR_PREFIXES,
  TEMP_FIXTURE_DOC_NAMES,
  isStrayFixtureDoc,
} from "../integration/fixture-doc.js";

/*
 * ЦЕ ТЕСТ НЕ ПРО ПРИБИРАННЯ, А ПРО ТЕ, ЧОГО ПРИБИРАННЯ НЕ СМІЄ ЗАЧЕПИТИ.
 *
 * `closeStrayFixtureDocs` закриває документи БЕЗ SaveOptions.YES і без
 * запитання, тобто хибне «так» тут коштує чужої роботи. Тому кожна умова
 * перевіряється поодинці: три негативи нижче — це три різні мутанти
 * («забути назву», «забути тимчасовий корінь», «забути префікс теки»), і
 * кожен із них без свого рядка проходив би зеленим.
 *
 * Шляхи будуються з СПРАВЖНЬОГО tmpdir(), а не з вигаданого рядка: на macOS
 * `/var/folders/…` і `/private/var/folders/…` — те саме місце, і предикат
 * мусить приймати обидва написання (InDesign віддає друге, mkdtemp — перше).
 */

const REAL_BOOK =
  "~/Library/CloudStorage/GoogleDrive-designer@example.com/My%20Drive/KR/Production/Design/" +
  "Book/Book 260811-1645.indd";

describe("isStrayFixtureDoc", () => {
  it("упізнає саме той документ, що лишався відкритим після прогону", () => {
    const path = join(tmpdir(), "idmcp-pgn-write-QDYZgZ", "pagination-fixture.indd");
    expect(isStrayFixtureDoc("pagination-fixture.indd", path)).toBe(true);
  });

  it("упізнає його і в тому написанні кореня, яке віддає InDesign", () => {
    /*
     * InDesign віддає шлях РОЗІМКНЕНИМ по символьних посиланнях, і на macOS це
     * не косметика: `/var/folders/…` перетворюється на `/private/var/folders/…`,
     * тобто на інший рядок. Розпізнавач мусить бачити обидва написання.
     *
     * Тут стояло `expect(path.startsWith("/private/")).toBe(true)` — і це
     * твердження не про код, а про МАШИНУ, на якій тест біжить. На Linux
     * `realpath(tmpdir())` — це `/tmp`, і юніт-набір, що обіцяє не залежати
     * від InDesign, падав на першому ж прогоні CI. Перевіряємо тепер те, що
     * справді перевіряємо: розімкнений корінь так само впізнається. А те, що
     * на macOS він ІНШИЙ за нерозімкнений, лишається окремим твердженням —
     * без нього тест міг би зазеленіти на машині, де обидва написання збігаються.
     */
    const resolved = realpathSync(tmpdir());
    const path = join(resolved, "idmcp-pgn-write-QDYZgZ", "pagination-fixture.indd");
    expect(isStrayFixtureDoc("pagination-fixture.indd", path)).toBe(true);
    if (process.platform === "darwin") {
      expect(resolved).not.toBe(tmpdir());
      expect(resolved.startsWith("/private/")).toBe(true);
    }
  });

  it("упізнає КОЖНУ з названих фікстур у КОЖНОМУ з названих префіксів", () => {
    for (const name of TEMP_FIXTURE_DOC_NAMES) {
      for (const prefix of TEMP_FIXTURE_DIR_PREFIXES) {
        const path = join(tmpdir(), `${prefix}abc123`, name);
        expect(isStrayFixtureDoc(name, path), `${name} у ${prefix}`).toBe(true);
      }
    }
  });

  it("НЕ чіпає робочого документа користувача", () => {
    expect(isStrayFixtureDoc("Book 260811-1645.indd", REAL_BOOK)).toBe(false);
    expect(isStrayFixtureDoc("Forzats_260816_380x220.indd", REAL_BOOK)).toBe(false);
  });

  it("НЕ чіпає однойменного файла поза тимчасовою текою", () => {
    /* Фікстура називається просто `fixture.indd` — таке ім'я цілком може мати
     * робочий файл у теці проєкту. Сама назва права закрити не дає. */
    expect(isStrayFixtureDoc("fixture.indd", "~/Documents/Робота/fixture.indd")).toBe(false);
    expect(
      isStrayFixtureDoc("pagination-fixture.indd", "/Users/designer/Desktop/pagination-fixture.indd"),
    ).toBe(false);
  });

  it("НЕ чіпає файла в теці з нашим префіксом, але ПОЗА тимчасовим коренем", () => {
    /*
     * ЦЕЙ ТЕСТ ДОПИСАНО ПІСЛЯ МУТАНТА, ЯКИЙ ВИЖИВ. Прибрати перевірку
     * тимчасового кореня — і всі решта вісім лишались зелені: два негативи
     * «поза тимчасовою текою» ловились не нею, а перевіркою префікса (їхні
     * теки звались «Робота» і «Desktop»). Тобто умова стояла без жодного
     * власного доказу. Тека `idmcp-…` цілком може лежати й у користувача — і
     * тоді право закривати дає лише те, що шлях справді тимчасовий.
     */
    expect(isStrayFixtureDoc("fixture.indd", "/Users/designer/Documents/idmcp-нотатки/fixture.indd")).toBe(
      false,
    );
  });

  it("НЕ чіпає чужого документа, що ЛЕЖИТЬ у тимчасовій теці з нашим префіксом", () => {
    const path = join(tmpdir(), "idmcp-pgn-write-QDYZgZ", "Book 260811-1645.indd");
    expect(isStrayFixtureDoc("Book 260811-1645.indd", path)).toBe(false);
  });

  it("НЕ чіпає нашої фікстури в тимчасовій теці ЧУЖОГО походження", () => {
    /* Тимчасовий корінь спільний для всієї системи — тека там може бути й не
     * нашою. Право дає префікс, а не сам факт «це /tmp». */
    const path = join(tmpdir(), "com.adobe.InDesign-cache", "pagination-fixture.indd");
    expect(isStrayFixtureDoc("pagination-fixture.indd", path)).toBe(false);
  });

  it("незбережений документ (fullName === null) не є забутою фікстурою", () => {
    /* `status` віддає null саме для незбережених. Шляху немає — судити нема
     * за чим, і мовчазне `true` тут закривало б будь-який Untitled. */
    expect(isStrayFixtureDoc("pagination-fixture.indd", null)).toBe(false);
  });

  it("вкладена тека з нашим префіксом ВИЩЕ по шляху права не дає", () => {
    /* Дивимось на теку, у якій файл лежить БЕЗПОСЕРЕДНЬО: інакше будь-що,
     * закинуте всередину нашої тимчасової теки, ставало б нашим. */
    const path = join(tmpdir(), "idmcp-pgn-write-QDYZgZ", "чуже", "pagination-fixture.indd");
    expect(isStrayFixtureDoc("pagination-fixture.indd", path)).toBe(false);
  });
});
