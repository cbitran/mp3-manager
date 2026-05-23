// Limita chamadas IPC concorrentes ao Rust.
// Sem isso, carregar 500 faixas dispara ~1000 invoke() simultâneos,
// que trava o WebView2 no Windows por vários segundos.
const MAX_CONCURRENT = 8;
let running = 0;
const queue: Array<() => void> = [];

export function queuedInvoke<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          running--;
          if (queue.length > 0) queue.shift()!();
        });
    };
    if (running < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}
