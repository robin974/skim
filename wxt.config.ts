/// <reference types="node" />
// ^ tsconfig.json restricts `types` to ["chrome"] for extension code, so Node
// globals cannot pollute the typechecking of code that runs in the browser. This
// file only ever runs in the build tooling, so this explicit reference reopens
// Node's types for IT alone.
import { defineConfig } from 'wxt';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatVersionName, type BuildInfo } from './lib/build-info';

// Build provenance — see lib/build-info.ts for why. Everything below runs ONLY
// when wxt loads this file (build/dev/prepare), never Vitest, which does not
// import it, so no shell-out to git happens during tests.

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Runs a git command and returns its trimmed output, or null when git is absent,
 * the directory is outside a repository, or the command fails for any other
 * reason. Each caller substitutes 'unknown' itself — never an exception that
 * would fail the build: provenance that breaks the build is worth less than no
 * provenance.
 */
function runGit(args: string[]): string | null {
  try {
    const out = execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function readGitInfo(): { sha: string; branch: string; dirty: boolean } {
  return {
    sha: runGit(['rev-parse', '--short', 'HEAD']) ?? 'unknown',
    branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown',
    // With an unreadable tree — no git, not a repository — we cannot ASSERT that
    // it is dirty, so we do not claim it. The same cautious degradation as for
    // sha/branch, applied to a boolean.
    dirty: (runGit(['status', '--porcelain']) ?? '').length > 0,
  };
}

/**
 * The version read from package.json, which names a dev build. A release is
 * named by its tag instead (see readReleaseVersion).
 *
 * package.json belongs to the project, unlike git: a read failure here means a
 * broken project, not a degraded build environment, so the silent fallback is
 * less warranted — but staying defensive beats letting an unclear exception
 * escape.
 */
function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('./package.json', import.meta.url), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && 'version' in parsed && typeof parsed.version === 'string') {
      return parsed.version;
    }
    return '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * The version named by a tag on HEAD, without its leading 'v', or null when no
 * such tag names HEAD. This is the whole release test: no flag, no environment
 * variable, nothing a build can forget to pass.
 *
 * `--exact-match` is what makes it a release test rather than a "nearest tag"
 * lookup — a commit ON TOP of v1.2.3 is not v1.2.3.
 *
 * The accepted shape is Chrome's version format (one to four dot-separated
 * integers), not semver: the manifest's `version` field rejects anything else,
 * so a `v1.2.3-beta` tag cannot name a build and does not make one a release.
 */
function readReleaseVersion(): string | null {
  const tag = runGit(['describe', '--tags', '--exact-match', 'HEAD']);
  if (tag === null) return null;
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  return /^\d+(\.\d+){0,3}$/.test(version) ? version : null;
}

const gitInfo = readGitInfo();
const packageVersion = readPackageVersion();
// A dirty worktree is never a release, whatever tag HEAD carries: the bundle
// would not be the tagged code.
const releaseVersion = gitInfo.dirty ? null : readReleaseVersion();

const buildInfo: BuildInfo = releaseVersion !== null
  ? { kind: 'release', version: releaseVersion }
  : { kind: 'dev', version: packageVersion, ...gitInfo, timestamp: new Date().toISOString() };

if (releaseVersion !== null && releaseVersion !== packageVersion) {
  // Not fatal — the tag wins, and the build stays reproducible from it — but a
  // package.json left behind means the repository disagrees with what shipped.
  console.warn(`[build] tag names ${releaseVersion}, package.json says ${packageVersion}`);
}

/** Served to every browser whose language has no catalogue of its own. */
const DEFAULT_LOCALE = 'en';

/**
 * The manifest placeholder for a message, proven to exist.
 *
 * A placeholder Chrome cannot resolve is not a cosmetic defect: the extension
 * fails to install. Nothing else catches it — Vitest does not collect this file,
 * and WXT assembles the manifest after it runs — so the proof belongs where the
 * placeholder is written, and the placeholder MUST NOT be written by hand.
 *
 * Missing from the DEFAULT locale is fatal: that is the one Chrome falls back
 * to, so nothing resolves. Missing from any other locale only degrades to that
 * fallback, which is a regression worth saying out loud and not worth stopping
 * a build for.
 */
