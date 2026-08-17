// Closes a <details> popover when the next click lands somewhere else.
//
// The panel's three menus — provider/model/effort, profile, and the session's
// summaries — are native <details>. The platform gives them their keyboard and
// screen-reader behaviour for free, but not this: a <details> only closes on its
// own summary, so a menu opened by mistake stays open over the content until it
// is clicked again.
import { useEffect, type RefObject } from 'react';

/**
 * Controls that put nothing on top of an open menu, so clicking them dismisses
 * nothing. The settings shortcut leaves for the options page in another tab: the
 * menu it was clicked beside is exactly what the user comes back to.
 */
const KEEPS_MENUS_OPEN = '.settings-shortcut';

/**
 * `pointerdown` rather than `click`: the menu closes as the button goes down,
 * where waiting for the release would leave it open across the whole gesture.
 * It also covers touch and pen with one listener.
 *
 * Sets the DOM property directly instead of asking a React state to change,
 * because two of the three popovers are uncontrolled — the element owns its
 * `open` attribute (see PanelHeader.tsx). The third is controlled and stays in
 * step anyway: closing the element fires `toggle`, and its own handler is what
 * writes the state back.
 */
export function useCloseOnOutsideClick(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current;
      // A click INSIDE is never a dismissal — including on the summary itself,
      // which must keep toggling the popover it owns rather than closing it here
      // and reopening it on the click that follows.
      if (el === null || !el.open) return;
      const target = event.target;
      if (target instanceof Node && el.contains(target)) return;
      if (target instanceof Element && target.closest(KEEPS_MENUS_OPEN) !== null) return;
      el.open = false;
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ref]);
}
