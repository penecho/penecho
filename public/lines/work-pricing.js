const WORK_PRICING = (() => {
  function concreteModel(value) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return '';
    const model = value.slice(value.lastIndexOf('/') + 1).trim();
    return /^default$/i.test(model) ? '' : model;
  }
  const modelId = value => concreteModel(value) ? value.trim() : '';
  // Keep the original ID for exact pricing of Works recorded before model names were normalized.
  const modelIdOf = step => modelId(step?.picked?.model) || modelId(step?.tokens?.requestModelId) || modelId(step?.tokens?.requestModel) || modelId(step?.tokens?.lastRequest?.model)
    || (step?.agent === 'dsh' ? modelId(step.resolvedModel) : '') || modelId(step?.selected?.model) || modelId(step?.resolvedModel);
  const modelOf = step => concreteModel(modelIdOf(step));
  function priceModelOf(step) {
    const model = modelIdOf(step), selected = modelId(step?.selected?.model);
    return !model.includes('/') && selected.includes('/') && concreteModel(selected).toLowerCase() === model.toLowerCase() ? selected : model;
  }
  function priceFor(model, prices) {
    const key = concreteModel(model).toLowerCase();
    if (!key) return undefined;
    const exact = model.trim().toLowerCase();
    return prices.find(price => modelId(price?.model).toLowerCase() === exact)
      || prices.find(price => concreteModel(price?.model).toLowerCase() === key);
  }
  function estimate(tokens, price) {
    if (!price || tokens?.inputTokens == null || tokens.outputTokens == null || tokens.coverage === 'unavailable') return null;
    const read = tokens.cacheReadInputTokens || 0, write = tokens.cacheWriteInputTokens || 0;
    const fresh = Math.max(0, tokens.inputTokens - read - write);
    return (fresh * price.input + read * (price.cached ?? price.input) + write * (price.cacheWrite ?? price.input) + tokens.outputTokens * price.output) / 1e6;
  }
  return { concreteModel, modelOf, priceModelOf, priceFor, estimate };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = WORK_PRICING;
