import { describe, expect, it } from "vitest";
import {
  AI_BUDGET_USD_PER_STEP,
  CLIENT_AI_PAUSED_MESSAGE,
  MODEL_PRICES,
  UNKNOWN_MODEL_PRICE,
  TOP_UP_PACKS,
  orgBudgetUsd,
  packFor,
  topUpPackLine,
  budgetStatus,
  balanceLine,
  budgetUsd,
  callCostUsd,
  coachBudgetMessage,
  meterLine,
  priceFor,
  totalCostUsd,
} from "@/lib/ai-budget";
import { BETA_ALLOWANCE_SCALE } from "@/lib/ai-usage";

describe("prices", () => {
  it("prices Sonnet 5 and 5.5 at $2 in / $10 out per million tokens and Haiku 5.5 at $0.10 / $0.50 (Anthropic's list, checked 2026-10-08)", () => {
    expect(priceFor("claude-sonnet-5")).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(priceFor("claude-sonnet-5-5")).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(priceFor("claude-haiku-5-5")).toEqual({ inputPerMTok: 0.1, outputPerMTok: 0.5 });
  });
  it("finds the price of a dated id by its start, longest key first (5-5 is not mistaken for 5)", () => {
    expect(priceFor("claude-sonnet-5-5-20261001")).toBe(MODEL_PRICES["claude-sonnet-5-5"]);
    expect(priceFor("claude-opus-5-5")).toEqual({ inputPerMTok: 4, outputPerMTok: 20 });
    expect(priceFor("claude-opus-5")).toEqual({ inputPerMTok: 5, outputPerMTok: 25 });
  });
  it("prices an unknown or missing model at the cautious rate, so the meter can only run ahead of the bill", () => {
    expect(priceFor("claude-future-9")).toBe(UNKNOWN_MODEL_PRICE);
    expect(priceFor(null)).toBe(UNKNOWN_MODEL_PRICE);
    expect(UNKNOWN_MODEL_PRICE.outputPerMTok).toBeGreaterThanOrEqual(MODEL_PRICES["claude-sonnet-5"].outputPerMTok);
  });
});

describe("cost from logged tokens", () => {
  it("is tokens times the per-million price", () => {
    expect(callCostUsd("claude-sonnet-5", 1_000_000, 0)).toBeCloseTo(2, 6);
    expect(callCostUsd("claude-sonnet-5", 0, 1_000_000)).toBeCloseTo(10, 6);
    // a food photo: 1,500 in and 200 out
    expect(callCostUsd("claude-sonnet-5", 1500, 200)).toBeCloseTo(0.005, 6);
  });
  it("treats missing token counts as zero", () => {
    expect(callCostUsd("claude-sonnet-5", null, undefined)).toBe(0);
  });
  it("sums several models, counting every call once (rows are already grouped by model)", () => {
    const total = totalCostUsd([
      { model: "claude-sonnet-5", input_tokens: "7000", output_tokens: "9400", calls: 3 },
      { model: "claude-haiku-5-5", input_tokens: 3000, output_tokens: 400, calls: 1 },
    ]);
    expect(total).toBeCloseTo((7000 * 2 + 9400 * 10) / 1e6 + (3000 * 0.1 + 400 * 0.5) / 1e6, 8);
  });
  it("is zero for no usage", () => {
    expect(totalCostUsd([])).toBe(0);
  });
});

describe("the budget scales like every other AI limit", () => {
  it("is $25 per 100-client step", () => {
    expect(AI_BUDGET_USD_PER_STEP).toBe(25);
    expect(budgetUsd(100)).toBe(25);
    expect(budgetUsd(101)).toBe(50);
    expect(budgetUsd(250)).toBe(75);
  });
  it("gives a coach with few clients a prorated share, never below a quarter", () => {
    expect(budgetUsd(10)).toBe(10);
    expect(budgetUsd(0)).toBe(6.25);
  });
  it("gives a free-access (beta) organization the beta scale of a step, or the org's own scale", () => {
    expect(budgetUsd(500, { exempt: true })).toBe(Math.round(25 * BETA_ALLOWANCE_SCALE * 100) / 100);
    expect(budgetUsd(500, { exempt: true, scale: 1 })).toBe(25);
  });
  it("a gym pools its clients: steps by total clients, plus $5 for each coach beyond the first", () => {
    expect(orgBudgetUsd({ clients: 100, coaches: 1 })).toBe(25);
    expect(orgBudgetUsd({ clients: 100, coaches: 3 })).toBe(35);
    expect(orgBudgetUsd({ clients: 250, coaches: 4 })).toBe(90);
    expect(orgBudgetUsd({ clients: 10, coaches: 2 })).toBe(15);
  });
  it("a solo coach's budget is the same as before", () => {
    expect(orgBudgetUsd({ clients: 40, coaches: 1 })).toBe(budgetUsd(40));
  });
  it("a free-access organization gets the beta scale of the steps AND of the extra coaches; an explicit scale of 1 gives the full standard budget", () => {
    expect(orgBudgetUsd({ clients: 500, coaches: 3, exempt: true })).toBe(Math.round((25 * BETA_ALLOWANCE_SCALE + 10 * BETA_ALLOWANCE_SCALE) * 100) / 100);
    expect(orgBudgetUsd({ clients: 100, coaches: 1, exempt: true, scale: 1 })).toBe(25);
    expect(orgBudgetUsd({ clients: 100, coaches: 2, exempt: true, scale: 1 })).toBe(30);
  });
  it("the included budget has nothing to do with top-ups (they are a separate balance that carries over)", () => {
    expect(orgBudgetUsd({ clients: 100, coaches: 1 })).toBe(25);
  });
});

