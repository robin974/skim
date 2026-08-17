// Build provenance. Several agents work on this repository in parallel, each in
// its own git worktree, each producing its own .output/chrome-mv3/. Whoever
// loads one of those builds into Chrome has no way to tell which one it is —
// and when a fix "does not work", answering "is the right build even running?"
// costs real debugging time.
//
// A published build has the opposite need. Its reader is a user, for whom a
// commit, a branch and the state of a worktree are noise; a version number is
// the one thing they can quote in a bug report, and a tag makes it traceable
// back to a commit without printing one.
//
// This module holds only the pure, testable formatting of those two cases.
// wxt.config.ts decides which one applies and injects the values as the
// `__BUILD_*__` compile-time constants declared at the bottom of this file. A
// packaged extension can reach neither .git nor a git executable, so these
// values MUST be substituted at compile time rather than read at runtime.

/**
 * What a build knows about itself.
 *
 * A build is a RELEASE when HEAD carries a version tag and the worktree is
 * clean (see wxt.config.ts): it then identifies itself by that version and by
 * nothing else. Every other build is a dev build and carries the provenance
 * that tells one worktree's build from another's.
 *
 * A union rather than an optional field: a release has no branch to show, and
 * that MUST be impossible to format by accident.
 */
export type BuildInfo =
  | {
      kind: 'release';
      /** Version named by the tag on HEAD, without its leading 'v'. */
      version: string;
    }
  | {
      kind: 'dev';
      /** Version from package.json — no tag names this build. */
      version: string;
      /** Short SHA of HEAD at build time, or 'unknown' if unreadable. */
      sha: string;
      /** Branch name at build time, or 'unknown' if unreadable. */
      branch: string;
      /** True if the worktree had uncommitted changes at build time. */
      dirty: boolean;
      /** ISO 8601 build timestamp. */
      timestamp: string;
    };

/**
 * Compact string for `version_name` in the manifest, reused verbatim by the
 * service worker at startup. Chrome shows it on chrome://extensions next to the
 * extension name, so it answers "which build is running?" without a click.
 *
 * Branch comes BEFORE the SHA: the branch is what tells a worktree build from a
 * main build, and chrome://extensions truncates long strings.
 *
 * A release returns its bare version, which is why wxt.config.ts omits
 * `version_name` there rather than repeating `version`.
 */
export function formatVersionName(info: BuildInfo): string {
  if (info.kind === 'release') return info.version;
  const dirtySuffix = info.dirty ? '-dirty' : '';
  return `${info.version}+${info.branch}@${info.sha}${dirtySuffix}`;
}

/**
 * Footer line for the options page.
 *
 * A release shows the version and nothing else. It contains no word, in any
 * language, which is what lets it bypass the i18n catalogue that every other
 * string the user reads goes through.
 *
 * A dev build shows everything, including the build timestamp that
 * formatVersionName omits, and stays deliberately discreet: visible to whoever
 * looks for it, invisible to whoever does not.
 */
export function formatBuildFooter(info: BuildInfo): string {
  if (info.kind === 'release') return `v${info.version}`;
  const dirtyMarker = info.dirty ? ' · uncommitted changes' : '';
  return `v${info.version} · branch ${info.branch} · commit ${info.sha} · build ${info.timestamp}${dirtyMarker}`;
}

/**
 * The compile-time constants injected by wxt.config.ts (`vite.define`): Vite
 * replaces these identifiers with literals in the final bundle, so extension
 * code reads no file and touches no repository.
 *
 * In a release bundle the four provenance constants are empty, not merely
 * unused: dead-branch elimination would probably drop them, but "probably" is
 * not a guarantee that a branch name never ships to the Web Store.
 *
 * Declared here rather than in a separate .d.ts because BuildInfo is their only
 * consumer. They exist ONLY in bundles produced by `wxt build` / `wxt dev`.
 * Nothing defines them under Vitest, and no test references them — the tests
 * exercise the pure functions above with an explicit BuildInfo.
 */
declare global {
  const __BUILD_RELEASE__: boolean;
  const __BUILD_SHA__: string;
  const __BUILD_BRANCH__: string;
  const __BUILD_DIRTY__: boolean;
  const __BUILD_TIME__: string;
}
