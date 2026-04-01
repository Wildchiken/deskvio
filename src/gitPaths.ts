export function extOf(path: string): string {
  const base = path.includes("/")
    ? path.slice(path.lastIndexOf("/") + 1)
    : path;
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i + 1).toLowerCase();
}

export function mimeForPath(path: string): string {
  const ext = extOf(path);
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
    svg: "image/svg+xml",
  };
  return map[ext] ?? "application/octet-stream";
}

export function resolveRepoRelativePath(
  markdownPath: string,
  ref: string,
): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("data:")
  ) {
    return null;
  }
  if (trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("#")) return null;

  const pathOnly = trimmed.split(/[?#]/)[0] ?? "";
  if (!pathOnly) return null;

  let rel = pathOnly.replace(/\\/g, "/");
  if (rel.startsWith("/")) rel = rel.slice(1);

  const dir = markdownPath.includes("/")
    ? markdownPath.slice(0, markdownPath.lastIndexOf("/"))
    : "";

  const baseParts = dir ? dir.split("/").filter(Boolean) : [];
  const stack = [...baseParts];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return stack.join("/");
}

export function isProbablyWebImageUrl(src: string): boolean {
  const t = src.trim().toLowerCase();
  return t.startsWith("http://") || t.startsWith("https://");
}
