use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoRecord {
    pub id: i64,
    pub path: String,
    pub display_name: Option<String>,
    pub project_intro: Option<String>,
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub last_opened_at: Option<i64>,
    pub is_bare: bool,
    pub last_head: Option<String>,
    pub created_at: i64,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS repos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                display_name TEXT,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                tags TEXT NOT NULL DEFAULT '[]',
                last_opened_at INTEGER,
                is_bare INTEGER NOT NULL DEFAULT 0,
                last_head TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_repos_favorite ON repos(is_favorite);
            CREATE INDEX IF NOT EXISTS idx_repos_last_opened ON repos(last_opened_at);
            "#,
        )?;
        if let Err(e) = conn.execute("ALTER TABLE repos ADD COLUMN project_intro TEXT", []) {
            if !e
                .to_string()
                .to_ascii_lowercase()
                .contains("duplicate column name")
            {
                return Err(e);
            }
        }
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn list_all(&self) -> Result<Vec<RepoRecord>, rusqlite::Error> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, path, display_name, project_intro, is_favorite, tags, last_opened_at, is_bare, last_head, created_at FROM repos ORDER BY is_favorite DESC, COALESCE(last_opened_at, 0) DESC, display_name COLLATE NOCASE",
        )?;
        let iter = stmt.query_map([], map_row)?;
        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn search(&self, query: &str) -> Result<Vec<RepoRecord>, rusqlite::Error> {
        let q = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, path, display_name, project_intro, is_favorite, tags, last_opened_at, is_bare, last_head, created_at FROM repos
             WHERE path LIKE ?1 ESCAPE '\\' OR IFNULL(display_name,'') LIKE ?1 ESCAPE '\\' OR IFNULL(project_intro,'') LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\'
             ORDER BY is_favorite DESC, COALESCE(last_opened_at, 0) DESC",
        )?;
        let iter = stmt.query_map(params![q], map_row)?;
        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get(&self, id: i64) -> Result<Option<RepoRecord>, rusqlite::Error> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, path, display_name, project_intro, is_favorite, tags, last_opened_at, is_bare, last_head, created_at FROM repos WHERE id = ?1",
        )?;
        stmt.query_row(params![id], map_row).optional()
    }

    pub fn insert_repo(
        &self,
        path: &str,
        display_name: Option<String>,
        is_bare: bool,
        last_head: Option<String>,
    ) -> Result<RepoRecord, rusqlite::Error> {
        let now = now_unix();
        let tags = "[]".to_string();
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO repos (path, display_name, project_intro, is_favorite, tags, last_opened_at, is_bare, last_head, created_at)
             VALUES (?1, ?2, NULL, 0, ?3, NULL, ?4, ?5, ?6)
             ON CONFLICT(path) DO UPDATE SET
                display_name = COALESCE(excluded.display_name, repos.display_name),
                is_bare = excluded.is_bare,
                last_head = COALESCE(excluded.last_head, repos.last_head)",
            params![
                path,
                display_name,
                tags,
                if is_bare { 1 } else { 0 },
                last_head,
                now
            ],
        )?;
        let mut stmt = conn.prepare(
            "SELECT id, path, display_name, project_intro, is_favorite, tags, last_opened_at, is_bare, last_head, created_at FROM repos WHERE path = ?1",
        )?;
        stmt.query_row(params![path], map_row)
    }

    pub fn delete(&self, id: i64) -> Result<bool, rusqlite::Error> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let n = conn.execute("DELETE FROM repos WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    pub fn set_favorite(&self, id: i64, favorite: bool) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "UPDATE repos SET is_favorite = ?1 WHERE id = ?2",
            params![if favorite { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    pub fn set_tags(&self, id: i64, tags: &[String]) -> Result<(), rusqlite::Error> {
        let json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".into());
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute("UPDATE repos SET tags = ?1 WHERE id = ?2", params![json, id])?;
        Ok(())
    }

    pub fn set_display_name(&self, id: i64, name: Option<String>) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "UPDATE repos SET display_name = ?1 WHERE id = ?2",
            params![name, id],
        )?;
        Ok(())
    }

    pub fn set_project_intro(&self, id: i64, intro: Option<String>) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "UPDATE repos SET project_intro = ?1 WHERE id = ?2",
            params![intro, id],
        )?;
        Ok(())
    }

    pub fn touch_opened(&self, id: i64) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "UPDATE repos SET last_opened_at = ?1 WHERE id = ?2",
            params![now_unix(), id],
        )?;
        Ok(())
    }

    pub fn update_cached_head(&self, id: i64, head: Option<&str>) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "UPDATE repos SET last_head = ?1 WHERE id = ?2",
            params![head, id],
        )?;
        Ok(())
    }

}

fn now_unix() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn map_row(row: &rusqlite::Row<'_>) -> Result<RepoRecord, rusqlite::Error> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(RepoRecord {
        id: row.get(0)?,
        path: row.get(1)?,
        display_name: row.get(2)?,
        project_intro: row.get(3)?,
        is_favorite: row.get::<_, i64>(4)? != 0,
        tags,
        last_opened_at: row.get(6)?,
        is_bare: row.get::<_, i64>(7)? != 0,
        last_head: row.get(8)?,
        created_at: row.get(9)?,
    })
}
