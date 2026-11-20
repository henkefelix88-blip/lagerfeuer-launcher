/**
 * Kurzer Leistungscheck (ca. 1 Sekunde) für die automatische Host-Wahl.
 *
 * Score = CPU-Multicore-Durchsatz (Web Worker auf allen Kernen, max. 16)
 *         × GPU-Faktor (dedizierte Grafikkarte > integrierte)
 *         + RAM-Bonus
 * Der Host-Server simuliert Physik/Treffer hauptsächlich auf der CPU – deshalb zählt sie am meisten.
 */
const WORKER_SRC = `
  onmessage = (e) => {
    const end = performance.now() + e.data;
    let ops = 0, x = 1.0001;
    while (performance.now() < end) {
      for (let i = 0; i < 20000; i++) { x = Math.sqrt(x * 1.000001 + i) % 1000 + Math.sin(i) * 0.0001; }
      ops += 20000;
    }
    postMessage(ops + (x > 1e12 ? 1 : 0));
  };`;

function runWorkers(count, ms) {
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  const jobs = [];
  for (let i = 0; i < count; i++) {
    jobs.push(new Promise((resolve) => {
      const w = new Worker(url);
      w.onmessage = (e) => { resolve(e.data); w.terminate(); };
      w.onerror = () => { resolve(0); w.terminate(); };
      w.postMessage(ms);
    }));
  }
  return Promise.all(jobs).finally(() => URL.revokeObjectURL(url));
}

function gpuInfo() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    // "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x…) Direct3D11 …, D3D11)" → "NVIDIA GeForce RTX 4070"
    const m = String(name).match(/^ANGLE \(([^,]*),\s*([^,]*)/);
    const clean = (m ? m[2] : String(name)).replace(/\s*\(0x[0-9a-f]+\).*$/i, '').replace(/\s+Direct3D.*$/i, '');
    return clean.trim() || 'Unbekannte GPU';
  } catch {
    return 'Unbekannte GPU';
  }
}

function gpuFactor(name) {
  const n = name.toLowerCase();
  if (/rtx|radeon rx 7|radeon rx 9|rx 6[789]/.test(n)) return 1.5;
  if (/gtx|radeon rx|arc a|quadro|geforce/.test(n)) return 1.3;
  if (/swiftshader|llvmpipe|basic render/.test(n)) return 0.6;
  return 1.0; // integriert / unbekannt
}

/** @returns {Promise<{score:number,cpu:string,cores:number,ramGb:number,gpu:string}>} */
export async function runPerfCheck(systemInfo) {
  const cores = Math.max(1, Math.min(16, navigator.hardwareConcurrency || systemInfo.cores || 4));
  const results = await runWorkers(cores, 900);
  const total = results.reduce((a, b) => a + b, 0);
  const gpu = gpuInfo();
  const score = Math.round((total / 100000) * gpuFactor(gpu) + systemInfo.ramGb * 2);
  return { score, cpu: systemInfo.cpu, cores: systemInfo.cores, ramGb: systemInfo.ramGb, gpu };
}
