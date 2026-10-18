import { NextResponse } from "next/server";

// The old way to erase a client the moment the coach confirmed. It is closed on purpose: the only way to erase a client now is "Delete permanently", which takes them out of the group at once and keeps
// 30 days to put them back before the account is erased (/api/clients/remove, then the daily job). Nothing is changed by calling this.
export async function POST() {
  return NextResponse.json({ error: "Deleting a client straight away isn't available any more. Use Delete permanently: you have 30 days to change your mind before the account is erased." }, { status: 410 });
}
