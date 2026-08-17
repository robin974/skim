import { describe, it, expect } from 'vitest';
import { formatVersionName, formatBuildFooter, type BuildInfo } from './build-info';

const clean: BuildInfo = {
  kind: 'dev', version: '1.0.0', sha: 'abc1234', branch: 'main', dirty: false, timestamp: '2026-08-12T12:00:00.000Z',
};
const release: BuildInfo = { kind: 'release', version: '1.2.3' };

describe('formatVersionName', () => {
  it('clean dev build: version, branch then SHA, with no dirty marker', () => {
    expect(formatVersionName(clean)).toBe('1.0.0+main@abc1234');
  });

  it(
    // The branch is what tells a worktree build from a main build, so it must
    // precede the SHA — chrome://extensions truncates long strings.
    'puts the branch before the SHA',
    () => {
      const info: BuildInfo = { ...clean, branch: 'worktree-agent-xyz', sha: 'deadbee' };
      expect(formatVersionName(info)).toBe('1.0.0+worktree-agent-xyz@deadbee');
    },
  );

  it('dirty worktree: appends the -dirty marker', () => {
    const info: BuildInfo = { ...clean, dirty: true };
    expect(formatVersionName(info)).toBe('1.0.0+main@abc1234-dirty');
  });

  it('unreadable SHA: substitutes "unknown" rather than failing to format', () => {
    const info: BuildInfo = { ...clean, sha: 'unknown' };
    expect(formatVersionName(info)).toBe('1.0.0+main@unknown');
  });

  it('unreadable branch: substitutes "unknown" rather than failing to format', () => {
    const info: BuildInfo = { ...clean, branch: 'unknown' };
    expect(formatVersionName(info)).toBe('1.0.0+unknown@abc1234');
  });

  it('unreadable SHA and branch on a dirty tree: all three degradations at once', () => {
    const info: BuildInfo = { ...clean, sha: 'unknown', branch: 'unknown', dirty: true };
    expect(formatVersionName(info)).toBe('1.0.0+unknown@unknown-dirty');
  });

  it('release: the version alone, nothing appended', () => {
    expect(formatVersionName(release)).toBe('1.2.3');
  });
});

describe('formatBuildFooter', () => {
  it('clean dev build: version, branch, commit, timestamp, no marker', () => {
    expect(formatBuildFooter(clean)).toBe(
      'v1.0.0 · branch main · commit abc1234 · build 2026-08-12T12:00:00.000Z',
    );
  });

  it('dirty worktree: appends the mention at the end of the line', () => {
    const info: BuildInfo = { ...clean, dirty: true };
    expect(formatBuildFooter(info)).toBe(
      'v1.0.0 · branch main · commit abc1234 · build 2026-08-12T12:00:00.000Z · uncommitted changes',
    );
  });

  it('unreadable SHA and branch: "unknown" appears in both places', () => {
    const info: BuildInfo = { ...clean, sha: 'unknown', branch: 'unknown' };
    expect(formatBuildFooter(info)).toBe(
      'v1.0.0 · branch unknown · commit unknown · build 2026-08-12T12:00:00.000Z',
    );
  });

  it('all degradations at once, on a dirty tree', () => {
    const info: BuildInfo = { ...clean, sha: 'unknown', branch: 'unknown', dirty: true };
    expect(formatBuildFooter(info)).toBe(
      'v1.0.0 · branch unknown · commit unknown · build 2026-08-12T12:00:00.000Z · uncommitted changes',
    );
  });

  it('release: the version alone', () => {
    expect(formatBuildFooter(release)).toBe('v1.2.3');
  });

  it('release: no commit, branch, timestamp or worktree state, whatever the version', () => {
    expect(formatBuildFooter({ kind: 'release', version: '10.0.1' })).toBe('v10.0.1');
  });
});