function msg(key: string): string {
  const dir = new URL('./public/_locales/', import.meta.url);
  for (const locale of readdirSync(dir)) {
    const raw = readFileSync(new URL(`./${locale}/messages.json`, dir), 'utf8');
    const messages = JSON.parse(raw) as Record<string, { message?: unknown } | undefined>;
    if (typeof messages[key]?.message === 'string') continue;
    if (locale === DEFAULT_LOCALE) {
      throw new Error(`[build] _locales/${locale}/messages.json has no "${key}": Chrome would refuse to install this build`);
    }
    console.warn(`[build] _locales/${locale}/messages.json has no "${key}", falling back to ${DEFAULT_LOCALE}`);
  }
  return `__MSG_${key}__`;
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    // The store title, and what store search ranks on hardest: `Skim` alone
    // matches no query anyone types, so the name carries a descriptive suffix.
    // `Skim` itself is never translated — only what follows the dash is.
    name: msg('extName'),
    // Manifest strings come from public/_locales/, which is the ONLY mechanism
    // that reaches them: Chrome reads the manifest before the extension runs, so
    // lib/i18n.ts — which exists at runtime — cannot supply a word here. The two
    // mechanisms therefore cover disjoint moments rather than compete: _locales
    // where no user setting can exist yet, the catalogue where it does.
    //
    // English is the default locale, served to every browser whose language has
    // no catalogue of its own.
    default_locale: DEFAULT_LOCALE,
    description: msg('extDescription'),
    // 'identity' is required by chrome.identity.launchWebAuthFlow and
    // getRedirectURL, which carry the optional OpenRouter PKCE sign-in.
    permissions: ['storage', 'sidePanel', 'identity'],
    host_permissions: [
      'https://*.youtube.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://openrouter.ai/*',
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://api.deepseek.com/*',
      // OpenCode Go's gateway lives under a path (/zen/go/v1) of the main site
      // rather than a dedicated API subdomain, hence an origin that looks broader
      // than the others without actually being so.
      'https://opencode.ai/*',
    ],
    // public/ is copied to the build root verbatim, so these paths carry no
    // 'public' prefix. The vector source and the Web Store renders stay out of
    // the package, in docs/icon/.
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: msg('actionTitle'),
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
      },
    },
    // `version` stays a bare number sequence, as Chrome and the Web Store
    // require. `version_name`, the free-form string, carries the provenance of a
    // dev build: it is what chrome://extensions shows next to the extension
    // name, the highest-value place to answer "which build is running?" without
    // a click. A release omits it — it would only repeat `version`.
    version: buildInfo.version,
    ...(buildInfo.kind === 'dev' ? { version_name: formatVersionName(buildInfo) } : {}),
  },
  // Compile-time constants: Vite replaces them with literals in the final
  // bundle, never read from a file at runtime — a packaged extension has no
  // access to the repository anyway. Consumed by lib/build-info.ts and by the
  // service worker and options page to display the same provenance as
  // version_name above, reusing formatVersionName rather than duplicating it.
  //
  // A release ships empty provenance rather than provenance it does not display:
  // what is not in the bundle cannot leak from it.
  vite: () => ({
    define: {
      __BUILD_RELEASE__: JSON.stringify(buildInfo.kind === 'release'),
      __BUILD_SHA__: JSON.stringify(buildInfo.kind === 'dev' ? buildInfo.sha : ''),
      __BUILD_BRANCH__: JSON.stringify(buildInfo.kind === 'dev' ? buildInfo.branch : ''),
      __BUILD_DIRTY__: JSON.stringify(buildInfo.kind === 'dev' ? buildInfo.dirty : false),
      __BUILD_TIME__: JSON.stringify(buildInfo.kind === 'dev' ? buildInfo.timestamp : ''),
    },
  }),
});
