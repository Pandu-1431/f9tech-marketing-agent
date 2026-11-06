/** Compare names the way people type them: any case, curly or straight quotes, extra spaces. */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFKC")
      .replace(/[‘’`´]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  return norm(a) === norm(b) && norm(a).length > 0;
}
