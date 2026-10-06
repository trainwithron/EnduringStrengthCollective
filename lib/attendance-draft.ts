// A warm come-back note the coach reads and edits before sending (it opens in the message box; nothing is sent for them). No guilt, no money.
export function buildComeBackDraft(firstName: string): string {
  const name = firstName.trim() || "there";
  return `Hi ${name}, it's been a couple of weeks since your last session and I wanted to check in. How are you doing? Whenever you're ready to get back on the calendar, I'm here.`;
}
