// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  readVideoId, readSegments, readDuration, findTranscriptButton, readVideoMeta, findActionBar,
  findTranscriptPanel, isInCurrentActionBar, readActionButtonMetrics, DEFAULT_ACTION_BUTTON_METRICS, SELECTORS,
  findExpandedTranscriptPanel, findTranscriptCloseButton, isTranscriptControl,
} from './youtube-dom';
import { parseTimestamp } from './transcript';

describe('readVideoId', () => {
  it('reads the v parameter', () => {
    expect(readVideoId('https://www.youtube.com/watch?v=dCEj2XdWEHQ')).toBe('dCEj2XdWEHQ');
  });
  it('lit une URL courte youtu.be', () => {
    expect(readVideoId('https://youtu.be/uRdFqlO12Mk')).toBe('uRdFqlO12Mk');
  });
  it('lit une URL de Short', () => {
    expect(readVideoId('https://www.youtube.com/shorts/abc123')).toBe('abc123');
  });
  it('returns null off a video page', () => {
    expect(readVideoId('https://www.youtube.com/feed/subscriptions')).toBeNull();
  });
});

/** Reproduces the real structure captured on 2026-08-11. */
function mountTranscript(rows: [string, string][]) {
  document.body.innerHTML = rows.map(([t, x]) => `
    <ytd-transcript-segment-renderer>
      <div class="segment-timestamp">${t}</div>
      <yt-formatted-string class="segment-text">${x}</yt-formatted-string>
    </ytd-transcript-segment-renderer>`).join('');
}

describe('readSegments', () => {
  it('extrait timestamp et texte', () => {
    mountTranscript([['0:00', 'Il se passe un truc bizarre dans mon'], ['0:01', 'portefeuille']]);
    expect(readSegments(document)).toEqual([
      { timestamp: '0:00', text: 'Il se passe un truc bizarre dans mon' },
      { timestamp: '0:01', text: 'portefeuille' },
    ]);
  });

  it('renvoie une liste vide sans panneau', () => {
    document.body.innerHTML = '<div>rien</div>';
    expect(readSegments(document)).toEqual([]);
  });

  it('ignore une ligne sans timestamp', () => {
    document.body.innerHTML = `
      <ytd-transcript-segment-renderer>
        <yt-formatted-string class="segment-text">orphelin</yt-formatted-string>
      </ytd-transcript-segment-renderer>`;
    expect(readSegments(document)).toEqual([]);
  });

  it('nettoie les espaces superflus', () => {
    mountTranscript([['  2:30  ', '  du texte  ']]);
    expect(readSegments(document)[0]).toEqual({ timestamp: '2:30', text: 'du texte' });
  });
});

/**
 * Reproduces the EXACT structure captured on 2026-08-11 on the new transcript
 * panel ("view-model", `PAmodern_transcript_view`). The accessibility label
 * (`a11y`) is a SIBLING of the `[role="text"]` span, not a child — exactly as on
 * the measured page.
 */
function mountTranscriptModern(rows: { timestamp: string; a11y: string; text: string }[]) {
  document.body.innerHTML = rows.map(({ timestamp, a11y, text }) => `
    <transcript-segment-view-model class="ytwTranscriptSegmentViewModelHost ytwTranscriptSegmentViewModelHostActive">
      <div aria-hidden="true" class="ytwTranscriptSegmentViewModelTimestamp ytwTranscriptSegmentViewModelTimestampActive">${timestamp}</div>
      <div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">${a11y}</div>
      <span class="ytAttributedStringHost ytAttributedStringLinkInheritColor" role="text">${text}</span>
    </transcript-segment-view-model>`).join('');
}

