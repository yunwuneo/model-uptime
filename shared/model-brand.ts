import type { IconPreference, ModelBrand } from './types.js';

export const iconOptions = [
  'auto',
  'openai',
  'google',
  'xai',
  'anthropic',
  'deepseek',
  'meta',
  'mistral',
  'qwen',
  'moonshot',
  'doubao',
  'zhipu',
  'minimax',
  'baidu',
  'generic',
] as const satisfies readonly IconPreference[];

export const brandLabels: Record<ModelBrand, string> = {
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  meta: 'Meta',
  mistral: 'Mistral',
  qwen: '通义千问',
  moonshot: 'Moonshot / Kimi',
  doubao: '豆包',
  zhipu: '智谱',
  minimax: 'MiniMax',
  baidu: '百度 / 文心',
  generic: '通用图标',
};

// Protocol is deliberately excluded: an OpenAI-compatible proxy can serve any brand.
// Match complete family names, including qualified IDs and common punctuation aliases.
const families: [ModelBrand, RegExp][] = [
  ['anthropic', /(?:^|[^a-z0-9])(?:claude|anthropic)(?=$|[^a-z]|\d)/i],
  ['google', /(?:^|[^a-z0-9])(?:gemini|gemma|imagen|veo|google)(?=$|[^a-z]|\d)/i],
  ['xai', /(?:^|[^a-z0-9])(?:grok|xai|x-ai)(?=$|[^a-z]|\d)/i],
  ['deepseek', /(?:^|[^a-z0-9])deepseek(?=$|[^a-z]|\d)/i],
  ['qwen', /(?:^|[^a-z0-9])(?:qwen|qwq|qvq)(?=$|[^a-z]|\d)|通义|千问/i],
  ['meta', /(?:^|[^a-z0-9])(?:llama|meta)(?=$|[^a-z]|\d)/i],
  [
    'mistral',
    /(?:^|[^a-z0-9])(?:mistral|mixtral|codestral|pixtral|ministral|magistral|devstral|voxtral)(?=$|[^a-z]|\d)/i,
  ],
  ['moonshot', /(?:^|[^a-z0-9])(?:moonshot|kimi)(?=$|[^a-z]|\d)|月之暗面/i],
  ['doubao', /(?:^|[^a-z0-9])(?:doubao|seed|seedream|seedance)(?=$|[^a-z]|\d)|豆包/i],
  ['zhipu', /(?:^|[^a-z0-9])(?:glm|chatglm|zhipu|cogview)(?=$|[^a-z]|\d)|智谱/i],
  ['minimax', /(?:^|[^a-z0-9])(?:minimax|abab|hailuo)(?=$|[^a-z]|\d)|海螺/i],
  ['baidu', /(?:^|[^a-z0-9])(?:ernie|baidu)(?=$|[^a-z]|\d)|文心/i],
  [
    'openai',
    /(?:^|[^a-z0-9])(?:gpt|chatgpt|openai|o[134](?=$|[^a-z0-9])|text-embedding|text-davinci|dall[ -]?e|sora|whisper|tts)(?=$|[^a-z]|\d)/i,
  ],
];

export function inferModelBrand(model: string, name = ''): ModelBrand {
  for (const value of [model, name]) {
    const match = families.find(([, pattern]) => pattern.test(value));
    if (match) return match[0];
  }
  return 'generic';
}

export function resolveModelBrand(
  model: string,
  name = '',
  icon: IconPreference = 'auto',
): ModelBrand {
  return icon === 'auto' ? inferModelBrand(model, name) : icon;
}
