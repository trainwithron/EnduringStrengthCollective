import { checked, DEFAULT_WRITE_ERROR } from "@/lib/checked-write";
import { showSaveFailed } from "@/lib/save-failed";

// A write whose result matters but whose screen has no place of its own to show an error. It looks at the result (the browser client never throws; a failed write looks exactly like a saved one otherwise) and,
// when it did not save, says so in the one shared "didn't save" bar. Returns true when it saved.
//
//   await saved(supabase.from("calendar_events").delete().eq("id", id));
//   if (!(await saved(supabase.from("x").update({ a: 1 }).eq("id", id), "Couldn't rename that."))) return;
// A unique-key conflict (code 23505, "already there") means the row the person asked for exists: a double tap on a favorite is not a failure.
type Op = PromiseLike<{ data?: unknown; error?: { message?: string; code?: string } | null }>;

export async function saved(operation: Op, message: string = DEFAULT_WRITE_ERROR): Promise<boolean> {
  let alreadyThere = false;
  const result = await checked(
    Promise.resolve(operation).then((r) => {
      if (r?.error && r.error.code === "23505") {
        alreadyThere = true;
        return { data: null, error: null };
      }
      return r;
    }),
    { message }
  );
  if (!result.ok) {
    showSaveFailed(result.error ?? message);
    return false;
  }
  return alreadyThere || result.ok;
}

// A write that is allowed to fail without anyone being told (remembering a dismissed hint, undoing a half-made row after the real error was already shown, noting a time zone). It still LOOKS at the result, so
// it never throws and never leaves an unhandled failure; it just stays quiet. Returns true when it saved.
export async function bestEffort(operation: PromiseLike<{ data?: unknown; error?: { message?: string } | null }>): Promise<boolean> {
  return (await checked(operation)).ok;
}
