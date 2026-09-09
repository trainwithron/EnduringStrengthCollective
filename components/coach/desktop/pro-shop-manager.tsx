"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";

export interface ProShopLink {
  id: string;
  title: string;
  category: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  discountCode: string | null;
  discountDescription: string | null;
  clickCount: number;
}

const CATEGORIES = [
  { value: "merch", label: "Merch" },
  { value: "supplements", label: "Supplements" },
  { value: "coaching", label: "Coaching / Apply" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function ProShopManager({ initialLinks }: { initialLinks: ProShopLink[] }) {
  const router = useRouter();
  const [links, setLinks] = useState(initialLinks);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0].value);
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [discountDescription, setDiscountDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError("Use a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image must be under 5MB.");
      return;
    }

    setUploadingImage(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploadingImage(false);
      return;
    }

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("pro-shop-images").upload(path, file);
    if (uploadError) {
      setError(uploadError.message);
      setUploadingImage(false);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from("pro-shop-images").getPublicUrl(path);
    setImageUrl(publicUrlData.publicUrl);
    setUploadingImage(false);
  }

  async function handleAdd() {
    if (!title.trim() || !url.trim()) return;
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const { data, error: insertError } = await supabase
      .from("pro_shop_links")
      .insert({
        coach_id: user.id,
        title: title.trim(),
        category,
        description: description.trim() || null,
        url: url.trim(),
        image_url: imageUrl,
        discount_code: discountCode.trim() || null,
        discount_description: discountDescription.trim() || null,
      })
      .select("id, title, category, description, url, image_url, discount_code, discount_description, click_count")
      .single();

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    if (data) {
      setLinks((prev) => [
        ...prev,
        {
          id: data.id,
          title: data.title,
          category: data.category,
          description: data.description,
          url: data.url,
          imageUrl: data.image_url,
          discountCode: data.discount_code,
          discountDescription: data.discount_description,
          clickCount: data.click_count,
        },
      ]);
    }
    setSaving(false);
    setTitle("");
    setDescription("");
    setUrl("");
    setDiscountCode("");
    setDiscountDescription("");
    setImageUrl(null);
    router.refresh();
  }

  async function handleDelete(id: string) {
    const supabase = createBrowserClient();
    await supabase.from("pro_shop_links").delete().eq("id", id);
    setLinks((prev) => prev.filter((l) => l.id !== id));
    router.refresh();
  }

  return (
    <div className="grid grid-cols-[1fr_360px] gap-8 items-start">
      <div className="divide-y divide-steel/15">
        {links.length === 0 ? (
          <p className="font-body text-sm text-steel py-2">No Pro Shop links added yet.</p>
        ) : (
          links.map((l) => (
            <div key={l.id} className="py-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                {l.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL.
                  <img
                    src={l.imageUrl}
                    alt=""
                    className="w-12 h-12 object-cover border border-steel/20 shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-body text-sm font-medium">
                    {l.title}{" "}
                    <span className="text-steel font-normal">
                      &middot; {CATEGORIES.find((c) => c.value === l.category)?.label ?? l.category}
                    </span>
                  </p>
                  {l.description && <p className="font-body text-xs text-steel mt-0.5">{l.description}</p>}
                  {l.discountDescription && (
                    <p className="font-body text-xs text-positive mt-0.5">{l.discountDescription}</p>
                  )}
                  <p className="font-body text-[11px] text-steel mt-1">
                    {l.clickCount} click{l.clickCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(l.id)}
                className="text-steel active:text-rust shrink-0"
                aria-label={`Delete ${l.title}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="border border-steel/20 p-4 space-y-2.5">
        <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-1">Add Pro Shop link</h3>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Team Merch Store)"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
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
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link URL"
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
          placeholder="e.g. 10% off with code TEAM10"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
        />
        <div className="flex items-center gap-2">
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL.
            <img src={imageUrl} alt="" className="w-9 h-9 object-cover border border-steel/30" />
          )}
          <label className="flex-1 h-9 px-2 bg-graphite border border-steel/30 text-steel font-body text-xs cursor-pointer flex items-center">
            {uploadingImage ? "Uploading…" : imageUrl ? "Replace image" : "Add image (optional)"}
            <input
              type="file"
              accept={ALLOWED_IMAGE_TYPES.join(",")}
              onChange={handleImageChange}
              disabled={uploadingImage}
              className="hidden"
            />
          </label>
        </div>
        {error && (
          <p className="font-body text-xs text-rust" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={handleAdd}
          disabled={saving || !title.trim() || !url.trim()}
          className="w-full h-9 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
