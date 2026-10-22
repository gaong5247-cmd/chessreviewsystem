use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct ReviewControl {
    running: AtomicBool,
    cancelled: AtomicBool,
    input: Mutex<Option<ChildStdin>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSettings {
    pub time_ms: u64,
    pub depth: u8,
    pub nodes: u64,
    pub threads: u8,
    pub hash_mb: u32,
    pub multi_pv: u8,
    pub engine_path: Option<String>,
}

impl EngineSettings {
    fn validate(&self) -> Result<(), String> {
        if !(1..=1_000_000).contains(&self.time_ms) {
            return Err("Time must be between 1 and 1,000,000 ms".into());
        }
        if !(1..=50).contains(&self.depth) {
            return Err("Depth must be between 1 and 50".into());
        }
        if !(1..=1_000_000_000_000).contains(&self.nodes) {
            return Err("Node limit must be between 1 and 1,000,000,000,000".into());
        }
        if !(1..=128).contains(&self.threads) || !(16..=65_536).contains(&self.hash_mb) {
            return Err("Threads must be 1–128 and hash must be 16–65,536 MB".into());
        }
        if !(2..=5).contains(&self.multi_pv) {
            return Err("MultiPV must be 2–5 to detect unique moves".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalLine {
    pub rank: usize,
    pub depth: u8,
    pub nodes: u64,
    pub cp: Option<i32>,
    pub mate: Option<i32>,
    pub pv: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionAnalysis {
    pub index: usize,
    pub fen: String,
    pub lines: Vec<EvalLine>,
    pub best_move: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    index: usize,
    total: usize,
    position: PositionAnalysis,
}

struct RunningGuard(Arc<ReviewControl>);
impl Drop for RunningGuard {
    fn drop(&mut self) {
        if let Ok(mut stdin) = self.0.input.lock() { *stdin = None; }
        self.0.running.store(false, Ordering::SeqCst);
    }
}

struct EngineSession {
    child: Child,
    reader: BufReader<ChildStdout>,
    control: Arc<ReviewControl>,
}
impl Drop for EngineSession {
    fn drop(&mut self) {
        if let Ok(mut lock) = self.control.input.lock() {
            if let Some(input) = lock.as_mut() {
                let _ = input.write_all(b"quit\n");
                let _ = input.flush();
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl EngineSession {
    fn send(&self, message: &str) -> Result<(), String> {
        let mut lock = self.control.input.lock().map_err(|_| "Engine input lock failed")?;
        let input = lock.as_mut().ok_or("Engine process is not available")?;
        input.write_all(message.as_bytes()).map_err(|e| e.to_string())?;
        input.write_all(b"\n").map_err(|e| e.to_string())?;
        input.flush().map_err(|e| e.to_string())
    }
    fn read(&mut self) -> Result<String, String> {
        let mut line = String::new();
        let size = self.reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if size == 0 { return Err("Stockfish exited unexpectedly. Verify the engine executable and NNUE weights.".into()); }
        Ok(line)
    }
    fn wait_for(&mut self, marker: &str) -> Result<(), String> {
        loop {
            if self.read()?.starts_with(marker) { return Ok(()); }
        }
    }
}

fn resolve_engine(settings: &EngineSettings) -> Result<PathBuf, String> {
    if let Some(custom) = settings.engine_path.as_deref() {
        if !custom.trim().is_empty() {
            let path = PathBuf::from(custom.trim());
            if !path.is_file() { return Err("Custom engine path does not exist".into()); }
            return Ok(path);
        }
    }
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let name = format!("stockfish{suffix}");
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if let Some(folder) = exe.parent() {
        let candidates = [
            folder.join(&name),
            folder.join("binaries").join(&name),
            folder.join("../Resources").join(&name),
            folder.join("../resources").join(&name),
            folder.join("../lib").join(&name),
        ];
        for candidate in candidates {
            if candidate.is_file() { return Ok(candidate); }
        }
    }
    Ok(PathBuf::from(&name))
}

fn open_engine(control: Arc<ReviewControl>, settings: &EngineSettings) -> Result<EngineSession, String> {
    let path = resolve_engine(settings)?;
    let mut child = Command::new(&path)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Cannot start Stockfish ({}): {}. Install a release build or choose a UCI engine path in Settings.", path.display(), e))?;
    let stdout = child.stdout.take().ok_or("Could not read Stockfish output")?;
    let stdin = child.stdin.take().ok_or("Could not write to Stockfish")?;
    *control.input.lock().map_err(|_| "Engine input lock failed")? = Some(stdin);
    let mut session = EngineSession { child, reader: BufReader::new(stdout), control };
    session.send("uci")?;
    session.wait_for("uciok")?;
    session.send(&format!("setoption name Threads value {}", settings.threads))?;
    session.send(&format!("setoption name Hash value {}", settings.hash_mb))?;
    session.send(&format!("setoption name MultiPV value {}", settings.multi_pv))?;
    session.send("isready")?;
    session.wait_for("readyok")?;
    session.send("ucinewgame")?;
    Ok(session)
}

fn token_number<T: std::str::FromStr>(tokens: &[&str], name: &str) -> Option<T> {
    tokens.iter().position(|&s| s == name).and_then(|at| tokens.get(at + 1)).and_then(|s| s.parse::<T>().ok())
}

fn parse_info(source: &str, black_to_move: bool) -> Option<EvalLine> {
    if !source.starts_with("info ") || !source.contains(" pv ") { return None; }
    if source.contains(" lowerbound") || source.contains(" upperbound") { return None; }
    let tokens: Vec<&str> = source.split_whitespace().collect();
    let pv_index = tokens.iter().position(|&t| t == "pv")?;
    let pv: Vec<String> = tokens[pv_index + 1..].iter().map(|s| s.to_string()).collect();
    if pv.is_empty() { return None; }
    let cp: Option<i32> = token_number(&tokens, "cp");
    let mate: Option<i32> = token_number(&tokens, "mate");
    if cp.is_none() && mate.is_none() { return None; }
    let sign = if black_to_move { -1 } else { 1 };
    Some(EvalLine {
        rank: token_number(&tokens, "multipv").unwrap_or(1),
        depth: token_number(&tokens, "depth").unwrap_or(0),
        nodes: token_number(&tokens, "nodes").unwrap_or(0),
        cp: cp.map(|v| v * sign),
        mate: mate.map(|v| v * sign),
        pv,
    })
}

fn analyze_one(session: &mut EngineSession, index: usize, fen: &str, settings: &EngineSettings) -> Result<PositionAnalysis, String> {
    session.send(&format!("position fen {fen}"))?;
    session.send(&format!("go depth {} nodes {} movetime {}", settings.depth, settings.nodes, settings.time_ms))?;
    let black_to_move = fen.split_whitespace().nth(1) == Some("b");
    let mut lines: BTreeMap<usize, EvalLine> = BTreeMap::new();
    let mut best_move: Option<String> = None;
    loop {
        let message = session.read()?;
        if message.starts_with("bestmove ") {
            best_move = message.split_whitespace().nth(1).filter(|v| *v != "(none)" && *v != "0000").map(str::to_string);
            break;
        }
        if let Some(parsed) = parse_info(&message, black_to_move) {
            let replace = lines.get(&parsed.rank).map_or(true, |old| parsed.depth >= old.depth);
            if replace { lines.insert(parsed.rank, parsed); }
        }
    }
    Ok(PositionAnalysis {index, fen: fen.to_string(), lines: lines.into_values().collect(), best_move})
}

fn run_review(app: AppHandle, control: Arc<ReviewControl>, positions: Vec<String>, settings: EngineSettings) -> Result<Vec<PositionAnalysis>, String> {
    let _guard = RunningGuard(control.clone());
    let mut session = open_engine(control.clone(), &settings)?;
    let mut results = Vec::with_capacity(positions.len());
    for (index, fen) in positions.iter().enumerate() {
        if control.cancelled.load(Ordering::SeqCst) { return Err("Review cancelled".into()); }
        let position = analyze_one(&mut session, index, fen, &settings)?;
        let _ = app.emit("review:progress", Progress { index, total: positions.len(), position: position.clone() });
        results.push(position);
    }
    Ok(results)
}

#[tauri::command]
pub async fn analyze_game(app: AppHandle, state: State<'_, Arc<ReviewControl>>, positions: Vec<String>, settings: EngineSettings) -> Result<Vec<PositionAnalysis>, String> {
    settings.validate()?;
    if positions.len() < 2 || positions.len() > 1001 || positions.iter().any(|p| p.split_whitespace().count() != 6 || p.len() > 110) {
        return Err("Supply 2–1001 valid standard chess FEN positions".into());
    }
    let control = state.inner().clone();
    if control.running.swap(true, Ordering::SeqCst) { return Err("Another analysis is running. Cancel it first.".into()); }
    control.cancelled.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || run_review(app, control, positions, settings))
        .await.map_err(|e| format!("Analysis worker failed: {e}"))?
}

#[tauri::command]
pub fn cancel_review(state: State<'_, Arc<ReviewControl>>) -> Result<(), String> {
    state.cancelled.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = state.input.lock() {
        if let Some(input) = guard.as_mut() {
            let _ = input.write_all(b"stop\n");
            let _ = input.flush();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn info_is_normalized_to_white() {
        let text = "info depth 17 multipv 1 score cp 43 nodes 999 pv e7e5 g1f3";
        let line = parse_info(text, true).unwrap();
        assert_eq!(line.cp, Some(-43));
        assert_eq!(line.pv[0], "e7e5");
        assert!(parse_info("info depth 1 nodes 2", false).is_none());
    }
    #[test]
    fn limits_reject_bad_values() {
        let mut s = EngineSettings {time_ms: 1, depth: 50, nodes: 1, threads: 1, hash_mb: 16, multi_pv: 2, engine_path: None};
        assert!(s.validate().is_ok());
        s.time_ms = 1_000_001;
        assert!(s.validate().is_err());
    }
}
