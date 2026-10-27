/**
 * Synthesis worker: renders bank jobs off the main thread. The main thread hands
 * out job keys one at a time (pull queue) so several workers share the load.
 */
import { hashStr, Rng, setSampleRate } from './dsp'
import { buildMusicJobs } from './music'
import { buildCoreJobs, type Job } from './synth'

export interface WorkerResult {
  key: string
  rate: number
  /** variations → channels */
  chans: Float32Array[][]
  ms: number
}

const jobs = new Map<string, Job>()
for (const j of [...buildCoreJobs(), ...buildMusicJobs()]) jobs.set(j.key, j)

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<string>) => void) | null
  postMessage(msg: WorkerResult, transfer: Transferable[]): void
}

scope.onmessage = (e) => {
  const job = jobs.get(e.data)
  const t0 = performance.now()
  const rate = job?.rate ?? 44100
  const chans: Float32Array[][] = []
  const transfer: Transferable[] = []
  if (job) {
    for (let i = 0; i < job.count; i++) {
      setSampleRate(rate)
      try {
        const r = job.make(i, new Rng(hashStr(job.key) + i * 7919))
        const c = Array.isArray(r) ? r : [r]
        chans.push(c)
        for (const a of c) transfer.push(a.buffer)
      } catch (err) {
        console.warn('[audio worker] synth failed for', job.key, err)
      }
    }
  }
  scope.postMessage({ key: e.data, rate, chans, ms: performance.now() - t0 }, transfer)
}
