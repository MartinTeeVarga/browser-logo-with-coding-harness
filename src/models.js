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
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.slice(0, 200) : id,
      provider: typeof entry.provider === 'string' ? entry.provider.slice(0, 100) : '',
      maxTokens: Number.isSafeInteger(entry.max_tokens) && entry.max_tokens > 0 ? entry.max_tokens : 12000,
      pricing: modelPricing(entry.cost)
    });
  }
  if (!models.size) throw new Error('Puter returned no available chat models. Try again.');
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
