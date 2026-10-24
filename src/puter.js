import { normalizeModels } from './models.js';

export const MODEL = 'openai/gpt-6-luna';

export function getPuter() {
  if (!globalThis.puter?.ai?.chat || !globalThis.puter?.auth) {
    throw new Error('Puter could not load. Check your connection, allow js.puter.com, then try again.');
  }
  return globalThis.puter;
}

export function connectPuter() {
  // Called directly from the form submit event to preserve popup activation.
  const puter = getPuter();
  return puter.auth.isSignedIn() ? Promise.resolve() : puter.auth.signIn();
}

export async function getRemainingAllowance() {
  const auth = globalThis.puter?.auth;
  // A status read must never open a sign-in/consent popup on its own.
  if (typeof auth?.isSignedIn !== 'function' || !auth.isSignedIn() || typeof auth.getMonthlyUsage !== 'function') return null;
  let timeout;
  try {
    const usage = await Promise.race([
      auth.getMonthlyUsage(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Usage lookup timed out.')), 8000); })
    ]);
    const info = usage?.allowanceInfo;
    if (typeof info?.remaining !== 'number' || !Number.isFinite(info.remaining)) return null;
    return {
      remaining: Math.max(0, info.remaining),
      total: typeof info.monthUsageAllowance === 'number' && Number.isFinite(info.monthUsageAllowance) ? info.monthUsageAllowance : null,
      // The documented legacy API uses microcents; newer responses can
      // explicitly label credit units. Never convert credits into dollars.
      unit: info.unit || usage.unit || 'microcents'
    };
  } finally { clearTimeout(timeout); }
}

export function formatAllowance(allowance) {
  if (!allowance) return null;
  const { remaining, total, unit } = allowance;
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  let amount;
  if (unit === 'microcents') {
    const dollars = remaining / 100000000;
    amount = dollars > 0 && dollars < 0.0001 ? '<$0.0001' : new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: dollars < 1 ? 4 : 2
    }).format(dollars);
  } else {
    amount = `${remaining > 0 && remaining < 0.01 ? '<0.01' : number.format(remaining)} ${unit}`;
  }
  const percent = total > 0 && remaining <= total ? remaining / total * 100 : null;
  const percentText = percent === null ? '' : ` (${percent > 0 && percent < 0.1 ? '<0.1' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(percent)}%)`;
  return `Puter · ${amount} remaining${percentText}`;
}

export async function loadModels() {
  const puter = getPuter();
  if (typeof puter.ai.listModels !== 'function') throw new Error('Puter model listing is unavailable. Reload the page and try again.');
  let timeout;
  try {
    const catalog = await Promise.race([
      puter.ai.listModels(),
      new Promise((_, reject) => {timeout = setTimeout(() => reject(new Error('Model listing timed out. Try again.')), 15000);})
    ]);
    return normalizeModels(catalog);
  } finally {clearTimeout(timeout);}
}

export async function generate(messages, model = MODEL, maxTokens = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Puter took too long to respond. Try again.')), 120000);
  let result;
  try {
    const options = {model, normalize: true, stream: false, max_tokens: Math.min(12000, maxTokens), signal: controller.signal};
    if (model === MODEL) options.reasoning_effort = 'medium';
    result = await getPuter().ai.chat(messages, options);
  } finally { clearTimeout(timeout); }
  if (result?.error) throw result.error;
  if (result?.message?.tool_calls?.length) return ''; // Never execute a tool call.
  if (['length', 'content_filter'].includes(result?.finish_reason)) return '';
  const content = result?.message?.content;
  if (typeof content === 'string') return content;
  // Compatibility with SDK versions that do not normalize older models.
  if (Array.isArray(content)) return content.filter(part => part.type === 'text').map(part => part.text).join('');
  return '';
}

export function providerError(error) {
  const code = String(error?.code || error?.error?.code || error?.error || '');
  const message = String(typeof error === 'string' ? error : error?.message || error?.msg || error?.error?.message || '');
  if (/popup_blocked/.test(code)) return 'Allow the Puter sign-in popup, then send your message again.';
  if (/auth_window_closed|cancel/.test(code + message)) return 'Puter sign-in was cancelled. Send your message when you’re ready.';
  if (/quota|allowance|credit|balance|insufficient|usage.limit|payment|funds/i.test(code + message)) return 'Your Puter AI allowance is unavailable or used up. Check your Puter account, then try again. Your code hasn’t changed.';
  if (/rate|429/.test(code + message)) return 'Puter is receiving too many requests. Wait a moment and try again. Your code hasn’t changed.';
  return message || 'Couldn’t reach Puter. Please try again. Your code hasn’t changed.';
}
