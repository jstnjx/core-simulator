// SPDX-License-Identifier: GPL-3.0-only
// Simulator-only adapter. Core page JSON never receives video_stream items.
import type { ActivityUserInterfaceItem, ActivityUserInterfacePage } from "@/types/activity";

type Stream = { id: string; name: string; activity_id: string; page_id: string;
  location: { x: number; y: number }; size: { width: number; height: number };
  width: number; fps: number; mode: string; enabled: boolean };

export type VideoItem = ActivityUserInterfaceItem & {
  type: "video_stream";
  video_stream?: { id?: string; url?: string; name?: string; width?: number; fps?: number };
};

const apiPrefix = "/rtsp-addon/api";
const path = (p: string) => apiPrefix + p;
async function request<T>(p: string, method = "GET", data?: object): Promise<T> {
  const response = await fetch(path(p), {
    method, credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-RTSP-Configurator": "1" },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Video Stream API HTTP " + response.status);
  }
  return response.status === 204 ? (null as T) : response.json() as Promise<T>;
}
let records: Stream[] = [];

export async function loadVideoStreams(): Promise<void> {
  records = await request<Stream[]>("/widgets");
}

export function withVideoStreams(pages: ActivityUserInterfacePage[], activityId: string): ActivityUserInterfacePage[] {
  return pages.map(page => ({
    ...page, items: [
      ...(page.items || []).filter(item => item.type !== "video_stream"),
      ...records.filter(row => row.activity_id === activityId && row.page_id === page.page_id)
        .map(row => ({
          type: "video_stream" as const,
          location: { ...row.location }, size: { ...row.size },
          text: row.name,
          video_stream: { id: row.id, name: row.name, width: row.width, fps: row.fps }
        }))
    ]
  }));
}

export async function persistVideoStreams(page: ActivityUserInterfacePage, activityId: string): Promise<ActivityUserInterfacePage> {
  const videoItems = (page.items || []).filter(item => item.type === "video_stream") as VideoItem[];
  const activeIds = new Set(videoItems.map(item => item.video_stream?.id).filter(Boolean));
  const existing = records.filter(row => row.activity_id === activityId && row.page_id === page.page_id);
  const corePage = { ...page, items: (page.items || []).filter(item => item.type !== "video_stream") };
  // Video stream changes must succeed before the normal Core page is saved.
  // A failed sidecar operation must never leak unknown item types to Core.
  for (const item of videoItems) {
    const meta = item.video_stream || {};
    const url = (meta.url || "").trim();
    if (!meta.id && !url) throw new Error("A new Video Stream requires an RTSP URL");
    const payload: Record<string, unknown> = {
      name: meta.name?.trim() || item.text || "Video Stream",
      activity_id: activityId, page_id: page.page_id, grid: page.grid || { width: 4, height: 6 },
      location: item.location, size: item.size, width: meta.width || 640,
      fps: meta.fps || 24, enabled: true, mode: "mjpeg"
    };
    if (url) payload.url = url;
    const old = existing.find(row => row.id === meta.id);
    if (meta.id && !old) {
      throw new Error("Cannot copy Video Stream credentials to another page. Add a new Video Stream instead.");
    }
    const changed = !old || url || old.name !== payload.name ||
      JSON.stringify(old.location) !== JSON.stringify(payload.location) ||
      JSON.stringify(old.size) !== JSON.stringify(payload.size) ||
      old.width !== payload.width || old.fps !== payload.fps;
    if (!changed) continue;
    const updated = await request<Stream>(meta.id ? "/widgets/" + encodeURIComponent(meta.id) : "/widgets",
      meta.id ? "PUT" : "POST", payload);
    meta.id = updated.id;
    delete meta.url;
    activeIds.add(updated.id);
  }
  for (const old of existing) {
    if (!activeIds.has(old.id)) await request("/widgets/" + encodeURIComponent(old.id), "DELETE");
  }
  if (videoItems.length || existing.length) await loadVideoStreams();
  return corePage;
}
