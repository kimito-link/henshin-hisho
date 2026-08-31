#!/usr/bin/env node
// Generate release-notes/CURRENT-ja.txt from conventional-style commit
// messages since the last release tag (or last 30 commits if no tag).
//
// Why: ASC + Play want a short ja-JP release-note string per version.
// Hand-writing it on every push is friction; commit messages already
// describe the change. Convert them into a user-facing summary.
//
// Conventional commit types -> friendly Japanese labels:
//   feat:    ✨ 新機能
//   fix:     🐛 不具合修正
//   perf:    ⚡ パフォーマンス改善
//   a11y:    ♿ アクセシビリティ改善
//   security:🔒 セキュリティ強化
//   docs/chore/refactor/test/ci/build: skipped (internal)
//
// Output rules:
//   - 4-12 lines, each <= 80 chars (Play+ASC display tight)
//   - Total under 500 chars (Play hard limit on ja-JP)
//   - If nothing user-facing changed, fall back to a generic stub
//
// Usage: node scripts/generate-release-notes.mjs [--write]
//        --write overwrites release-notes/CURRENT-ja.txt; otherwise dry-run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const OUT_PATH = path.join(REPO, 'release-notes', 'CURRENT-ja.txt');
const WRITE = process.argv.includes('--write');

// 注意: ラベルに絵文字を入れない。App Store Connect の whatsNew は一部の絵文字
// (✨ 等)を拒否する（INVALID_CHARACTERS: "can't contain ... ✨"）。Play も将来
// 同様のリスクがあるため、表示は絵文字なしのプレーン日本語に統一する。
const TYPE_LABELS = {
  feat: '新機能',
  fix: '不具合の修正',
  perf: 'パフォーマンス改善',
  a11y: 'アクセシビリティ改善',
  security: 'セキュリティ強化',
};

// 他プラットフォーム名を中立化する。App Store(Guideline 2.3.10)は whatsNew に
// Android / Google Play 等の他プラットフォーム言及があると拒否する。コミット件名に
// それらが紛れても提出がブロックされないよう、リリースノート生成時に中立語へ寄せる。
function neutralizePlatform(s) {
  return (
    s
      // 「Android(Play)も」「iOS/Android」等の併記・括弧付きをまず畳む
      .replace(/[（(]\s*(?:Google\s*Play|Play|App\s*Store)\s*[)）]/gi, '')
      // App Store(2.3.10)が whatsNew で禁じる他プラットフォーム名を「ストア」に。
      // appstore-submit.mjs の BANNED_IN_IOS_WHATS_NEW と網羅範囲を一致させること。
      .replace(
        /(?:Google\s*Play|App\s*Store|Play\s*Store|Play\s*Console|Galaxy\s*Store|Amazon\s*Appstore)/gi,
        'ストア',
      )
      .replace(/\b(?:iOS|iPadOS|Android)\b/gi, '')
      // 「ストア と ストア の両方」→「各ストア」等、中立化後の重複・不自然を整える
      .replace(/ストア\s*(?:と|・|\/|／|、)\s*ストア(\s*の両方)?/g, '各ストア')
      // 中立化で孤立した接続詞・記号（「+ も価値…」「・」連続など）を掃除
      .replace(/(?:^|\s)[+＋]\s*(?=[もはがをにで])/g, ' ')
      .replace(/\s*[／/]\s*ストア/g, 'ストア')
      .replace(/^[\s・/／,、+＋]+|[\s・/／,、+＋]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

// ASC の whatsNew が拒否する文字（主に絵文字・記号類）を除去する保険。
// コミット本文に絵文字が紛れても提出がブロックされないようにする。
function sanitizeForStore(text) {
  return text
    // 絵文字・装飾記号の主要レンジを除去
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu,
      '',
    )
    // 絵文字除去で生じた行頭の余分な空白を整える
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
const SKIP_TYPES = new Set(['docs', 'chore', 'refactor', 'test', 'ci', 'build', 'style']);
// Commits whose scope is purely about infra/pipeline are not user-facing
// even if the type is `feat` (e.g. `feat(ci):`, `feat(automation):`).
const SKIP_SCOPES = new Set([
  'ci',
  'automation',
  'build',
  'infra',
  'deploy',
  'release',
  'workflow',
  'pipeline',
  'deps',
  'cd',
]);

function git(args) {
  return execSync(`git ${args}`, { cwd: REPO, encoding: 'utf8' }).trim();
}

function getLastReleaseRef() {
  // Prefer the most recent annotated tag matching v* (semver).
  try {
    return git('describe --tags --abbrev=0 --match "v*"');
  } catch {
    // No tag — fall back to 30 commits ago.
    return null;
  }
}

function readCommits() {
  const since = getLastReleaseRef();
  const range = since ? `${since}..HEAD` : 'HEAD~30..HEAD';
  let log;
  try {
    log = git(`log ${range} --pretty=format:%s`);
  } catch {
    // shallow clone may not have HEAD~30; fall back to whatever we can see
    log = git('log --pretty=format:%s');
  }
  return log.split('\n').filter(Boolean);
}

function parseCommit(line) {
  // Match: "type(scope)?: subject"  — scope/breaking marker tolerated
  const m = line.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!m) return null;
  const [, type, scope, breaking, subject] = m;
  return { type: type.toLowerCase(), scope, breaking: !!breaking, subject };
}

function buildNotes(commits) {
  const groups = new Map();
  for (const line of commits) {
    const c = parseCommit(line);
    if (!c) continue;
    if (SKIP_TYPES.has(c.type)) continue;
    if (c.scope && SKIP_SCOPES.has(c.scope.toLowerCase().split(',')[0].trim())) continue;
    const label = TYPE_LABELS[c.type];
    if (!label) continue;
    const bucket = groups.get(label) || [];
    // Strip CI/scope noise from subjects
    let subj = c.subject.replace(/\s*\(#\d+\)\s*$/, '').trim();
    // Drop pure-internal phrases
    if (/^(bump|deps|version|release)/i.test(subj)) continue;
    // 他プラットフォーム名を中立化する。App Store は whatsNew に Android/Google Play 等の
    // 他プラットフォーム言及があると Guideline 2.3.10 で拒否する（submit が事前検出して停止）。
    // Play 側の release-notes でも他OS名は冗長なので、一律に中立な表現へ寄せる。
    subj = neutralizePlatform(subj);
    bucket.push(subj);
    groups.set(label, bucket);
  }

  if (groups.size === 0) return null;

  const lines = [];
  for (const [label, items] of groups) {
    lines.push(label);
    for (const it of items.slice(0, 4)) {
      const oneLine = `・${it}`;
      lines.push(oneLine.length > 80 ? oneLine.slice(0, 77) + '...' : oneLine);
    }
    lines.push('');
  }
  let text = sanitizeForStore(lines.join('\n'));
  if (text.length > 480) text = text.slice(0, 477) + '...';
  return text;
}

const commits = readCommits();
const notes = buildNotes(commits);

if (!notes) {
  console.log('No user-facing commits found; leaving release notes unchanged.');
  process.exit(0);
}

console.log(`Generated release notes (${notes.length} chars):\n`);
console.log(notes);
console.log();

if (WRITE) {
  fs.writeFileSync(OUT_PATH, notes + '\n', 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
} else {
  console.log(`(dry-run; pass --write to overwrite ${OUT_PATH})`);
}
