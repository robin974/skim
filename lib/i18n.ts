// Application message catalogue.
//
// WHY NOT `_locales/` + chrome.i18n.getMessage, the native and shorter path:
// chrome.i18n resolves the language from the BROWSER, once, and no API lets an
// extension change it. The "interface language" <select> would then be either
// inert or lying — there is no way to reload the native catalogue in another
// language without restarting Chrome. An application catalogue makes that choice
// real, at the cost of the interpolation and plural mechanism written below.
//
// This catalogue is the ONLY source of strings visible in either entrypoint.
// Modules under lib/ MUST return KEYS and their parameters, never words: the
// decision ("which segments, in what order") stays tested in lib/, the wording
// lives here.

import type { EffortLevel } from './llm/types';

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * The reference catalogue. Every key exists here first; `en` is typed against
 * it, so a missing translation does not compile — proof, not convention (same
 * argument as ERROR_PLANS, lib/panel-errors.ts).
 *
 * Plural convention: an `x_one` key and an `x_other` key, picked by `t.n(...)`.
 * Both forms are spelled out rather than derived by appending an "s" — the two
 * forms differ by more than one letter in many languages, and French agrees the
 * participle where English does not.
 *
 * REGISTER, French: the extension says "vous", or says nothing — an instruction
 * with no addressee ("Réessayer", "Cliquer pour insérer") is preferred wherever
 * one reads naturally, and the panel's error copy is impersonal by rule (see its
 * section). No key says "tu". A product a stranger installs has not been
 * introduced to them.
 */
