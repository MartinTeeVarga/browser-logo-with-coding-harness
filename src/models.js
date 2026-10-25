// The SDK's live catalog uses named rate keys inside `costs`. Older API
// examples use `cost.input`/`cost.output`. Both declare currency and token units.
export function modelCost(model) {
  if (model.cost) return model.cost;
  const costs = model.costs;
  if (!costs || typeof model.input_cost_key !== 'string' || typeof model.output_cost_key !== 'string') return null;
  return {
    currency: model.costs_currency,
    tokens: costs.tokens,
    input: costs[model.input_cost_key],
    output: costs[model.output_cost_key]
  };
}

// Puter reports token prices in USD cents for cost.tokens tokens.
// Compare the same workload for every model: 1M input + 1M output tokens.
export function modelPricing(cost) {
  if (!cost || cost.currency !== 'usd-cents' || !Number.isFinite(cost.tokens) || cost.tokens <= 0 ||
      !Number.isFinite(cost.input) || cost.input < 0 || !Number.isFinite(cost.output) || cost.output < 0) {
    return {band: '?', description: 'Price unavailable'};
  }
  const scale = 1000000 / cost.tokens / 100;
  const input = cost.input * scale;
  const output = cost.output * scale;
  if (!Number.isFinite(input + output)) return {band: '?', description: 'Price unavailable'};
  const total = input + output;
  const band = total <= 2 ? '$' : total <= 15 ? '$$' : '$$$';
  const money = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:4}).format(value);
  return {band, description: total === 0 ? 'Free at the listed token rate' : `${money(input)} input / ${money(output)} output per 1M tokens`};
}

export function normalizeModels(catalog) {
  if (!Array.isArray(catalog)) throw new Error('Puter returned an invalid model catalog.');
  const models = new Map();
  for (const entry of catalog) {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 512) continue;
    const id = entry.id.trim();
    if (models.has(id)) continue;
    models.set(id, {
      id,
      aliases: Array.isArray(entry.aliases) ? entry.aliases.filter(alias => typeof alias === 'string' && alias.length <= 512) : [],
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.slice(0, 200) : id,
      provider: typeof entry.provider === 'string' ? entry.provider.slice(0, 100) : '',
      maxTokens: Number.isSafeInteger(entry.max_tokens) && entry.max_tokens > 0 ? entry.max_tokens : 12000,
      pricing: modelPricing(modelCost(entry))
    });
  }
  if (!models.size) throw new Error('Puter returned no available chat models. Try again.');
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// Current families reviewed against Puter's live catalog on 2026-10-25.
// Keep this explicit: these are recent families, not a Logo quality rating.
// New generations stay available in All until this list is reviewed.
const LATEST_FAMILIES = [
  'gpt-6', 'gpt-6.1',
  'claude-opus-5-5', 'claude-opus-5.5',
  'claude-sonnet-5-5', 'claude-sonnet-5.5',
  'claude-haiku-5-5', 'claude-haiku-5.5',
  'claude-fable-5-1', 'claude-fable-5.1',
  'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro',
  'mistral-large-4', 'mistral-medium-2604', 'mistral-medium-3-5', 'mistral-medium-3.5',
  'mistral-small-2603', 'devstral-2512',
  'grok-4.7', 'deepseek-v4.1-flash', 'deepseek-v4-1-flash', 'deepseek-v4-pro',
  'kimi-k3', 'kimi-k3.1'
];
const latestPatterns = LATEST_FAMILIES.map(family =>
  new RegExp('(?:^|[/:])' + family.replaceAll('.', '\\.') + '(?:$|[-:])', 'i')
);

export function isLatestModel(model) {
  const names = [model.id, ...(model.aliases || [])];
  return names.some(name => latestPatterns.some(pattern => pattern.test(name)));
}
