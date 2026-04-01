# Third-Party Licenses

This project depends on third-party packages from npm and crates.io.

License data below is a practical release manifest for `v1.0.0` preparation.  
Please re-verify before each formal release (especially after dependency upgrades).

## JavaScript / TypeScript dependencies

| Package | Version | License | Source |
|---|---:|---|---|
| `@tauri-apps/api` | 2.10.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| `@tauri-apps/cli` | 2.10.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| `@tauri-apps/plugin-dialog` | 2.6.0 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace |
| `@tauri-apps/plugin-opener` | 2.5.3 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace |
| `@types/react` | 19.2.14 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/react-dom` | 19.2.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@vitejs/plugin-react` | 4.7.0 | MIT | https://github.com/vitejs/vite-plugin-react |
| `react` | 19.2.4 | MIT | https://react.dev |
| `react-dom` | 19.2.4 | MIT | https://react.dev |
| `react-markdown` | 10.1.0 | MIT | https://github.com/remarkjs/react-markdown |
| `rehype-raw` | 7.0.0 | MIT | https://github.com/rehypejs/rehype-raw |
| `rehype-sanitize` | 6.0.0 | MIT | https://github.com/rehypejs/rehype-sanitize |
| `remark-gfm` | 4.0.1 | MIT | https://github.com/remarkjs/remark-gfm |
| `typescript` | 5.8.3 | Apache-2.0 | https://www.typescriptlang.org |
| `vite` | 7.3.1 | MIT | https://vite.dev |

## Rust dependencies (direct)

| Crate | Requirement | Typical license | Source |
|---|---:|---|---|
| `tauri` | ^2 | MIT OR Apache-2.0 | https://github.com/tauri-apps/tauri |
| `tauri-build` | ^2 | MIT OR Apache-2.0 | https://github.com/tauri-apps/tauri |
| `tauri-plugin-dialog` | ^2 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace |
| `tauri-plugin-opener` | ^2 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace |
| `serde` | ^1 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| `serde_json` | ^1 | MIT OR Apache-2.0 | https://github.com/serde-rs/json |
| `rusqlite` | ^0.32 | MIT | https://github.com/rusqlite/rusqlite |
| `walkdir` | ^2 | MIT OR Unlicense | https://github.com/BurntSushi/walkdir |
| `zip` | ^2 | MIT | https://github.com/zip-rs/zip2 |
| `thiserror` | ^2 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror |
| `directories` | ^5 | MIT OR Apache-2.0 | https://github.com/dirs-dev/directories-rs |
| `base64` | ^0.22 | MIT OR Apache-2.0 | https://github.com/marshallpierce/rust-base64 |
| `uuid` | ^1 | MIT OR Apache-2.0 | https://github.com/uuid-rs/uuid |

## Notes

- This list covers direct dependencies in `package.json` and `src-tauri/Cargo.toml`.
- Transitive dependencies are governed by their own licenses; they are brought in via upstream package managers.
- If you distribute binaries, keep this file and the root `LICENSE` together with release artifacts.
