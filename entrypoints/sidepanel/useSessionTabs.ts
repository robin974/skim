// The session's conversations, as the tab bar sees them.
//
// The bar is DERIVED from chrome.storage.session and nothing else: there is no
// tab state to persist and none to keep in step. Closing a tab is deleting a
// conversation, and a summary started from another tab appears here because the
// service worker wrote it, not because anything told this hook.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listConversations, deleteConversation, readConversationKey, readTailStatus,
  type ConversationSummary,
} from '@/lib/conversations';

export type UseSessionTabs = {
  conversations: ConversationSummary[];
  /**
   * Forgets these videos' summaries — which IS closing their tabs. Removed from
   * the displayed list before storage answers, so the bar never keeps a tab the
   * user has just closed.
   */
  forget: (videoIds: readonly string[]) => void;
};

export function useSessionTabs(): UseSessionTabs {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  /**
   * Stamps each read so a slower one cannot overwrite a fresher answer. Without
   * it a `listConversations` started before a close resolves after it and puts
   * the closed tab back, until the deletion's own reload removes it again — the
   * tab reappears for a frame.
   */
  const latest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      const read = (latest.current += 1);
      listConversations()
        .then((c) => { if (!cancelled && read === latest.current) setConversations(c); })
        .catch(console.error);
    };

    reload();

    /**
     * A full reload ONLY when a conversation appears or disappears. A tail write
     * carries its own status, and applying it in place is what keeps this
     * listener off `listConversations` — which reads every value, transcripts
     * included, while the streaming loop writes a tail up to once a second (see
     * readConversationKey, lib/conversations.ts).
     */
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session') return;

      for (const [key, change] of Object.entries(changes)) {
        const target = readConversationKey(key);
        if (target === null) continue;

        if (target.kind === 'head') { reload(); return; }

        const status = readTailStatus(change.newValue);
        if (status === undefined) continue;
        setConversations((prev) => (
          prev.some((c) => c.videoId === target.videoId && c.status !== status)
            ? prev.map((c) => (c.videoId === target.videoId ? { ...c, status } : c))
            // Same status as the one already displayed: the throttled writes of
            // a running stream all say 'streaming', and rebuilding the list for
            // each of them would redraw the bar every second for nothing.
            : prev
        ));
      }
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const forget = useCallback((videoIds: readonly string[]) => {
    // Invalidates any read still in flight: it was started before this deletion
    // and knows nothing about it.
    latest.current += 1;
    setConversations((prev) => prev.filter((c) => !videoIds.includes(c.videoId)));
    Promise.all(videoIds.map((id) => deleteConversation(id))).catch(console.error);
  }, []);

  return { conversations, forget };
}
