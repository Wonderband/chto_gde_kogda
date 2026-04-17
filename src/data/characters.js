/**
 * src/data/characters.js — Single source of truth for all Breaking Bad character metadata.
 *
 * Used by:
 *   - src/components/QuestionCard.jsx  (UI display: img, city, Ukrainian desc)
 *   - src/services/openai.js           (read script builder: localized name, city, desc)
 *
 * To add a new character: add one entry here. Nothing else needs updating.
 * To add a name alias (e.g. nickname used in questions.json): add to ALIASES below.
 */

export const CHARACTERS = {
  "Walter White": {
    ukName: "Волтер Вайт",
    ruName: "Уолтер Уайт",
    city: "Альбукерке, Нью-Мексико",
    ukDesc: "вчитель хімії",
    ruDesc: "учитель химии",
    ukIntro:
      "геніальний хімік і колишній учитель, який збудував власну імперію.",
    ruIntro:
      "гениальный химик и бывший учитель, который построил собственную империю.",
    img: "/characters/walter.jpg",
  },
  "Jesse Pinkman": {
    ukName: "Джессі Пінкман",
    ruName: "Джесси Пинкман",
    city: "Альбукерке, Нью-Мексико",
    ukDesc: "вуличний хімік",
    ruDesc: "уличный химик",
    ukIntro: "емоційний, вибуховий, але здатний на дуже неочікувані ходи.",
    ruIntro:
      "эмоциональный, взрывной, но способный на очень точные и неожиданные ходы.",
    img: "/characters/jesse.jpg",
  },
  "Saul Goodman": {
    ukName: "Сол Гудман",
    ruName: "Сол Гудман",
    city: "Альбукерке, Нью-Мексико",
    ukDesc: "адвокат",
    ruDesc: "адвокат",
    ukIntro: "адвокат, який завжди знайде вихід навіть там, де його немає.",
    ruIntro:
      "адвокат, который всегда найдет выход даже там, где его почти нет.",
    img: "/characters/saul.jpg",
  },
  "Skyler White": {
    ukName: "Скайлер Вайт",
    ruName: "Скайлер Уайт",
    city: "Альбукерке, Нью-Мексико",
    ukDesc: "бухгалтер",
    ruDesc: "бухгалтер",
    ukIntro:
      "жінка, яка намагається зберегти сім’ю, але в результаті стає частиною імперії.",
    ruIntro: "человек холодного ума, контроля и очень точного расчета.",
    img: "/characters/skyler.jpg",
  },
  "Hank Schrader": {
    ukName: "Генк Шрейдер",
    ruName: "Хэнк Шрейдер",
    city: "Альбукерке, Нью-Мексико",
    ukDesc: "агент DEA",
    ruDesc: "агент DEA",
    ukIntro:
      "агент DEA, детектив, який йде по сліду, не зупиняючись ні перед чим.",
    ruIntro: "агент DEA с острым чутьем на ложь, следы и большие дела.",
    img: "/characters/hank.jpg",
  },
  "Mike Ehrmantraut": {
    ukName: "Майк Ерментраут",
    ruName: "Майк Эрмантраут",
    city: "Філадельфія",
    ukDesc: "вирішувач проблем",
    ruDesc: "решатель проблем",
    ukIntro:
      "спокійний, відповідальний і небезпечний професіонал без зайвих слів.",
    ruIntro: "спокойный, ответственный и опасный профессионал без лишних слов.",
    img: "/characters/mike.jpg",
  },
  "Gustavo Fring": {
    ukName: "Густаво Фрінг",
    ruName: "Густаво Фринг",
    city: "Сантьяго, Чилі",
    ukDesc: "власник Pollos Hermanos",
    ruDesc: "владелец Pollos Hermanos",
    ukIntro:
      "ввічливий перфекціоніст, за яким ховаються холодний розрахунок і залізна дисципліна.",
    ruIntro:
      "вежливый перфекционист, за которым скрываются холодный расчет и железная дисциплина.",
    img: "/characters/gus.jpg",
  },
  "Jane Margolis": {
    ukName: "Джейн Марголіс",
    ruName: "Джейн Марголис",
    city: "Альбукерке, Нью-Мексико",
    ukDesc: "художниця",
    ruDesc: "художница",
    ukIntro: "тонка, вільна й небезпечна героїня, яка різко змінює чужі долі.",
    ruIntro:
      "тонкая, свободная и опасная героиня, которая резко меняет чужие судьбы.",
    img: "/characters/jane.jpg",
  },
  "Todd Alquist": {
    ukName: "Тодд Олквіст",
    ruName: "Тодд Олквист",
    city: "Альбукерке, Нью-Мексико",
    ukDesc: "хімік-самоучка",
    ruDesc: "химик-самоучка",
    ukIntro:
      "усміхнений виконавець, у якого моторошний спокій замість сумнівів.",
    ruIntro:
      "улыбчивый исполнитель, у которого жуткое спокойствие вместо сомнений.",
    img: "/characters/todd.jpg",
  },
  "Tuco Salamanca": {
    ukName: "Туко Саламанка",
    ruName: "Туко Саламанка",
    city: "Альбукерке, Нью-Мексико",
    ukDesc: "дилер наркотиків",
    ruDesc: "дилер наркотиков",
    ukIntro:
      "вибуховий і непередбачуваний гравець, від якого можна чекати чого завгодно.",
    ruIntro:
      "взрывной и непредсказуемый игрок, от которого можно ждать чего угодно.",
    img: "/characters/tuco.jpg",
  },
  "Gale Boetticher": {
    ukName: "Ґейл Беттікер",
    ruName: "Гейл Беттикер",
    city: "Альбукерке, Нью-Мексико",
    ukDesc: "хімік-лаборант",
    ruDesc: "химик-лаборант",
    ukIntro:
      "інтелігентний хімік, який поєднав лабораторію, каву і любов до поезії.",
    ruIntro:
      "интеллигентный химик, который соединил лабораторию, кофе и любовь к поэзии.",
    img: "/characters/gale.jpg",
  },
  "Walter White Jr.": {
    ukName: "Волтер Вайт-молодший",
    ruName: "Уолтер Уайт-младший",
    city: "Альбукерке, Нью-Мексико",
    ukDesc: "син Волтера Вайта",
    ruDesc: "сын Уолтера Уайта",
    ukIntro: "син Волтера Вайта, відвертий і чесний, який довіряє людям",
    ruIntro:
      "сын Уолтера Уайта, который часто видит людей прямее и честнее других.",
    img: "/characters/flynn.jpg",
  },
};

// Some questions.json entries use non-canonical character names.
// Add aliases here rather than touching the JSON data.
const ALIASES = {
  Flynn: "Walter White Jr.",
};

/**
 * Look up a character by name (or alias).
 * Returns the CHARACTERS entry, or null if not found.
 * @param {string} name  — value of question.character from questions.json
 */
export function resolveCharacter(name) {
  if (!name) return null;
  const key = ALIASES[name] ?? name;
  return CHARACTERS[key] ?? null;
}

export function getCharacterIntro(name, lang = "uk") {
  const character = resolveCharacter(name);
  if (!character) {
    return {
      displayName: name || "",
      intro: "",
    };
  }

  return {
    displayName:
      lang === "ru" ? character.ruName || name : character.ukName || name,
    intro: lang === "ru" ? character.ruIntro || "" : character.ukIntro || "",
  };
}
