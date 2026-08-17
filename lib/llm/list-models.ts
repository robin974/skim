// Queries the active provider's model list to populate the model pickers — the
// options page's and the side panel's. Both reuse EXACTLY this path rather than
// growing a second one.
//
// Same split as lib/validate-key.ts, for the same reason: the provider supplies
// a PURE request (modelCatalog.buildRequest) and a pure parser
// (modelCatalog.parse), both tested; the network call lives here.
import type { ModelOption, Provider, ProviderConfig } from '@/lib/llm/types';
import type { MessageKey, MessageParams } from '@/lib/i18n';

export type ModelListing =
  | { status: 'ok'; models: ModelOption[] }
  /**
   * One failure shape, deliberately: the options page reacts the same way to
   * every case — network down, key refused, unreadable response, provider with
   * no list — by switching to manual id entry. The nuance goes to the screen,
   * not to the code.
   *
   * A catalogue KEY and its parameters, never a ready-made sentence: this module
   * runs in both entrypoints, both translatable.
   */
  | { status: 'error'; messageKey: MessageKey; params?: MessageParams };

/** Never throws: every failure becomes an 'error' ModelListing. */
export async function listModels(provider: Provider, cfg: ProviderConfig): Promise<ModelListing> {
  const catalog = provider.modelCatalog;
  if (!catalog) {
    return { status: 'error', messageKey: 'models.error.noCatalog', params: { provider: provider.label } };
  }

  const built = catalog.buildRequest(cfg);

  let res: Response;
  try {
    res = await fetch(built.url, built.init);
  } catch {
    return { status: 'error', messageKey: 'models.error.network' };
  }

  if (!res.ok) {
    // 401/403 deserve their own sentence: the only case the user can fix
    // themselves, right above on the same page — a stored key may have been
    // revoked since.
    if (res.status === 401 || res.status === 403) {
      return { status: 'error', messageKey: 'models.error.refused' };
    }
    return { status: 'error', messageKey: 'models.error.status', params: { status: res.status } };
  }

  let models: ModelOption[];
  try {
    models = catalog.parse(await res.json());
  } catch {
    return { status: 'error', messageKey: 'models.error.unreadable' };
  }

  // An empty list is not a usable success: a dropdown with no option leaves the
  // user no way to choose, so it is treated as a failure and yields manual entry.
  if (models.length === 0) {
    return { status: 'error', messageKey: 'models.error.empty' };
  }

  // Sorted on the displayed label, not the id: the label is what the user scans.
  // localeCompare with `numeric` so "GLM-5.2" follows "GLM-5.1", not "GLM-5.10".
  return {
    status: 'ok',
    models: [...models].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
  };
}
