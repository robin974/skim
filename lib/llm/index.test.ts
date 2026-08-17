import { describe, it, expect } from 'vitest';
import { getProvider, PROVIDERS } from './index';
import type { ProviderId } from './types';

const ALL_IDS: ProviderId[] = [
  'openrouter', 'openai', 'deepseek', 'anthropic', 'gemini', 'opencode-go', 'custom',
];

describe('provider registry', () => {
  it('getProvider returns every known provider', () => {
    for (const id of ALL_IDS) {
      const provider = getProvider(id);
      expect(provider).toBeDefined();
      expect(provider.id).toBe(id);
    }
  });

  it('PROVIDERS covers exactly the seven known providers', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([...ALL_IDS].sort());
  });

  it('every provider offered in the options page can list its models', () => {
    // The model dropdown replaced a free-text field: a provider without a
    // modelCatalog would show nothing there. `custom` is excluded — it is not
    // offered in the options page.
    for (const provider of Object.values(PROVIDERS)) {
      if (provider.id === 'custom') continue;
      expect(provider.modelCatalog, provider.id).toBeDefined();
    }
  });
});
