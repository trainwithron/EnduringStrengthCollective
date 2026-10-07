"use client";

export interface DraggedClient {
  athleteId: string;
  fullName: string;
  balance: number;
  // The client's own group. A one-on-one client lives in their own, and sessions and balances are kept per group.
  groupId?: string;
}

export const CLIENT_DRAG_MIME = "application/x-esc-client";

export function DraggableClientName({
  client,
  children,
  className,
}: {
  client: DraggedClient;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CLIENT_DRAG_MIME, JSON.stringify(client));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`cursor-grab active:cursor-grabbing ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
