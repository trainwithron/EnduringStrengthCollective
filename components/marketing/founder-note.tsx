// Plain words from the founder, on the landing page: a short beta banner at the top and a "Why I built this" section before the final call to action.

export const BETA_BANNER =
  "V1, and it's a beta. This is as good as I can make it on my own right now. As you use it, it gets better, and if you find a use case that would improve it, tell me and I'll build it.";

export const WHY_I_BUILT_THIS = [
  "I started this because I couldn't find software that worked for me. So I took everything I liked and everything I didn't, and I tried to make the good parts as good as they can be, make the parts I disliked right, and cut everything I didn't need. That was the goal, and I'm sure I haven't hit it perfectly yet.",
  "If you find bloat, or something buried where it shouldn't be, tell me. If we agree it's not needed, we'll fix it. I don't have all the best ideas, but I know what I like, and I'm all about making this better. With your help, we can build the best coaching software out there. Open communication is what will make that happen.",
];

export const FOUNDER_SIGN_OFF = "Ron Arnold, Founder";

export function BetaBanner() {
  return (
    <div className="bg-rust/10 border-b border-rust/30 px-6 py-3">
      <p className="font-body text-sm text-chalk max-w-4xl mx-auto text-center" role="note">
        {BETA_BANNER}
      </p>
    </div>
  );
}

export function WhyIBuiltThis() {
  return (
    <section className="px-6 py-16 md:py-20 border-t border-steel/20">
      <div className="max-w-2xl mx-auto">
        <h2 className="font-display uppercase text-3xl md:text-4xl font-bold">Why I built this</h2>
        <div className="mt-6 space-y-4">
          {WHY_I_BUILT_THIS.map((p) => (
            <p key={p.slice(0, 24)} className="font-body text-chalk/85 leading-relaxed">
              {p}
            </p>
          ))}
        </div>
        <p className="font-display uppercase tracking-wide text-rust font-bold mt-8">{FOUNDER_SIGN_OFF}</p>
      </div>
    </section>
  );
}
