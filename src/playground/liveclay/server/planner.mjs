import { FORMS, COLOR_SPACE, MOTIONS, RELATIONS, SHAPE_DETAILS, EMPTY_WORLD, MAX_ENTITIES } from '../shared/scene.mjs';
import { callJev } from './jev.mjs';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
export function candidatesFromText(text) {
  const words = [...segmenter.segment(text)].filter((x) => x.isWordLike);
  const result = new Set();
  // Recall-oriented span enumeration; semantic entity decisions belong to JEV.
  for (const word of words) {
    result.add(word.segment);
    if (/^[\p{Script=Han}]{2,}$/u.test(word.segment)) {
      const stem = word.segment.replace(/(?:上面|下面|旁边|里面|前面|后面|上|下|里|中|旁)$/u, '');
      if (stem) result.add(stem);
    }
  }
  for (let width = 2; width <= 3; width++) {
    for (let i = 0; i + width <= words.length; i++) {
      const start = words[i].index;
      const last = words[i + width - 1];
      const span = text.slice(start, last.index + last.segment.length);
      if (span.length <= 28 && !/[，。！？；,;.!?\n]/u.test(span)) result.add(span);
    }
  }
  return [...result].slice(0, 160);
}

export function extractionQuestions(candidates) {
  return Object.fromEntries(candidates.map((span, i) => [`n${i}`, {
    type: 'choice',
    instructions: `Classify exactly this text span: «${span}». Is the WHOLE span a complete noun naming one drawable thing, landform, material, or weather in the scene?`,
    criteria: {
      entity: 'A complete noun for a present entity. 完整事物名词，例如小猫、农夫、山、海。',
      fragment: 'Not a complete noun: a verb, adjective, quantity, preposition, location (山上), incomplete compound, or phrase with actions. 动词、量词、方位词或不完整名词。',
      absent: 'This thing is explicitly negated or removed from the scene. 否定、删除的东西。',
    },
  }]));
}

