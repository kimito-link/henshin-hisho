// テスト用の最小 D1。cost-guard.js が使う2文（UPSERT … RETURNING / UPDATE … value - ?2）だけを実装する。
// ★知らない SQL は投げる（黙って成功させると、ガードが効いていないのにテストが緑になる）。
export function createFakeD1() {
  const counters = new Map();
  return {
    counters,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.startsWith('INSERT INTO cost_counters')) {
                const [key, amount] = args;
                const next = (counters.get(key) || 0) + amount;
                counters.set(key, next);
                return { value: next };
              }
              throw new Error(`fake-d1: unsupported first(): ${sql}`);
            },
            async run() {
              if (sql.startsWith('UPDATE cost_counters SET value = value - ?2')) {
                const [key, amount] = args;
                if (counters.has(key)) counters.set(key, counters.get(key) - amount);
                return { success: true };
              }
              throw new Error(`fake-d1: unsupported run(): ${sql}`);
            }
          };
        }
      };
    }
  };
}
