import { useState } from "react";

// ── Score simulator ────────────────────────────────────────────────────────────
function simulate(likes: number, comments: number, runs: number, hoursAgo: number, gravity: number) {
  const eng = likes * 1 + comments * 2 + runs * 3;
  return (eng + 1) / Math.pow(hoursAgo + 2, gravity);
}

// ── Components ─────────────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-bold text-zinc-100 mt-8 mb-3 border-b border-zinc-700 pb-2">
      {children}
    </h2>
  );
}

function BugCard({
  severity,
  title,
  where,
  problem,
  fix,
}: {
  severity: "critical" | "medium" | "low";
  title: string;
  where: string;
  problem: string;
  fix: string;
}) {
  const colors = {
    critical: "border-red-500 bg-red-500/10",
    medium:   "border-yellow-500 bg-yellow-500/10",
    low:      "border-blue-500 bg-blue-500/10",
  };
  const badges = {
    critical: "bg-red-500 text-white",
    medium:   "bg-yellow-500 text-black",
    low:      "bg-blue-500 text-white",
  };
  const labels = { critical: "CRITICAL", medium: "MEDIUM", low: "LOW" };
  return (
    <div className={`rounded-xl border p-4 mb-3 ${colors[severity]}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badges[severity]}`}>
          {labels[severity]}
        </span>
        <span className="text-sm font-semibold text-zinc-100">{title}</span>
      </div>
      <p className="text-[11px] font-mono text-zinc-400 mb-1">{where}</p>
      <p className="text-xs text-zinc-300 mb-2">🐛 {problem}</p>
      <p className="text-xs text-emerald-400">✅ {fix}</p>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 text-xs text-emerald-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
      {children}
    </pre>
  );
}

