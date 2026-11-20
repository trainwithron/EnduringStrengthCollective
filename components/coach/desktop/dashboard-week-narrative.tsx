export function DashboardWeekNarrative({ text }: { text: string }) {
  return (
    <div className="border border-transparent bg-surface p-4">
      <h2 className="font-body text-[15px] font-semibold text-chalk mb-2">This week</h2>
      <p className="font-body text-sm text-chalk">{text}</p>
    </div>
  );
}
