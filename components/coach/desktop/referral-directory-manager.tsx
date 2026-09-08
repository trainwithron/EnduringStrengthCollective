"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";

export interface ReferralPartner {
  id: string;
  name: string;
  specialty: string;
  description: string | null;
  bookingUrl: string | null;
  discountCode: string | null;
  discountDescription: string | null;
  clickCount: number;
}

const SPECIALTIES = [
  "Massage Therapist",
  "Chiropractor",
  "Physical Therapist",
  "Sports Medicine",
  "Nutritionist",
  "Other",
];

export function ReferralDirectoryManager({ initialPartners }: { initialPartners: ReferralPartner[] }) {
  const router = useRouter();
  const [partners, setPartners] = useState(initialPartners);
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState(SPECIALTIES[0]);
  const [description, setDescription] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [discountDescription, setDiscountDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!name.trim()) return;
    setSaving(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const { data } = await supabase
      .from("referral_partners")
      .insert({
        coach_id: user.id,
        name: name.trim(),
        specialty,
        description: description.trim() || null,
        booking_url: bookingUrl.trim() || null,
        discount_code: discountCode.trim() || null,
        discount_description: discountDescription.trim() || null,
      })
      .select("id, name, specialty, description, booking_url, discount_code, discount_description, click_count")
      .single();

    if (data) {
      setPartners((prev) => [
        ...prev,
        {
          id: data.id,
          name: data.name,
          specialty: data.specialty,
          description: data.description,
          bookingUrl: data.booking_url,
          discountCode: data.discount_code,
          discountDescription: data.discount_description,
          clickCount: data.click_count,
        },
      ]);
    }
    setSaving(false);
    setName("");
    setDescription("");
    setBookingUrl("");
    setDiscountCode("");
    setDiscountDescription("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    const supabase = createBrowserClient();
    await supabase.from("referral_partners").delete().eq("id", id);
    setPartners((prev) => prev.filter((p) => p.id !== id));
    router.refresh();
  }

  return (
    <div className="grid grid-cols-[1fr_360px] gap-8 items-start">
      <div className="divide-y divide-steel/15">
        {partners.length === 0 ? (
          <p className="font-body text-sm text-steel py-2">No referral partners added yet.</p>
        ) : (
          partners.map((p) => (
            <div key={p.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-body text-sm font-medium">
                  {p.name} <span className="text-steel font-normal">&middot; {p.specialty}</span>
                </p>
                {p.description && <p className="font-body text-xs text-steel mt-0.5">{p.description}</p>}
                {p.discountDescription && (
                  <p className="font-body text-xs text-positive mt-0.5">{p.discountDescription}</p>
                )}
                <p className="font-body text-[11px] text-steel mt-1">
                  {p.clickCount} click{p.clickCount === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(p.id)}
                className="text-steel active:text-rust shrink-0"
                aria-label={`Delete ${p.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="border border-steel/20 p-4 space-y-2.5">
        <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-1">
          Add referral partner
        </h3>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
        />
        <select
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
        >
          {SPECIALTIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description (optional)"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
        />
        <input
          type="url"
          value={bookingUrl}
          onChange={(e) => setBookingUrl(e.target.value)}
          placeholder="Booking link (Jane App, Mindbody, etc.)"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
        />
        <input
          type="text"
          value={discountCode}
          onChange={(e) => setDiscountCode(e.target.value)}
          placeholder="Discount code (optional)"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
        />
        <input
          type="text"
          value={discountDescription}
          onChange={(e) => setDiscountDescription(e.target.value)}
          placeholder="e.g. 15% off first massage"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={saving || !name.trim()}
          className="w-full h-9 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