describe('readSegments — new generation (view-model)', () => {
  // EXACT text captured on 2026-08-11, with its non-breaking spaces (&nbsp; in the source HTML).
  const SAMPLE_TEXT =
    'AI was supposed to kick  off the white collar purge.  But the reality is different.' +
    ' In Fortune 500  boardrooms across the country, thousands of  ';
  const SAMPLE_A11Y = '0 seconde';

  it('extracts timestamp and text, with whitespace normalised', () => {
    mountTranscriptModern([{ timestamp: '0:00', a11y: SAMPLE_A11Y, text: SAMPLE_TEXT }]);
    expect(readSegments(document)).toEqual([
      {
        timestamp: '0:00',
        text:
          'AI was supposed to kick off the white collar purge. But the reality is different. ' +
          'In Fortune 500 boardrooms across the country, thousands of',
      },
    ]);
  });

  it(
    // The accessibility label must NEVER appear in the text sent to the model:
    // it would silently corrupt every transcript line. This proves the test would
    // fail against a naive implementation reading `textContent` off the whole
    // segment instead of the targeted `[role="text"]` span.
    'never injects the accessibility label into the extracted text',
    () => {
      mountTranscriptModern([{ timestamp: '0:00', a11y: SAMPLE_A11Y, text: SAMPLE_TEXT }]);

      const [seg] = readSegments(document);
      expect(seg?.text).not.toContain('seconde');

      // Proof it would fail against the naive implementation: a `textContent`
      // taken on the whole segment does include the label.
      const naiveText = document.querySelector(SELECTORS.segmentModern)?.textContent ?? '';
      expect(naiveText).toContain('seconde');
    },
  );

  it('keeps the old generation working, with unchanged behaviour', () => {
    mountTranscript([['0:00', 'Il se passe un truc bizarre dans mon']]);
    expect(readSegments(document)).toEqual([
      { timestamp: '0:00', text: 'Il se passe un truc bizarre dans mon' },
    ]);
  });

  it('lets the new generation win, with no duplicates, when both are present', () => {
    mountTranscriptModern([{ timestamp: '0:00', a11y: SAMPLE_A11Y, text: SAMPLE_TEXT }]);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<ytd-transcript-segment-renderer>
        <div class="segment-timestamp">0:05</div>
        <yt-formatted-string class="segment-text">ancienne génération</yt-formatted-string>
      </ytd-transcript-segment-renderer>`,
    );

    const segs = readSegments(document);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.timestamp).toBe('0:00');
  });

  it('normalises a non-breaking space in the timestamp for parseTimestamp', () => {
    mountTranscriptModern([{ timestamp: '12 :34', a11y: '', text: 'x' }]);
    const [seg] = readSegments(document);
    expect(seg?.timestamp).not.toContain(' ');
    expect(parseTimestamp(seg?.timestamp ?? '')).toBe(754);
  });
});

describe('readSegments — duplicated panels (SPA) and deduplication', () => {
  it(
    // Production regression: YouTube keeps the previous page's transcript panel
    // hidden in the DOM after an internal navigation, so two
    // `ytd-transcript-renderer` coexist here — the first hidden (stale) with
    // content DIFFERENT from the second, visible (live) one. `readSegments` used
    // to query the whole document, reading both and mixing stale content into
    // live.
    //
    // The two panels' content MUST differ. With identical panels the dedup alone,
    // with no scoping at all, already produces the right result — the stale
    // panel's (timestamp, text) pairs are exact duplicates of the live one's — so
    // this would pass even against an implementation WITHOUT the containment to
    // `findTranscriptPanel` it is meant to check. With distinct content, only real
    // containment to the live panel can produce the expected result.
    'returns only the live panel\'s content when two transcript panels hold DIFFERENT content',
    () => {
      document.body.innerHTML = `
        <ytd-transcript-renderer aria-hidden="true">
          <ytd-transcript-segment-renderer>
            <div class="segment-timestamp">0:00</div>
            <yt-formatted-string class="segment-text">contenu périmé, page précédente</yt-formatted-string>
          </ytd-transcript-segment-renderer>
          <ytd-transcript-segment-renderer>
            <div class="segment-timestamp">0:01</div>
            <yt-formatted-string class="segment-text">ne doit jamais apparaître</yt-formatted-string>
          </ytd-transcript-segment-renderer>
        </ytd-transcript-renderer>
        <ytd-transcript-renderer>
          <ytd-transcript-segment-renderer>
            <div class="segment-timestamp">0:00</div>
            <yt-formatted-string class="segment-text">Il se passe un truc bizarre</yt-formatted-string>
          </ytd-transcript-segment-renderer>
          <ytd-transcript-segment-renderer>
            <div class="segment-timestamp">0:01</div>
            <yt-formatted-string class="segment-text">dans mon portefeuille</yt-formatted-string>
          </ytd-transcript-segment-renderer>
        </ytd-transcript-renderer>`;

      expect(readSegments(document)).toEqual([
        { timestamp: '0:00', text: 'Il se passe un truc bizarre' },
        { timestamp: '0:01', text: 'dans mon portefeuille' },
      ]);
    },
  );

  it(
    // The safety net must NEVER deduplicate on the timestamp alone: two genuinely
    // distinct segments starting within the same second must both be kept. No
    // panel here (findTranscriptPanel resolves null), so this is the
    // whole-document fallback, where the net alone must prevent content loss.
    'keeps both of two distinct segments sharing the same timestamp',
    () => {
      mountTranscript([['0:00', 'Bonjour'], ['0:00', 'Salut']]);
      expect(readSegments(document)).toEqual([
        { timestamp: '0:00', text: 'Bonjour' },
        { timestamp: '0:00', text: 'Salut' },
      ]);
    },
  );

  it('has the deduplication ignore a non-breaking versus normal space difference', () => {
    document.body.innerHTML = `
      <ytd-transcript-segment-renderer>
        <div class="segment-timestamp">0:00</div>
        <yt-formatted-string class="segment-text">du texte</yt-formatted-string>
      </ytd-transcript-segment-renderer>
      <ytd-transcript-segment-renderer>
        <div class="segment-timestamp">0:00</div>
        <yt-formatted-string class="segment-text">du texte</yt-formatted-string>
      </ytd-transcript-segment-renderer>`;
    // The two copies differ only by one whitespace character: once normalised they
    // become the SAME (timestamp, text) pair, and the second must be dropped as a
    // duplicate.
    expect(readSegments(document)).toEqual([{ timestamp: '0:00', text: 'du texte' }]);
  });

  it(
    // A second failure introduced by the scoping fix itself:
    // `div.ytSectionListRendererContents`, the unscoped candidate ranked second in
    // `transcriptPanelCandidates`, is reused by other YouTube engagement panels
    // (here: chapters). On a page where that chapters panel is visible and the
    // precise candidate
    // `[target-id="PAmodern_transcript_view"] div.ytSectionListRendererContents`
    // resolves to nothing, `findTranscriptPanel` returned the chapters panel —
    // and `readRoot`, bounding the read to that wrong panel, made `readSegments`
    // return [] while the real transcript lives elsewhere in the document. This
    // passes with `readRoot`'s containment check, which rejects a resolved panel
    // holding no segment and falls back to the whole document.
    'does not let a visible non-transcript panel matching a candidate hide the real transcript living elsewhere',
    () => {
      document.body.innerHTML = `
        <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-chapters">
          <div class="ytSectionListRendererContents">Chapitre 1, Chapitre 2</div>
        </ytd-engagement-panel-section-list-renderer>
        <ytd-transcript-renderer>
          <ytd-transcript-segment-renderer>
            <div class="segment-timestamp">0:00</div>
            <yt-formatted-string class="segment-text">Vrai texte de la transcription</yt-formatted-string>
          </ytd-transcript-segment-renderer>
        </ytd-transcript-renderer>
      `;
      expect(readSegments(document)).toEqual([
        { timestamp: '0:00', text: 'Vrai texte de la transcription' },
      ]);
    },
  );

  it("preserves the original order after deduplication", () => {
    mountTranscript([
      ['0:00', 'un'],
      ['0:01', 'deux'],
      ['0:00', 'un'], // exact duplicate of the first, must vanish without shifting the others
      ['0:02', 'trois'],
    ]);
    expect(readSegments(document)).toEqual([
      { timestamp: '0:00', text: 'un' },
      { timestamp: '0:01', text: 'deux' },
      { timestamp: '0:02', text: 'trois' },
    ]);
  });
});

describe('readDuration', () => {
  it('reads the duration from the player', () => {
    document.body.innerHTML = '<video></video>';
    Object.defineProperty(document.querySelector('video')!, 'duration', { value: 3660 });
    expect(readDuration(document)).toBe(3660);
  });
  it('renvoie 0 sans lecteur', () => {
    document.body.innerHTML = '';
    expect(readDuration(document)).toBe(0);
  });
});

describe('readVideoMeta', () => {
  it('extracts title, channel and description', () => {
    document.body.innerHTML = `
      <h1 class="ytd-watch-metadata"><yt-formatted-string>Mon titre</yt-formatted-string></h1>
      <ytd-channel-name><a href="/@charlie">Charlie Invest</a></ytd-channel-name>
      <ytd-text-inline-expander id="description-inline-expander">Salut, moi c'est Charlie.</ytd-text-inline-expander>
      <video></video>`;
    const m = readVideoMeta(document, 'abc');
    expect(m.title).toBe('Mon titre');
    expect(m.channel).toBe('Charlie Invest');
    expect(m.description).toContain('Charlie');
    expect(m.videoId).toBe('abc');
  });

  it('returns empty strings rather than crashing when the DOM has changed', () => {
    document.body.innerHTML = '<div></div>';
    const m = readVideoMeta(document, 'abc');
    expect(m).toEqual({
      videoId: 'abc', title: '', channel: '', description: '', durationSeconds: 0,
    });
  });

  it('truncates a very long description', () => {
    document.body.innerHTML =
      `<ytd-text-inline-expander id="description-inline-expander">${'x'.repeat(5000)}</ytd-text-inline-expander>`;
    expect(readVideoMeta(document, 'a').description.length).toBeLessThanOrEqual(1000);
  });

  it('normalises whitespace, non-breaking included, in every field as well as truncating the description', () => {
    document.body.innerHTML = `
      <ytd-watch-metadata>
        <h1 class="ytd-watch-metadata"><yt-formatted-string>Titre  avec espaces</yt-formatted-string></h1>
        <ytd-channel-name><a href="/@x">Chaîne  X</a></ytd-channel-name>
        <ytd-text-inline-expander id="description-inline-expander">${'x'.repeat(5000)}</ytd-text-inline-expander>
      </ytd-watch-metadata>`;
    const m = readVideoMeta(document, 'a');
    expect(m.title).toBe('Titre avec espaces');
    expect(m.channel).toBe('Chaîne X');
    expect(m.description.length).toBeLessThanOrEqual(1000);
  });

  it(
    // Regression: on a video from one channel, readVideoMeta returned another
    // channel's name in production — a SUGGESTED channel placed before
    // ytd-watch-metadata in the DOM.
    'ignores the ytd-channel-name of a suggested video placed before the watched one\'s',
    () => {
      document.body.innerHTML = `
        <ytd-compact-video-renderer>
          <ytd-channel-name><a href="/@franceinfo">franceinfo</a></ytd-channel-name>
        </ytd-compact-video-renderer>
        <ytd-watch-metadata>
          <h1 class="ytd-watch-metadata"><yt-formatted-string>Un titre quelconque</yt-formatted-string></h1>
          <ytd-channel-name><a href="/@rubentech">Ruben Tech</a></ytd-channel-name>
          <ytd-text-inline-expander id="description-inline-expander">Contenu.</ytd-text-inline-expander>
        </ytd-watch-metadata>
        <video></video>`;
      const m = readVideoMeta(document, 'abc');
      expect(m.channel).toBe('Ruben Tech');
    },
  );

  it('lets the live ytd-watch-metadata win over a stale hidden one placed before it', () => {
    document.body.innerHTML = `
      <ytd-watch-metadata hidden>
        <ytd-channel-name><a href="/@stale">Chaîne périmée</a></ytd-channel-name>
      </ytd-watch-metadata>
      <ytd-watch-metadata>
        <ytd-channel-name><a href="/@live">Chaîne vivante</a></ytd-channel-name>
      </ytd-watch-metadata>`;
    const m = readVideoMeta(document, 'abc');
    expect(m.channel).toBe('Chaîne vivante');
  });

  it('falls back to a whole-document read when no metadata container resolves', () => {
    document.body.innerHTML = `
      <h1 class="ytd-watch-metadata"><yt-formatted-string>Titre sans conteneur</yt-formatted-string></h1>
      <ytd-channel-name><a href="/@x">Chaîne sans conteneur</a></ytd-channel-name>
      <ytd-text-inline-expander id="description-inline-expander">Description sans conteneur.</ytd-text-inline-expander>`;
    const m = readVideoMeta(document, 'abc');
    expect(m).not.toEqual({
      videoId: 'abc', title: '', channel: '', description: '', durationSeconds: 0,
    });
    expect(m.title).toBe('Titre sans conteneur');
    expect(m.channel).toBe('Chaîne sans conteneur');
    expect(m.description).toBe('Description sans conteneur.');
  });

  it('returns an entirely empty VideoMeta, without crashing, on a completely empty document', () => {
    document.body.innerHTML = '';
    expect(() => readVideoMeta(document, 'abc')).not.toThrow();
    const m = readVideoMeta(document, 'abc');
    expect(m).toEqual({
      videoId: 'abc', title: '', channel: '', description: '', durationSeconds: 0,
    });
  });
});

describe('findTranscriptButton', () => {
  it('finds the button by its aria-label', () => {
    document.body.innerHTML = '<button aria-label="Afficher la transcription">x</button>';
    expect(findTranscriptButton(document)).not.toBeNull();
  });
  it('trouve le bouton par son aria-label anglais', () => {
    document.body.innerHTML = '<button aria-label="Show transcript">x</button>';
    expect(findTranscriptButton(document)).not.toBeNull();
  });
  it('renvoie null si absent', () => {
    document.body.innerHTML = '<button aria-label="Partager">x</button>';
    expect(findTranscriptButton(document)).toBeNull();
  });

  it(
    // Reproduces the structure captured on 2026-08-11 on a real YouTube page. The
    // FIRST element in the document whose label matches the transcript pattern is
    // a generic button carrying that word alone — not the opening control — and a
    // close button appears BEFORE the real one
    // d'ouverture. Avant ce correctif, `findTranscriptButton` retournait le
    // A label-only implementation takes the first match in document order: here
    // either the generic button or, worse, the CLOSE button, which matches the
    // same pattern since it contains the word too. This passes with the
    // implementation that prefers the dedicated semantic container.
    'finds the button in ytd-video-description-transcript-section-renderer, even when a close control appears earlier in the document',
    () => {
      document.body.innerHTML = `
        <button aria-label="Transcription">Transcription</button>
        <ytd-button-renderer>Afficher la transcription</ytd-button-renderer>
        <button aria-label="Fermer la transcription"></button>
        <ytd-video-description-transcript-section-renderer>
          <ytd-button-renderer>
            <button aria-label="Afficher la transcription">Afficher la transcription</button>
          </ytd-button-renderer>
        </ytd-video-description-transcript-section-renderer>
      `;

      const btn = findTranscriptButton(document);
      expect(btn).not.toBeNull();
      expect(btn?.closest('ytd-video-description-transcript-section-renderer')).not.toBeNull();
      expect(btn?.getAttribute('aria-label')).toBe('Afficher la transcription');
    },
  );

  it('never returns a close control in the label fallback', () => {
    document.body.innerHTML = `
      <button aria-label="Fermer la transcription"></button>
      <button aria-label="Close transcript"></button>
    `;
    expect(findTranscriptButton(document)).toBeNull();
  });

  it('prefers a candidate with an opening verb over a bare-label one', () => {
    document.body.innerHTML = `
      <button aria-label="Transcription">Transcription</button>
      <button aria-label="Afficher la transcription">Afficher la transcription</button>
    `;
    const btn = findTranscriptButton(document);
    expect(btn?.getAttribute('aria-label')).toBe('Afficher la transcription');
  });

  it('falls back to the bare label when no candidate carries an opening verb', () => {
    document.body.innerHTML = '<button aria-label="Transcription">Transcription</button>';
    const btn = findTranscriptButton(document);
    expect(btn?.getAttribute('aria-label')).toBe('Transcription');
  });

  it(
    // Measured live 2026-08-12 with the description collapsed: button present,
    // offsetParent null, hidden ancestor, height 0. The button is real and
    // clickable (`isConnected === true`), but an ancestor carries `[hidden]`.
    // Before the fix, `findTranscriptButton` required visibility (like
    // `findActionBar`) and rejected this perfectly valid button, so the extension
    // stopped opening the transcript on its own. `.click()` is a direct DOM call,
    // not a mouse simulation: a programmatic click TARGET's visibility does not
    // matter, unlike an ANCHOR point's (see `findActionBar`).
    'finds the button even when an ancestor of the structural section is hidden (collapsed description)',
    () => {
      document.body.innerHTML = `
        <div hidden style="display: flex; height: 0">
          <ytd-video-description-transcript-section-renderer>
            <ytd-button-renderer>
              <button aria-label="Afficher la transcription">Afficher la transcription</button>
            </ytd-button-renderer>
          </ytd-video-description-transcript-section-renderer>
        </div>
      `;
      const btn = findTranscriptButton(document);
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute('aria-label')).toBe('Afficher la transcription');
    },
  );

  it(
    // Completes the test above for the label fallback, with no structural
    // container: a hidden candidate stays eligible, but a close control never is,
    // even when IT is the only visible one. The hidden candidate must be chosen
    // precisely BECAUSE the only visible element is the close control.
    'never returns a close control, even when it is the only visible element',
    () => {
      document.body.innerHTML = `
        <button aria-label="Afficher la transcription" hidden>caché mais valide</button>
        <button aria-label="Fermer la transcription">visible mais fermeture</button>
      `;
      const btn = findTranscriptButton(document);
      expect(btn?.getAttribute('aria-label')).toBe('Afficher la transcription');
    },
  );

  it(
    // A variant of the regression above, on the OTHER branch of the old
    // `isVisible`: an inline `display: none` ancestor rather than a `[hidden]`
    // attribute. Both were distinct rejection reasons before the fix; both must
    // now be ignored, since `findTranscriptButton` filters on `isConnected` alone.
    'finds the button even when an ancestor carries an inline display:none',
    () => {
      document.body.innerHTML = `
        <div style="display: none">
          <ytd-video-description-transcript-section-renderer>
            <ytd-button-renderer>
              <button aria-label="Afficher la transcription">Afficher la transcription</button>
            </ytd-button-renderer>
          </ytd-video-description-transcript-section-renderer>
        </div>
      `;
      const btn = findTranscriptButton(document);
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute('aria-label')).toBe('Afficher la transcription');
    },
  );

  it(
    // SPA regression, structural variant: after an internal navigation several
    // `ytd-video-description-transcript-section-renderer` can coexist, the old
    // hidden page before the new one. Before the fix, `findTranscriptButton`
    // looked only at the FIRST section `querySelector` found — if it carried only
    // a close button, or none, the next section was never tried. Here the first,
    // stale section holds only a close button; the second, live one holds the real
    // opening button.
    'ignores a stale section carrying only a close button and finds the button in the next one',
    () => {
      document.body.innerHTML = `
        <ytd-video-description-transcript-section-renderer id="perimee">
          <ytd-button-renderer>
            <button aria-label="Fermer la transcription"></button>
          </ytd-button-renderer>
        </ytd-video-description-transcript-section-renderer>
        <ytd-video-description-transcript-section-renderer id="vivante">
          <ytd-button-renderer>
            <button aria-label="Afficher la transcription">Afficher la transcription</button>
          </ytd-button-renderer>
        </ytd-video-description-transcript-section-renderer>
      `;
      const btn = findTranscriptButton(document);
      expect(btn).not.toBeNull();
      expect(btn?.closest('ytd-video-description-transcript-section-renderer')?.id).toBe('vivante');
    },
  );
});

describe('findTranscriptPanel', () => {
  it('renvoie null si rien ne correspond', () => {
    document.body.innerHTML = '<div>rien</div>';
    expect(findTranscriptPanel(document)).toBeNull();
  });

  it('renvoie le premier candidat visible', () => {
    document.body.innerHTML = `
      <ytd-transcript-renderer>repli</ytd-transcript-renderer>
      <ytd-transcript-segment-list-renderer>précis</ytd-transcript-segment-list-renderer>
    `;
    expect(findTranscriptPanel(document)?.textContent).toBe('précis');
  });

  it('returns the new panel\'s scroll container first', () => {
    document.body.innerHTML = `
      <ytd-transcript-renderer>ancien panneau</ytd-transcript-renderer>
      <ytd-engagement-panel-section-list-renderer target-id="PAmodern_transcript_view">
        <div class="ytSectionListRendererContents">conteneur moderne</div>
      </ytd-engagement-panel-section-list-renderer>
    `;
    expect(findTranscriptPanel(document)?.textContent).toBe('conteneur moderne');
  });

  it('ignores a hidden candidate and falls back to the next', () => {
    document.body.innerHTML = `
      <ytd-transcript-segment-list-renderer aria-hidden="true">masqué</ytd-transcript-segment-list-renderer>
      <ytd-transcript-renderer>visible</ytd-transcript-renderer>
    `;
    expect(findTranscriptPanel(document)?.textContent).toBe('visible');
  });

  it(
    // The same defect as `findActionBar`, and the same remedy: after an SPA
    // navigation the old transcript panel can stay hidden in the DOM BEFORE the
    // new one, under the SAME candidate selector. Before the fix, the first
    // hidden match abandoned the whole selector without ever reaching the second,
    // visible one, so the scroll fallback scrolled nothing after an internal
    // navigation.
    'ignores the first hidden candidate after an SPA navigation and returns the second, visible one of the SAME selector',
    () => {
      document.body.innerHTML = `
        <ytd-transcript-renderer aria-hidden="true">ancien panneau (périmé)</ytd-transcript-renderer>
        <ytd-transcript-renderer>nouveau panneau (visible)</ytd-transcript-renderer>
      `;
      expect(findTranscriptPanel(document)?.textContent).toBe('nouveau panneau (visible)');
    },
  );
});

describe('findActionBar', () => {
  it('renvoie null si rien ne correspond', () => {
    document.body.innerHTML = '<div>rien</div>';
    expect(findActionBar(document)).toBeNull();
  });

  it(
    // `#top-level-buttons-computed` alone matches ~23 elements on a real YouTube
    // page (comments, suggestions, menus). This page gathers 4, only one of them
    // inside ytd-watch-metadata.
    'keeps only ytd-watch-metadata\'s on a page with several #top-level-buttons-computed',
    () => {
      document.body.innerHTML = `
        <div id="comment-1"><div id="top-level-buttons-computed">commentaire 1</div></div>
        <div id="comment-2"><div id="top-level-buttons-computed">commentaire 2</div></div>
        <ytd-watch-metadata>
          <div id="actions">
            <div id="top-level-buttons-computed">vraie barre</div>
          </div>
        </ytd-watch-metadata>
        <div id="suggested"><div id="top-level-buttons-computed">suggestion</div></div>
      `;

      // Proof it would fail against the old behaviour: an unconstrained
      // querySelector grabs the first of the 4 elements in document order — a
      // comment menu, not the real bar.
      const naive = document.querySelector('#top-level-buttons-computed');
      expect(naive?.textContent).toBe('commentaire 1');

      expect(findActionBar(document)?.textContent).toBe('vraie barre');
    },
  );

  it('ignores a hidden candidate and falls back to a visible one later in the list', () => {
    document.body.innerHTML = `
      <ytd-watch-metadata>
        <div id="actions" aria-hidden="true">
          <div id="top-level-buttons-computed">barre masquée</div>
        </div>
      </ytd-watch-metadata>
      <div id="actions-inner">repli visible</div>
    `;
    expect(findActionBar(document)?.textContent).toBe('repli visible');
  });

  it('prefers the most precise candidate when several match', () => {
    document.body.innerHTML = `
      <ytd-watch-metadata>
        <div id="actions">
          <div id="top-level-buttons-computed">précis</div>
        </div>
      </ytd-watch-metadata>
      <div id="actions-inner">
        <div id="top-level-buttons-computed">moins précis</div>
      </div>
    `;
    expect(findActionBar(document)?.textContent).toBe('précis');
  });

  it(
    // SPA regression: YouTube does not destroy the old page on an internal
    // navigation — it leaves it hidden in the DOM, BEFORE the new visible one. Two
    // `ytd-watch-metadata` therefore exist, matching the SAME candidate selector.
    // Before the fix, `findActionBar` examined only the FIRST match of each
    // selector: it rejected the hidden bar and abandoned THAT selector entirely,
    // without ever reaching the second, visible match. Only a full reload brought
    // the button back.
    'ignores the first hidden match after an SPA navigation and returns the second, visible one of the SAME selector',
    () => {
      document.body.innerHTML = `
        <ytd-watch-metadata hidden>
          <div id="actions">
            <div id="top-level-buttons-computed">ancienne vidéo (masquée)</div>
          </div>
        </ytd-watch-metadata>
        <ytd-watch-metadata>
          <div id="actions">
            <div id="top-level-buttons-computed">nouvelle vidéo (visible)</div>
          </div>
        </ytd-watch-metadata>
      `;
      expect(findActionBar(document)?.textContent).toBe('nouvelle vidéo (visible)');
    },
  );

  it(
    // Combines the within-selector multiplicity above with the preference between
    // selectors: the most precise selector must still win even when its FIRST
    // match is stale and hidden. Falling back to a broader selector just because
    // the precise one's first match failed would be wrong.
    'always prefers the most precise selector, even when its first match is stale and hidden',
    () => {
      document.body.innerHTML = `
        <ytd-watch-metadata hidden>
          <div id="actions">
            <div id="top-level-buttons-computed">précis mais périmé (masqué)</div>
          </div>
        </ytd-watch-metadata>
        <ytd-watch-metadata>
          <div id="actions">
            <div id="top-level-buttons-computed">précis et visible</div>
          </div>
        </ytd-watch-metadata>
        <div id="actions-inner">
          <div id="top-level-buttons-computed">repli moins précis, visible aussi</div>
        </div>
      `;
      expect(findActionBar(document)?.textContent).toBe('précis et visible');
    },
  );
});

describe('findActionBar vs findTranscriptButton — the visibility guard diverges on purpose', () => {
  // The same ingredient, a `[hidden]` ancestor, gives two opposite results, and
  // that is INTENDED: findActionBar returns an ANCHOR point, where a hidden
  // candidate would make the injected button invisible with nothing to signal it,
  // while findTranscriptButton returns a PROGRAMMATIC CLICK TARGET (`.click()`
  // fires the event whatever the visibility). Harmonising the two implementations
  // would reintroduce the regression.
  it('has findActionBar return null while findTranscriptButton returns the button, on a structurally valid but hidden candidate', () => {
    document.body.innerHTML = `
      <div hidden>
        <ytd-watch-metadata>
          <div id="actions">
            <div id="top-level-buttons-computed">barre masquée</div>
          </div>
        </ytd-watch-metadata>
        <ytd-video-description-transcript-section-renderer>
          <ytd-button-renderer>
            <button aria-label="Afficher la transcription">Afficher la transcription</button>
          </ytd-button-renderer>
        </ytd-video-description-transcript-section-renderer>
      </div>
    `;

    expect(findActionBar(document)).toBeNull();

    const btn = findTranscriptButton(document);
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-label')).toBe('Afficher la transcription');
  });
});

describe('isInCurrentActionBar — the ghost-button guard after an SPA navigation', () => {
  // `injectButton()` in the content script starts with
  // `document.getElementById(BTN_ID)`, which returned `true` for an existing
  // button without checking WHERE it lived. After an SPA navigation a button
  // injected into the old action bar can survive hidden in the DOM, and the guard
  // reported success for a button invisible on the current page. This makes it
  // honest: a button is valid only while still contained in the bar
  // `findActionBar` resolves NOW.
  it("treats an existing button in a stale action bar as invalid when the current bar is another element", () => {
    document.body.innerHTML = `
      <ytd-watch-metadata hidden>
        <div id="actions">
          <div id="top-level-buttons-computed">
            <button id="ai-recap-btn">✦ Résumer</button>
          </div>
        </div>
      </ytd-watch-metadata>
      <ytd-watch-metadata>
        <div id="actions">
          <div id="top-level-buttons-computed">barre courante</div>
        </div>
      </ytd-watch-metadata>
    `;
    const staleBtn = document.getElementById('ai-recap-btn');
    expect(staleBtn).not.toBeNull();
    if (staleBtn) expect(isInCurrentActionBar(staleBtn, document)).toBe(false);
  });

  it('treats a button contained in the current bar as valid', () => {
    document.body.innerHTML = `
      <ytd-watch-metadata>
        <div id="actions">
          <div id="top-level-buttons-computed">
            <button id="ai-recap-btn">✦ Résumer</button>
          </div>
        </div>
      </ytd-watch-metadata>
    `;
    const btn = document.getElementById('ai-recap-btn');
    expect(btn).not.toBeNull();
    if (btn) expect(isInCurrentActionBar(btn, document)).toBe(true);
  });

  it("returns false when no action bar resolves", () => {
    document.body.innerHTML = '<button id="ai-recap-btn">✦ Résumer</button>';
    const btn = document.getElementById('ai-recap-btn');
    expect(btn).not.toBeNull();
    if (btn) expect(isInCurrentActionBar(btn, document)).toBe(false);
  });
});

describe('readActionButtonMetrics', () => {
  // `doc.defaultView.getComputedStyle` faithfully reflects an inline style under
  // jsdom (verified before writing these tests), so metric values can be
  // "injected" by setting an inline style on a sibling button, with no
  // contortion and no second implementation of
  // getComputedStyle.
  it(
    'adopts height, radius, size AND font family from a sibling button in the action bar',
    () => {
      document.body.innerHTML = `
      <ytd-watch-metadata>
        <div id="actions">
          <div id="top-level-buttons-computed">
            <button style="height: 40px; border-radius: 20px; font-size: 16px; font-family: Roboto, Arial">
              Partager
            </button>
          </div>
        </div>
      </ytd-watch-metadata>`;
      expect(readActionButtonMetrics(document)).toEqual({
        height: '40px', borderRadius: '20px', fontSize: '16px', fontFamily: 'Roboto, Arial',
      });
    },
  );

  it(
    // Measured live 2026-08-13: the bar's first button is the like button, the
    // LEFT half of the like/dislike segmented control, whose computed radius is
    // `20px 0px 0px 20px`. Copied as is, it gave the injected button a perfectly
    // square right edge. Only the radius's SCALE is adopted, not its shape.
    'uniformises a segmented sibling\'s radius instead of copying its square corners',
    () => {
      document.body.innerHTML = `
      <ytd-watch-metadata>
        <div id="actions">
          <div id="top-level-buttons-computed">
            <button style="height: 40px; border-radius: 20px 0px 0px 20px; font-size: 14px; font-family: Roboto">
              J'aime
            </button>
          </div>
        </div>
      </ytd-watch-metadata>`;
      expect(readActionButtonMetrics(document).borderRadius).toBe('20px');
    },
  );

  it('keeps the largest radius when the corners differ without being zero', () => {
    document.body.innerHTML = `
      <ytd-watch-metadata>
        <div id="actions">
          <div id="top-level-buttons-computed">
            <button style="height: 40px; border-radius: 4px 18px 18px 4px; font-size: 14px; font-family: Roboto">
              Partager
            </button>
          </div>
        </div>
      </ytd-watch-metadata>`;
    expect(readActionButtonMetrics(document).borderRadius).toBe('18px');
  });

  it(
    // A percentage radius (a circular icon button) does not translate into a
    // usable length for a button of a different width: full fallback rather than
    // an invented conversion.
    'falls back to the defaults when the radius read contains no pixel length',
    () => {
      document.body.innerHTML = `
      <ytd-watch-metadata>
        <div id="actions">
          <div id="top-level-buttons-computed">
            <button style="height: 40px; border-radius: 50%; font-size: 14px; font-family: Roboto">icône</button>
          </div>
        </div>
      </ytd-watch-metadata>`;
      expect(readActionButtonMetrics(document)).toEqual(DEFAULT_ACTION_BUTTON_METRICS);
    },
  );

  it("falls back to the defaults when no action bar resolves", () => {
    document.body.innerHTML = '<div>rien</div>';
    expect(readActionButtonMetrics(document)).toEqual(DEFAULT_ACTION_BUTTON_METRICS);
  });

  it("falls back to the defaults when the action bar holds no sibling button", () => {
    document.body.innerHTML = `
      <ytd-watch-metadata>
        <div id="actions">
          <div id="top-level-buttons-computed"><span>pas un bouton</span></div>
        </div>
      </ytd-watch-metadata>`;
    expect(readActionButtonMetrics(document)).toEqual(DEFAULT_ACTION_BUTTON_METRICS);
  });

  it('falls back to the defaults when the height read is zero, with layout not computed', () => {
    document.body.innerHTML = `
      <ytd-watch-metadata>
        <div id="actions">
          <div id="top-level-buttons-computed">
            <button style="border-radius: 20px; font-size: 16px">Partager</button>
          </div>
        </div>
      </ytd-watch-metadata>`;
    expect(readActionButtonMetrics(document)).toEqual(DEFAULT_ACTION_BUTTON_METRICS);
  });

  it("adopts the first button found in the action bar, not one from another section", () => {
    document.body.innerHTML = `
      <div id="comment-1">
        <button style="height: 99px; border-radius: 99px; font-size: 99px; font-family: Comic Sans MS">
          commentaire
        </button>
      </div>
      <ytd-watch-metadata>
        <div id="actions">
          <div id="top-level-buttons-computed">
            <button style="height: 40px; border-radius: 20px; font-size: 16px; font-family: Roboto, Arial">
              Partager
            </button>
          </div>
        </div>
      </ytd-watch-metadata>`;
    expect(readActionButtonMetrics(document)).toEqual({
      height: '40px', borderRadius: '20px', fontSize: '16px', fontFamily: 'Roboto, Arial',
    });
  });
});

/** Reproduces the engagement panel structure captured on 2026-08-12. */
function mountPanel(targetId: string, visibility: string, inner = '') {
  return `<ytd-engagement-panel-section-list-renderer target-id="${targetId}" visibility="${visibility}">${inner}</ytd-engagement-panel-section-list-renderer>`;
}

const EXPANDED = 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
const HIDDEN = 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN';

describe('findExpandedTranscriptPanel', () => {
  it("recognises the old generation when expanded", () => {
    document.body.innerHTML = mountPanel('engagement-panel-searchable-transcript', EXPANDED);
    expect(findExpandedTranscriptPanel(document)).not.toBeNull();
  });

  it('recognises the new generation when expanded', () => {
    document.body.innerHTML = mountPanel('PAmodern_transcript_view', EXPANDED);
    expect(findExpandedTranscriptPanel(document)).not.toBeNull();
  });

  it('ignores a collapsed transcript panel', () => {
    document.body.innerHTML = mountPanel('engagement-panel-searchable-transcript', HIDDEN);
    expect(findExpandedTranscriptPanel(document)).toBeNull();
  });

  it('ignores an expanded panel that does not carry the transcript', () => {
    document.body.innerHTML = mountPanel('engagement-panel-comments-section', EXPANDED);
    expect(findExpandedTranscriptPanel(document)).toBeNull();
  });

  it("answers on the attribute, not the appearance: a hidden panel stays expanded", () => {
    // Stealth mode's invariant: the panel is made invisible (opacity 0) while
    // being perfectly open. A visual criterion would answer closed, and the
    // extension would open a second one, or refuse to close its own.
    document.body.innerHTML = mountPanel('engagement-panel-searchable-transcript', EXPANDED);
    const panel = document.querySelector('ytd-engagement-panel-section-list-renderer') as HTMLElement;
    panel.style.opacity = '0';
    panel.style.position = 'absolute';
    expect(findExpandedTranscriptPanel(document)).toBe(panel);
  });
});

describe('findTranscriptCloseButton', () => {
  it('finds the close control inside the expanded panel', () => {
    document.body.innerHTML = mountPanel('engagement-panel-searchable-transcript', EXPANDED,
      '<button aria-label="Fermer"></button>');
    expect(findTranscriptCloseButton(document)?.getAttribute('aria-label')).toBe('Fermer');
  });

  it('ignores buttons that do not close', () => {
    document.body.innerHTML = mountPanel('engagement-panel-searchable-transcript', EXPANDED,
      '<button aria-label="Rechercher dans la transcription"></button>');
    expect(findTranscriptCloseButton(document)).toBeNull();
  });

  it("does not take the close button of ANOTHER panel", () => {
    document.body.innerHTML =
      mountPanel('engagement-panel-comments-section', EXPANDED, '<button aria-label="Fermer"></button>')
      + mountPanel('engagement-panel-searchable-transcript', HIDDEN, '<button aria-label="Fermer"></button>');
    expect(findTranscriptCloseButton(document)).toBeNull();
  });
});

describe('isTranscriptControl', () => {
  it('recognises the button in the section under the description', () => {
    document.body.innerHTML = `
      <ytd-video-description-transcript-section-renderer>
        <button>Afficher la transcription</button>
      </ytd-video-description-transcript-section-renderer>`;
    expect(isTranscriptControl(document.querySelector('button'))).toBe(true);
  });

  it("recognises the show-transcript entry of the \u2026 menu", () => {
    // It is not a <button>: without this path, opening through the menu would go
    // unnoticed and the user would get an invisible panel.
    document.body.innerHTML = `
      <ytd-menu-service-item-renderer>
        <yt-formatted-string>Afficher la transcription</yt-formatted-string>
      </ytd-menu-service-item-renderer>`;
    expect(isTranscriptControl(document.querySelector('yt-formatted-string'))).toBe(true);
  });

  it('recognises a click inside the panel itself', () => {
    document.body.innerHTML = mountPanel('engagement-panel-searchable-transcript', EXPANDED,
      '<button aria-label="Fermer"></button>');
    expect(isTranscriptControl(document.querySelector('button'))).toBe(true);
  });

  it('traite « Fermer la transcription » comme une reprise en main', () => {
    // Unlike findTranscriptButton, CLOSE_LABELS is not excluded here: acting on
    // the panel, even to close it, is enough to release it.
    document.body.innerHTML = '<button aria-label="Fermer la transcription"></button>';
    expect(isTranscriptControl(document.querySelector('button'))).toBe(true);
  });

  it('ignore un clic sans rapport', () => {
    document.body.innerHTML = '<button aria-label="Partager"></button>';
    expect(isTranscriptControl(document.querySelector('button'))).toBe(false);
  });

  it('ignores a target that is not an element', () => {
    expect(isTranscriptControl(null)).toBe(false);
  });
});