describe("top-up packs", () => {
  it("a $5 pack adds $3.50 and a $10 pack adds $7, priced to stay profitable after Stripe's fees", () => {
    expect(TOP_UP_PACKS).toEqual([
      { cents: 500, addUsd: 3.5 },
      { cents: 1000, addUsd: 7 },
    ]);
    for (const p of TOP_UP_PACKS) {
      const stripeFee = p.cents / 100 * 0.029 + 0.3;
      expect(p.addUsd + stripeFee).toBeLessThan(p.cents / 100);
    }
  });
  it("finds a pack by what was paid, and knows no other amount", () => {
    expect(packFor(500)?.addUsd).toBe(3.5);
    expect(packFor(1000)?.addUsd).toBe(7);
    expect(packFor(750)).toBeNull();
    expect(packFor(100000)).toBeNull();
  });
  it("says what a pack buys in plain words", () => {
    expect(topUpPackLine()).toBe("A $5 top-up adds $3.50 of AI that carries over from month to month until it's used; a $10 top-up adds $7 of AI.");
  });
});

describe("budgetStatus", () => {
  it("is ok below 80 percent, low from 80, out at 100 and over", () => {
    expect(budgetStatus(10, 25).level).toBe("ok");
    expect(budgetStatus(19.99, 25).level).toBe("ok");
    expect(budgetStatus(20, 25).level).toBe("low");
    expect(budgetStatus(24.99, 25).level).toBe("low");
    expect(budgetStatus(25, 25).level).toBe("out");
    expect(budgetStatus(40, 25).level).toBe("out");
    expect(budgetStatus(40, 25).pct).toBe(160);
  });
  it("reports whole percent used", () => {
    expect(budgetStatus(15.5, 25).pct).toBe(62);
  });
  it("an internal unlimited account is never low or out", () => {
    expect(budgetStatus(9999, 25, true).level).toBe("unlimited");
  });
  it("a zero budget is out", () => {
    expect(budgetStatus(0, 0).level).toBe("out");
  });
});