const fr = {
  // ── Common ────────────────────────────────────────────────────────────────
  'common.loading': 'Chargement…',
  'common.cancel': 'Annuler',

  // ── Options page: structure ──────────────────────────────────────────────
  /** DOCUMENT title only, since the header shows the name itself. */
  'options.title': 'Réglages — Skim',
  'options.tagline': "L'essentiel d'une vidéo, en un clic.",
  'options.badge.ready': 'Prêt',
  'options.badge.ready.title': 'Au moins une clé est enregistrée : un fournisseur est sélectionnable dans le panneau.',
  'options.badge.setup': 'À configurer',
  'options.badge.setup.title': "Aucune clé n'est enregistrée.",
  'options.tabs.aria': 'Sections des réglages',
  'options.tab.providers': 'Fournisseurs',
  'options.tab.profiles': 'Profils',
  'options.tab.languages': 'Langues',
  'options.tab.data': 'Données',

  // ── Providers tab ────────────────────────────────────────────────────────
  'providers.field.effort': 'Effort',
  'providers.key.show': 'Afficher la clé',
  'providers.key.hide': 'Masquer la clé',
  'providers.key.replace': 'Remplacer',
  'providers.key.delete': 'Supprimer',
  'providers.key.delete.title': 'Supprimer la clé {provider} enregistrée',
  'providers.key.deleteConfirm': 'Supprimer cette clé ? {provider} ne sera plus sélectionnable dans le panneau.',
  'providers.key.deleteYes': 'Oui, supprimer',
  'providers.key.stored': 'Clé enregistrée',
  'providers.key.none': 'Aucune clé enregistrée',
  'providers.key.placeholder': 'Collez votre clé {provider} ici',
  'providers.key.checking': 'Vérification…',
  'providers.key.valid': 'Clé valide, enregistrée.',
  'providers.key.get': 'Obtenir une clé {provider}',

  // ── Providers tab: the setup assistant (lib/provider-setup.ts) ───────────
  'setup.step.provider': 'Fournisseur',
  'setup.step.key': 'Clé',
  'setup.choose.title': 'Choisissez votre fournisseur',
  'setup.choose.subtitle': "L'extension utilise votre propre clé.",
  'setup.row.configure': 'Configurer',
  'setup.row.replace': 'Remplacer la clé',
  'setup.back': '‹ Changer de fournisseur',
  'setup.key.oauth.title': 'Connectez votre compte OpenRouter',
  'setup.key.oauth.subtitle': "Un clic suffit : OpenRouter crée la clé et l'extension l'enregistre. Sinon, collez une clé existante.",
  'setup.key.paste.title': 'Collez votre clé {provider}',
  'setup.key.paste.subtitle': 'La clé reste sur cette machine et sert uniquement à appeler {provider}.',
  'setup.key.stored.title': 'Clé {provider} enregistrée',
  'setup.key.stored.subtitle': "Vous pouvez l'afficher, la remplacer, ou la supprimer.",
  'setup.key.submit': 'Valider',
  'setup.or': 'ou',
  'setup.done.title': '{provider} est prêt.',
  'setup.done.models': 'Vous pouvez maintenant résumer vos vidéos avec les modèles {provider}.',
  'setup.done.next': 'Retournez sur une vidéo YouTube et cliquez sur « Résumer » dans le panneau.',
  'setup.done.back': 'Revenir à la liste',

  // ── Model picker (options page and panel) ────────────────────────────────
  'model.default': 'Modèle par défaut ({model})',
  'model.defaultUnknown': 'Modèle par défaut du fournisseur',
  'model.loading': 'Chargement des modèles…',
  'model.orphanShort': '{model} — absent de la liste',
  'model.aria': 'Modèle utilisé pour le prochain résumé',
  'model.ariaManual': 'Identifiant du modèle utilisé pour le prochain résumé',
  'model.placeholder': 'identifiant du modèle',
  'models.error.noCatalog': '{provider} ne publie pas de liste de modèles.',
  'models.error.network': 'Réseau indisponible : impossible de charger la liste des modèles.',
  'models.error.refused': "Clé refusée par le fournisseur : la clé enregistrée n'est plus valide.",
  'models.error.status': 'Le fournisseur a répondu une erreur inattendue (code {status}).',
  'models.error.unreadable': 'Réponse illisible du fournisseur.',
  'models.error.empty': "Le fournisseur n'a renvoyé aucun modèle.",

  // ── Key validation (lib/validate-key.ts) ─────────────────────────────────
  'validate.empty': 'Collez une clé pour la faire vérifier.',
  'validate.whitespace': 'La clé contient un espace ou un saut de ligne : elle a probablement été mal copiée. Recopiez-la depuis le site du fournisseur.',
  'validate.network': 'Réseau indisponible : impossible de vérifier la clé pour le moment. Réessayez dans un instant.',
  'validate.refused': "Clé refusée par le fournisseur : vérifiez qu'elle est correcte, active, et associée au bon compte.",
  'validate.status': 'Le fournisseur a répondu une erreur inattendue (code {status}). Réessayez plus tard.',
  'validate.crashed': 'Une erreur inattendue est survenue pendant la vérification. Réessayez.',

  // ── OpenRouter OAuth connection ──────────────────────────────────────────
  'oauth.connect': 'Se connecter avec OpenRouter',
  'oauth.connecting': 'Connexion en cours…',
  'oauth.oneClick': 'Connexion en un clic, sans clé à copier.',
  'oauth.unexpected': 'Une erreur inattendue est survenue. Collez votre clé OpenRouter manuellement ci-dessous.',
  'oauth.error.fallback': 'Collez plutôt votre clé OpenRouter manuellement ci-dessous.',
  'oauth.error.unsupported': "La connexion automatique n'est pas disponible sur ce navigateur.",
  'oauth.error.refusedFlow': 'Connexion annulée ou refusée.',
  'oauth.error.cancelled': 'Connexion annulée.',
  'oauth.error.noCode': "OpenRouter n'a renvoyé aucun code d'autorisation.",
  'oauth.error.network': "Réseau indisponible pendant l'échange avec OpenRouter.",
  'oauth.error.exchangeRefused': "OpenRouter a refusé la demande : le code d'autorisation expire au bout de 10 minutes et ne sert qu'une fois — réessayez si le délai a été dépassé.",
  'oauth.error.unreadable': "Réponse d'OpenRouter illisible.",
  'oauth.error.unexpected': "Réponse d'OpenRouter inattendue.",

  // ── Reasoning effort ─────────────────────────────────────────────────────
  'effort.label.default': 'Défaut',
  // Untranslated on purpose, and shorter than « Aucune » in a panel header where
  // width is the binding constraint: it reads as a switch position, not as a
  // quantity.
  'effort.label.off': 'off',
  'effort.label.minimal': 'Minimal',
  'effort.label.low': 'Bas',
  'effort.label.medium': 'Moyen',
  'effort.label.high': 'Élevé',
  'effort.label.xhigh': 'Très élevé',
  'effort.label.max': 'Max',
  'effort.byProvider_one': '{count} cran, rétrogradé par {provider} selon le modèle',
  'effort.byProvider_other': '{count} crans, rétrogradés par {provider} selon le modèle',
  'effort.byModel_one': '{count} cran accepté par ce modèle',
  'effort.byModel_other': '{count} crans acceptés par ce modèle',
  'effort.none.noReasoning': 'Ce modèle ne réfléchit pas.',
  'effort.none.unknown': "L'extension ne sait pas piloter la réflexion de ce modèle.",

  // ── Profiles tab ─────────────────────────────────────────────────────────
  'prompt.tokensHint': "Cliquer pour insérer à l'endroit du curseur",
  'prompt.insert': 'Insérer {token}',
  'prompt.aria': 'Prompt envoyé au modèle',
  'prompt.saved_one': 'Enregistré automatiquement · {count} caractère',
  'prompt.saved_other': 'Enregistré automatiquement · {count} caractères',
  'prompt.languageHint': "La langue du résumé se règle dans l'onglet Langues : la consigne correspondante est ajoutée automatiquement, inutile de l'écrire ici.",
  'profiles.default.name': 'Par défaut',
  'profiles.migrated.name': 'Mon prompt',
  'profiles.new': '+ Nouveau profil',
  'profiles.new.name': 'Nouveau profil',
  'profiles.duplicate': 'Dupliquer',
  'profiles.copySuffix': '{name} (copie)',
  'profiles.delete': 'Supprimer',
  'profiles.deleteConfirm': 'Supprimer ce profil ?',
  'profiles.shipped': "Prompt de l'extension",
  'profiles.chars_one': '{count} caractère',
  'profiles.chars_other': '{count} caractères',
  'profiles.nameAria': 'Nom du profil',
  'profiles.resetPrompt': 'Repartir du prompt par défaut',

  // ── Languages tab ────────────────────────────────────────────────────────
  'languages.ui.label': "Langue de l'interface",
  'languages.ui.hint': 'Menus, boutons et messages.',
  'languages.summary.label': 'Langue du résumé',
  'languages.summary.hint': 'Langue dans laquelle le modèle rédige.',
  'languages.browser': 'Langue du navigateur ({name})',
  'languages.browserPlain': 'Langue du navigateur',
  'languages.note': "Une langue d'interface distincte de la langue du résumé : lire les réglages en anglais n'oblige pas à recevoir des résumés en anglais.",

  // ── Data tab ─────────────────────────────────────────────────────────────
  'data.reset.title': 'Remise à zéro',
  'data.reset.warning': 'Sans retour possible. Les clés supprimées devront être recollées.',
  'data.reset.keys': 'Supprimer toutes les clés',
  'data.reset.keysConfirm': 'Supprimer toutes les clés enregistrées ?',
  'data.reset.keysDone': 'Toutes les clés ont été supprimées.',
  'data.reset.all': 'Réinitialiser tous les réglages',
  'data.reset.allConfirm': 'Réinitialiser tous les réglages, clés comprises ?',
  'data.reset.allDone': 'Tous les réglages sont revenus à leur valeur par défaut.',
  'data.reset.confirmYes': 'Oui, je confirme',

  // ── Side panel ───────────────────────────────────────────────────────────
  /**
   * Titre de repli : le titre du contenu est celui de la vidéo affichée
   * (SessionTabs.tsx), et cette clé ne sert plus qu'à l'écran sans aucun onglet.
   */
  'panel.title': 'Résumé',
  /** DOCUMENT title, shown by Chrome in the side panel header. Names the product, since the h1 under it already says "Résumé". */
  'panel.documentTitle': 'Skim',
  'panel.idle.none': 'Aucun résumé pour cette vidéo.',
  'panel.idle.summarize': '✦ Résumer cette vidéo',
  'panel.waiting.reading': '✦ Lecture de la vidéo…',
  'panel.waiting.writing': '✦ Rédaction du résumé…',
  'panel.waiting.answer': '✦ Rédaction de la réponse…',
  'panel.waiting.seconds': '{count} s',
  'panel.waiting.closeable': 'Le panneau peut être fermé : le résumé se poursuit et sera là au retour.',
  'panel.regenerate': '↻ Régénérer',
  'panel.regenerate.title': 'Régénérer ce résumé pour cette vidéo. Le résumé actuel et les questions posées sont remplacés.',
  'panel.ask.placeholder': 'Poser une question sur cette vidéo…',
  'panel.ask.aria': 'Poser une question sur cette vidéo',
  'panel.ask.send': 'Envoyer',
  'panel.conversation.aria': 'Questions posées sur cette vidéo',
  /** Libellé du bouton fixe ET question envoyée : le même texte des deux côtés. */
  'panel.quick.condense': 'Résume la vidéo en une seule phrase',

  // ── Side panel: session tabs (SessionTabs.tsx) ───────────────────────────
  /**
   * Nom accessible de la croix, jamais « × » seul : lu à voix haute, le glyphe
   * ne nomme pas l'action.
   */
  'panel.tabs.closeTab': "Fermer l'onglet",
  'panel.tabs.aria': 'Résumés ouverts dans cette session',
  'panel.tabs.showAll': 'Voir tous les résumés de la session',
  'panel.tabs.listTitle': 'Résumés de cette session',
  'panel.tabs.closeAll': 'Fermer tous les onglets',
  'panel.tabs.closeAllConfirm_one': "Fermer l'onglet ?",
  'panel.tabs.closeAllConfirm_other': 'Fermer les {count} onglets ?',
  'panel.tabs.closeAllCancel': 'Annuler',
  'panel.tabs.closeAllApply': 'Fermer tout',
  'panel.tabs.closeMenu': 'Fermer',
  'panel.tabs.scrollLeft': 'Onglets à gauche',
  'panel.tabs.scrollRight': 'Onglets à droite',
  'panel.tabs.currentVideo': '{title} — vidéo affichée, pas encore résumée',
  'panel.tabs.generating': '{title} — résumé en cours',
  'panel.tabs.empty': 'Plus aucun résumé dans cette session. Ouvrez une vidéo YouTube : le panneau résume celle qui y est affichée.',

  // ── Side panel: the summarised video's title (App.tsx) ───────────────────
  'panel.title.openTab': "Aller à l'onglet de la vidéo",
  'panel.title.openNewTab': 'Ouvrir la vidéo dans un nouvel onglet',
  /** Ligne chaîne · durée sous le titre. « 47 min ». */
  'panel.videoMeta.minutes': '{count} min',
  /** « 1 h 04 » : les minutes arrivent déjà complétées à deux chiffres. */
  'panel.videoMeta.hours': '{hours} h {minutes}',
  'panel.header.switcherTitle': "Changer le fournisseur, le modèle et l'effort du prochain résumé",
  'panel.header.effortLine': '{label} : {level}',
  'panel.header.providerLabel': 'Fournisseur',
  'panel.header.addProvider': '+ Ajouter',
  'panel.header.closePopover': 'Fermer',
  'panel.header.profileLabel': 'Profil',
  'panel.header.profileSwitcherTitle': 'Changer le profil du prochain résumé',
  'panel.header.manageProfiles': '+ Gérer',
  'panel.header.settings': 'Réglages',
  'panel.header.settingsAria': "Ouvrir les réglages de l'extension",
  'panel.header.notConnected': 'Aucun compte connecté',
  'panel.model.locked': 'Configurez une clé {provider} pour choisir un modèle.',
  'panel.onboarding.title': 'Sans intro, sans sponsor, sans suspense',
  'panel.onboarding.body': 'Skim lit la vidéo et vous en rend le fond. Une clé IA à coller, une seule fois.',
  'panel.onboarding.cta': 'Commencer',
  'panel.onboarding.hint': "S'ouvre dans un nouvel onglet",
  'panel.languageHint.text': 'Résumé rédigé en anglais.',
  'panel.languageHint.action': 'Changer la langue',
  'panel.languageHint.dismissAria': 'Masquer cette information',

  // ── Summary provenance (see lib/summary-meta.ts) ─────────────────────────
  'provenance.built.transcript': 'Construit à partir des sous-titres',
  'provenance.generatedAt': 'généré le {date}',
  'provenance.byModel': 'par {provider} ({model})',
  'provenance.byProvider': 'par {provider}',
  'provenance.effortDropped': "sans le réglage d'effort, refusé par le modèle",

  // ── Panel errors ─────────────────────────────────────────────────────────
  // Impersonal wording: the panel states, it never addresses the reader. This
  // is the surface that shows up at the worst moment.
  'error.no-key.message': "Aucune clé API n'est configurée.",
  'error.invalid-key.message': 'La clé API {provider} a été refusée : elle n’est plus valide.',
  'error.invalid-key.detail': 'Vérifiée au collage, puis le résumé repart tout seul.',
  'error.invalid-key.placeholder': 'Coller une nouvelle clé',
  'error.quota.message': 'Le quota de cette clé API est épuisé pour le moment.',
  'error.quota.detail': 'Réessayer plus tard, ou basculer sur un autre fournisseur déjà configuré.',
  'error.overloaded.message': 'Le service est temporairement surchargé.',
  'error.overloaded.detail': 'Réessayer dans quelques instants.',
  'error.offline.message': 'La connexion internet a été perdue.',
  'error.offline.detail': 'Vérifier la connexion, puis réessayer.',
  'error.not-public.message': "Cette vidéo n'est pas accessible publiquement (privée ou non répertoriée) : impossible de la résumer.",
  'error.not-public.detail': 'Essayer avec une vidéo publique.',
  'error.too-long.message': 'Cette vidéo est trop longue pour être résumée sans sous-titres disponibles.',
  'error.too-long.detail': 'Essayer une vidéo plus courte, ou une vidéo dont les sous-titres sont disponibles.',
  'error.no-transcript.message': "La page de cette vidéo n'a pas pu être lue : aucun onglet ne l'affiche, ou elle n'a pas fini de se charger.",
  'error.no-transcript.detail': 'Ouvrir la vidéo dans un onglet — la recharger si elle était déjà ouverte — puis réessayer.',
  'error.transcript-unavailable.message': "Le panneau de transcription de YouTube n'a pas pu être lu sur cette page.",
  'error.transcript-unavailable.detail': "Cette vidéo n'a probablement pas de sous-titres, et l'extension résume à partir des sous-titres.",
  'error.transcript-incomplete.message': "La page n'a pas fini de charger sa transcription : elle changeait encore à chaque lecture.",
  'error.transcript-incomplete.detail': "Par prudence, l'extension refuse de résumer un texte peut-être tronqué — un résumé faux ne se remarque pas.",
  'error.no-conversation.message': "Aucun résumé n'a encore été généré pour cette vidéo.",
  'error.no-conversation.detail': 'Lancer le résumé avant de poser une question.',
  'error.unknown.message': 'Une erreur inattendue est survenue.',
  'error.unknown.detail': 'Réessayer ; si le problème persiste, vérifier les réglages.',
  'error.action.retry': 'Réessayer',
  'error.action.openSettings': 'Ouvrir les réglages',
  'error.action.switchProvider': 'Basculer sur {provider}',
} as const;

