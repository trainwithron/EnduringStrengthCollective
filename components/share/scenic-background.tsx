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
