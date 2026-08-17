// Validates an API key on paste. Composes the active provider's pure
// buildValidateRequest with a real network call.
//
// Lives in lib/ rather than under one entrypoint because both surfaces validate
// keys: the options page, and the panel's in-place repair of the `invalid-key`
// error. A second copy would drift on the wording of the three failure causes.
import type { Provider, ProviderConfig } from '@/lib/llm/types';
import type { MessageKey, MessageParams } from '@/lib/i18n';

export type KeyValidation =
  | { status: 'valid' }
  /** Same contract as ModelListing (lib/llm/list-models.ts): a catalogue key, never a sentence — both surfaces that display it are translatable. */
  | { status: 'invalid'; messageKey: MessageKey; params?: MessageParams };

/**
 * buildValidateRequest is only a constructor, so the try/catch lives here, at
 * the caller: any error means "unusable key". Distinguishes three causes —
 * badly copied key, key refused by the provider, network unavailable.
 */
export async function validateKey(provider: Provider, cfg: ProviderConfig): Promise<KeyValidation> {
  const trimmed = cfg.apiKey.trim();
  if (!trimmed) {
    return { status: 'invalid', messageKey: 'validate.empty' };
  }
  if (/\s/.test(trimmed)) {
    return { status: 'invalid', messageKey: 'validate.whitespace' };
  }

  const built = provider.buildValidateRequest({ ...cfg, apiKey: trimmed });

  let res: Response;
  try {
    res = await fetch(built.url, built.init);
  } catch {
    return { status: 'invalid', messageKey: 'validate.network' };
  }

  if (res.ok) return { status: 'valid' };

  if (res.status === 401 || res.status === 403) {
    return { status: 'invalid', messageKey: 'validate.refused' };
  }

  return { status: 'invalid', messageKey: 'validate.status', params: { status: res.status } };
}
