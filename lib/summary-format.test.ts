import { describe, it, expect } from 'vitest';
import { parseSummary, type Block, type Inline } from './summary-format';

// A realistic summary, in the shape measured on the benchmark transcripts:
// numbered sections, one "##" section, single-bullet items each carrying a bold
// label and exactly one timestamp, in the three formats encountered (m:ss,
// mm:ss, h:mm:ss). The text stays French because that is what the model
// produces.
const REALISTIC_SUMMARY = `1. Investissement, trading et gestion passive
- **Horizon temporel** : la frontière entre investissement et trading est l'horizon, pas le produit [1:23]
- **Gestion active subie** : acheter des actions populaires puis vendre en panique est une gestion trop active [4:48]

2. Krach et préparation du portefeuille
- **Horizon de retrait** : un krach n'est un vrai problème que si des retraits sont prévus [15:21]
- **Diversification** : répartir les actifs sur plusieurs classes réduit le risque global [22:10]

## Conclusion
- **Discipline** : rester investi malgré la volatilité est la clé sur un horizon d'une heure [1:00:05]`;

describe('parseSummary — realistic case', () => {
  const blocks = parseSummary(REALISTIC_SUMMARY);

  it('produces the expected block sequence', () => {
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading', 'bullet', 'bullet',
      'heading', 'bullet', 'bullet',
      'heading', 'bullet',
    ]);
  });

  // A numbered title counts as a "##": the same rank in the shape the prompt
  // produces — a section of the summary, never its overall title.
  it('reads both title forms, numbered and ##, at the same level', () => {
    expect(blocks[0]).toEqual({
      kind: 'heading',
      level: 2,
      content: [{ kind: 'text', text: 'Investissement, trading et gestion passive' }],
    });
    expect(blocks[3]).toEqual({
      kind: 'heading',
      level: 2,
      content: [{ kind: 'text', text: 'Krach et préparation du portefeuille' }],
    });
    expect(blocks[6]).toEqual({
      kind: 'heading', level: 2, content: [{ kind: 'text', text: 'Conclusion' }],
    });
  });

  it('recognises ### as a heading, at its own level', () => {
    expect(parseSummary('### Section')).toEqual([
      { kind: 'heading', level: 3, content: [{ kind: 'text', text: 'Section' }] },
    ]);
  });

  // The summary prompt produces "##", but an answer to a follow-up question is
  // not framed by that prompt, and the model there happily opens with "# Title".
  // All six Markdown levels are recognised and each keeps ITS rank through to the
  // render — flattened onto one level, they all displayed at the same size as
  // bold text.
  it('recognises all six heading levels, # through ######, keeping each rank', () => {
    const hashesByLevel = ['#', '##', '###', '####', '#####', '######'];

    hashesByLevel.forEach((hashes, index) => {
      expect(parseSummary(`${hashes} Ceci est un titre`)).toEqual([
        { kind: 'heading', level: index + 1, content: [{ kind: 'text', text: 'Ceci est un titre' }] },
      ]);
    });
  });

  it('stops treating seven hashes as a heading: Markdown has six levels', () => {
    expect(parseSummary('####### Trop profond')).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: '####### Trop profond' }] },
    ]);
  });

  it('does not treat a hash without a space as a heading', () => {
    expect(parseSummary('#hashtag')).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: '#hashtag' }] },
    ]);
  });

  it('extracts a bold span followed by literal text and a timestamp', () => {
    const bullet = blocks[1];
    if (bullet === undefined || bullet.kind !== 'bullet') throw new Error('bloc 1 doit être une puce');
    const [first, ...rest] = bullet.content;
    expect(first).toEqual({ kind: 'strong', text: 'Horizon temporel' });
    const last = rest.at(-1);
    expect(last).toEqual({ kind: 'timestamp', label: '1:23', seconds: 83 });
  });

  it('convertit les trois formats de timestamp en secondes correctes', () => {
    const seconds = (block: Block | undefined): number => {
      if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
      const ts = block.content.find((n): n is Extract<Inline, { kind: 'timestamp' }> => n.kind === 'timestamp');
      if (ts === undefined) throw new Error('timestamp attendu');
      return ts.seconds;
    };

    expect(seconds(blocks[1])).toBe(83); // 1:23 (m:ss)
    expect(seconds(blocks[4])).toBe(921); // 15:21 (mm:ss)
    expect(seconds(blocks[7])).toBe(3605); // 1:00:05 (h:mm:ss)
  });
});

