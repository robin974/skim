import { describe, it, expect } from 'vitest';
import { closesPanelOf } from './panel-toggle';
import type { ClosePanelEvent, PanelBroadcast } from './messages';

const click = (windowId: number): ClosePanelEvent => ({ type: 'CLOSE_PANEL', windowId });

describe('closesPanelOf', () => {
  it('closes the panel of the window whose icon was clicked', () => {
    expect(closesPanelOf(click(4), 4)).toBe(true);
  });

  it('leaves the panels of the other windows alone', () => {
    expect(closesPanelOf(click(4), 9)).toBe(false);
  });

  // The panel reads its window at mount: until it answers, a click on another
  // window's icon must not take this panel with it. And the panel a click just
  // opened is in exactly that state, which keeps it from closing on the request
  // that opened it.
  it('closes nothing while the panel does not know its window', () => {
    expect(closesPanelOf(click(4), null)).toBe(false);
  });

  it('ignores everything else the service worker broadcasts', () => {
    const others: PanelBroadcast[] = [
      { type: 'STATE', videoId: 'v1', target: { kind: 'summary' }, status: 'done' },
      { type: 'CHUNK', videoId: 'v1', target: { kind: 'summary' }, text: 'x' },
      { type: 'RESTORE', videoId: 'v1' },
    ];
    for (const msg of others) expect(closesPanelOf(msg, 4)).toBe(false);
  });

  it('ignores anything that is not a message', () => {
    for (const msg of [null, undefined, 'CLOSE_PANEL', 4, { windowId: 4 }]) {
      expect(closesPanelOf(msg, 4)).toBe(false);
    }
  });
});
