"use client";

export interface BiomechTagOption {
  id: string;
  kind: "joint_action" | "stabilization";
  key: string;
  label: string;
  joint: string | null;
  description: string;
}

export interface BiomechTagSelection {
  tagId: string;
  role: "prime_mover" | "stabilizer_demand";
}

const JOINT_ORDER = [
  "shoulder",
  "scapula",
  "elbow",
  "forearm",
  "wrist",
  "spine_cervical",
  "spine_thoracic",
  "spine_lumbar",
  "hip",
  "knee",
  "ankle",
];
const JOINT_LABEL: Record<string, string> = {
  shoulder: "Shoulder",
  scapula: "Scapula",
  elbow: "Elbow",
  forearm: "Forearm",
  wrist: "Wrist",
  spine_cervical: "Spine — Cervical",
  spine_thoracic: "Spine — Thoracic",
  spine_lumbar: "Spine — Lumbar",
  hip: "Hip",
  knee: "Knee",
  ankle: "Ankle",
};

// Fully controlled — no DB knowledge of its own — so the same checklist
// UI works both for an exercise that already exists (persisted on every
// toggle by the caller) and for one that doesn't exist yet (held in
// local state until the coach actually creates it, since tagging is
// required at creation time — corrective_exercise_biomechanical_
// tagging_idea.md's own "required for new exercises going forward"
// rule, which has to live at the form level since there's no FK from
// exercise_library to tag rows to enforce it with a DB constraint).
export function BiomechTagPicker({
  vocabulary,
  selected,
  onToggle,
  onRoleChange,
}: {
  vocabulary: BiomechTagOption[];
  selected: BiomechTagSelection[];
  onToggle: (tagId: string) => void;
  onRoleChange: (tagId: string, role: "prime_mover" | "stabilizer_demand") => void;
}) {
  const selectedByTagId = new Map(selected.map((s) => [s.tagId, s.role]));
  const jointActions = vocabulary.filter((t) => t.kind === "joint_action");
  const stabilization = vocabulary.filter((t) => t.kind === "stabilization");
  const jointGroups = JOINT_ORDER.map((joint) => ({
    joint,
    tags: jointActions.filter((t) => t.joint === joint),
  })).filter((g) => g.tags.length > 0);

  function renderTagRow(tag: BiomechTagOption) {
    const role = selectedByTagId.get(tag.id);
    const isChecked = role !== undefined;
    return (
      <div key={tag.id} className="flex items-center gap-2 py-1">
        <label className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer" title={tag.description}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggle(tag.id)}
            className="accent-rust shrink-0"
          />
          <span className="font-body text-xs text-chalk truncate">{tag.label}</span>
        </label>
        {isChecked && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => onRoleChange(tag.id, "prime_mover")}
              className={`h-6 px-1.5 font-body text-[10px] border ${
                role === "prime_mover"
                  ? "bg-rust text-graphite border-rust"
                  : "border-steel/30 text-steel"
              }`}
            >
              Prime mover
            </button>
            <button
              type="button"
              onClick={() => onRoleChange(tag.id, "stabilizer_demand")}
              className={`h-6 px-1.5 font-body text-[10px] border ${
                role === "stabilizer_demand"
                  ? "bg-rust text-graphite border-rust"
                  : "border-steel/30 text-steel"
              }`}
            >
              Stabilizer
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border border-steel/20 bg-graphite/40 p-3 max-h-80 overflow-y-auto space-y-4">
      <div className="grid grid-cols-2 gap-x-6">
        {jointGroups.map((group) => (
          <div key={group.joint} className="mb-3">
            <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-1">
              {JOINT_LABEL[group.joint] ?? group.joint}
            </p>
            {group.tags.map(renderTagRow)}
          </div>
        ))}
      </div>
      <div>
        <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-1">
          Stabilization / Chain Demand
        </p>
        <div className="grid grid-cols-2 gap-x-6">{stabilization.map(renderTagRow)}</div>
      </div>
    </div>
  );
}
