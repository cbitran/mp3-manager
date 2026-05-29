// Limita chamadas IPC concorrentes ao Rust.
// Sem isso, carregar 500 faixas dispara ~1000 invoke() simultâneos,
// que trava o WebView2 no Windows por vários segundos.
const MAX_CONCURRENT = 8;
let running = 0;
const queue: Array<() => void> = [];

export function queuedInvoke<T>(fn: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      let freed = false; // garante que o slot é liberado exatamente uma vez

      const free = () => {
        if (freed) return;
        freed = true;
        running--;
        if (queue.length > 0) queue.shift()!();
      };

      const timer = setTimeout(() => {
        free();
        reject(new Error("IPC timeout"));
      }, timeoutMs);

      fn()
        .then((v) => { clearTimeout(timer); free(); resolve(v); })
        .catch((e) => { clearTimeout(timer); free(); reject(e); });
    };
    if (running < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}
