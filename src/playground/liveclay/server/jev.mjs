export function validateAnswers(answers, questions) {
  if (!answers || typeof answers !== 'object') throw new Error('JEV response is missing answers');
  for (const [id, question] of Object.entries(questions)) {
    const a = answers[id];
    if (!a || a.type !== question.type) throw new Error(`Invalid JEV answer: ${id}`);
    if (question.type === 'choice') {
      if (!Object.hasOwn(question.criteria, a.choice)) throw new Error(`Out-of-space answer: ${id}`);
      if (!a.probabilities || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) throw new Error(`Invalid confidence: ${id}`);
      let sum = 0;
      for (const option of Object.keys(question.criteria)) {
        const p = a.probabilities[option];
        if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error(`Invalid probability: ${id}`);
        sum += p;
      }
      if (Math.abs(sum - 1) > 0.06) throw new Error(`Invalid probability sum: ${id}`);
    } else if (question.type === 'noul') {
      if (!Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1) throw new Error(`Invalid noul: ${id}`);
    } else if (!Number.isFinite(a.score) || a.score < 0 || a.score > question.criteria.length - 1) {
      throw new Error(`Invalid score: ${id}`);
    }
  }
  return answers;
}

export async function callJev() {
  throw Object.assign(new Error('Configure a JEV connection in the PenEcho Admin Live Clay pool.'), {status:503});
}
