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
  'Walter White': {
    ukName: 'Волтер Вайт',
    ruName: 'Уолтер Уайт',
    city: 'Альбукерке, Нью-Мексико',
    ukDesc: 'вчитель хімії',
    ruDesc: 'учитель химии',
    img: '/characters/walter.jpg',
  },
  'Jesse Pinkman': {
    ukName: 'Джессі Пінкман',
    ruName: 'Джесси Пинкман',
    city: 'Альбукерке, Нью-Мексико',
    ukDesc: 'вуличний хімік',
    ruDesc: 'уличный химик',
    img: '/characters/jesse.jpg',
  },
  'Saul Goodman': {
    ukName: 'Сол Гудман',
    ruName: 'Сол Гудман',
    city: 'Альбукерке, Нью-Мексико',
    ukDesc: 'адвокат',
    ruDesc: 'адвокат',
    img: '/characters/saul.jpg',
  },
  'Skyler White': {
    ukName: 'Скайлер Вайт',
    ruName: 'Скайлер Уайт',
    city: 'Альбукерке, Нью-Мексико',
    ukDesc: 'бухгалтер',
    ruDesc: 'бухгалтер',
    img: '/characters/skyler.jpg',
  },
  'Hank Schrader': {
    ukName: 'Генк Шрейдер',
    ruName: 'Хэнк Шрейдер',
    city: 'Альбукерке, Нью-Мексико',
    ukDesc: 'агент DEA',
    ruDesc: 'агент DEA',
    img: '/characters/hank.jpg',
  },
  'Mike Ehrmantraut': {
    ukName: 'Майк Ерментраут',
    ruName: 'Майк Эрмантраут',
    city: 'Філадельфія',
    ukDesc: 'вирішувач проблем',
    ruDesc: 'решатель проблем',
    img: '/characters/mike.jpg',
  },
  'Gustavo Fring': {
    ukName: 'Густаво Фрінг',
    ruName: 'Густаво Фринг',
    city: 'Сантьяго, Чилі',
    ukDesc: 'власник Pollos Hermanos',
    ruDesc: 'владелец Pollos Hermanos',
    img: '/characters/gus.jpg',
  },
  'Jane Margolis': {
    ukName: 'Джейн Марголіс',
    ruName: 'Джейн Марголис',
    city: 'Альбукерке, Нью-Мексико',
    ukDesc: 'художниця',
    ruDesc: 'художница',
    img: '/characters/jane.jpg',
  },
  'Todd Alquist': {
    ukName: 'Тодд Олквіст',
    ruName: 'Тодд Олквист',
    city: 'Альбукерке, Нью-Мексико',
    ukDesc: 'хімік-самоучка',
    ruDesc: 'химик-самоучка',
    img: '/characters/todd.jpg',
  },
  'Tuco Salamanca': {
    ukName: 'Туко Саламанка',
    ruName: 'Туко Саламанка',
    city: 'Альбукерке, Нью-Мексико',
    ukDesc: 'дилер наркотиків',
    ruDesc: 'дилер наркотиков',
    img: '/characters/tuco.jpg',
  },
  'Gale Boetticher': {
    ukName: 'Ґейл Беттікер',
    ruName: 'Гейл Беттикер',
    city: 'Альбукерке, Нью-Мексико',
    ukDesc: 'хімік-лаборант',
    ruDesc: 'химик-лаборант',
    img: '/characters/gale.jpg',
  },
  'Walter White Jr.': {
    ukName: 'Волтер Вайт-молодший',
    ruName: 'Уолтер Уайт-младший',
    city: 'Альбукерке, Нью-Мексико',
    ukDesc: 'син Волтера Вайта',
    ruDesc: 'сын Уолтера Уайта',
    img: '/characters/flynn.jpg',
  },
}

// Some questions.json entries use non-canonical character names.
// Add aliases here rather than touching the JSON data.
const ALIASES = {
  'Flynn': 'Walter White Jr.',
}

/**
 * Look up a character by name (or alias).
 * Returns the CHARACTERS entry, or null if not found.
 * @param {string} name  — value of question.character from questions.json
 */
export function resolveCharacter(name) {
  if (!name) return null
  const key = ALIASES[name] ?? name
  return CHARACTERS[key] ?? null
}
