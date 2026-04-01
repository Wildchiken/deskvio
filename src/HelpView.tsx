type Props = {
  locale?: "zh-CN" | "en-US";
};

export function HelpView({ locale = "zh-CN" }: Props) {
  const isZh = locale === "zh-CN";
  return (
    <div className="help-view help-redesign">
      <header className="help-hero">
        <h2>{isZh ? "帮助中心" : "Help Center"}</h2>
        <p className="help-lead">
          {isZh
            ? "纯本地、无账号的 Git 工具：统一管理本机仓库，浏览代码与历史，完成轻量提交。"
            : "A local-first Git tool with no account requirement: manage local repositories, browse history, and make lightweight commits."}
        </p>
      </header>

      <section className="help-grid">
        <article className="help-card">
          <h3>{isZh ? "快速开始" : "Quick Start"}</h3>
          <pre className="help-code">{`npm install
npm run tauri dev`}</pre>
          <p className="help-note">
            {isZh ? "依赖" : "Requires"}{" "}
            <a href="https://nodejs.org/" target="_blank" rel="noreferrer">
              Node.js
            </a>{" "}
            +{" "}
            <a href="https://rustup.rs/" target="_blank" rel="noreferrer">
              Rust
            </a>{" "}
            +{" "}
            <a href="https://v2.tauri.app/start/prerequisites/" target="_blank" rel="noreferrer">
              {isZh ? "Tauri 前置环境" : "Tauri prerequisites"}
            </a>
            {isZh ? "。" : "."}
          </p>
        </article>

        <article className="help-card">
          <h3>{isZh ? "构建发布" : "Build"}</h3>
          <pre className="help-code">npm run tauri build</pre>
          <p className="help-note">
            {isZh ? "产物位于" : "Artifacts are generated in"} <code>src-tauri/target/release/bundle/</code>
            {isZh ? "，应用级数据存储于" : ", and app-level data is stored in"} <code>hub.db</code>
            {isZh ? "。" : "."}
          </p>
        </article>
      </section>

      <section className="help-card">
        <h3>{isZh ? "仓库导入方式" : "Repository Import Options"}</h3>
        <ul>
          <li>{isZh ? "添加仓库：选择包含 " : "Add repository: choose a repository root containing "}<code>.git</code>{isZh ? "。" : "."}</li>
          <li>{isZh ? "扫描目录：从根目录批量发现仓库。" : "Scan directory: discover repositories in bulk from a root folder."}</li>
          <li>{isZh ? "导入 ZIP：解压到仓库根目录并自动扫描（可在设置里修改）。" : "Import ZIP: extract into repository root and auto-scan (configurable in settings)."}</li>
        </ul>
      </section>

      <section className="help-grid">
        <article className="help-card">
          <h3>{isZh ? "克隆模板" : "Clone Templates"}</h3>
          <pre className="help-code">{`git clone https://github.com/用户名/仓库名.git
git clone --mirror https://github.com/用户名/仓库名.git 仓库名.git
git clone --depth 1 https://github.com/用户名/仓库名.git`}</pre>
        </article>
        <article className="help-card">
          <h3>{isZh ? "便携 Git" : "Portable Git"}</h3>
          <p>
            {isZh
              ? "设置 "
              : "Set "}
            <code>PORTABLE_GIT_PATH</code>
            {isZh
              ? "，或将 "
              : " or place "}
            <code>portable-git</code>
            {isZh
              ? " 放在可执行文件同目录。详情见 "
              : " next to the executable. See "}
            <code>bundled-git/README.md</code>
            {isZh ? "。" : "."}
          </p>
          <p className="help-note">
            Windows: <code>portable-git/cmd/git.exe</code>{isZh ? "，" : ", "}macOS/Linux:{" "}
            <code>portable-git/bin/git</code>{isZh ? "。" : "."}
          </p>
        </article>
      </section>
    </div>
  );
}