export type MessageKey = keyof typeof fr;
type Catalog = Record<MessageKey, string>;

const en: Catalog = {
  'common.loading': 'Loading…',
  'common.cancel': 'Cancel',

  'options.title': 'Settings — Skim',
  'options.tagline': 'The gist of any video, in one click.',
  'options.badge.ready': 'Ready',
  'options.badge.ready.title': 'At least one key is stored: a provider can be selected in the panel.',
  'options.badge.setup': 'Setup needed',
  'options.badge.setup.title': 'No key is stored.',
  'options.tabs.aria': 'Settings sections',
  'options.tab.providers': 'Providers',
  'options.tab.profiles': 'Profiles',
  'options.tab.languages': 'Languages',
  'options.tab.data': 'Data',

  // Names what is being steered, where French keeps the shorter « Effort ».
  'providers.field.effort': 'Reasoning',
  'providers.key.show': 'Show the key',
  'providers.key.hide': 'Hide the key',
  'providers.key.replace': 'Replace',
  'providers.key.delete': 'Delete',
  'providers.key.delete.title': 'Delete the stored {provider} key',
  'providers.key.deleteConfirm': 'Delete this key? {provider} will no longer be selectable in the panel.',
  'providers.key.deleteYes': 'Yes, delete it',
  'providers.key.stored': 'Key stored',
  'providers.key.none': 'No key stored',
  'providers.key.placeholder': 'Paste your {provider} key here',
  'providers.key.checking': 'Checking…',
  'providers.key.valid': 'Key valid, saved.',
  'providers.key.get': 'Get a {provider} key',

  'setup.step.provider': 'Provider',
  'setup.step.key': 'Key',
  'setup.choose.title': 'Choose your provider',
  'setup.choose.subtitle': 'The extension uses your own key.',
  'setup.row.configure': 'Set up',
  'setup.row.replace': 'Replace the key',
  'setup.back': '‹ Change provider',
  'setup.key.oauth.title': 'Connect your OpenRouter account',
  'setup.key.oauth.subtitle': 'One click is enough: OpenRouter creates the key and the extension stores it. Otherwise, paste an existing key.',
  'setup.key.paste.title': 'Paste your {provider} key',
  'setup.key.paste.subtitle': 'The key stays on this machine and is only used to call {provider}.',
  'setup.key.stored.title': '{provider} key stored',
  'setup.key.stored.subtitle': 'You can show it, replace it, or delete it.',
  'setup.key.submit': 'Check and save',
  'setup.or': 'or',
  'setup.done.title': '{provider} is ready.',
  'setup.done.models': 'You can now summarize your videos with {provider} models.',
  'setup.done.next': 'Go back to a YouTube video and click “Summarize” in the panel.',
  'setup.done.back': 'Back to the list',

  'model.default': 'Provider default ({model})',
  'model.defaultUnknown': "The provider's default model",
  'model.loading': 'Loading models…',
  'model.orphanShort': '{model} — missing from the list',
  'model.aria': 'Model used for the next summary',
  'model.ariaManual': 'Id of the model used for the next summary',
  'model.placeholder': 'model id',
  'models.error.noCatalog': '{provider} publishes no model list.',
  'models.error.network': 'Network unavailable: the model list could not be loaded.',
  'models.error.refused': 'Key refused by the provider: the stored key is no longer valid.',
  'models.error.status': 'The provider answered with an unexpected error (code {status}).',
  'models.error.unreadable': 'Unreadable answer from the provider.',
  'models.error.empty': 'The provider returned no model at all.',

  'validate.empty': 'Paste a key to have it checked.',
  'validate.whitespace': 'The key contains a space or a line break: it was probably copied badly. Copy it again from the provider’s site.',
  'validate.network': 'Network unavailable: the key cannot be checked right now. Try again in a moment.',
  'validate.refused': 'Key refused by the provider: check that it is correct, active, and tied to the right account.',
  'validate.status': 'The provider answered with an unexpected error (code {status}). Try again later.',
  'validate.crashed': 'Something unexpected happened during the check. Try again.',

  'oauth.connect': 'Sign in with OpenRouter',
  'oauth.connecting': 'Signing in…',
  'oauth.oneClick': 'One-click sign-in, no key to copy.',
  'oauth.unexpected': 'Something unexpected happened. Paste your OpenRouter key by hand below.',
  'oauth.error.fallback': 'Paste your OpenRouter key by hand below instead.',
  'oauth.error.unsupported': 'Automatic sign-in is not available in this browser.',
  'oauth.error.refusedFlow': 'Sign-in cancelled or refused.',
  'oauth.error.cancelled': 'Sign-in cancelled.',
  'oauth.error.noCode': 'OpenRouter returned no authorization code.',
  'oauth.error.network': 'Network unavailable during the exchange with OpenRouter.',
  'oauth.error.exchangeRefused': 'OpenRouter refused the request: the authorization code expires after 10 minutes and works only once — try again if that delay was exceeded.',
  'oauth.error.unreadable': 'Unreadable answer from OpenRouter.',
  'oauth.error.unexpected': 'Unexpected answer from OpenRouter.',

  'effort.label.default': 'Default',
  'effort.label.off': 'off',
  'effort.label.minimal': 'Minimal',
  'effort.label.low': 'Low',
  'effort.label.medium': 'Medium',
  'effort.label.high': 'High',
  'effort.label.xhigh': 'Very high',
  'effort.label.max': 'Max',
  'effort.byProvider_one': '{count} level, downgraded per model by {provider}',
  'effort.byProvider_other': '{count} levels, downgraded per model by {provider}',
  'effort.byModel_one': '{count} level accepted by this model',
  'effort.byModel_other': '{count} levels accepted by this model',
  'effort.none.noReasoning': 'This model does not reason.',
  'effort.none.unknown': "The extension cannot steer this model's reasoning.",

  'prompt.tokensHint': 'Click to insert at the cursor',
  'prompt.insert': 'Insert {token}',
  'prompt.aria': 'Prompt sent to the model',
  'prompt.saved_one': 'Saved automatically · {count} character',
  'prompt.saved_other': 'Saved automatically · {count} characters',
  'prompt.languageHint': 'The summary language is set in the Languages tab: the matching instruction is appended automatically, no need to write it here.',
  'profiles.default.name': 'Default',
  'profiles.migrated.name': 'My prompt',
  'profiles.new': '+ New profile',
  'profiles.new.name': 'New profile',
  'profiles.duplicate': 'Duplicate',
  'profiles.copySuffix': '{name} (copy)',
  'profiles.delete': 'Delete',
  'profiles.deleteConfirm': 'Delete this profile?',
  'profiles.shipped': "The extension's prompt",
  'profiles.chars_one': '{count} character',
  'profiles.chars_other': '{count} characters',
  'profiles.nameAria': 'Profile name',
  'profiles.resetPrompt': 'Start from the default prompt',

  'languages.ui.label': 'Interface language',
  'languages.ui.hint': 'Menus, buttons and messages.',
  'languages.summary.label': 'Summary language',
  'languages.summary.hint': 'The language the model writes in.',
  'languages.browser': 'Browser language ({name})',
  'languages.browserPlain': 'Browser language',
  'languages.note': 'An interface language separate from the summary language: reading the settings in English does not force summaries in English.',

  'data.reset.title': 'Reset',
  'data.reset.warning': 'No way back. Deleted keys will have to be pasted again.',
  'data.reset.keys': 'Delete every key',
  'data.reset.keysConfirm': 'Delete every stored key?',
  'data.reset.keysDone': 'Every key has been deleted.',
  'data.reset.all': 'Reset every setting',
  'data.reset.allConfirm': 'Reset every setting, keys included?',
  'data.reset.allDone': 'Every setting is back to its default value.',
  'data.reset.confirmYes': 'Yes, I confirm',

  'panel.title': 'Summary',
  'panel.documentTitle': 'Skim',
  'panel.idle.none': 'No summary for this video yet.',
  'panel.idle.summarize': '✦ Summarize this video',
  'panel.waiting.reading': '✦ Reading the video…',
  'panel.waiting.writing': '✦ Writing the summary…',
  'panel.waiting.answer': '✦ Writing the answer…',
  'panel.waiting.seconds': '{count} s',
  'panel.waiting.closeable': 'This panel can be closed: the summary keeps going and will be here on your return.',
  'panel.regenerate': '↻ Regenerate',
  'panel.regenerate.title': 'Regenerates this summary for this video. The current summary and the questions asked are replaced.',
  'panel.ask.placeholder': 'Ask a question about this video…',
  'panel.ask.aria': 'Ask a question about this video',
  'panel.ask.send': 'Send',
  'panel.conversation.aria': 'Questions asked about this video',
  'panel.quick.condense': 'Summarize the video in one sentence',
  'panel.tabs.closeTab': 'Close this tab',
  'panel.tabs.aria': 'Summaries open in this session',
  'panel.tabs.showAll': 'Show every summary of this session',
  'panel.tabs.listTitle': 'Summaries of this session',
  'panel.tabs.closeAll': 'Close every tab',
  'panel.tabs.closeAllConfirm_one': 'Close this tab?',
  'panel.tabs.closeAllConfirm_other': 'Close the {count} tabs?',
  'panel.tabs.closeAllCancel': 'Cancel',
  'panel.tabs.closeAllApply': 'Close all',
  'panel.tabs.closeMenu': 'Close',
  'panel.tabs.scrollLeft': 'Tabs to the left',
  'panel.tabs.scrollRight': 'Tabs to the right',
  'panel.tabs.currentVideo': '{title} — shown in the active tab, not summarized yet',
  'panel.tabs.generating': '{title} — summary in progress',
  'panel.tabs.empty': 'No summary left in this session. Open a YouTube video: the panel summarizes whatever it shows.',
  'panel.title.openTab': 'Go to the video’s tab',
  'panel.title.openNewTab': 'Open the video in a new tab',
  'panel.videoMeta.minutes': '{count} min',
  'panel.videoMeta.hours': '{hours}h{minutes}',
  'panel.header.switcherTitle': 'Change the provider, model and effort of the next summary',
  'panel.header.effortLine': '{label}: {level}',
  'panel.header.providerLabel': 'Provider',
  'panel.header.addProvider': '+ Add',
  'panel.header.closePopover': 'Close',
  'panel.header.profileLabel': 'Profile',
  'panel.header.profileSwitcherTitle': 'Change the profile of the next summary',
  'panel.header.manageProfiles': '+ Manage',
  'panel.header.settings': 'Settings',
  'panel.header.settingsAria': 'Open the extension settings',
  'panel.header.notConnected': 'No account connected',
  'panel.model.locked': 'Store a {provider} key to pick a model.',
  'panel.onboarding.title': 'No intro, no sponsor, no suspense',
  'panel.onboarding.body': 'Skim reads the video and gives you the substance. One AI key to paste, once.',
  'panel.onboarding.cta': 'Get started',
  'panel.onboarding.hint': 'Opens in a new tab',
  'panel.languageHint.text': 'This summary is written in English.',
  'panel.languageHint.action': 'Change the language',
  'panel.languageHint.dismissAria': 'Hide this notice',

  'provenance.built.transcript': 'Built from the subtitles',
  'provenance.generatedAt': 'generated on {date}',
  'provenance.byModel': 'by {provider} ({model})',
  'provenance.byProvider': 'by {provider}',
  'provenance.effortDropped': 'without the effort setting, refused by the model',

  'error.no-key.message': 'No API key is configured.',
  'error.invalid-key.message': 'The {provider} API key was refused: it is no longer valid.',
  'error.invalid-key.detail': 'Checked on paste, then the summary restarts on its own.',
  'error.invalid-key.placeholder': 'Paste a new key',
  'error.quota.message': "This API key's quota is exhausted for now.",
  'error.quota.detail': 'Try again later, or switch to another provider already configured.',
  'error.overloaded.message': 'The service is temporarily overloaded.',
  'error.overloaded.detail': 'Try again in a moment.',
  'error.offline.message': 'The internet connection was lost.',
  'error.offline.detail': 'Check the connection, then try again.',
  'error.not-public.message': 'This video is not publicly accessible (private or unlisted): it cannot be summarized.',
  'error.not-public.detail': 'Try a public video.',
  'error.too-long.message': 'This video is too long to be summarized without available subtitles.',
  'error.too-long.detail': 'Try a shorter video, or one whose subtitles are available.',
  'error.no-transcript.message': "This video's page could not be read: no tab shows it, or it has not finished loading.",
  'error.no-transcript.detail': 'Open the video in a tab — reload it if it was already open — then try again.',
  'error.transcript-unavailable.message': "YouTube's transcript panel could not be read on this page.",
  'error.transcript-unavailable.detail': 'This video probably has no subtitles, and the extension summarizes from subtitles.',
  'error.transcript-incomplete.message': 'The page had not finished loading its transcript: it still changed on every read.',
  'error.transcript-incomplete.detail': 'To be safe, the extension refuses to summarize possibly truncated text — a wrong summary does not look wrong.',
  'error.no-conversation.message': 'No summary has been generated for this video yet.',
  'error.no-conversation.detail': 'Run the summary before asking a question.',
  'error.unknown.message': 'Something unexpected happened.',
  'error.unknown.detail': 'Try again; if it keeps happening, check the settings.',
  'error.action.retry': 'Try again',
  'error.action.openSettings': 'Open the settings',
  'error.action.switchProvider': 'Switch to {provider}',
};

