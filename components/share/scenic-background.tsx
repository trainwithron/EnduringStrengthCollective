import type { ScenicBackgroundKey } from "@/lib/scenic-backgrounds";

// Real production CSS-gradient scenes, matching the reviewed mockup
// exactly — flat/geometric composition consistent with the app's own
// rust/graphite/chalk visual identity, not photorealistic.
export function ScenicBackground({ background }: { background: ScenicBackgroundKey }) {
  if (background === "coastal") {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg,#3a2f52 0%,#a2567a 28%,#e08a56 46%,#f4b96a 55%,#8fa5a8 62%,#5a7378 100%)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            left: "50%",
            top: "40%",
            width: 160,
            height: 160,
            background: "radial-gradient(circle, rgba(255,220,160,.9), rgba(255,180,110,0) 70%)",
            transform: "translate(-50%, -50%)",
          }}
        />
        <div
          className="absolute left-0 right-0 bottom-0 bg-graphite opacity-55"
          style={{
            height: "38%",
            clipPath:
              "polygon(0 40%,15% 30%,32% 46%,50% 22%,68% 38%,84% 18%,100% 34%,100% 100%,0 100%)",
          }}
        />
        <div
          className="absolute left-0 right-0 bottom-0 bg-graphite opacity-85"
          style={{
            height: "26%",
            clipPath:
              "polygon(0 55%,20% 35%,38% 58%,58% 30%,78% 52%,100% 40%,100% 100%,0 100%)",
          }}
        />
      </div>
    );
  }

  if (background === "vegas") {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg,#241a3d 0%,#4a2f5e 32%,#8a4a5e 52%,#c97a52 68%,#e8a95f 100%)",
          }}
        />
        <div
          className="absolute left-0 right-0 bottom-0 opacity-70"
          style={{
            height: "22%",
            background: "#2a2038",
            clipPath:
              "polygon(0 60%,10% 30%,22% 55%,36% 15%,50% 48%,64% 20%,78% 50%,90% 25%,100% 45%,100% 100%,0 100%)",
          }}
        />
        <div className="absolute left-0 right-0 bottom-0" style={{ height: "34%" }}>
          {[
            { left: "6%", w: 14, h: "60%" },
            { left: "14%", w: 20, h: "85%" },
            { left: "26%", w: 12, h: "45%" },
            { left: "34%", w: 24, h: "95%" },
            { left: "44%", w: 16, h: "55%" },
            { left: "54%", w: 28, h: "100%" },
            { left: "65%", w: 14, h: "50%" },
            { left: "73%", w: 18, h: "70%" },
            { left: "84%", w: 22, h: "88%" },
            { left: "94%", w: 12, h: "40%" },
          ].map((b, i) => (
            <div
              key={i}
              className="absolute bottom-0"
              style={{ left: b.left, width: b.w, height: b.h, background: "#171420" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (background === "sunrise") {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg,#4a3a63 0%,#a8567a 32%,#e08a5e 55%,#f4c56a 72%,#8aa3a0 100%)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            left: "50%",
            top: "58%",
            width: 130,
            height: 130,
            background: "radial-gradient(circle, rgba(255,224,170,.95), rgba(255,190,120,0) 68%)",
            transform: "translate(-50%, -50%)",
          }}
        />
        <div
          className="absolute left-0 right-0 bottom-0 bg-graphite opacity-90"
          style={{
            height: "42%",
            clipPath:
              "polygon(0 55%,12% 20%,24% 48%,34% 8%,46% 38%,58% 4%,70% 34%,82% 12%,92% 40%,100% 22%,100% 100%,0 100%)",
          }}
        />
        <div
          className="absolute left-0 right-0 bottom-0 bg-graphite"
          style={{
            height: "20%",
            clipPath: "polygon(0 65%,20% 40%,40% 60%,60% 30%,80% 55%,100% 45%,100% 100%,0 100%)",
          }}
        />
      </div>
    );
  }

  if (background === "desert") {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg,#2b1f3d 0%,#5a2f4a 30%,#a4453f 52%,#d97a3f 68%,#f0b35e 100%)",
          }}
        />
        <div
          className="absolute left-0 right-0 bottom-0 opacity-80"
          style={{
            height: "30%",
            background: "#3a2438",
            clipPath: "polygon(0 40%,25% 40%,25% 18%,50% 18%,50% 32%,75% 32%,75% 12%,100% 12%,100% 100%,0 100%)",
          }}
        />
        <div
          className="absolute left-0 right-0 bottom-0"
          style={{
            height: "16%",
            background: "#241a30",
            clipPath: "polygon(0 55%,30% 55%,30% 30%,55% 30%,55% 48%,100% 48%,100% 100%,0 100%)",
          }}
        />
      </div>
    );
  }

  if (background === "forest") {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg,#1c3038 0%,#2e4a52 34%,#5a7a78 58%,#8fa8a0 78%,#c4d0c0 100%)",
          }}
        />
        <div className="absolute left-0 right-0" style={{ bottom: "8%", height: "18%", opacity: 0.35 }}>
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,transparent,#c4d0c0)" }} />
        </div>
        <div className="absolute left-0 right-0 bottom-0" style={{ height: "40%" }}>
          {[
            { left: "2%", w: 26, h: "55%", op: 0.5 },
            { left: "16%", w: 34, h: "80%", op: 0.65 },
            { left: "34%", w: 22, h: "48%", op: 0.5 },
            { left: "46%", w: 30, h: "72%", op: 0.75 },
            { left: "62%", w: 36, h: "95%", op: 0.9 },
            { left: "80%", w: 24, h: "60%", op: 0.7 },
            { left: "92%", w: 20, h: "44%", op: 0.5 },
          ].map((t, i) => (
            <div
              key={i}
              className="absolute bottom-0"
              style={{
                left: t.left,
                width: t.w,
                height: t.h,
                background: "#0f1a1c",
                opacity: t.op,
                clipPath: "polygon(50% 0%,100% 100%,0% 100%)",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (background === "aurora") {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,#0a0e1c 0%,#131a30 55%,#1c2438 100%)" }} />
        {[
          { top: "8%", left: "5%" },
          { top: "18%", left: "60%" },
          { top: "28%", left: "30%" },
          { top: "12%", left: "82%" },
          { top: "34%", left: "12%" },
        ].map((s, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-chalk"
            style={{ top: s.top, left: s.left, width: 2, height: 2, opacity: 0.7 }}
          />
        ))}
        <div
          className="absolute"
          style={{
            left: "-10%",
            right: "-10%",
            top: "10%",
            height: "45%",
            background: "linear-gradient(100deg, rgba(84,214,160,0) 0%, rgba(84,214,160,.55) 30%, rgba(120,200,220,.4) 55%, rgba(160,120,220,.35) 75%, rgba(160,120,220,0) 100%)",
            filter: "blur(6px)",
            transform: "skewY(-6deg)",
          }}
        />
        <div
          className="absolute"
          style={{
            left: "-10%",
            right: "-10%",
            top: "26%",
            height: "30%",
            background: "linear-gradient(100deg, rgba(120,220,190,0) 0%, rgba(120,220,190,.35) 40%, rgba(140,150,230,.3) 70%, rgba(140,150,230,0) 100%)",
            filter: "blur(10px)",
            transform: "skewY(-4deg)",
          }}
        />
        <div
          className="absolute left-0 right-0 bottom-0"
          style={{
            height: "22%",
            background: "#05070f",
            clipPath: "polygon(0 60%,20% 35%,40% 58%,58% 30%,78% 52%,100% 40%,100% 100%,0 100%)",
          }}
        />
      </div>
    );
  }

  if (background === "tropical") {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg,#3a1f4a 0%,#8a3468 34%,#d9567a 56%,#f0966a 72%,#f5c878 100%)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            left: "68%",
            top: "36%",
            width: 90,
            height: 90,
            background: "radial-gradient(circle, rgba(255,230,180,.9), rgba(255,190,140,0) 70%)",
            transform: "translate(-50%, -50%)",
          }}
        />
        {[
          { left: "8%", rotate: -18 },
          { left: "22%", rotate: 10 },
          { left: "88%", rotate: 24 },
        ].map((p, i) => (
          <div
            key={i}
            className="absolute bottom-[-4%] bg-graphite"
            style={{
              left: p.left,
              width: 6,
              height: "58%",
              transformOrigin: "bottom",
              transform: `rotate(${p.rotate}deg)`,
            }}
          >
            {[0, 1, 2, 3].map((f) => (
              <div
                key={f}
                className="absolute bg-graphite"
                style={{
                  bottom: `${28 + f * 16}%`,
                  left: f % 2 === 0 ? -30 : undefined,
                  right: f % 2 === 1 ? -30 : undefined,
                  width: 34,
                  height: 10,
                  borderRadius: "0 100% 0 100%",
                  transform: f % 2 === 0 ? "rotate(-25deg)" : "rotate(25deg) scaleX(-1)",
                }}
              />
            ))}
          </div>
        ))}
        <div
          className="absolute left-0 right-0 bottom-0 bg-graphite opacity-90"
          style={{ height: "14%", clipPath: "polygon(0 60%,30% 40%,60% 58%,100% 35%,100% 100%,0 100%)" }}
        />
      </div>
    );
  }

  // midnight
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,#05060d 0%,#0d1224 45%,#1a2038 78%,#2a2740 100%)" }} />
      {[
        { top: "6%", left: "12%" },
        { top: "14%", left: "70%" },
        { top: "22%", left: "40%" },
        { top: "9%", left: "88%" },
        { top: "30%", left: "22%" },
        { top: "18%", left: "55%" },
      ].map((s, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-chalk"
          style={{ top: s.top, left: s.left, width: 2, height: 2, opacity: 0.8 }}
        />
      ))}
      <div className="absolute left-0 right-0 bottom-0" style={{ height: "48%" }}>
        {[
          { left: "3%", w: 16, h: "50%" },
          { left: "12%", w: 22, h: "78%" },
          { left: "25%", w: 14, h: "42%" },
          { left: "33%", w: 26, h: "92%" },
          { left: "45%", w: 18, h: "60%" },
          { left: "56%", w: 30, h: "100%" },
          { left: "68%", w: 16, h: "55%" },
          { left: "77%", w: 20, h: "74%" },
          { left: "89%", w: 24, h: "86%" },
        ].map((b, i) => (
          <div key={i} className="absolute bottom-0" style={{ left: b.left, width: b.w, height: b.h, background: "#0a0c16" }}>
            {Array.from({ length: 6 }).map((_, r) =>
              Array.from({ length: 2 }).map((_, c) => (
                <div
                  key={`${r}-${c}`}
                  className="absolute bg-rust"
                  style={{
                    left: `${20 + c * 40}%`,
                    bottom: `${10 + r * 16}%`,
                    width: 2,
                    height: 2,
                    opacity: (r + c) % 3 === 0 ? 0.85 : 0,
                  }}
                />
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
