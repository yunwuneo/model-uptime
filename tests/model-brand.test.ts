import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  brandLabels,
  iconOptions,
  inferModelBrand,
  resolveModelBrand,
} from '../shared/model-brand.js';
import { Store } from '../server/store.js';
import { fixture } from './fixtures.js';
import type { ModelBrand } from '../shared/types.js';

test('model family detection supports aliases, casing, qualified IDs and non-chat endpoints', () => {
  const cases: [string, ModelBrand][] = [
    ['GPT 5.6 Sol', 'openai'],
    ['neoai/gpt-5.6-sol', 'openai'],
    ['CHATGPT-4o-latest', 'openai'],
    ['o1', 'openai'],
    ['o3-mini', 'openai'],
    ['o4-mini', 'openai'],
    ['text-embedding-3-small', 'openai'],
    ['gpt-image-1', 'openai'],
    ['dall-e-3', 'openai'],
    ['gemini-2.5-pro', 'google'],
    ['models/gemini-2.5-flash', 'google'],
    ['google/gemma-3-27b-it', 'google'],
    ['imagen-3.0', 'google'],
    ['openai/grok-4', 'xai'],
    ['Grok 3 Mini', 'xai'],
    ['anthropic/claude-sonnet-4', 'anthropic'],
    ['Claude Opus', 'anthropic'],
    ['deepseek-ai/DeepSeek-R1', 'deepseek'],
    ['qwen3-32b', 'qwen'],
    ['QwQ-32B', 'qwen'],
    ['meta-llama/Llama-4', 'meta'],
    ['mixtral-8x7b', 'mistral'],
    ['codestral-latest', 'mistral'],
    ['kimi-k2', 'moonshot'],
    ['moonshot-v1-8k', 'moonshot'],
    ['doubao-seed-1.6', 'doubao'],
    ['seedream-4.0', 'doubao'],
    ['glm-4.5', 'zhipu'],
    ['MiniMax-M2', 'minimax'],
    ['ernie-4.5', 'baidu'],
    ['通义千问', 'qwen'],
    ['文心一言', 'baidu'],
  ];
  for (const [model, brand] of cases) assert.equal(inferModelBrand(model), brand, model);
});

test('model ID wins over display name; unknown models stay neutral and manual choice wins', () => {
  assert.equal(inferModelBrand('grok-4', 'GPT 主渠道'), 'xai');
  assert.equal(inferModelBrand('custom-deployment', 'GPT 5.6 Sol'), 'openai');
  for (const model of ['unknown-model', 'mygptproxy', 'claudette', 'o123', 'geminify'])
    assert.equal(inferModelBrand(model, 'NeoAI'), 'generic', model);
  assert.equal(resolveModelBrand('claude-sonnet-4', 'Claude', 'xai'), 'xai');
  assert.equal(resolveModelBrand('gpt-5', '', 'generic'), 'generic');
  assert.equal(resolveModelBrand('claude-sonnet-4', '', 'auto'), 'anthropic');
  for (const icon of iconOptions) if (icon !== 'auto') assert.ok(brandLabels[icon]);
});

test('existing monitors without an icon remain compatible and manual preferences survive reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lumen-icon-test-'));
  let store = new Store(directory);
  try {
    const { icon: _icon, ...legacy } = fixture();
    store.db.prepare('INSERT INTO monitors VALUES (?, ?)').run(legacy.id, JSON.stringify(legacy));
    assert.equal(store.monitor(legacy.id)?.icon, 'auto');
    store.saveMonitor({ ...store.monitor(legacy.id)!, icon: 'anthropic' });
    store.close();
    store = new Store(directory);
    assert.equal(store.monitor(legacy.id)?.icon, 'anthropic');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
