// A video's own thumbnail, from YouTube's image CDN.
//
// No permission involved: an <img> in an extension page answers to the page's
// CSP, not to `host_permissions`, which cover fetch and content scripts. The
// privacy policy states this request.
//
// Two of the sizes YouTube publishes, picked by the slot being filled so none is
// rendered soft and none is downloaded for nothing:
//  - `default.jpg`, 120×90, for the tabs (28×17) and the menu rows (34×20);
//  - `mqdefault.jpg`, 320×180, for the heading above the summary (80×45), where
//    120px wide would be exactly 1.5× and already soft on a 2× display.
// The rendered size itself comes from the class the caller passes.
import { useEffect, useState } from 'react';

/**
 * A video that has been removed serves nothing at all. The tile then stays the
 * empty surface it already was, rather than becoming a broken image: it is
 * decoration beside a title that carries the meaning, and it MUST NOT collapse
 * the row it sits in either.
 */
export function Thumbnail(
  { videoId, className, large = false }: { videoId: string; className: string; large?: boolean },
) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [videoId]);

  return (
    <span className={className}>
      {!broken && (
        <img
          src={`https://i.ytimg.com/vi/${videoId}/${large ? 'mqdefault' : 'default'}.jpg`}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      )}
    </span>
  );
}
