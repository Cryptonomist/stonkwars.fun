/* The hero's picture: a finished fight, labelled as a sample so nobody reads
 * it as a live result. */

import { HealthBars } from "@/components/HealthBars";

export function SampleFight() {
  return (
    <div className="card relative overflow-hidden p-6 pt-10 sm:p-8 sm:pt-12" aria-label="A sample fight">
      <span className="label absolute left-1/2 top-3 -translate-x-1/2 bg-panel-2 px-2 py-0.5">Sample fight</span>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-4">
        <div>
          <span className="label">Challenger</span>
          <p className="display text-6xl text-p1 sm:text-7xl">TSLA</p>
          <p className="font-mono text-3xl text-up">+3.12%</p>
        </div>
        <span className="display pb-2 text-3xl text-ink">VS</span>
        <div className="relative text-right">
          <span className="label">Answered</span>
          <p className="display text-6xl text-p2 opacity-40 sm:text-7xl">NVDA</p>
          <p className="font-mono text-3xl text-down">-0.85%</p>
          <span className="stamp-cooked absolute -top-2 right-0 text-4xl sm:text-5xl">Cooked</span>
        </div>
      </div>
      <div className="mt-6">
        <HealthBars p1Move={3.12} p2Move={-0.85} roundSecs={7 * 86_400} />
      </div>
      {/* Say the payout in shares, not dollars: winning somebody's stock is the
        * part people do not expect. */}
      <div className="mt-6 grid grid-cols-2 gap-3 font-mono text-sm">
        <div className="bg-panel-2 px-3 py-2">
          <span className="label block">On the table</span>
          0.069 TSLAx + 0.114 NVDAx
        </div>
        <div className="bg-panel-2 px-3 py-2 text-right">
          <span className="label block">TSLA walks away with</span>
          <span className="text-up">0.114 NVDAx</span>
          <span className="text-dim"> · $50.57</span>
        </div>
      </div>
    </div>
  );
}
