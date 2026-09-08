"use client";

export interface DraggedClient {
  athleteId: string;
  fullName: string;
  balance: number;
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
      title="Drag onto a calendar day to schedule a session"
    >
      {children}
    </div>
  );
}
