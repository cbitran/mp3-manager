// Limita chamadas IPC concorrentes ao Rust.
// Sem isso, carregar 500 faixas dispara ~1000 invoke() simultâneos,
// que trava o WebView2 no Windows por vários segundos.
const MAX_CONCURRENT = 8;
let running = 0;
const queue: Array<() => void> = [];

// Queue separada com menor concorrência para pré-carregamento de PCM.
// Evita que preloads de PCM bloqueiem a geração de waveforms visuais.
const PCM_MAX = 2;
let pcmRunning = 0;
const pcmQueue: Array<() => void> = [];

export function pcmPreloadInvoke<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      pcmRunning++;
      let freed = false;
      const free = () => {
        if (freed) return;
        freed = true;
        pcmRunning--;
        if (pcmQueue.length > 0) pcmQueue.shift()!();
      };
      const timer = setTimeout(() => { free(); reject(new Error("PCM timeout")); }, 90_000);
      fn()
        .then((v) => { clearTimeout(timer); free(); resolve(v); })
        .catch((e) => { clearTimeout(timer); free(); reject(e); });
    };
    if (pcmRunning < PCM_MAX) run();
    else pcmQueue.push(run);
  });
}

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
