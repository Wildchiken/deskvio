export type FileListEntry =
  | { kind: "file"; name: string; path: string }
  | { kind: "dir"; name: string; prefix: string };

export function listEntriesAtPrefix(
  blobPaths: string[],
  prefix: string,
): FileListEntry[] {
  const norm = prefix.replace(/\/$/, "");
  const pfx = norm ? `${norm}/` : "";
  const seen = new Map<string, string[]>();
  for (const p of blobPaths) {
    if (!p.startsWith(pfx)) continue;
    const rest = p.slice(pfx.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    const head = slash === -1 ? rest : rest.slice(0, slash);
    if (!seen.has(head)) seen.set(head, []);
    seen.get(head)!.push(rest);
  }
  const entries: FileListEntry[] = [];
  for (const [head, rels] of seen) {
    const isFile = rels.length === 1 && rels[0] === head;
    if (isFile) {
      entries.push({ kind: "file", name: head, path: pfx + head });
    } else {
      entries.push({ kind: "dir", name: head, prefix: pfx + head });
    }
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return entries;
}

const LICENSE_BASE =
  /^(LICENSE|LICENCE|COPYING|COPYRIGHT)(\.md|\.txt|\.markdown)?$/i;

export function findLicensePath(paths: string[]): string | null {
  for (const p of paths) {
    const base = p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p;
    if (LICENSE_BASE.test(base)) return p;
  }
  return null;
}

export function formatRelativeTime(dateUnix: number): string {
  const delta = Math.max(0, Date.now() / 1000 - dateUnix);
  if (delta < 45) return "刚刚";
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`;
  if (delta < 86400 * 7) return `${Math.floor(delta / 86400)} 天前`;
  return new Date(dateUnix * 1000).toLocaleDateString();
}
