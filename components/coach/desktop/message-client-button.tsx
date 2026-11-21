"use client";

import { openClientMessages } from "@/lib/open-client-messages";

// The profile header's Message (computer only): opens the message box on Overview from any tab, with no address change and no step added for Back.
export function MessageClientButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => openClientMessages()} className={className} data-message-client>
      Message
    </button>
  );
}