export const CATALOGS: Record<Locale, Catalog> = { fr, en };

/**
 * Base of a plural pair: `'model.count'` for the keys `model.count_one` /
 * `model.count_other`. Derived from the catalogue itself, so `t.n('x')` only
 * compiles when both forms exist.
 */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer Base}_other` ? Base : never
  : never;

export type MessageParams = Record<string, string | number>;

/**
 * The effective interface language. An empty `uiLanguage` means "follow the
 * browser" — the same convention as `language` (summary language) in
 * lib/settings.ts, with one difference: empty is NOT resolved when settings
 * load, because the Languages tab <select> must keep telling the two apart (see
 * getStoredLanguage).
 *
 * The final fallback is English, not French, even though French is the reference
 * catalogue: a German browser has no reason to get French rather than English.
 */
export function resolveLocale(uiLanguage: string, browserLanguage: string): Locale {
  const explicit = uiLanguage.split('-')[0] ?? '';
  if (isLocale(explicit)) return explicit;
  const fromBrowser = browserLanguage.split('-')[0] ?? '';
  return isLocale(fromBrowser) ? fromBrowser : 'en';
}

/**
 * Plural category. French puts 0 with the singular ("0 modèle disponible"),
 * English with the plural ("0 models available"). That is the only rule differing
 * between the two catalogues, and a zero counter is the common case for a key
 * that lists nothing.
 */
export function pluralCategory(locale: Locale, count: number): 'one' | 'other' {
  const n = Math.abs(count);
  return locale === 'fr' ? (n < 2 ? 'one' : 'other') : (n === 1 ? 'one' : 'other');
}

/**
 * Replaces `{name}` with the matching value. A missing parameter leaves the
 * placeholder AS IS rather than writing "undefined": a visible `{provider}` gets
 * noticed and fixed, an "undefined" reads as a bug in the extension.
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export type Translator = {
  (key: MessageKey, params?: MessageParams): string;
  /** Plural form: picks `${key}_one` or `${key}_other` and injects `{count}`. */
  n(key: PluralKey, count: number, params?: MessageParams): string;
  locale: Locale;
};

/**
 * A translator fixed on one language. The fallback to the French catalogue is
 * not decorative: it guarantees that a key missing from a future translation
 * renders readable text rather than a bare key. Typing forbids that today, but a
 * dynamically loaded catalogue would not.
 */
export function createTranslator(locale: Locale): Translator {
  const catalog = CATALOGS[locale];
  const t = ((key: MessageKey, params?: MessageParams) =>
    interpolate(catalog[key] ?? fr[key] ?? key, params)) as Translator;

  t.n = (key: PluralKey, count: number, params?: MessageParams) => {
    const form = `${key}_${pluralCategory(locale, count)}` as MessageKey;
    return t(form, { count, ...params });
  };
  t.locale = locale;
  return t;
}

/**
 * The catalogue key for an effort level's label. Exhaustiveness holds through
 * template literal typing: a level added to EffortLevel without its
 * `effort.label.*` key does not compile.
 */
export function effortLabelKey(level: EffortLevel): MessageKey {
  return `effort.label.${level}`;
}
