// 正本は web-ios-android/templates/shared/ai-triage/draft-tone.mjs、同期対象。こちらだけ直さない
// templates/shared/ai-triage/draft-tone.mjs
//
// 返信下書きのトーン（言い方）の定義と、その選び方。外部依存ゼロの純粋な定数・関数。
//
// ■ 出どころ
//   henshin-hisho/backend/src/draft-gen.js（2026-11-18 時点の実コード）から、
//   中身を変えずにそのまま抜き出した。同じ定義が gmail-secretary-extension の
//   draft-gen.js にも GMAIL_DRAFT_TONE_INSTRUCTIONS という名前で別コピーとしてある。
//
// ■ なぜ共有にするか
//   2つのリポで、日本語の指示文まで同じ定義が別々にコピーされていた
//   （2026-09-08 発見。設計: _docs/DESIGN-ai-triage-shared-module-2026-09-08.md）。
//   片方だけトーンを足す・直すと、同じ「丁寧に」でも製品ごとに下書きが変わってしまう。
//   正本をここ1か所に置き、各リポへは同じ中身を配って check-drift で割れを見張る。
//
// ■ 守ること（契約）
//   - import を書かない（外部依存ゼロ）。Cloudflare Workers と Chrome拡張の両方で読めるようにするため。
//   - プロンプト本体（buildDraftPrompt など）は accountPolicy と結びついていて各リポで違うので、ここへ持ち込まない。

export const DRAFT_TONE_INSTRUCTIONS = Object.freeze({
  polite: '丁寧に',
  firm: 'はっきり強めに、ただし攻撃的にしない',
  calm: '冷静に感情を抑えて',
  casual: 'いつもの砕けた調子で'
});

export function pickTone(value) {
  return Object.prototype.hasOwnProperty.call(DRAFT_TONE_INSTRUCTIONS, value) ? value : 'polite';
}
