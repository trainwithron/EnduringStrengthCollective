"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { createOrganization } from "@/lib/org-creation";

interface OrgOption {
  id: string;
  name: string;
}

export function NewOrganizationForm({ existingOrgs, ownerId }: { existingOrgs: OrgOption[]; ownerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [starterGroupName, setStarterGroupName] = useState("");
  const [templateOrgId, setTemplateOrgId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createBrowserClient();
      const { groupId } = await createOrganization(supabase, {
        name: name.trim(),
        starterGroupName: starterGroupName.trim() || "Main Group",
        ownerId,
        templateOrgId: templateOrgId || null,
      });
      router.push(`/groups/${groupId}/branding`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create this organization.");
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium"
      >
        New organization
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border border-steel/30 p-4 max-w-sm bg-surface space-y-3">
      <p className="font-body text-xs text-steel uppercase tracking-wide">New organization</p>
      <div>
        <label htmlFor="org-name" className="font-body text-xs text-steel">
          Organization name
        </label>
        <input
          id="org-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Coast to Coast Fitness"
          className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
        />
      </div>
      <div>
        <label htmlFor="starter-group-name" className="font-body text-xs text-steel">
          Starter group name
        </label>
        <input
          id="starter-group-name"
          type="text"
          value={starterGroupName}
          onChange={(e) => setStarterGroupName(e.target.value)}
          placeholder="Main Group"
          className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
        />
      </div>
      <div>
        <label htmlFor="template-org" className="font-body text-xs text-steel">
          Start branding from
        </label>
        <select
          id="template-org"
          value={templateOrgId}
          onChange={(e) => setTemplateOrgId(e.target.value)}
          className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm"
        >
          <option value="">Blank (default colors)</option>
          {existingOrgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        <p className="font-body text-[11px] text-steel mt-1">
          Copies colors, fonts, and button shape only — not the logo, since a new client uploads
          their own.
        </p>
      </div>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {submitting ? "Creating…" : "Create organization"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={submitting}
          className="font-body text-xs text-steel disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
