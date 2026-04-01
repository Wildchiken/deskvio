import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CommitSummary,
  RefLists,
  ReleaseAsset,
  ReleaseEntry,
  RemoteInfo,
  RepoRecord,
  StatusLine,
  TreeEntry,
} from "./api";
import {
  hubRemoveRepo,
  hubSetProjectIntro,
  hubSetTags,
  repoBlobBase64,
  repoBlobText,
  repoCommit,
  repoLatestCommit,
  repoListRefs,
  repoLog,
  repoLsTree,
  repoPathsLastCommit,
  repoImportReleaseAsset,
  repoListReleases,
  repoRemotes,
  repoRevCount,
  repoDeleteReleaseAsset,
  repoSaveReleases,
  repoShowCommit,
  repoStage,
  repoStatus,
} from "./api";
import { extOf, mimeForPath } from "./gitPaths";
import { MarkdownBody } from "./MarkdownBody";
import {
  findLicensePath,
  formatRelativeTime,
  listEntriesAtPrefix,
} from "./repoFileListing";

type Tab = "files" | "commits" | "changes" | "releases";
type MarkdownViewMode = "preview" | "code";

type BlobViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "text"; content: string }
  | { kind: "markdown"; content: string }
  | { kind: "image"; dataUrl: string; alt: string }
  | { kind: "binary" };

type Props = {
  repo: RepoRecord;
  locale?: "zh-CN" | "en-US";
  onBack: () => void;
  onUpdateRepo?: (repo: RepoRecord) => void;
  onRemoveRepo?: (repoId: number) => void;
};

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
]);
const MARKDOWN_EXT = new Set(["md", "markdown", "mdx"]);

function parseTagTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\r\n,]+/)) {
    const t = raw.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function pickReadmePath(paths: string[]): string | null {
  const set = new Set(paths);
  const ordered = [
    "README.md",
    "Readme.md",
    "readme.md",
    "README.markdown",
    "readme.markdown",
    "README.mdown",
    "README",
    "readme",
  ];
  for (const p of ordered) {
    if (set.has(p)) return p;
  }
  const docs = paths.find((p) => /^docs\/README\.md$/i.test(p));
  if (docs) return docs;
  const readmes = paths.filter((p) => {
    const base = p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p;
    return /^readme\.(md|markdown|mdown)$/i.test(base);
  });
  if (readmes.length === 0) return null;
  readmes.sort((a, b) => {
    const da = a.split("/").length;
    const db = b.split("/").length;
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });
  return readmes[0];
}

function readmeExcerptFromMarkdown(text: string): string | null {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("```")) continue;
    if (t.startsWith("#")) continue;
    const plain = t.replace(/<[^>]+>/g, "").trim();
    if (plain.length > 0) return plain.slice(0, 220);
  }
  return null;
}

function PathLastCommitCell({
  rev,
  path,
  cacheRef,
  cacheVersion,
}: {
  rev: string;
  path: string;
  cacheRef: MutableRefObject<Map<string, CommitSummary | null>>;
  cacheVersion: number;
}) {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    const key = `${rev}\0${path}`;
    if (cacheRef.current.has(key)) {
      const c = cacheRef.current.get(key);
      setLine(
        c
          ? `${c.subject.slice(0, 72)}${c.subject.length > 72 ? "…" : ""} · ${formatRelativeTime(c.dateUnix)}`
          : "—",
      );
      return;
    }
    setLine(null);
  }, [rev, path, cacheRef, cacheVersion]);

  return (
    <span className={`repo-file-col-msg${line === null ? " skeleton" : ""}`}>
      {line ?? ""}
    </span>
  );
}

