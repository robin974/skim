import { describe, it, expect } from 'vitest';
import { ERROR_PLANS, resolvePanelErrorActions } from './panel-errors';
import type { PanelErrorContext } from './panel-errors';

const summary: PanelErrorContext = { target: 'summary', canRetry: true, alternate: null };

describe('resolvePanelErrorActions — never a button that would not go through', () => {
  it("`invalid-key` offers the in-place repair, then the settings as fallback", () => {
    expect(resolvePanelErrorActions('invalid-key', summary)).toEqual([
      { kind: 'fix-key' },
      { kind: 'open-settings', tab: 'providers' },
    ]);
  });

  // Replacing one error with another is not a repair: with no other configured
  // provider, the switch is not offered at all.
  it('`quota` offers the switch only when another provider has a key', () => {
    expect(resolvePanelErrorActions('quota', summary)).toEqual([
      { kind: 'open-settings', tab: 'providers' },
    ]);
    expect(resolvePanelErrorActions('quota', { ...summary, alternate: 'gemini' })).toEqual([
      { kind: 'switch-provider', provider: 'gemini' },
      { kind: 'open-settings', tab: 'providers' },
    ]);
  });

  it('offers no retry with no identified video: there would be nothing to restart', () => {
    expect(resolvePanelErrorActions('transcript-unavailable', summary)).toEqual([{ kind: 'retry' }]);
    expect(resolvePanelErrorActions('transcript-unavailable', { ...summary, canRetry: false })).toEqual([]);
  });

  // Retrying would give exactly the same answer: a private video stays private,
  // and an over-long one stays over-long.
  it('offers nothing for definitive failures', () => {
    expect(resolvePanelErrorActions('not-public', summary)).toEqual([]);
    expect(resolvePanelErrorActions('too-long', summary)).toEqual([]);
  });

  // On a follow-up answer, retry would mean asking the question again, which the
  // panel cannot replay. No button beats a button that does something other than
  // what it says.
  it("a follow-up answer only ever gets the settings link", () => {
    for (const code of Object.keys(ERROR_PLANS) as (keyof typeof ERROR_PLANS)[]) {
      const actions = resolvePanelErrorActions(code, { target: 'answer', canRetry: true, alternate: 'gemini' });
      expect(actions.every((a) => a.kind === 'open-settings'), code).toBe(true);
    }
  });

  it('always targets the tab of the setting at fault, never the bare page', () => {
    const actions = resolvePanelErrorActions('no-key', summary);
    expect(actions).toEqual([{ kind: 'open-settings', tab: 'providers' }]);
  });
});

describe('ERROR_PLANS', () => {
  // `Record<ErrorCode, …>` already proves exhaustiveness at compile time. This
  // catches what typing cannot see: a plan listing the same gesture twice.
  it("never lists the same gesture twice", () => {
    for (const [code, plan] of Object.entries(ERROR_PLANS)) {
      expect(new Set(plan.actions).size, code).toBe(plan.actions.length);
    }
  });

  it("reserves the key repair for the key error alone", () => {
    for (const [code, plan] of Object.entries(ERROR_PLANS)) {
      if (plan.actions.includes('fix-key')) expect(code).toBe('invalid-key');
      if (plan.actions.includes('switch-provider')) expect(code).toBe('quota');
    }
  });
});
