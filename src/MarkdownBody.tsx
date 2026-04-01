import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { repoBlobBase64 } from "./api";
import {
  isProbablyWebImageUrl,
  mimeForPath,
  resolveRepoRelativePath,
} from "./gitPaths";

type Props = {
  source: string;
  repoId: number;
  markdownPath: string;
  rev?: string;
  onOpenBlob: (path: string) => void;
};

function MdImg({
  src,
  alt,
  repoId,
  markdownPath,
  rev,
}: {
  src?: string;
  alt?: string;
  repoId: number;
  markdownPath: string;
  rev: string;
}) {
  const [phase, setPhase] = useState<"loading" | "ok" | "fallback" | "err">(
    "loading",
  );
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setPhase("err");
      return;
    }
    if (isProbablyWebImageUrl(src)) {
      setPhase("fallback");
      return;
    }

    const resolved = resolveRepoRelativePath(markdownPath, src);
    if (!resolved) {
      setPhase("fallback");
      return;
    }

    let cancelled = false;
    setPhase("loading");
    setDataUrl(null);

    (async () => {
      try {
        const b64 = await repoBlobBase64(repoId, `${rev}:${resolved}`);
        if (cancelled) return;
        const mime = mimeForPath(resolved);
        setDataUrl(`data:${mime};base64,${b64}`);
        setPhase("ok");
      } catch {
        if (!cancelled) setPhase("err");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, repoId, markdownPath, rev]);

  if (!src) return null;

  if (phase === "fallback") {
    return (
      <img src={src} alt={alt ?? ""} className="markdown-body-img-external" />
    );
  }

  if (phase === "loading") {
    return (
      <span className="markdown-body-img-loading" aria-hidden>
        …
      </span>
    );
  }

  if (phase === "ok" && dataUrl) {
    return <img src={dataUrl} alt={alt ?? ""} />;
  }

  return (
    <span className="markdown-body-img-missing" title={src}>
      {alt ? `[${alt}]` : src}
    </span>
  );
}

function mdLinkRenderer(
  href: string | undefined,
  children: ReactNode,
  markdownPath: string,
  onOpenBlob: (path: string) => void,
) {
  if (!href) return <span>{children}</span>;
  if (href.startsWith("#")) {
    return <a href={href}>{children}</a>;
  }
  const lower = href.trim().toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:")
  ) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  const resolved = resolveRepoRelativePath(markdownPath, href);
  if (resolved) {
    return (
      <button
        type="button"
        className="md-internal-link"
        onClick={() => onOpenBlob(resolved)}
      >
        {children}
      </button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function MarkdownBody({
  source,
  repoId,
  markdownPath,
  rev = "HEAD",
  onOpenBlob,
}: Props) {
  const r = rev;
  const rehypePlugins = useMemo(
    () => [rehypeRaw, rehypeSanitize],
    [],
  );

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          a: ({ href, children }) =>
            mdLinkRenderer(href, children, markdownPath, onOpenBlob),
          img: ({ src, alt }) => (
            <MdImg
              src={src ?? undefined}
              alt={alt ?? undefined}
              repoId={repoId}
              markdownPath={markdownPath}
              rev={r}
            />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
