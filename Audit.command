#!/bin/zsh
#
# Клікабельний запускач передпольотного аудиту.
#
# ДВІ РЕЧІ, ЯКІ ТУТ НЕ ВИПАДКОВІ:
#
# 1. Меню будується з ТОГО, ЩО ЗАРАЗ ВІДКРИТО В INDESIGN, а не з переліку
#    конфігів. Інакше оператор мусив би сам пам'ятати, який файл у нього в
#    застосунку, і сам зіставляти його з назвою конфіга — тобто робити
#    роботу, яку машина зробить точніше, і помилятися саме там, де ціна
#    помилки найбільша: прогін не на тій книжці.
#
# 2. Шляхи абсолютні, виведені з розташування ЦЬОГО файлу. Finder запускає
#    .command із домашньої теки, а не з теки файлу, тож відносний шлях тут
#    просто не знайшов би нічого.
#
# ІМЕНА ЗМІННИХ ЛАТИНКОЮ НАВМИСНО: zsh не приймає кириличних
# ідентифікаторів — `for к in …` дає parse error, а `SHLYAH=…` — «no such
# file or directory». Виміряно двічі, 2026-08-17. Текст для людини лишається
# українським.

set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Працює і в теці перенесення (бандл поруч), і в репозиторії (бандл у dist/).
BUNDLE="$ROOT/indesign-audit.mjs"
[[ -f "$BUNDLE" ]] || BUNDLE="$ROOT/dist/indesign-audit.mjs"
CONFIGS="$ROOT/configs"
REPORTS="$HOME/Desktop/Аудити"

echo "════════════════════════════════════════════════"
echo "  Передпольотний аудит макета"
echo "════════════════════════════════════════════════"
echo ""

finish() {
  echo ""
  read -r "?Enter — закрити."
  exit "${1:-0}"
}

if ! command -v node > /dev/null 2>&1; then
  echo "Node.js не знайдено. Аудит без нього не працює."
  finish 1
fi

if [[ ! -f "$BUNDLE" ]]; then
  echo "Аудит не знайдено поруч із цим файлом."
  echo "Очікувався: $ROOT/indesign-audit.mjs"
  echo ""
  echo "Якщо ви в репозиторії — зберіть його:"
  echo "  cd \"$ROOT\" && npm run build:audit"
  finish 1
fi

# ── Що зараз відкрито в InDesign ────────────────────────────────────
echo "Питаю InDesign, що в ньому відкрито…"
echo ""

DOCS=$(node "$BUNDLE" --documents --configs "$CONFIGS" 2>/tmp/audit-launcher.err)
rc=$?

if [[ $rc -ne 0 ]]; then
  echo "Не вдалося опитати InDesign:"
  echo ""
  cat /tmp/audit-launcher.err
  echo ""
  echo "Аудит читає ЖИВИЙ документ, а не файл .indd з диска —"
  echo "запустіть InDesign, відкрийте макет і спробуйте знову."
  finish 1
fi

if [[ -z "$DOCS" ]]; then
  echo "InDesign запущено, але жодного документа не відкрито."
  echo "Відкрийте макет і запустіть знову."
  finish 1
fi

# ── Меню з відкритих документів ─────────────────────────────────────
names=()
docpaths=()
cfgs=()
titles=()

# ЗМІННА ЗВЕТЬСЯ docpath, А НЕ path — І ЦЕ НЕ СМАК.
#
# `path` у zsh зв'язана з `PATH`. Перша редакція читала поля в `path`, і
# для НЕЗБЕРЕЖЕНОГО документа (шлях порожній) це затирало PATH нанівець:
# виміряно, 3856 символів → 0. Далі падало все підряд — «command not found:
# mkdir», «date», «basename», «node», — за десятки рядків від причини.
#
# Сухий прогін цього не показав, бо скасування виходить РАНІШЕ за перший
# зовнішній виклик. Спіймав лише справжній запуск із Finder.
while IFS=$'\x1f' read -r name docpath cfg title; do
  [[ -z "$name" ]] && continue
  names+=("$name")
  docpaths+=("$docpath")
  cfgs+=("$cfg")
  titles+=("$title")
done <<< "$DOCS"

