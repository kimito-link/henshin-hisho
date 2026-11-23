// 正本は web-ios-android/templates/shared/ai-triage/json-repair.mjs、同期対象。こちらだけ直さない
// templates/shared/ai-triage/json-repair.mjs
//
// AI応答のJSONが途中で切れた場合に修復する、外部依存ゼロの純粋関数群。
//
// ■ 出どころ
//   henshin-hisho/backend/src/triage.js（2026-11-18 時点の実コード）から、
//   ロジックを変えずにそのまま抜き出した（関数名も henshin-hisho 側に揃えた）。
//   同じものが gmail-secretary-extension/sw/features/gmail-inbox/triage.js にも
//   別コピーとしてある（そちらでは canParseJson が tryParseJson という名前）。
//
// ■ なぜ共有にするか
//   2つのリポへ別々にコピーされたあと、片方だけ直す・片方だけ足すことが起き、
//   中身が少しずつずれていた（2026-09-08 発見。設計:
//   _docs/DESIGN-ai-triage-shared-module-2026-09-08.md）。
//   正本をここ1か所に置き、各リポへは同じ中身を配って check-drift で割れを見張る。
//
// ■ 守ること（契約）
//   - import を書かない（外部依存ゼロ）。Cloudflare Workers（henshin-hisho）と
//     Chrome拡張の service worker（gmail-secretary-extension）の両方でそのまま読めるようにするため。
//   - 純粋関数だけを置く。callLLM・normalizeText・keywordRiskOverlay などの
//     各リポ固有の処理はここへ持ち込まない。

export function scanJsonFragment(text) {
  let inString = false;
  let escaped = false;
  const stack = [];
  const commas = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop();
    else if (ch === ',') commas.push(i);
  }
  return { inString, stack, commas };
}

export function closeOpenJsonStructures(text) {
  let repaired = String(text || '').replace(/[ \t\r\n]+$/, '');
  let state = scanJsonFragment(repaired);
  if (state.inString) repaired += '"';
  state = scanJsonFragment(repaired);
  while (state.stack.length) repaired += state.stack.pop() === '{' ? '}' : ']';
  return repaired;
}

export function canParseJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function repairCandidate(fragment) {
  let repaired = String(fragment || '').replace(/[ \t\r\n]+$/, '');
  const state = scanJsonFragment(repaired);
  if (!state.inString) {
    const trimmed = repaired.replace(/[ \t\r\n]+$/, '');
    if (trimmed.endsWith(',')) {
      repaired = trimmed.slice(0, -1).replace(/[ \t\r\n]+$/, '');
    } else if (trimmed.endsWith(':')) {
      const lastComma = state.commas[state.commas.length - 1];
      if (Number.isFinite(lastComma)) repaired = repaired.slice(0, lastComma).replace(/[ \t\r\n]+$/, '');
    }
  }
  return closeOpenJsonStructures(repaired);
}

export function repairTruncatedJson(fragment) {
  let candidate = String(fragment || '');
  for (let i = 0; i < 12; i += 1) {
    const repaired = repairCandidate(candidate);
    if (canParseJson(repaired)) return repaired;
    const state = scanJsonFragment(candidate);
    const lastComma = state.commas[state.commas.length - 1];
    if (!Number.isFinite(lastComma) || lastComma <= 0) break;
    candidate = candidate.slice(0, lastComma);
  }
  return null;
}

export function extractTriageJson(value) {
  const raw = String(value || '').trim();
  if (!raw) return { data: {}, status: 'failed' };
  const start = raw.indexOf('{');
  if (start < 0) return { data: {}, status: 'failed' };

  try {
    return { data: JSON.parse(raw), status: 'ok' };
  } catch {
    const end = raw.lastIndexOf('}');
    if (end > start) {
      try {
        return { data: JSON.parse(raw.slice(start, end + 1)), status: 'ok' };
      } catch {
        // Try truncated JSON repair below.
      }
    }
  }

  const repaired = repairTruncatedJson(raw.slice(start));
  if (repaired !== null) {
    try {
      return { data: JSON.parse(repaired), status: 'repaired' };
    } catch {
      // Fall through.
    }
  }
  return { data: {}, status: 'failed' };
}

export function isRescueNeeded(triage = {}) {
  if (triage.parseStatus === 'failed') return true;
  if (triage.parseStatus === 'repaired' && triage.category === 'unknown') return true;
  return false;
}