function CompareTable() {
  const rows = [
    {
      platform: "Hacker News",
      formula: "(P-1) / (T+2)^1.8",
      timeRef: "createdAt",
      engFormula: "upvotes (linear)",
      gravity: "1.8",
      personalized: "ไม่มี",
      notes: "T = ชั่วโมงนับจากโพสต์ครั้งแรก. ไลค์เพิ่มขึ้นทีหลังไม่ช่วย T. ง่ายที่สุด.",
    },
    {
      platform: "Reddit (hot)",
      formula: "log10(score) + sign × age/45000",
      timeRef: "createdAt",
      engFormula: "log10(upvotes-downvotes)",
      gravity: "≈1.8 equiv.",
      personalized: "บางส่วน",
      notes: "ใช้ log ป้องกัน viral post ครองตลอดกาล. T = วินาทีนับจากสร้าง. Logarithmic compression.",
    },
    {
      platform: "Instagram Feed",
      formula: "ML model (not public)",
      timeRef: "lastActivityAt",
      engFormula: "saves×4 + comments×2 + likes×1",
      gravity: "~1.4–1.6",
      personalized: "สูง (affinity)",
      notes: "Saves = strongest signal. ใช้ ML ทำ interest prediction per user. ไม่มีสูตรคงที่.",
    },
    {
      platform: "TikTok FYP",
      formula: "Neural net (not public)",
      timeRef: "recentActivity",
      engFormula: "completion×5 + replays×3 + shares×2 + comments×1",
      gravity: "aggressive (~2.0)",
      personalized: "สูงมาก",
      notes: "Video completion rate = #1 signal. Content-first, not social-graph-first.",
    },
    {
      platform: "Letterboxd",
      formula: "ไม่เปิดเผย (behavior-based)",
      timeRef: "lastActivityAt (inferred)",
      engFormula: "likes + comments + lists",
      gravity: "~1.4 (inferred)",
      personalized: "บางส่วน",
      notes: "Film review platform ใกล้เคียง Ticker ที่สุด. Content มี shelf life ยาว.",
    },
    {
      platform: "Ticker (ก่อนแก้)",
      formula: "(eng+1) / (lastActivity+2)^1.8",
      timeRef: "lastActivityAt ✓",
      engFormula: "likes×1 + comments×2 + runs×3",
      gravity: "1.8 ❌ เร็วเกินไป",
      personalized: "freshBoost 15×",
      notes: "gravity 1.8 ทำให้โพสต์ 24h หายไปจาก feed. Stale chainCount fallback.",
    },
    {
      platform: "Ticker (หลังแก้)",
      formula: "(eng+1) / (lastActivity+2)^1.5",
      timeRef: "lastActivityAt ✓",
      engFormula: "likes×1 + comments×2 + runs×3",
      gravity: "1.5 ✓ เหมาะกับ Ticker",
      personalized: "freshBoost 15× + mode-aware",
      notes: "gravity 1.5 ให้ content มี shelf life ~3 วัน. Bonus fallback แก้แล้ว. freshBoost แยก mode.",
    },
  ];

  return (
    <div className="overflow-x-auto -mx-4">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-zinc-700">
            {["Platform", "Formula", "Time Reference", "Engagement", "Gravity", "Personalized", "Notes"].map(h => (
              <th key={h} className="text-left text-zinc-400 font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-b border-zinc-800 ${i === rows.length - 1 ? "bg-emerald-900/20" : i === rows.length - 2 ? "bg-red-900/20" : ""}`}>
              <td className="px-3 py-2 font-semibold text-zinc-200 whitespace-nowrap">{r.platform}</td>
              <td className="px-3 py-2 font-mono text-emerald-300 whitespace-nowrap">{r.formula}</td>
              <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{r.timeRef}</td>
              <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{r.engFormula}</td>
              <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{r.gravity}</td>
              <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{r.personalized}</td>
              <td className="px-3 py-2 text-zinc-400 max-w-[240px]">{r.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Simulator() {
  const [likes, setLikes]     = useState(3);
  const [comments, setComments] = useState(0);
  const [runs, setRuns]       = useState(0);
  const [hours, setHours]     = useState(6);

  const scoreNew = simulate(likes, comments, runs, hours, 1.5);
  const scoreOld = simulate(likes, comments, runs, hours, 1.8);

  const slider = (label: string, value: number, setValue: (v: number) => void, max: number, unit = "") => (
    <div className="mb-4">
      <div className="flex justify-between text-xs text-zinc-400 mb-1">
        <span>{label}</span>
        <span className="font-mono text-zinc-200">{value}{unit}</span>
      </div>
      <input
        type="range" min={0} max={max} step={max >= 100 ? 1 : 1} value={value}
        onChange={e => setValue(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </div>
  );

  const bar = (score: number, max: number, color: string) => {
    const pct = Math.min(score / max, 1) * 100;
    return (
      <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
    );
  };

  const maxScore = Math.max(scoreNew, scoreOld, 0.01) * 1.2;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4">
      <div className="grid grid-cols-2 gap-6">
        <div>
          {slider("Likes ❤️", likes, setLikes, 50)}
          {slider("Comments 💬", comments, setComments, 20)}
          {slider("Chain Runs 🔗", runs, setRuns, 20)}
          {slider("ชั่วโมงที่ผ่านมา ⏰", hours, setHours, 168, "h")}
        </div>
        <div className="flex flex-col gap-4 justify-center">
          <div>
            <p className="text-xs text-zinc-400 mb-1">gravity=1.5 (ใหม่) <span className="text-emerald-400">✓</span></p>
            {bar(scoreNew, maxScore, "bg-emerald-500")}
            <p className="font-mono text-emerald-400 text-sm mt-1">{scoreNew.toFixed(4)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-400 mb-1">gravity=1.8 (เก่า)</p>
            {bar(scoreOld, maxScore, "bg-red-500")}
            <p className="font-mono text-red-400 text-sm mt-1">{scoreOld.toFixed(4)}</p>
          </div>
          <div className="text-xs text-zinc-500 border-t border-zinc-700 pt-3 mt-1">
            <p>Engagement = {likes}×1 + {comments}×2 + {runs}×3 = <span className="text-zinc-300">{likes + comments * 2 + runs * 3}</span></p>
            <p>Age divisor (1.5) = {(hours + 2).toFixed(1)}^1.5 = <span className="text-zinc-300">{Math.pow(hours + 2, 1.5).toFixed(2)}</span></p>
            <p>Age divisor (1.8) = {(hours + 2).toFixed(1)}^1.8 = <span className="text-zinc-300">{Math.pow(hours + 2, 1.8).toFixed(2)}</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function AlgorithmLab() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 pb-20">
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="pt-12 pb-4">
          <p className="text-xs font-mono text-emerald-500 mb-1">TICKER ENGINEERING</p>
          <h1 className="text-2xl font-bold text-zinc-100">Algorithm Lab</h1>
          <p className="text-sm text-zinc-400 mt-1">
            วิเคราะห์ ranking algorithm ทุกบรรทัด เทียบกับแพลตฟอร์มจริง และสรุปสิ่งที่แก้แล้ว
          </p>
        </div>

        {/* ── Formula ──────────────────────────────────────────────────────── */}
        <SectionTitle>สูตร Algorithm ของ Ticker (หลังแก้)</SectionTitle>
        <Code>{`// hot-score.ts  (gravity: 1.8 → 1.5)
score = (engagement + 1) / (hoursAgo + 2) ^ 1.5

engagement = likes × 1
           + comments × 2
           + chain_runs × 3

hoursAgo = ชั่วโมงนับจาก lastActivityAt
           (ไลค์/คอมเม้น/chain-run ล่าสุด — ไม่ใช่วันที่สร้าง)

freshBoost (60 นาทีแรก):
  โพสต์ของตัวเอง + ผู้ที่ Follow (เฉพาะ home/following mode)
  → 15× ที่ t=0, เส้นตรงลง → 1× ที่ t=60 นาที
  → discover/explore mode: boost เฉพาะโพสต์ตัวเอง`}</Code>

        <div className="text-xs text-zinc-400 mt-3 space-y-1">
          <p>• <strong className="text-zinc-200">+1</strong> ในตัวเศษ = โพสต์ใหม่ 0 engagement ยัง score ≈ 0.35 ไม่หายไปทันที</p>
          <p>• <strong className="text-zinc-200">+2</strong> ในตัวส่วน = หลีกเลี่ยง division near-zero สำหรับโพสต์ใหม่มากๆ</p>
          <p>• <strong className="text-zinc-200">lastActivityAt</strong> ≠ createdAt — โพสต์เก่าสามารถ "ฟื้น" ได้เมื่อมีไลค์ใหม่ (ต่างจาก HN/Reddit ที่ใช้ createdAt คงที่)</p>
        </div>

        {/* ── Score examples ────────────────────────────────────────────────── */}
        <SectionTitle>ตัวอย่าง Score (gravity=1.5)</SectionTitle>
        <div className="overflow-x-auto -mx-4">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-700">
                {["Likes", "Comments", "Runs", "ชั่วโมงที่แล้ว", "Score (1.5)", "Score (1.8 เก่า)", "ต่างกัน"].map(h => (
                  <th key={h} className="text-left text-zinc-400 font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                [0, 0, 0, 0],
                [3, 0, 0, 1],
                [3, 0, 0, 6],
                [4, 0, 0, 6],
                [3, 1, 0, 6],
                [5, 0, 0, 12],
                [3, 0, 0, 24],
                [10, 2, 1, 24],
                [3, 0, 0, 72],
              ].map(([l, c, r, h], i) => {
                const s15 = simulate(l, c, r, h, 1.5);
                const s18 = simulate(l, c, r, h, 1.8);
                const diff = ((s15 / s18 - 1) * 100).toFixed(0);
                return (
                  <tr key={i} className="border-b border-zinc-800">
                    <td className="px-3 py-1.5 text-zinc-300">{l}</td>
                    <td className="px-3 py-1.5 text-zinc-300">{c}</td>
                    <td className="px-3 py-1.5 text-zinc-300">{r}</td>
                    <td className="px-3 py-1.5 text-zinc-300">{h}h</td>
                    <td className="px-3 py-1.5 font-mono text-emerald-400">{s15.toFixed(4)}</td>
                    <td className="px-3 py-1.5 font-mono text-red-400">{s18.toFixed(4)}</td>
                    <td className={`px-3 py-1.5 font-mono text-xs ${Number(diff) > 0 ? "text-emerald-400" : "text-zinc-500"}`}>
                      {Number(diff) > 0 ? `+${diff}%` : `${diff}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          gravity=1.5 ทำให้โพสต์เก่าอยู่ได้นานขึ้น (~2–3× ดีขึ้นสำหรับ 24h+) เหมาะกับ Ticker ที่โพสต์มีน้อยกว่า HN/Reddit มาก
        </p>

        {/* ── Simulator ─────────────────────────────────────────────────────── */}
        <SectionTitle>Score Simulator</SectionTitle>
        <Simulator />

        {/* ── Bugs Found ────────────────────────────────────────────────────── */}
        <SectionTitle>Bug ที่พบจากการอ่านทุกบรรทัด (แก้แล้วทั้งหมด)</SectionTitle>

        <BugCard
          severity="critical"
          title="gravity = 1.8 เร็วเกินไปสำหรับ Ticker"
          where="hot-score.ts:21 — export const HOT_GRAVITY = 1.8"
          problem="HN gravity 1.8 ถูก design มาสำหรับแพลตฟอร์มที่มีโพสต์ใหม่หลักพันชิ้น/วัน มันทำให้โพสต์ที่ 24h มี score เหลือแค่ 3% ของโพสต์ใหม่ (divisor 26^1.8 = 329 vs 2^1.8 = 3.5). บน Ticker ที่มีโพสต์ใหม่น้อย โพสต์ที่มีไลค์มากจะหายไปเร็วมาก."
          fix="เปลี่ยนเป็น gravity = 1.5 — ทำให้โพสต์ 24h มี divisor 26^1.5 = 132 แทน 329 (2.5× ช้าลง). โพสต์ quality สูงอยู่ใน feed ได้ ~3 วัน ซึ่งเหมาะกับ Letterboxd-style platform."
        />

        <BugCard
          severity="critical"
          title="bonus: runMap ?? c.chainCount — stale data fallback"
          where="chains.ts:331,569 / feed.ts:314 — bonus: runMap.get(c.id) ?? c.chainCount"
          problem="เมื่อ runMap ไม่มีข้อมูล (0 runs จริงๆ) แทนที่จะ fallback เป็น 0 กลับ fallback ไปที่ chainCount column ที่ denormalized และอาจ stale. Chain ที่ chainCount=1 จากเหตุผลอื่น (เช่น creator count) จะได้รับ +3 engagement points ฟรีโดยไม่มี run จริงๆ."
          fix="เปลี่ยนเป็น runMap.get(c.id) ?? 0 ทุก endpoint (chains.ts explore, chains.ts hot, feed.ts). ถ้า runMap ไม่มีข้อมูลหมายความว่าไม่มี run จริงๆ = 0."
        />

        <BugCard
          severity="medium"
          title="freshBoost mode inconsistency — explore vs home feed"
          where="chains.ts:325 (explore/hot) — makeFreshBoost(followedSet)"
          problem="ใน feed.ts discover mode: boost เฉพาะโพสต์ตัวเอง (ถูก). แต่ใน chains.ts explore และ hot endpoint: makeFreshBoost(followedSet) boost ทั้ง followed users ด้วย ทำให้ creator ที่ user follow ได้ boost ใน global explore ranking — ไม่ fair สำหรับ creator อื่น."
          fix="chains.ts ทุก endpoint ส่ง currentUserId แยกออกมา: makeFreshBoost(followedSet, currentUserId). อ่าน followedSet จาก followRows ตามปกติ แต่ freshBoost ใน explore/hot = ทำงาน mode-aware แบบเดียวกับ feed.ts."
        />

        <BugCard
          severity="medium"
          title="makeAffinity() — dead code"
          where="hot-score.ts:53 / chains.ts:324,561 — const affinityFn = makeAffinity(followedSet)"
          problem="makeAffinity ส่งคืน () => 1.0 ทุกกรณี ไม่มีผลต่อ score เลย แต่ถูกเรียกทุก chain ทุก request เป็น redundant computation และทำให้ code อ่านยากเพราะคิดว่ามี personalization ที่ทำงานจริง."
          fix="ลบ makeAffinity() ออกทั้งหมด. ถ้าต้องการ affinity จริงในอนาคต implement ใหม่ที่ทำงานจริง (เช่น followed users = 1.2× permanent boost)."
        />

        <BugCard
          severity="low"
          title="POOL pool selection bias — ใช้ lastActivityAt เป็น gate"
          where="feed.ts:38 / chains.ts POOL queries — ORDER BY GREATEST(createdAt, ...) LIMIT POOL"
          problem="Pool คัด candidate จากการ ORDER BY lastActivityAt DESC แล้ว LIMIT. ถ้ามี chain ที่ไลค์มากมายจาก 2 สัปดาห์ก่อน แต่ไม่มีกิจกรรมใหม่ chain นั้นอาจไม่เข้า pool เลย. POOL=limit×4 ซึ่งเล็กเกินไปสำหรับ edge case นี้."
          fix="POOL เพิ่มเป็น limit×8 (ถ้ามีข้อมูลมาก) หรือยอมรับว่า algorithm เน้น recency จึง OK ที่ stale content ไม่ขึ้น. สำหรับ Ticker ขนาดปัจจุบันไม่ critical."
        />

        <BugCard
          severity="low"
          title="Bookmark/Save signal ขาด"
          where="feed.ts + chains.ts — ไม่มี bookmarks ใน engagement"
          problem="Bookmark (save) เป็น signal ที่แข็งแกร่งมากในอุตสาหกรรม: Instagram ให้ saves weight สูงกว่า likes 4×, Twitter ใช้ bookmarks เป็น quality signal. Ticker มีข้อมูล bookmarks/chain_bookmarks ในฐานข้อมูลแต่ไม่ได้ใช้ใน ranking."
          fix="เพิ่ม saves×2 ใน engagement = likes×1 + comments×2 + saves×2 + chainRuns×3 (Future work — ต้อง join bookmarks table ใน pool query)."
        />

        {/* ── Platform Comparison ───────────────────────────────────────────── */}
        <SectionTitle>เทียบกับ Algorithm จริงในอุตสาหกรรม</SectionTitle>
        <CompareTable />

        <div className="mt-4 text-xs text-zinc-400 space-y-2">
          <p><strong className="text-zinc-200">HN vs Ticker</strong>: HN ใช้ T=createdAt (คงที่) ดังนั้นโพสต์เก่าไม่มีทางฟื้น. Ticker ใช้ lastActivityAt (dynamic) ทำให้ review เก่าที่มีคนกด like ใหม่ขึ้นมาได้ — เหมาะกว่าสำหรับ social film platform.</p>
          <p><strong className="text-zinc-200">Reddit vs Ticker</strong>: Reddit ใช้ log10(votes) ป้องกัน viral post ครองตลอดกาล. Ticker ใช้ linear engagement ซึ่ง OK ตราบใดที่ engagement ยังต่ำ (&lt; 1,000 likes). เมื่อ scale ขึ้นควรเพิ่ม log.</p>
          <p><strong className="text-zinc-200">Instagram vs Ticker</strong>: Instagram ML-based personalization ทำงานแบบ per-user ทุก request. Ticker ใช้ simple hotScore + freshBoost ซึ่งเหมาะกับ scale ปัจจุบัน. เมื่อมี traffic มากพอค่อยเพิ่ม personalization.</p>
          <p><strong className="text-zinc-200">Letterboxd (closest comparable)</strong>: Film review platform คล้าย Ticker ที่สุด. ไม่เปิดเผยสูตร แต่ behavior บ่งบอกว่าใช้ recency + engagement คล้ายกัน. gravity ~1.4 (inferred) ใกล้กับ 1.5 ที่เราใช้อยู่.</p>
        </div>

        {/* ── Summary ───────────────────────────────────────────────────────── */}
        <SectionTitle>สรุปสิ่งที่แก้แล้ว</SectionTitle>
        <div className="bg-emerald-900/20 border border-emerald-700 rounded-xl p-4 space-y-2 text-xs">
          {[
            ["hot-score.ts", "gravity: 1.8 → 1.5 (โพสต์อยู่ใน feed ได้ ~3 วันแทน ~12 ชั่วโมง)"],
            ["hot-score.ts", "makeFreshBoost() signature ใหม่: รับ followedSet + currentUserId แยกกัน"],
            ["hot-score.ts", "ลบ makeAffinity() dead code ออกทั้งหมด"],
            ["chains.ts (explore)", "bonus: runMap.get(c.id) ?? 0 — ไม่ fallback หา stale chainCount"],
            ["chains.ts (explore)", "ลบ affinityFn dead code, freshBoostFn mode-aware"],
            ["chains.ts (hot)", "bonus: runMap.get(c.id) ?? 0 — เหมือน explore"],
            ["chains.ts (hot)", "ลบ affinityFn dead code, freshBoostFn mode-aware"],
            ["feed.ts", "ใช้ makeFreshBoost() shared helper แทน inline duplicate"],
            ["feed.ts", "bonus: runMap.get(c.id) ?? 0 — เหมือน chains.ts"],
            ["feed.ts (+ chains)", "tiebreaker: เมื่อ score เท่ากัน → createdAt DESC (ใหม่กว่าขึ้นก่อน)"],
          ].map(([file, desc], i) => (
            <div key={i} className="flex gap-2">
              <span className="text-emerald-400 mt-0.5 flex-shrink-0">✓</span>
              <span>
                <span className="font-mono text-emerald-300 mr-2">{file}</span>
                <span className="text-zinc-300">{desc}</span>
              </span>
            </div>
          ))}
        </div>

        {/* ── Future Recommendations ────────────────────────────────────────── */}
        <SectionTitle>สิ่งที่ควรทำในอนาคต (ยังไม่แก้)</SectionTitle>
        <div className="space-y-2 text-xs text-zinc-400">
          {[
            ["Bookmark signal", "เพิ่ม saves×2 ใน engagement — เป็น strongest intent signal ใน industry"],
            ["Log compression", "เมื่อไลค์ > 100: ใช้ Math.log2(likes+1) แทน linear — ป้องกัน viral post ครอง feed"],
            ["User diversity cap", "จำกัด 2-3 โพสต์จาก user เดียวกันต่อ page — prevent feed domination"],
            ["POOL expansion", "POOL = limit×8 เพื่อ accuracy ดีขึ้น โดยเฉพาะเมื่อ content เยอะขึ้น"],
            ["Affinity implementation", "ถ้าต้องการ: followed users = 1.2× permanent ไม่ใช่แค่ 1.0"],
          ].map(([title, desc], i) => (
            <div key={i} className="flex gap-2 border border-zinc-800 rounded-lg p-3">
              <span className="text-yellow-500 mt-0.5 flex-shrink-0">→</span>
              <span>
                <span className="text-zinc-200 font-semibold mr-2">{title}</span>
                <span>{desc}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center text-xs text-zinc-600 pb-4">
          Ticker Algorithm Lab • gravity=1.5 • lastActivityAt-based scoring
        </div>
      </div>
    </div>
  );
}
