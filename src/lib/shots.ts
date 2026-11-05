/** "daily-plan_screen.png" -> "daily plan screen": a product screenshot's label from its file name. */
export function shotLabel(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "app screen";
}