// The prompt ends section titles with a timestamp ("## Title [MM:SS]"), not just
// bullets: titles are a summary's most useful jump targets. `heading` therefore
// carries inline content like `bullet` and `paragraph`, and reuses the same
// `parseInline` — hence the same robustness guarantees (a malformed or truncated
// timestamp stays literal text, never a broken button).
describe('parseSummary — headings with a timestamp', () => {
  it('produces an inline timestamp with the right seconds for a heading', () => {
    const [block] = parseSummary('## Un colosse venu de nulle part [2:46]');
    if (block === undefined || block.kind !== 'heading') throw new Error('expected a heading');
    expect(block.content).toEqual([
      { kind: 'text', text: 'Un colosse venu de nulle part ' },
      { kind: 'timestamp', label: '2:46', seconds: 166 },
    ]);
  });

  it('works the same way for a numbered heading with a timestamp', () => {
    const [block] = parseSummary('1. Le mystère Smaev [6:24]');
    if (block === undefined || block.kind !== 'heading') throw new Error('titre attendu');
    const ts = block.content.at(-1);
    expect(ts).toEqual({ kind: 'timestamp', label: '6:24', seconds: 384 });
  });

  it('still handles a heading with no timestamp, producing no button', () => {
    const [block] = parseSummary('## Conclusion');
    if (block === undefined || block.kind !== 'heading') throw new Error('titre attendu');
    expect(block.content).toEqual([{ kind: 'text', text: 'Conclusion' }]);
    expect(block.content.some((n) => n.kind === 'timestamp')).toBe(false);
  });

  it('keeps literal text for a malformed heading timestamp, with no broken button', () => {
    const [block] = parseSummary('## Titre bizarre [abc]');
    if (block === undefined || block.kind !== 'heading') throw new Error('titre attendu');
    expect(block.content).toEqual([{ kind: 'text', text: 'Titre bizarre [abc]' }]);
  });
});

describe('parseSummary — gras', () => {
  it('recognises two bold spans on the same line', () => {
    const [block] = parseSummary('- **Un** puis **Deux** dans la même puce');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([
      { kind: 'strong', text: 'Un' },
      { kind: 'text', text: ' puis ' },
      { kind: 'strong', text: 'Deux' },
      { kind: 'text', text: ' dans la même puce' },
    ]);
  });

  it('recognises bold text abutting a timestamp with no space', () => {
    const [block] = parseSummary('- **Titre**[2:00]');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([
      { kind: 'strong', text: 'Titre' },
      { kind: 'timestamp', label: '2:00', seconds: 120 },
    ]);
  });

  it('ignore un gras vide (****)', () => {
    const [block] = parseSummary('- avant **** après');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([{ kind: 'text', text: 'avant **** après' }]);
  });
});

describe('parseSummary — italique', () => {
  it('recognises an italic span between literal text', () => {
    const [block] = parseSummary('- le mot *souligné* compte');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([
      { kind: 'text', text: 'le mot ' },
      { kind: 'em', text: 'souligné' },
      { kind: 'text', text: ' compte' },
    ]);
  });

  it('keeps bold and italic apart on the same line', () => {
    const [block] = parseSummary('- **gras** puis *italique*');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([
      { kind: 'strong', text: 'gras' },
      { kind: 'text', text: ' puis ' },
      { kind: 'em', text: 'italique' },
    ]);
  });

  it('recognises italic text abutting a timestamp with no space', () => {
    const [block] = parseSummary('- *Titre*[2:00]');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([
      { kind: 'em', text: 'Titre' },
      { kind: 'timestamp', label: '2:00', seconds: 120 },
    ]);
  });

  // The bullet marker and the italic marker are the same character; only the
  // whitespace after it tells them apart.
  it('reads a line opening on italics as a paragraph, not as a bullet', () => {
    expect(parseSummary('*Ceci* ouvre un paragraphe')).toEqual([
      {
        kind: 'paragraph',
        content: [
          { kind: 'em', text: 'Ceci' },
          { kind: 'text', text: ' ouvre un paragraphe' },
        ],
      },
    ]);
  });

  it('leaves an asterisk with whitespace against it literal, so 2 * 3 * 4 is not italic', () => {
    const [block] = parseSummary('- 2 * 3 * 4 font 24');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([{ kind: 'text', text: '2 * 3 * 4 font 24' }]);
  });

  it('leaves an unclosed italic literal, as a chunk cut mid-stream produces', () => {
    const [block] = parseSummary('- un début *tronqué');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([{ kind: 'text', text: 'un début *tronqué' }]);
  });

  // The `*` a truncated `**gras` leaves behind closes nothing: were the italic
  // read before the bold, "**gras**" would come out as an empty italic followed
  // by literal text.
  it('leaves a truncated bold marker literal rather than reading it as italic', () => {
    const [block] = parseSummary('- un début **tronqué');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([{ kind: 'text', text: 'un début **tronqué' }]);
  });
});

