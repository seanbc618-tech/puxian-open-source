/** Only the score is permanent; feature panels remain mounted beside it. */
export const PRIMARY_ZONES = ["zone-score"] as const;
export const FEATURES = [
  { id: "zone-audio", title: "听写与音频" },
  { id: "zone-input", title: "写谱" },
  { id: "zone-expression", title: "表情记号" },
  { id: "zone-key", title: "移调与乐器" },
  { id: "zone-lyrics", title: "歌词" },
  { id: "zone-style", title: "辅助模块" },
  { id: "zone-play", title: "打印与导出" },
  { id: "zone-drafts", title: "本机草稿" },
] as const;
export type FeatureId = typeof FEATURES[number]["id"];
export function isFeatureId(id: string): id is FeatureId {
  return FEATURES.some((feature) => feature.id === id);
}
export function isPrimaryZone(id: string): boolean {
  return PRIMARY_ZONES.some((zone) => zone === id);
}
