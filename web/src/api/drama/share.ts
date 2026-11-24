import service from "@/utils/requests/service";

export type SharingMode = "view" | "copy" | "transfer";
export type Viewer = { id: string; email: string };
export type SharedDrama = { id: string; title: string };
export type SharedEpisode = {
  no: number;
  title: string;
  script: string;
  final?: string;
  segments: { prompt: string; board?: string; videos: string[]; selected?: string }[];
};
export type SharedView = {
  title: string;
  outline: string;
  characters: string;
  asset_ids: string[];
  episodes: SharedEpisode[];
};

export const dramaSharing = {
  members: (id: string) => service.get<Viewer[]>(`/dramas/${id}/shares`),
  remove: (id: string, member: string) => service.delete<void>(`/dramas/${id}/shares/${member}`),
  submit: (id: string, mode: SharingMode, email: string, key: string) =>
    service.post<void>(`/dramas/${id}/shares`, { mode, email, request_key: key }, { timeout: 0 }),
  list: (keyword: string, page: number) =>
    service.get<{ list: SharedDrama[]; total: number }>("/dramas/shared", {
      keyword,
      page,
      page_size: 24,
    }),
  read: (id: string) => service.get<SharedView>(`/dramas/${id}/reader`),
  media: (id: string, asset: string, signal: AbortSignal) =>
    service.get<Blob>(`/dramas/${id}/reader/media/${asset}`, undefined, {
      responseType: "blob",
      signal,
      timeout: 0,
    }),
};