describe("the words", () => {
  const live = { available: true, packs: TOP_UP_PACKS, wouldNotCover: false, balanceUsd: 0, supportEmail: "help@enduringstrengthco.com", resetsOn: "November 1" };
  const off = { available: false, packs: [], wouldNotCover: false, balanceUsd: 0, supportEmail: "help@enduringstrengthco.com", resetsOn: "November 1" };
  const tooBig = { available: false, packs: [], wouldNotCover: true, balanceUsd: 0, supportEmail: "help@enduringstrengthco.com", resetsOn: "November 1" };
  it("tells the coach plainly at about 80 percent, with what a top-up really buys, when a purchase is possible", () => {
    const m = coachBudgetMessage("low", live);
    expect(m).toContain("Heads up: your AI for this month is almost used up.");
    expect(m).toContain("Every AI request costs real money, and I'm running a small business");
    expect(m).toContain("so extra AI use is a paid top-up");
    expect(m).toContain("A $5 top-up adds $3.50 of AI that carries over from month to month until it's used; a $10 top-up adds $7 of AI.");
    expect(m).toContain("Food search, barcode and saved meals stay free.");
  });
  it("while a purchase is not possible there is NO price and no buy wording: it says what will happen and when, and how to reach help", () => {
    for (const level of ["low", "out"] as const) {
      const m = coachBudgetMessage(level, off);
      expect(m).toContain("November 1");
      expect(m).toContain("help@enduringstrengthco.com");
      expect(m).toContain("will become a paid top-up, which isn't open yet");
      expect(m).not.toMatch(/buy|purchase|checkout|\$/i);
      // no contradiction: it never says extra use "is" a paid top-up while also saying top-ups are not open
      expect(m).not.toContain("so extra AI use is a paid top-up");
    }
  });
  it("names only the packs that can really be bought and would lift the pause", () => {
    const one = { ...live, packs: [TOP_UP_PACKS[1]] };
    const m = coachBudgetMessage("out", one);
    expect(m).toContain("A $10 top-up adds $7 of AI that carries over from month to month until it's used.");
    expect(m).not.toContain("$5");
    expect(topUpPackLine([TOP_UP_PACKS[0]])).toBe("A $5 top-up adds $3.50 of AI that carries over from month to month until it's used.");
  });
  it("when a pack exists but is too small for this month's overspend it says so, and never says top-ups are not open", () => {
    const m = coachBudgetMessage("out", tooBig);
    expect(m).toContain("A top-up wouldn't cover this month's use; AI resumes on November 1.");
    expect(m).not.toContain("isn't open yet");
    expect(m).not.toMatch(/buy|purchase|checkout|\$/i);
  });
  it("says AI features are paused when it is used up", () => {
    expect(coachBudgetMessage("out", live)).toContain("used up, so AI features are paused");
    expect(coachBudgetMessage("out", off)).toContain("paused until November 1");
  });
  it("never shows a client the business explanation, only a friendly pause and what still works", () => {
    expect(CLIENT_AI_PAUSED_MESSAGE).toBe("AI photo and typed logging is paused for this month. You can still search foods, scan a barcode or use your saved meals.");
    expect(CLIENT_AI_PAUSED_MESSAGE).not.toMatch(/money|business|top-up|\$/i);
  });
  it("the meter line is one short sentence", () => {
    expect(meterLine(budgetStatus(15.5, 25))).toBe("This month's included AI: 62% used");
    expect(meterLine(budgetStatus(1, 25, true))).toBe("AI this month: no limit on your account.");
  });
});

describe("the top-up balance: spent after the included month, carried over", () => {
  it("under the included budget the balance is untouched", () => {
    const s = budgetStatus(10, 25, false, { availableUsd: 7 });
    expect(s).toMatchObject({ level: "ok", balanceUsd: 7, shortfallUsd: 0, hasTopUps: true });
  });
  it("past the included budget the balance pays and the level is 'balance', not out", () => {
    const s = budgetStatus(27, 25, false, { availableUsd: 7 });
    expect(s).toMatchObject({ level: "balance", balanceUsd: 5, shortfallUsd: 0 });
    expect(s.pct).toBe(108);
  });
  it("only when both are used up is it out, and it says how far past the balance the use is", () => {
    expect(budgetStatus(32, 25, false, { availableUsd: 7 })).toMatchObject({ level: "out", balanceUsd: 0, shortfallUsd: 0 });
    expect(budgetStatus(34, 25, false, { availableUsd: 7 })).toMatchObject({ level: "out", balanceUsd: 0, shortfallUsd: 2 });
    expect(budgetStatus(25, 25)).toMatchObject({ level: "out", shortfallUsd: 0 });
  });
  it("80 percent of the included budget is 'low' even when there is a balance", () => {
    expect(budgetStatus(20, 25, false, { availableUsd: 7 }).level).toBe("low");
  });
  it("an unlimited account has no balance", () => {
    expect(budgetStatus(1, 25, true, { availableUsd: 7 })).toMatchObject({ level: "unlimited", balanceUsd: 0, hasTopUps: false });
  });
  it("the meter shows a balance line once anything was ever bought, and none before", () => {
    expect(balanceLine(budgetStatus(10, 25))).toBeNull();
    expect(balanceLine(budgetStatus(10, 25, false, { availableUsd: 3.5 }))).toBe("Top-up balance: $3.50");
    expect(balanceLine(budgetStatus(40, 25, false, { availableUsd: 7, everBought: true }))).toBe("Top-up balance: $0.00");
    expect(balanceLine(budgetStatus(1, 25, true))).toBeNull();
  });
  it("the words: using the balance is not a pause, and says the balance carries over", () => {
    const top = { available: true, packs: TOP_UP_PACKS, wouldNotCover: false, balanceUsd: 5, supportEmail: null, resetsOn: "November 1" };
    const m = coachBudgetMessage("balance", top);
    expect(m).toContain("Your included AI for this month is used up, so you're now using your top-up balance: $5.00 left");
    expect(m).toContain("carries over from month to month");
    expect(m).toContain("refreshes on November 1");
    expect(m).not.toContain("paused");
    const low = coachBudgetMessage("low", { ...top, balanceUsd: 3.5 });
    expect(low).toContain("$3.50 of top-up balance, which takes over");
    expect(low).not.toContain("paid top-up");
  });
});