# Сторожа на той самий клас помилки: якщо PATH колись знову постраждає,
# хай це буде названо тут, а не проявиться як «mkdir не знайдено».
if ! command -v mkdir > /dev/null 2>&1; then
  echo "Зламано PATH — оболонка більше не бачить системних команд."
  echo "Причина майже напевно в цьому скрипті: якась змінна перекрила"
  echo "спеціальну змінну zsh (path, status тощо)."
  finish 1
fi

echo "Відкрито в InDesign:"
echo ""
i=1
for n in "${names[@]}"; do
  echo "  $i) $n"
  if [[ -n "${cfgs[$i]}" ]]; then
    echo "     конфіг: ${titles[$i]}"
  else
    echo "     конфіга немає — можна скласти чернетку"
  fi
  i=$((i + 1))
done
echo ""

if [[ ${#names[@]} -eq 1 ]]; then
  choice=1
  echo "Документ один — беру його."
else
  read -r "choice?Номер (Enter — 1): "
  [[ -z "$choice" ]] && choice=1
fi

if [[ -z "${names[$choice]:-}" ]]; then
  echo "Немає варіанта «$choice»."
  finish 1
fi

DOC="${names[$choice]}"
CONFIG="${cfgs[$choice]}"

# ── Конфіга немає: пропонуємо чернетку ──────────────────────────────
if [[ -z "$CONFIG" ]]; then
  echo ""
  echo "Для «$DOC» конфіга немає."
  echo "Без нього аудит не запуститься: конфіг несе те, чого документ"
  echo "про себе не знає — який стиль є колонцифрою, який основним текстом."
  echo ""
  read -r "mk?Скласти чернетку зараз? (Enter — так): "
  [[ -n "$mk" ]] && { echo "Гаразд, нічого не робив."; finish 0; }

  echo ""
  echo "Коротка латинська назва для конфіга (напр. istoriya, atlas-2026):"
  read -r "slug?Назва: "
  [[ -z "$slug" ]] && { echo "Назви не введено."; finish 1; }

  mkdir -p "$CONFIGS"
  NEW="$CONFIGS/$slug.json"
  if [[ -e "$NEW" ]]; then
    echo "Файл $NEW уже існує — оберіть іншу назву, щоб не затерти."
    finish 1
  fi

  echo ""
  node "$BUNDLE" --init --doc "$DOC" --out "$NEW"
  code=$?
  if [[ $code -ne 0 ]]; then
    echo "Чернетку скласти не вдалося."
    finish $code
  fi
  echo ""
  echo "Чернетка: $NEW"
  echo "Заповніть у ній кожне «<?>» назвами стилів із переліку вище,"
  echo "тоді запустіть цей файл знову — документ з'явиться з конфігом."
  open -R "$NEW"
  finish 0
fi

# ── Підтвердження: ЯКИЙ САМЕ документ ───────────────────────────────
echo ""
echo "Перевірятиметься:"
echo "  документ: $DOC"
echo "  конфіг:   ${titles[$choice]}"
echo ""
read -r "yes?Так? (Enter — так, будь-що інше — скасувати): "
if [[ -n "$yes" ]]; then
  echo "Скасовано. Нічого не запущено."
  finish 0
fi

# ── Прогін ──────────────────────────────────────────────────────────
mkdir -p "$REPORTS"
stamp=$(date +%Y-%m-%d_%H-%M)
base=$(basename "$CONFIG" .json)
REPORT="$REPORTS/${base}_${stamp}.html"

echo ""
echo "────────────────────────────────────────────────"
echo "Прогін почався. Це кілька хвилин."
echo "InDesign на цей час буде зайнятий — НЕ ПЕРЕМИКАЙТЕ"
echo "документи, інакше аудит відмовить і скаже чому."
echo "────────────────────────────────────────────────"
echo ""

node "$BUNDLE" --config "$CONFIG" --out "$REPORT"
code=$?

echo ""
case $code in
  0) echo "✓ ЧИСТО — критичних знахідок немає." ;;
  1) echo "⚠ Є КРИТИЧНІ знахідки, або критичну родину не виміряли зовсім." ;;
  2) echo "✗ Конфіг відхилено. Причина вище — до InDesign аудит навіть не звертався." ;;
  3) echo "✗ Збій середовища: InDesign, документ або перемикання. Причина вище." ;;
  *) echo "✗ Несподіваний код виходу: $code" ;;
esac

if [[ -f "$REPORT" ]]; then
  echo ""
  echo "Звіт: $REPORT"
  open "$REPORT"
fi

finish 0