describe('parseSummary — malformed timestamps', () => {
  it('leaves a four-segment timestamp as literal text', () => {
    const [block] = parseSummary('- une puce [99:99:99:99] cassée');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([{ kind: 'text', text: 'une puce [99:99:99:99] cassée' }]);
  });

  it('leaves an unreadable timestamp as literal text', () => {
    const [block] = parseSummary('- une puce [abc] cassée');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([{ kind: 'text', text: 'une puce [abc] cassée' }]);
  });

  it('leaves empty brackets as literal text', () => {
    const [block] = parseSummary('- une puce [] cassée');
    if (block === undefined || block.kind !== 'bullet') throw new Error('puce attendue');
    expect(block.content).toEqual([{ kind: 'text', text: 'une puce [] cassée' }]);
  });
});

describe('parseSummary — empty input and unrecognised lines', () => {
  it('returns an empty array for an empty string', () => {
    expect(parseSummary('')).toEqual([]);
  });

  it('produces no block from purely blank lines', () => {
    expect(parseSummary('\n\n   \n')).toEqual([]);
  });

  it('turns a line with no marker into a paragraph', () => {
    expect(parseSummary('Juste une phrase.')).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: 'Juste une phrase.' }] },
    ]);
  });

  it('never throws on absurd input', () => {
    expect(() => parseSummary('**[##1.- \n\r\n**]]][[[')).not.toThrow();
  });
});

describe('parseSummary — streaming robustness', () => {
  /**
   * The panel receives the summary in pieces and reparses it on every chunk.
   * This is the test that matters most: it reproduces exactly the condition the
   * panel really runs in, unlike the cases above, which only exercise complete
   * documents.
   *
   * No alphabetic character of the real text, accents included, is ever a syntax
   * character in this subset — only digits, `.`, `#`, `-`, `*`, `[`, `]` and
   * spaces are. So it is possible to check, without duplicating the parser's
   * logic, that no letter of the input is lost: by construction any letter no
   * recognised marker consumes ends up in text, an emphasis span, or a
   * timestamp label.
   */
  const letters = (s: string): string => (s.match(/\p{L}/gu) ?? []).join('');

  // `heading` carries `content: Inline[]` like `bullet` and `paragraph`, so one
  // path covers all three block kinds.
  const plainText = (blocks: Block[]): string =>
    blocks
      .map((b) => b.content.map((n) => (n.kind === 'timestamp' ? n.label : n.text)).join(''))
      .join('');

  it('never throws and loses no letter, for every prefix of the realistic summary', () => {
    for (let i = 1; i <= REALISTIC_SUMMARY.length; i++) {
      const prefix = REALISTIC_SUMMARY.slice(0, i);
      let blocks: Block[] = [];
      expect(() => {
        blocks = parseSummary(prefix);
      }).not.toThrow();
      expect(letters(plainText(blocks))).toBe(letters(prefix));
    }
  });

  // A summary in the prompt's full shape: unmarked opening paragraph, "## Title
  // [MM:SS]" headings with the timestamp at end of line, sections mixing prose
  // paragraphs and bullets, selective bold and italics. Sweeping EVERY prefix
  // necessarily passes through a state where a heading's timestamp is half typed
  // — exactly the case of interest, with no separate test needed.
  const V11_SUMMARY = `Dans cette vidéo, la chaîne dresse le portrait d'un athlète hors norme et interroge ce qui, dans sa force, relève de la génétique et ce qui relève du travail.

## Un colosse venu de nulle part [2:46]
Il grandit loin de tout, sans salle de sport, et découvre la musculation par hasard à l'adolescence.
- Il développe couché **200 kg** dès 17 ans, un niveau que peu atteignent après vingt ans de pratique [3:19]
- Son tour de bras dépasse *largement* celui de nombreux bodybuilders [3:35]

## Peut-on devenir aussi fort que lui ? [8:51]
La réponse est non pour la plupart : il cumule une génétique rare, une rigueur extrême et, de son propre aveu, des produits.
- **Trois facteurs** cumulés expliquent son niveau : génétique, entraînement, produits [8:51]

## Conclusion
Le message final tient en une phrase : tout le monde peut progresser, même sans réunir ces trois facteurs.`;

  it('never throws and loses no letter, for every prefix of a full-shape summary', () => {
    for (let i = 1; i <= V11_SUMMARY.length; i++) {
      const prefix = V11_SUMMARY.slice(0, i);
      let blocks: Block[] = [];
      expect(() => {
        blocks = parseSummary(prefix);
      }).not.toThrow();
      expect(letters(plainText(blocks))).toBe(letters(prefix));
    }
  });
});