export function extractEntities(candidates, answers) {
  const selected = candidates.map((label, i) => ({ label, probability: answers[`n${i}`]?.probabilities?.entity ?? 0, choice: answers[`n${i}`]?.choice }))
    .filter((e) => e.choice === 'entity' && e.probability >= 0.6);
  return selected.filter((e) => !selected.some((o) => o !== e && e.label.includes(o.label) && e.label.length > o.label.length))
    .slice(0, MAX_ENTITIES).map((e, i) => ({ ...e, id: `e${i}` }));
}
const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
export function worldQuestions(entities) {
  const questions = {
    mood: choice('What is the explicitly described time or lighting of the whole scene? Default to day.', { day: 'Daytime, or not specified / 白天或未指定', sunset: 'Sunrise or sunset, golden hour / 日出、日落', night: 'Night or outer space / 夜晚或太空' }),
  };
  for (const e of entities) {
    const focus = `For the entity «${e.label}» in the scene description. `;
    const edges = { none: 'No explicit relationship involving this entity is described.' };
    for (const o of entities.filter((o) => o.id !== e.id)) {
      const a = `«${e.label}»`, b = `«${o.label}»`;
      const statements = {
        above: `${a} is ABOVE ${b}. ${a}在${b}上方。`, below: `${a} is BELOW ${b}. ${a}在${b}下方。`,
        left: `${a} is LEFT of ${b}.`, right: `${a} is RIGHT of ${b}.`, behind: `${a} is BEHIND ${b}.`, front: `${a} is IN FRONT of ${b}.`,
        on: `${a} rests ON TOP OF ${b}.`, inside: `${a} is INSIDE ${b}.`, near: `${a} is BESIDE ${b}.`,
        eating: `${a} is EATING ${b}. ${a}吃${b}。`, eaten_by: `${a} is BEING EATEN BY ${b}. ${a}被${b}吃。`,
        chasing: `${a} is CHASING ${b}.`, orbiting: `${a} ORBITS AROUND ${b}.`,
        rising: `${a} RISES from behind ${b}. ${a}从${b}后面升起。`, rise_origin: `${b} RISES from behind ${a}. ${a}是${b}升起的背景。`,
        crossing: `${a} CROSSES or SPANS ${b}.`,
      };
      for (const [relation, statement] of Object.entries(statements)) edges[`${relation}:${o.id}`] = statement;
    }
    questions[`${e.id}_form`] = choice(focus + 'Choose its visual form. For unlisted nouns select the closest generic geometric abstraction, not an unrelated named object.', FORMS);
    questions[`${e.id}_color`] = choice(focus + 'Which color is explicitly requested for THIS entity? Do not copy another object’s color. Default natural.', COLOR_SPACE);
    questions[`${e.id}_motion`] = choice(focus + 'What motion does THIS entity perform? A fish being eaten is not itself eating. Default still.', MOTIONS);
    questions[`${e.id}_edge`] = choice('Which complete statement is explicitly supported by the description? Preserve WHO DOES WHAT TO WHOM. For 猫吃鱼, 鱼 is eaten_by 猫, not eating 猫. Prefer action relationships to implied proximity. Choose none if no statement matches.', edges);
    questions[`${e.id}_scale`] = choice(focus + 'What relative size is explicitly requested? Default normal. Species names like 小猫 alone are normal size.', { tiny: 'tiny, miniature / 微小、迷你', normal: 'normal or unspecified / 普通或未指定', large: 'large, huge, giant / 巨大、大大的' });
    questions[`${e.id}_detail`] = choice(focus + 'Which additional characteristic is essential to identify this object and explicitly stated or inherent in it? Choose plain unless it needs an extra feature.', SHAPE_DETAILS);
    questions[`${e.id}_count`] = choice(focus + 'Is this entity described as one, a pair, or a group? Default one.', { one: 'one or unspecified / 一或未指定', two: 'two or a pair / 两个、一对', many: 'a group, several, many / 一群、许多' });
  }
  return questions;
}
export function worldFromAnswers(entities, answers) {
  const field = (id, key) => answers[`${id}_${key}`].choice;
  return {
    mood: answers.mood.choice,
    abstract: entities.some((e) => ['sphere', 'box', 'cone', 'cylinder', 'ribbon', 'ring', 'creature'].includes(field(e.id, 'form'))),
    entities: entities.map((e) => ({
      id: e.id, label: e.label, form: field(e.id, 'form'), color: field(e.id, 'color'), motion: field(e.id, 'motion'),
      target: field(e.id, 'edge').split(':')[1] ?? 'none', relation: field(e.id, 'edge').split(':')[0], scale: field(e.id, 'scale'), detail: field(e.id, 'detail'), count: field(e.id, 'count'),
      confidence: e.probability, formConfidence: answers[`${e.id}_form`].confidence, alternatives: answers[`${e.id}_form`].probabilities,
    })),
  };
}
export async function planWorld(text, signal, emit = () => {}) {
  if (!text.trim()) return { world: EMPTY_WORLD, meta: { calls: 0, latencyMs: 0, model: 'jev-1.13.0' } };
  const started = performance.now();
  const candidates = candidatesFromText(text);
  if (!candidates.length) return { world: EMPTY_WORLD, meta: { calls: 0, latencyMs: 0, model: 'jev-1.13.0' } };
  const first = await callJev(text, extractionQuestions(candidates), signal);
  const entities = extractEntities(candidates, first.answers);
  emit({ type: 'entities', labels: entities.map((e) => e.label), candidates: candidates.length });
  if (!entities.length) return { world: EMPTY_WORLD, meta: { calls: 1, latencyMs: Math.round(performance.now() - started), model: first.model, candidates: candidates.length, questions: candidates.length, usage: first.usage } };
  const questions = worldQuestions(entities);
  const second = await callJev(text, questions, signal);
  return {
    world: worldFromAnswers(entities, second.answers),
    meta: { calls: 2, latencyMs: Math.round(performance.now() - started), model: second.model, candidates: candidates.length, questions: candidates.length + Object.keys(questions).length, choices: second.choices, usage: { input_tokens: first.usage.input_tokens + second.usage.input_tokens, output_tokens: first.usage.output_tokens + second.usage.output_tokens } },
  };
}
