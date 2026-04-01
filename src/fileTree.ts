export type FileTreeNode = {
  name: string;
  fullPath?: string;
  children?: FileTreeNode[];
};

function insertPath(root: FileTreeNode, path: string) {
  const parts = path.split("/").filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i];
    const isLeaf = i === parts.length - 1;
    if (!cur.children) cur.children = [];
    let next = cur.children.find((c) => c.name === name);
    if (!next) {
      next = isLeaf
        ? { name, fullPath: path }
        : { name, children: [] };
      cur.children.push(next);
    } else if (isLeaf) {
      next.fullPath = path;
      if (!next.children) next.children = [];
    } else if (!next.children) {
      next.children = [];
    }
    cur = next;
  }
}

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes]
    .map((n) => ({
      ...n,
      children: n.children?.length
        ? sortNodes(n.children)
        : n.children,
    }))
    .sort((a, b) => {
      const aDir = !!(a.children && a.children.length > 0);
      const bDir = !!(b.children && b.children.length > 0);
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}

export function pathsToFileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", children: [] };
  for (const p of paths) insertPath(root, p);
  return sortNodes(root.children ?? []);
}
