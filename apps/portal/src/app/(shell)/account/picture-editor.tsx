"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { Seal } from "@kimono/ui";
import { Portrait } from "@/components/portrait";

const stage = 288;
const circle = 240;
const output = 512;

type Crop = { image: HTMLImageElement; url: string; zoom: number; x: number; y: number };

function fit(crop: Crop) {
  const base = circle / Math.min(crop.image.naturalWidth, crop.image.naturalHeight);
  const scale = base * crop.zoom;
  const width = crop.image.naturalWidth * scale;
  const height = crop.image.naturalHeight * scale;
  /* The circle must stay covered, so the photo can only move as far as its spare edge. */
  const maxX = (width - circle) / 2;
  const maxY = (height - circle) / 2;
  const x = Math.max(-maxX, Math.min(maxX, crop.x));
  const y = Math.max(-maxY, Math.min(maxY, crop.y));
  return { scale, width, height, x, y };
}

function draw(canvas: HTMLCanvasElement, crop: Crop, size: number) {
  const { scale, width, height, x, y } = fit(crop);
  const context = canvas.getContext("2d");
  if (!context) return;
  canvas.width = size;
  canvas.height = size;
  const side = circle / scale;
  const left = (width / 2 - x - circle / 2) / scale;
  const top = (height / 2 - y - circle / 2) / scale;
  context.imageSmoothingQuality = "high";
  context.drawImage(crop.image, left, top, side, side, 0, 0, size, size);
}

/**
 * Crops a photo to the circle in the browser and sends a fresh 512×512 PNG.
 * Redrawing onto a canvas is also what leaves the photo's metadata behind.
 */
export function PictureEditor({ name, username, picture }: { name: string; username: string; picture: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (crop) URL.revokeObjectURL(crop.url); }, [crop?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { setError("That photo is over 25 MB. Choose a smaller one."); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setCrop({ image, url, zoom: 1, x: 0, y: 0 });
    image.onerror = () => { URL.revokeObjectURL(url); setError("This browser can't open that photo. Try a JPEG or PNG."); };
    image.src = url;
  }

  function move(dx: number, dy: number) {
    setCrop((current) => {
      if (!current) return current;
      const placed = fit({ ...current, x: current.x + dx, y: current.y + dy });
      return { ...current, x: placed.x, y: placed.y };
    });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!crop) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, startX: crop.x, startY: crop.y };
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || !crop) return;
    const placed = fit({ ...crop, x: start.startX + event.clientX - start.x, y: start.startY + event.clientY - start.y });
    setCrop({ ...crop, x: placed.x, y: placed.y });
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 32 : 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = moves[event.key];
    if (delta) { event.preventDefault(); move(...delta); }
  }

  async function save() {
    if (!crop) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      draw(canvas, crop, output);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Your browser couldn't prepare the picture.");
      const response = await fetch("/api/v1/me/picture", { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
      const reply = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(reply.error || "Your picture could not be saved.");
      setCrop(null);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your picture could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/me/picture", { method: "DELETE" });
      const reply = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(reply.error || "Your picture could not be removed.");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your picture could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  const placed = crop ? fit(crop) : null;
  return <div className="picture-editor">
    <input ref={input} type="file" accept="image/*" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} />
    {crop && placed
      ? <div className="picture-crop">
          <div>
            <div className="picture-stage" style={{ width: stage, height: stage }} tabIndex={0} role="group" aria-label="Photo position. Drag, or use the arrow keys, to move it inside the circle."
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={onKeyDown}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local photo being cropped */}
              <img src={crop.url} alt="" draggable={false} style={{ width: placed.width, height: placed.height, transform: `translate(calc(-50% + ${placed.x}px), calc(-50% + ${placed.y}px))` }} />
              <span className="picture-mask" style={{ width: circle, height: circle }} />
            </div>
            <label className="picture-zoom"><span>Zoom</span><input type="range" min={1} max={4} step={0.01} value={crop.zoom}
              onChange={(event) => { const zoom = Number(event.target.value); const next = fit({ ...crop, zoom }); setCrop({ ...crop, zoom, x: next.x, y: next.y }); }} /></label>
          </div>
          <div className="picture-crop-actions">
            <div className="k-form-actions">
              <Seal type="button" onClick={save} disabled={busy}>{busy ? "Saving picture" : "Use this picture"}</Seal>
              <Seal type="button" tone="quiet" onClick={() => setCrop(null)} disabled={busy}>Cancel</Seal>
            </div>
          </div>
        </div>
      : <div className="picture-current">
          <Portrait name={name} username={username} picture={picture} size={96} />
          <div className="k-form-actions">
            <Seal type="button" onClick={() => input.current?.click()} disabled={busy}>{picture ? "Change picture" : "Add a picture"}</Seal>
            {picture ? <Seal type="button" tone="quiet" onClick={remove} disabled={busy}>{busy ? "Removing" : "Remove"}</Seal> : null}
          </div>
        </div>}
    {error ? <p className="admin-notice error picture-error" role="alert">{error}</p> : null}
  </div>;
}
