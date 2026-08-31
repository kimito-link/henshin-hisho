/**
 * visibility.js — 誰の発言をAIコンテキストに出してよいかを決める、二段階防御の第1段。
 *
 * 設計: docs/PROJECT-AI-IMPLEMENTATION-HANDOFF.md C節。
 *
 * 第1段（このファイル）: メッセージ取り込み時に senderRole / visibility を確定して永続化する。
 * 第2段（db.js の fetchProjectMessages）: 取得時にSQLのWHERE句で再フィルタする。
 * AIプロンプトはどちらの防御にも数えない（プロンプト任せは会議で明確に却下済み）。
 *
 * ★実演で確認した2つの実データケースへの対応:
 *   - 同じ source='chatwork' でも、相手が顧客かエンジニアかでvisibilityの既定値が変わる
 *     → project_channel_links.counterpart_role（ルーム単位の登録値）で決める。sourceでは決めない。
 *   - 同一ルーム内に顧客予算とエンジニア原価が混在する
 *     → counterpart_role='mixed' で登録し、既定は internal（fail-closed）。
 *       公開してよい発言だけを db.js の事後修正APIで public へ昇格する。
 *       「既定はルーム単位、例外はメッセージ単位」の2層構造。
 */

/**
 * senderRoleを判定する。表示名の文字列一致には一切頼らない
 * （実演で同一人物がサービスごとに異なる表示名を使っている実例を確認したため）。
 *
 * @param {{ source: string, senderAccountId: string, channelLink: { counterpart_role: string }, staffMap: Map<string, {staff_role: string}> }} params
 * @returns {'internal'|'engineer'|'customer'|'unknown'}
 */
export function decideSenderRole({ source, senderAccountId, channelLink, staffMap }) {
  const staff = staffMap.get(`${source}:${String(senderAccountId)}`);
  if (staff) return staff.staff_role === 'engineer' ? 'engineer' : 'internal';
  if (channelLink.counterpart_role === 'customer') return 'customer';
  if (channelLink.counterpart_role === 'engineer') return 'engineer';
  return 'unknown'; // mixedルームの未登録者
}

/**
 * visibilityを決定する。ルーム単位の既定値が正で、メッセージ単位の例外は
 * db.js の patchMessageVisibility で事後に付与する（このファイルの責務外）。
 *
 * @param {{ senderRole: string, channelLink: { counterpart_role: string } }} params
 * @returns {'public'|'internal'}
 */
export function decideVisibility({ senderRole, channelLink }) {
  // ルール1: 顧客窓口ルームは全発言public（顧客が既に見ている情報だから。
  //          自分の発言もエンジニアが顧客ルームに書いた発言もpublic）。
  if (channelLink.counterpart_role === 'customer') return 'public';
  // ルール2: エンジニア窓口ルームは全発言internal（原価・内部相談の器）。
  if (channelLink.counterpart_role === 'engineer') return 'internal';
  // ルール3: mixed は fail-closed で全件internal。
  //          誤りの向きが「漏らす」ではなく「引用を控える」側に倒れるのが要点。
  return 'internal';
}

/**
 * default_visibility を counterpart_role から導出する（project_channel_links作成時に使う）。
 * @param {'customer'|'engineer'|'mixed'} counterpartRole
 * @returns {'public'|'internal'}
 */
export function deriveDefaultVisibility(counterpartRole) {
  return counterpartRole === 'customer' ? 'public' : 'internal';
}
