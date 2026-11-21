// A paid booking's amount as people read it ("$60.00"). Its own file so pages in the browser can use it (wave 3 C7).
export const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