export function RepoView({ repo, locale = "zh-CN", onBack, onUpdateRepo, onRemoveRepo }: Props) {
  const [tab, setTab] = useState<Tab>("files");
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [blob, setBlob] = useState<BlobViewState>({ kind: "idle" });
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [commitPatch, setCommitPatch] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusLine[]>([]);
  const [selectedStage, setSelectedStage] = useState<Set<string>>(new Set());
  const [commitMessage, setCommitMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const autoReadmeDone = useRef(false);
  const pathCommitCache = useRef(new Map<string, CommitSummary | null>());
  const [pathCommitVersion, setPathCommitVersion] = useState(0);

  const [rev, setRev] = useState("HEAD");
  const [refLists, setRefLists] = useState<RefLists | null>(null);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [filePrefix, setFilePrefix] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [headCommit, setHeadCommit] = useState<CommitSummary | null>(null);
  const [revCount, setRevCount] = useState<number>(0);
  const [readmeBlurb, setReadmeBlurb] = useState<string | null>(null);
  const [tagDraftList, setTagDraftList] = useState<string[]>([]);
  const [tagInputDraft, setTagInputDraft] = useState("");
  const [introDraft, setIntroDraft] = useState("");
  const [repoSettingsOpen, setRepoSettingsOpen] = useState(false);
  const [deleteGateInput, setDeleteGateInput] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [markdownViewMode, setMarkdownViewMode] =
    useState<MarkdownViewMode>("preview");
  const [releaseDrafts, setReleaseDrafts] = useState<ReleaseEntry[]>([]);
  const [releaseSavedSnapshot, setReleaseSavedSnapshot] = useState("[]");
  const [releaseSaving, setReleaseSaving] = useState(false);
  const isZh = locale === "zh-CN";
  const unsavedReleasePrompt = isZh
    ? "Releases 有未保存变更，确定离开并丢弃这些修改吗？"
    : "You have unsaved release changes. Leave and discard these edits?";

  const blobPaths = useMemo(
    () => tree.filter((e) => e.objectType === "blob").map((e) => e.path),
    [tree],
  );
  const draftTags = useMemo(
    () => [...new Set(tagDraftList.map((t) => t.trim()).filter(Boolean))],
    [tagDraftList],
  );
  const duplicateReleaseVersion = useMemo(() => {
    const seen = new Set<string>();
    for (const rel of releaseDrafts) {
      const v = rel.version.trim().toLowerCase();
      if (!v) continue;
      if (seen.has(v)) return rel.version.trim();
      seen.add(v);
    }
    return null;
  }, [releaseDrafts]);
  const releaseDraftSnapshot = useMemo(
    () => JSON.stringify(releaseDrafts),
    [releaseDrafts],
  );
  const hasUnsavedReleases = useMemo(
    () => releaseDraftSnapshot !== releaseSavedSnapshot,
    [releaseDraftSnapshot, releaseSavedSnapshot],
  );

  const licensePath = useMemo(() => findLicensePath(blobPaths), [blobPaths]);

  const fileEntries = useMemo(() => {
    const entries = listEntriesAtPrefix(blobPaths, filePrefix);
    const q = fileFilter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [blobPaths, filePrefix, fileFilter]);

  useEffect(() => {
    if (tab !== "files" || fileEntries.length === 0) return;
    let cancelled = false;
    const targets = fileEntries
      .map((e) => (e.kind === "file" ? e.path : `${e.prefix}/`))
      .filter((p) => !pathCommitCache.current.has(`${rev}\0${p}`));
    if (targets.length === 0) return;
    void repoPathsLastCommit(repo.id, rev, targets)
      .then((rows) => {
        if (cancelled) return;
        for (const row of rows) {
          pathCommitCache.current.set(`${rev}\0${row.path}`, row.commit);
        }
        setPathCommitVersion((v) => v + 1);
      })
      .catch(() => {
        if (cancelled) return;
        for (const target of targets) {
          pathCommitCache.current.set(`${rev}\0${target}`, null);
        }
        setPathCommitVersion((v) => v + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, fileEntries, repo.id, rev]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([repoListRefs(repo.id), repoRemotes(repo.id)]).then(
      ([refs, rmt]) => {
        if (cancelled) return;
        setRefLists(refs);
        setRemotes(rmt);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repo.id]);

  useEffect(() => {
    setRev("HEAD");
    setFilePrefix("");
    setFileFilter("");
    pathCommitCache.current.clear();
    setReadmeBlurb(null);
    autoReadmeDone.current = false;
    setTagDraftList(repo.tags);
    setTagInputDraft("");
    setIntroDraft(repo.projectIntro ?? "");
    setReleaseDrafts([]);
    setReleaseSavedSnapshot("[]");
  }, [repo.id]);

  useEffect(() => {
    setTagDraftList(repo.tags);
    setTagInputDraft("");
  }, [repo.tags]);

  useEffect(() => {
    setIntroDraft(repo.projectIntro ?? "");
  }, [repo.projectIntro]);

  useEffect(() => {
    pathCommitCache.current.clear();
    autoReadmeDone.current = false;
  }, [rev]);

  const loadReleases = useCallback(async () => {
    setError(null);
    try {
      const list = await repoListReleases(repo.id);
      setReleaseDrafts(list);
      setReleaseSavedSnapshot(JSON.stringify(list));
    } catch (e) {
      setError(String(e));
      setReleaseDrafts([]);
      setReleaseSavedSnapshot("[]");
    }
  }, [repo.id]);

  const loadTree = useCallback(async () => {
    setError(null);
    try {
      const t = await repoLsTree(repo.id, rev);
      setTree(t.filter((e) => e.objectType === "blob"));
    } catch (e) {
      setError(String(e));
      setTree([]);
    }
  }, [repo.id, rev]);

  const loadCommits = useCallback(async () => {
    setError(null);
    try {
      const c = await repoLog(repo.id, 100, rev);
      setCommits(c);
    } catch (e) {
      setError(String(e));
      setCommits([]);
    }
  }, [repo.id, rev]);

  const loadStatus = useCallback(async () => {
    if (repo.isBare) {
      setStatus([]);
      return;
    }
    setError(null);
    try {
      const s = await repoStatus(repo.id);
      setStatus(s);
    } catch (e) {
      setError(String(e));
      setStatus([]);
    }
  }, [repo.id, repo.isBare]);

  useEffect(() => {
    if (tab === "files") void loadTree();
    if (tab === "commits") void loadCommits();
    if (tab === "changes") void loadStatus();
    if (tab === "releases") void loadReleases();
  }, [tab, loadTree, loadCommits, loadStatus, loadReleases]);

  useEffect(() => {
    if (tab !== "files") return;
    let cancelled = false;
    void Promise.all([
      repoLatestCommit(repo.id, rev),
      repoRevCount(repo.id, rev),
    ])
      .then(([lc, cnt]) => {
        if (cancelled) return;
        setHeadCommit(lc);
        setRevCount(cnt);
      })
      .catch(() => {
        if (cancelled) return;
        setHeadCommit(null);
        setRevCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, repo.id, rev]);

  const openBlob = useCallback(
    async (path: string) => {
      setSelectedPath(path);
      setBlob({ kind: "loading" });
      setError(null);
      const spec = `${rev}:${path}`;
      const ext = extOf(path);

      try {
        if (IMAGE_EXT.has(ext)) {
          const b64 = await repoBlobBase64(repo.id, spec);
          const mime = mimeForPath(path);
          setBlob({
            kind: "image",
            dataUrl: `data:${mime};base64,${b64}`,
            alt: path,
          });
          return;
        }
        if (MARKDOWN_EXT.has(ext)) {
          const text = await repoBlobText(repo.id, spec);
          setBlob({ kind: "markdown", content: text });
          const readme = pickReadmePath(blobPaths);
          if (readme === path) {
            setReadmeBlurb(readmeExcerptFromMarkdown(text));
          }
          return;
        }
        const text = await repoBlobText(repo.id, spec);
        setBlob({ kind: "text", content: text });
      } catch (e) {
        const msg = String(e);
        if (msg.includes("binary") || msg.includes("non-UTF-8")) {
          try {
            const b64 = await repoBlobBase64(repo.id, spec);
            const mime = mimeForPath(path);
            if (mime.startsWith("image/")) {
              setBlob({
                kind: "image",
                dataUrl: `data:${mime};base64,${b64}`,
                alt: path,
              });
              return;
            }
          } catch {
          }
          setBlob({ kind: "binary" });
        } else {
          setBlob({ kind: "error", message: msg });
        }
      }
    },
    [repo.id, rev, blobPaths],
  );

  useEffect(() => {
    if (tab !== "files" || blobPaths.length === 0 || autoReadmeDone.current) {
      return;
    }
    autoReadmeDone.current = true;
    const readme = pickReadmePath(blobPaths);
    if (readme) void openBlob(readme);
  }, [tab, blobPaths, openBlob]);

  async function openCommit(id: string) {
    setSelectedCommit(id);
    setCommitPatch(null);
    setError(null);
    try {
      const patch = await repoShowCommit(repo.id, id);
      setCommitPatch(patch);
    } catch (e) {
      setError(String(e));
    }
  }

  function toggleStagePath(p: string) {
    setSelectedStage((prev) => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }

  async function stageSelected() {
    if (selectedStage.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await repoStage(repo.id, [...selectedStage]);
      setSelectedStage(new Set());
      await loadStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    if (!commitMessage.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await repoCommit(repo.id, commitMessage.trim());
      setCommitMessage("");
      await loadStatus();
      await loadTree();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveRepoTags() {
    const tags = draftTags;
    setError(null);
    try {
      await hubSetTags(repo.id, tags);
      onUpdateRepo?.({ ...repo, tags });
      setTagDraftList(tags);
      setTagInputDraft("");
    } catch (e) {
      setError(String(e));
    }
  }

  function addTagFromInput() {
    const incoming = parseTagTokens(tagInputDraft);
    if (incoming.length === 0) return;
    setTagDraftList((prev) => {
      const next = [...prev];
      for (const t of incoming) {
        if (!next.includes(t)) next.push(t);
      }
      return next;
    });
    setTagInputDraft("");
  }

  function removeSingleTag(tag: string) {
    setTagDraftList((prev) => prev.filter((t) => t !== tag));
  }

  async function saveProjectIntro() {
    const intro = introDraft.trim();
    setError(null);
    try {
      await hubSetProjectIntro(repo.id, intro.length > 0 ? intro : null);
      onUpdateRepo?.({ ...repo, projectIntro: intro.length > 0 ? intro : null });
      setIntroDraft(intro);
    } catch (e) {
      setError(String(e));
    }
  }

  function addReleaseDraft() {
    const now = Math.floor(Date.now() / 1000);
    setReleaseDrafts((prev) => [
      {
        id: crypto.randomUUID(),
        version: "",
        title: "",
        notes: "",
        sourceUrl: "",
        assets: [],
        createdAt: now,
        updatedAt: now,
      },
      ...prev,
    ]);
  }

  function removeReleaseDraft(id: string) {
    setReleaseDrafts((prev) => prev.filter((x) => x.id !== id));
  }

  function updateReleaseDraft(
    id: string,
    field: "version" | "title" | "notes" | "sourceUrl",
    value: string,
  ) {
    const now = Math.floor(Date.now() / 1000);
    setReleaseDrafts((prev) =>
      prev.map((x) => (x.id === id ? { ...x, [field]: value, updatedAt: now } : x)),
    );
  }

  async function removeReleaseAsset(releaseId: string, asset: ReleaseAsset) {
    try {
      await repoDeleteReleaseAsset(repo.id, asset.storedPath);
    } catch (e) {
      setError(String(e));
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    setReleaseDrafts((prev) =>
      prev.map((x) =>
        x.id === releaseId
          ? {
              ...x,
              assets: x.assets.filter((a) => a.id !== asset.id),
              updatedAt: now,
            }
          : x,
      ),
    );
  }

  async function importAssetsToRelease(releaseId: string) {
    try {
      const picked = await open({
        title: isZh ? "选择 Release 文件" : "Select release assets",
        multiple: true,
        directory: false,
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;
      const imported: ReleaseAsset[] = [];
      for (const p of paths) {
        const asset = await repoImportReleaseAsset(repo.id, releaseId, p);
        imported.push(asset);
      }
      const now = Math.floor(Date.now() / 1000);
      setReleaseDrafts((prev) =>
        prev.map((x) =>
          x.id === releaseId
            ? { ...x, assets: [...x.assets, ...imported], updatedAt: now }
            : x,
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  }

  async function saveAllReleases() {
    if (duplicateReleaseVersion) {
      setError(
        isZh
          ? `版本号重复：${duplicateReleaseVersion}`
          : `Duplicate release version: ${duplicateReleaseVersion}`,
      );
      return;
    }
    setReleaseSaving(true);
    setError(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const normalized = releaseDrafts
        .map((x) => ({
          ...x,
          id: x.id.trim() || crypto.randomUUID(),
          version: x.version.trim(),
          title: x.title.trim(),
          notes: x.notes.trim(),
          sourceUrl: x.sourceUrl.trim(),
          createdAt: x.createdAt || now,
          updatedAt: now,
        }))
        .filter((x) => x.version.length > 0);
      const saved = await repoSaveReleases(repo.id, normalized);
      setReleaseDrafts(saved);
      setReleaseSavedSnapshot(JSON.stringify(saved));
    } catch (e) {
      setError(String(e));
    } finally {
      setReleaseSaving(false);
    }
  }

  function confirmLeaveReleases() {
    if (tab !== "releases" || !hasUnsavedReleases) return true;
    return window.confirm(unsavedReleasePrompt);
  }

  function switchTab(next: Tab) {
    if (next === tab) return;
    if (tab === "releases" && next !== "releases" && !confirmLeaveReleases()) {
      return;
    }
    setTab(next);
  }

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedReleases) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [hasUnsavedReleases]);

  const deleteGateMatched = deleteGateInput.trim().toUpperCase() === "DELETE";

  async function removeFromHub() {
    if (!deleteGateMatched || deleteBusy) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await hubRemoveRepo(repo.id);
      setRepoSettingsOpen(false);
      setDeleteGateInput("");
      onRemoveRepo?.(repo.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  const title =
    repo.displayName ??
    repo.path.split(/[/\\]/).filter(Boolean).pop() ??
    repo.path;

  const prefixBreadcrumb = filePrefix
    ? filePrefix.split("/").filter(Boolean)
    : [];

  return (
    <div className="repo-view repo-view-ios">
      <header className="repo-ios-header">
        <div className="repo-ios-nav-row">
          <button
            type="button"
            className="repo-ios-back"
            onClick={() => {
              if (!confirmLeaveReleases()) return;
              onBack();
            }}
          >
            <span className="repo-ios-back-chevron" aria-hidden>
              ‹
            </span>
            {isZh ? "门户" : "Hub"}
          </button>
        </div>
        <div className="repo-ios-title-block">
          <h1 className="repo-ios-title">
            {title}
            {repo.isBare && (
              <span className="repo-ios-badge" title="裸仓库">
                Bare
              </span>
            )}
          </h1>
          <p className="repo-ios-subtitle" title={repo.path}>
            {repo.path}
          </p>
        </div>
        <nav
          className="repo-ios-segmented"
          role="tablist"
          aria-label={isZh ? "仓库分区" : "Repository sections"}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "files"}
            className={tab === "files" ? "active" : ""}
            onClick={() => switchTab("files")}
          >
            {isZh ? "代码" : "Code"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "commits"}
            className={tab === "commits" ? "active" : ""}
            onClick={() => switchTab("commits")}
          >
            {isZh ? "提交" : "Commits"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "changes"}
            className={tab === "changes" ? "active" : ""}
            onClick={() => switchTab("changes")}
            disabled={repo.isBare}
            title={repo.isBare ? (isZh ? "裸仓库无工作区" : "Bare repository has no working tree") : undefined}
          >
            {isZh ? "改动" : "Changes"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "releases"}
            className={tab === "releases" ? "active" : ""}
            onClick={() => switchTab("releases")}
          >
            Releases
          </button>
        </nav>
      </header>
      {error && <div className="repo-ios-error">{error}</div>}

      {tab === "files" && (
        <div className="repo-code-page">
          <div className="repo-code-main">
            <div className="repo-code-toolbar repo-code-card">
              <label className="repo-code-rev-label">
                <span className="sr-only">{isZh ? "修订" : "Revision"}</span>
                <select
                  className="repo-code-rev-select"
                  value={rev}
                  onChange={(e) => setRev(e.target.value)}
                  aria-label={isZh ? "分支或标签" : "Branch or tag"}
                >
                  <option value="HEAD">HEAD</option>
                  {refLists && refLists.branches.length > 0 && (
                    <optgroup label={isZh ? "分支" : "Branches"}>
                      {refLists.branches.map((b) => (
                        <option key={`b-${b}`} value={b}>
                          {b}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {refLists && refLists.tags.length > 0 && (
                    <optgroup label={isZh ? "标签" : "Tags"}>
                      {refLists.tags.map((t) => (
                        <option key={`t-${t}`} value={t}>
                          {t}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <input
                type="search"
                className="repo-code-search"
                placeholder={isZh ? "过滤当前目录…" : "Filter current directory..."}
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                aria-label={isZh ? "过滤文件" : "Filter files"}
              />
            </div>

            <div className="repo-commit-strip repo-code-card">
              {headCommit ? (
                <>
                  <div className="repo-commit-strip-main">
                    <span className="repo-commit-author">{headCommit.author}</span>
                    <span className="repo-commit-subj" title={headCommit.subject}>
                      {headCommit.subject}
                    </span>
                  </div>
                  <div className="repo-commit-strip-meta">
                    <code className="repo-commit-sha">
                      {headCommit.id.slice(0, 7)}
                    </code>
                    <span className="repo-commit-time">
                      {formatRelativeTime(headCommit.dateUnix)}
                    </span>
                    <button
                      type="button"
                      className="repo-commit-count-btn"
                      onClick={() => setTab("commits")}
                    >
                      {isZh ? `${revCount} 条提交` : `${revCount} commits`}
                    </button>
                  </div>
                </>
              ) : (
                <span className="repo-commit-strip-empty">{isZh ? "暂无提交信息" : "No commit info"}</span>
              )}
            </div>

            <div className="repo-code-columns">
              <div className="repo-file-panel repo-code-card">
                <div className="repo-file-panel-head">
                  <span>{isZh ? "文件" : "Files"}</span>
                  <span className="repo-file-rev-pill" title="当前修订">
                    {rev}
                  </span>
                </div>
                <div className="repo-path-breadcrumb" aria-label={isZh ? "路径" : "Path"}>
                  <button
                    type="button"
                    className={
                      filePrefix ? "repo-bc-link" : "repo-bc-link repo-bc-current"
                    }
                    onClick={() => setFilePrefix("")}
                  >
                    {title}
                  </button>
                  {prefixBreadcrumb.map((seg, i) => {
                    const full = prefixBreadcrumb.slice(0, i + 1).join("/");
                    const isLast = i === prefixBreadcrumb.length - 1;
                    return (
                      <span key={full}>
                        <span className="repo-bc-sep">/</span>
                        <button
                          type="button"
                          className={
                            isLast
                              ? "repo-bc-link repo-bc-current"
                              : "repo-bc-link"
                          }
                          onClick={() => setFilePrefix(full)}
                        >
                          {seg}
                        </button>
                      </span>
                    );
                  })}
                </div>
                <div className="repo-file-table-wrap">
                  <table className="repo-file-table">
                    <thead>
                      <tr>
                        <th className="repo-file-col-name">{isZh ? "名称" : "Name"}</th>
                        <th className="repo-file-col-last">{isZh ? "最后提交" : "Last commit"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileEntries.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="repo-file-empty">
                            {blobPaths.length === 0 ? (isZh ? "暂无文件" : "No files") : (isZh ? "无匹配项" : "No matches")}
                          </td>
                        </tr>
                      ) : (
                        fileEntries.map((e) => (
                          <tr key={e.kind + (e.kind === "file" ? e.path : e.prefix)}>
                            <td className="repo-file-col-name">
                              {e.kind === "dir" ? (
                                <button
                                  type="button"
                                  className="repo-file-name-btn"
                                  onClick={() => setFilePrefix(e.prefix)}
                                >
                                  <span className="repo-file-icon" aria-hidden>
                                    📁
                                  </span>
                                  {e.name}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={`repo-file-name-btn${selectedPath === e.path ? " active" : ""}`}
                                  onClick={() => void openBlob(e.path)}
                                >
                                  <span className="repo-file-icon" aria-hidden>
                                    📄
                                  </span>
                                  {e.name}
                                </button>
                              )}
                            </td>
                            <td className="repo-file-col-last">
                              <PathLastCommitCell
                                rev={rev}
                                path={
                                  e.kind === "file" ? e.path : `${e.prefix}/`
                                }
                                cacheRef={pathCommitCache}
                                cacheVersion={pathCommitVersion}
                              />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <section className="repo-reader-panel repo-code-card" aria-label={isZh ? "文件内容" : "File contents"}>
                <div className="repo-ios-breadcrumb" aria-label={isZh ? "当前文件" : "Current file"}>
                  {selectedPath?.split("/").map((part, i, arr) => (
                    <span key={`${i}-${part}`}>
                      {i > 0 && <span className="repo-ios-bc-sep">/</span>}
                      <span
                        className={
                          i === arr.length - 1
                            ? "repo-ios-bc-current"
                            : "repo-ios-bc-part"
                        }
                      >
                        {part}
                      </span>
                    </span>
                  ))}
                  {!selectedPath && (
                    <span className="repo-ios-bc-placeholder">{isZh ? "选择文件" : "Select a file"}</span>
                  )}
                </div>
                {blob.kind === "markdown" && (
                  <div
                    className="repo-markdown-mode-toggle"
                    role="tablist"
                    aria-label={
                      isZh ? "Markdown 显示模式" : "Markdown display mode"
                    }
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
                        return;
                      e.preventDefault();
                      setMarkdownViewMode((m) =>
                        m === "preview" ? "code" : "preview",
                      );
                    }}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={markdownViewMode === "preview"}
                      className={
                        markdownViewMode === "preview" ? "active" : ""
                      }
                      onClick={() => setMarkdownViewMode("preview")}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={markdownViewMode === "code"}
                      className={markdownViewMode === "code" ? "active" : ""}
                      onClick={() => setMarkdownViewMode("code")}
                    >
                      Code
                    </button>
                  </div>
                )}
                <div className="repo-ios-viewport">
                  {blob.kind === "idle" && (
                    <p className="repo-ios-placeholder">
                      {isZh
                        ? "进入目录时会优先打开 README。点击文件表中的文件可阅读源码与预览。"
                        : "README opens by default when available. Select a file to read source and preview."}
                    </p>
                  )}
                  {blob.kind === "loading" && (
                    <p className="repo-ios-placeholder">{isZh ? "加载中…" : "Loading..."}</p>
                  )}
                  {blob.kind === "error" && (
                    <pre className="repo-ios-blob-error">{blob.message}</pre>
                  )}
                  {blob.kind === "text" && (
                    <pre className="repo-ios-blob-raw">{blob.content}</pre>
                  )}
                  {blob.kind === "markdown" && (
                    markdownViewMode === "preview" ? (
                      <div className="repo-ios-markdown">
                        <MarkdownBody
                          source={blob.content}
                          repoId={repo.id}
                          markdownPath={selectedPath ?? ""}
                          rev={rev}
                          onOpenBlob={(p) => void openBlob(p)}
                        />
                      </div>
                    ) : (
                      <pre className="repo-ios-markdown-code">{blob.content}</pre>
                    )
                  )}
                  {blob.kind === "image" && (
                    <figure className="repo-ios-figure">
                      <img
                        src={blob.dataUrl}
                        alt={blob.alt}
                        className="repo-ios-image"
                      />
                      <figcaption className="repo-ios-figcap">{blob.alt}</figcaption>
                    </figure>
                  )}
                  {blob.kind === "binary" && (
                    <div className="repo-ios-binary">
                      <p>{isZh ? "此文件为二进制或无法解码为文本。" : "This file is binary or cannot be decoded as text."}</p>
                      <p className="repo-ios-footnote">
                        {isZh ? "若应为图片，请确认扩展名（如 .png）。" : "If this should be an image, verify the file extension (e.g. .png)."}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>

          <aside className="repo-about-sidebar repo-code-card" aria-label={isZh ? "关于" : "About"}>
            <h2 className="repo-about-title">{isZh ? "关于" : "About"}</h2>
            {readmeBlurb && (
              <p className="repo-about-desc">{readmeBlurb}</p>
            )}
            {!readmeBlurb && (
              <p className="repo-about-desc muted">
                {isZh ? "打开 README 后将显示摘要。" : "Open README to show summary."}
              </p>
            )}
            {repo.tags.length > 0 && (
              <div className="repo-about-tags">
                {repo.tags.map((t) => (
                  <span key={t} className="repo-about-tag">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="repo-about-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setRepoSettingsOpen(true);
                  setDeleteGateInput("");
                }}
              >
                {isZh ? "仓库设置" : "Repository settings"}
              </button>
            </div>
            <dl className="repo-about-dl">
              <dt>{isZh ? "本地路径" : "Local path"}</dt>
              <dd className="repo-about-mono" title={repo.path}>
                {repo.path}
              </dd>
              {licensePath && (
                <>
                  <dt>{isZh ? "许可证文件" : "License file"}</dt>
                  <dd>
                    <button
                      type="button"
                      className="repo-about-link"
                      onClick={() => void openBlob(licensePath)}
                    >
                      {licensePath.includes("/")
                        ? licensePath.slice(licensePath.lastIndexOf("/") + 1)
                        : licensePath}
                    </button>
                  </dd>
                </>
              )}
            </dl>
            {remotes.length > 0 && (
              <>
                <h3 className="repo-about-sub">{isZh ? "远程" : "Remotes"}</h3>
                <ul className="repo-about-remotes">
                  {remotes.map((r) => (
                    <li key={r.name}>
                      <span className="repo-remote-name">{r.name}</span>
                      <span className="repo-about-mono repo-remote-url" title={r.fetchUrl}>
                        {r.fetchUrl}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>
      )}
      {repoSettingsOpen && (
        <div className="settings-modal-backdrop" role="presentation" onClick={() => setRepoSettingsOpen(false)}>
          <section
            className="settings-modal repo-settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label={isZh ? "仓库设置" : "Repository settings"}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="settings-modal-head">
              <h2>{isZh ? "仓库设置" : "Repository settings"}</h2>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setRepoSettingsOpen(false)}
                disabled={deleteBusy}
              >
                {isZh ? "关闭" : "Close"}
              </button>
            </header>
            <section className="settings-card">
              <h3>{isZh ? "项目简介" : "Project intro"}</h3>
              <div className="repo-about-tag-input-row">
                <input
                  id={`repo-intro-${repo.id}`}
                  className="repo-about-tag-input"
                  value={introDraft}
                    placeholder={isZh ? "一句话简介，展示在项目卡片" : "One-line summary for project card"}
                  onChange={(e) => setIntroDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveProjectIntro();
                  }}
                />
                <button type="button" className="btn-secondary" onClick={() => void saveProjectIntro()}>
                  {isZh ? "保存简介" : "Save intro"}
                </button>
              </div>
            </section>
            <section className="settings-card">
              <h3>{isZh ? "项目标签" : "Project tags"}</h3>
              <p className="settings-note">
                {isZh
                  ? "可添加多个标签。输入后按 Enter 加入列表；也支持粘贴逗号分隔标签。"
                  : "Add multiple tags. Press Enter to append; comma-separated paste is also supported."}
              </p>
              <div className="repo-about-tag-input-row">
                <input
                  id={`repo-tags-${repo.id}`}
                  className="repo-about-tag-input"
                  value={tagInputDraft}
                  placeholder={isZh ? "输入标签，例如 work" : "Type tag, e.g. work"}
                  onChange={(e) => setTagInputDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void saveRepoTags();
                      return;
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTagFromInput();
                    }
                  }}
                />
                <button type="button" className="btn-secondary" onClick={addTagFromInput}>
                  {isZh ? "添加" : "Add"}
                </button>
              </div>
              <p className="settings-note">
                {isZh ? "快捷键：Ctrl/Cmd + Enter 保存标签" : "Shortcut: Ctrl/Cmd + Enter to save tags"}
              </p>
              <div className="repo-settings-tag-preview">
                <span className="repo-about-sub">{isZh ? "预览" : "Preview"}</span>
                {draftTags.length > 0 ? (
                  <div className="repo-about-tags repo-settings-tags">
                    {draftTags.map((t) => (
                      <span key={`preview-${t}`} className="repo-about-tag repo-settings-tag-chip">
                        {t}
                        <button
                          type="button"
                          className="repo-settings-tag-remove"
                          aria-label={isZh ? `移除标签 ${t}` : `Remove tag ${t}`}
                          onClick={() => removeSingleTag(t)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="settings-note">
                    {isZh ? "暂无标签预览" : "No tags in preview"}
                  </p>
                )}
              </div>
              <div className="settings-confirm-actions">
                <button type="button" className="btn-secondary" onClick={() => void saveRepoTags()}>
                  {isZh ? "保存标签" : "Save tags"}
                </button>
              </div>
            </section>
            <section className="settings-card settings-danger-card">
              <h3>{isZh ? "危险操作" : "Danger zone"}</h3>
              <p className="settings-note">
                {isZh
                  ? "将删除项目记录并永久删除本地仓库目录（含 .git 与工作区文件）。"
                  : "Removes project record and permanently deletes local repository directory, including .git and working tree files."}
              </p>
              <label className="settings-item-label" htmlFor={`repo-delete-gate-${repo.id}`}>
                {isZh ? "输入 DELETE 继续" : "Type DELETE to continue"}
              </label>
              <input
                id={`repo-delete-gate-${repo.id}`}
                className="repo-about-tag-input"
                value={deleteGateInput}
                placeholder="DELETE"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setDeleteGateInput(e.target.value)}
              />
              {deleteGateInput.length > 0 && !deleteGateMatched && (
                <p className="repo-delete-confirm-error" role="alert">
                  {isZh ? "输入必须为 DELETE" : "Input must be DELETE"}
                </p>
              )}
              <div className="settings-confirm-actions">
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => void removeFromHub()}
                  disabled={deleteBusy || !deleteGateMatched}
                >
                  {deleteBusy
                    ? isZh
                      ? "删除中…"
                      : "Deleting..."
                    : isZh
                      ? "确认永久删除"
                      : "Confirm permanent delete"}
                </button>
              </div>
            </section>
          </section>
        </div>
      )}

      {tab === "releases" && (
        <div className="repo-releases-wrap repo-code-card">
          <div className="repo-releases-toolbar">
            <button type="button" className="btn-secondary" onClick={addReleaseDraft}>
              {isZh ? "新建 Release" : "New release"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void saveAllReleases()}
              disabled={releaseSaving}
            >
              {releaseSaving ? (isZh ? "保存中…" : "Saving...") : (isZh ? "保存全部" : "Save all")}
            </button>
            {duplicateReleaseVersion && (
              <span className="settings-note">
                {isZh ? `版本重复：${duplicateReleaseVersion}` : `Duplicate version: ${duplicateReleaseVersion}`}
              </span>
            )}
          </div>
          {releaseDrafts.length === 0 ? (
            <p className="repo-ios-footnote">
              {isZh ? "暂无 Release。点击“新建 Release”开始。" : "No releases yet. Click New release to start."}
            </p>
          ) : (
            <div className="repo-release-list">
              {releaseDrafts.map((item) => (
                <section className="repo-release-item" key={item.id}>
                  <div className="repo-release-head">
                    <strong>{item.version || (isZh ? "未命名版本" : "Untitled version")}</strong>
                    <div className="settings-confirm-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void importAssetsToRelease(item.id)}
                      >
                        {isZh ? "上传文件" : "Upload files"}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => removeReleaseDraft(item.id)}
                      >
                        {isZh ? "删除版本" : "Delete release"}
                      </button>
                    </div>
                  </div>
                  <input
                    className="repo-about-tag-input"
                    placeholder={isZh ? "版本号（唯一，如 v1.2.0）" : "Version (unique, e.g. v1.2.0)"}
                    value={item.version}
                    onChange={(e) => updateReleaseDraft(item.id, "version", e.target.value)}
                  />
                  <input
                    className="repo-about-tag-input"
                    placeholder={isZh ? "标题" : "Title"}
                    value={item.title}
                    onChange={(e) => updateReleaseDraft(item.id, "title", e.target.value)}
                  />
                  <input
                    className="repo-about-tag-input"
                    placeholder={isZh ? "来源链接（可选）" : "Source URL (optional)"}
                    value={item.sourceUrl}
                    onChange={(e) => updateReleaseDraft(item.id, "sourceUrl", e.target.value)}
                  />
                  <textarea
                    className="repo-about-tag-input repo-release-notes"
                    placeholder={isZh ? "发布说明 / 备注" : "Release notes / remarks"}
                    value={item.notes}
                    onChange={(e) => updateReleaseDraft(item.id, "notes", e.target.value)}
                  />
                  {item.assets.length > 0 ? (
                    <ul className="repo-release-assets">
                      {item.assets.map((asset) => (
                        <li key={asset.id}>
                          <div className="repo-release-asset-line">
                            <span>{asset.name}</span>
                            <span className="repo-about-mono">{formatBytes(asset.sizeBytes)}</span>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => void removeReleaseAsset(item.id, asset)}
                            >
                              {isZh ? "移除" : "Remove"}
                            </button>
                          </div>
                          <div className="repo-about-mono">{asset.storedPath}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="settings-note">{isZh ? "该版本暂无文件" : "No assets in this release"}</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "commits" && (
        <div className="repo-commits-wrap">
          <div className="repo-code-toolbar repo-code-card repo-commits-toolbar">
            <label className="repo-code-rev-label">
                <span className="sr-only">{isZh ? "修订" : "Revision"}</span>
              <select
                className="repo-code-rev-select"
                value={rev}
                onChange={(e) => setRev(e.target.value)}
                aria-label={isZh ? "分支或标签" : "Branch or tag"}
              >
                <option value="HEAD">HEAD</option>
                {refLists && refLists.branches.length > 0 && (
                  <optgroup label={isZh ? "分支" : "Branches"}>
                    {refLists.branches.map((b) => (
                      <option key={`cb-${b}`} value={b}>
                        {b}
                      </option>
                    ))}
                  </optgroup>
                )}
                {refLists && refLists.tags.length > 0 && (
                  <optgroup label={isZh ? "标签" : "Tags"}>
                    {refLists.tags.map((t) => (
                      <option key={`ct-${t}`} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          </div>
        <div className="repo-github-split repo-github-split-commits">
          <ul className="repo-ios-commit-list">
            {commits.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={selectedCommit === c.id ? "active" : ""}
                  onClick={() => void openCommit(c.id)}
                >
                  <span className="sha">{c.id.slice(0, 7)}</span>{" "}
                  <span className="subj">{c.subject}</span>
                  <div className="commit-meta">
                    {c.author} · {new Date(c.dateUnix * 1000).toLocaleString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <pre className="repo-ios-patch">
            {commitPatch ?? (isZh ? "选择一条提交查看变更" : "Select a commit to view patch")}
          </pre>
        </div>
        </div>
      )}

      {tab === "changes" && !repo.isBare && (
        <div className="repo-ios-changes">
          <p className="repo-ios-changes-lead">
            {isZh ? "勾选要暂存的文件，然后填写提交说明。需本机已配置 " : "Select files to stage, then enter a commit message. Git config required: "}
            <code>user.name</code> / <code>user.email</code>。
          </p>
          <ul className="repo-ios-status-list">
            {status.map((s) => (
              <li key={s.path}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedStage.has(s.path)}
                    onChange={() => toggleStagePath(s.path)}
                  />
                  <span className="st">
                    {s.x}
                    {s.y}
                  </span>{" "}
                  {s.path}
                </label>
              </li>
            ))}
          </ul>
          {status.length === 0 && (
            <p className="repo-ios-footnote">{isZh ? "工作区干净，或尚未产生变更。" : "Working tree is clean, or no changes yet."}</p>
          )}
          <div className="repo-ios-commit-bar">
            <button
              type="button"
              className="repo-ios-btn-secondary"
              onClick={() => void stageSelected()}
              disabled={busy || selectedStage.size === 0}
            >
              {isZh ? "暂存所选" : "Stage selected"}
            </button>
            <input
              className="repo-ios-input"
              placeholder={isZh ? "提交说明" : "Commit message"}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
            <button
              type="button"
              className="repo-ios-btn-primary"
              onClick={() => void doCommit()}
              disabled={busy || !commitMessage.trim()}
            >
              {isZh ? "提交" : "Commit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
