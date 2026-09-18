# Довідник внутрішньої структури DOM Google Meet (People Panel & Presentation Pinning)

Цей документ містить підтверджену на практиці внутрішню структуру DOM-елементів Google Meet станом на 2026 рік. Документація створена для збереження знань про роботу бічної панелі учасників, механізми закріплення презентацій та запобігання регресіям у селекторах.

---

## 1. Архітектура бічної панелі «Учасники» (People Panel)

### 1.1. Головний контейнер бічної панелі
У сучасному Google Meet відкрита бічна панель рендериться за допомогою HTML5-тегу `<aside>`, а не `<div>`:
* **Тег та атрибути:** `<aside class="R3Gmyc WSJBnb P9KVBf" aria-label="Side panel">`
* **Заголовок:** Містить назву `People` (або `Учасники` / `Люди`) та кнопку закриття `Close` (`close`).
* ⚠️ **Критична пастка селекторів:**
  Селектор `div[role="tabpanel"]` **НЕ МОЖНА** використовувати для пошуку панелі учасників наосліп. У Meet цей же `role="tabpanel"` використовує панель додаткових інструментів/активностей (Activities: Опитування, Таймер, Запис, Дошки тощо). Якщо в Meet відкрито інструменти, селектор знайде порожній список без людей.

### 1.2. Контейнер учасників зустрічі («In call»)
Усі учасники, які зараз перебувають у дзвінку, згруповані у спеціальному контейнері з атрибутом `role="region"`:
```html
<span class="GWjh7b" role="region" aria-label="In call">
  <!-- Список рядків учасників та їхніх презентацій -->
</span>
```
* **Локалізовані селектори:**
  * Англійська: `[aria-label="In call"]`
  * Українська: `[aria-label*="дзвінк" i]`, `[aria-label*="виклику" i]`
  * Російська: `[aria-label*="вызов" i]`

---

## 2. Структура рядків: Учень vs Презентація учня

Коли учень поширює свій екран, у списку `In call` для нього створюється **два незалежних рядки**:

### Рядок 1: Профіль учня (камера / мікрофон)
* **Текст:** `Bohdan Rubakha`
* **Кнопки:**
  * `Mute Bohdan Rubakha's microphone` (Вимкнути мікрофон)
  * `More actions` (Додаткові дії)

### Рядок 2: Демонстрація екрана учня
* **Текст:** `Bohdan Rubakha's presentation` (або `Презентація користувача Bohdan Rubakha`)
* **Кнопки:**
  * `Mute Bohdan Rubakha's presentation` (Вимкнути звук трансляції)
  * `More actions` (іконка `more_vert`)

> ⚠️ **Зверніть увагу:** У рядку презентації **немає прямої кнопки Pin** за замовчуванням! Кнопка закріплення знаходиться всередині спливаючого меню **`More actions`**.

---

## 3. Механізм закріплення через меню `More actions`

### 3.1. Кнопка «More actions»
* **Селектор:**
  * `button[aria-label*="More" i]`, `button[aria-label*="дії" i]`, `button[aria-label*="більше" i]`
  * Або елемент з Material Icon: `text === 'more_vert'` чи `aria-label*="more_vert"`

### 3.2. Спливаюче меню (Dropdown Menu)
Після кліку на `More actions` на сторінці динамічно монтується меню:
```text
Пункти меню:
1. 'keepPin to screen' (або 'Закріпити на екрані' / 'Закрепить на экране')
2. "videocam_offDon't watch" (Не дивитися)
3. 'remove_circle_outlineRemove from the call' (Видалити з дзвінка)
```
* **Текст кнопки закріплення:** `keepPin to screen` (назва іконки `keep` конкатенується перед словом `Pin`).
* **Селектор пункту закріплення:**
  ```javascript
  const pinOption = menuItems.find(m => {
    const t = (m.textContent || '').toLowerCase();
    const a = (m.getAttribute('aria-label') || '').toLowerCase();
    return (t.includes('pin') || t.includes('закріп') || t.includes('keep')) &&
           !t.includes('unpin') && !t.includes('відкріп');
  });
  ```

### 3.3. Діалогове вікно хоста/організатора («Лише для мене»)
Оскільки вчитель є організатором дзвінка, після натискання `Pin` Google Meet відкриває підтвердження:
* `For myself only` / `Лише для мене`
* `For everyone` / `Для всіх`

> 🛡️ **Правило безпеки:** MeetSwitcher **завжди** вибирає `For myself only`, щоб не перемикати екран іншим учням класу.

---

## 4. Оверлеї центральної сцени (Center Stage Overlays)

Коли презентація закріплена по центру (або транслюється екран вчителя):
1. **Панель масштабування (Zoom Overlay):**
   * Елементи: `Zoom in`, `Zoom out`, `100% Current zoom level`, `Enter Full Screen`.
   * **Пастка:** Якщо не фільтрувати `%` та `zoom`, детектор може прийняти `100%Current zoom level` за ім'я учасника і створити фантомний слот.
   * **Фільтрація:** У `isValidParticipantName` відхиляються всі назви з `%`, `zoom`, `масштаб`, `рівень масштабу`.
2. **Власний екран вчителя:**
   * Містить кнопку «Зупинити показ» / `Stop presenting`.
   * Плитки з кнопкою «Зупинити показ» або бейджем «Ваша презентація» автоматично ігноруються методом `isTeacherPresentationTile()`, щоб слот вчителя не займав цифрові клавіші `Alt + 1..9`.

---

## 5. Довідкові діагностичні скрипти для DevTools

### Перевірка структури бічної панелі:
```javascript
(() => {
  const inCall = document.querySelector('[aria-label="In call"], [aria-label*="дзвінк" i], aside[aria-label*="Side panel" i]') || document.body;
  const allBtns = Array.from(inCall.querySelectorAll('button, [role="button"]'));
  console.log("Кнопок у списку учасників:", allBtns.length);
  allBtns.forEach((b, i) => console.log(`${i + 1}. [${b.tagName}] "${b.getAttribute('aria-label') || b.textContent?.trim()}"`));
})();
```

### Тестове закріплення презентації в прямому ефірі:
У розширенні MeetSwitcher вбудовано команду:
```javascript
testPinParticipant("Ім'я учня")
```
Або швидкий огляд панелі:
```javascript
testPeoplePanel()
```
