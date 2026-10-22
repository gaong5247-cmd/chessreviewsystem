use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use url::Url;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteGame {
    id: String,
    title: String,
    url: String,
    pgn: String,
}

fn valid_name(input: &str) -> Result<&str, String> {
    let trimmed = input.trim();
    if trimmed.len() < 2 || trimmed.len() > 32 || !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Enter a valid public username (letters, digits, underscore, dash)".into());
    }
    Ok(trimmed)
}
fn tag(pgn: &str, name: &str) -> String {
    let prefix = format!("[{name} \"");
    pgn.lines().find_map(|line| line.strip_prefix(&prefix).and_then(|rest| rest.split('"').next())).unwrap_or("?").to_string()
}
fn label(pgn: &str) -> String {
    format!("{} vs {} • {}", tag(pgn, "White"), tag(pgn, "Black"), tag(pgn, "Result"))
}
fn split_pgn(data: &str) -> Vec<String> {
    let normalized = data.replace("\r\n", "\n");
    let indices: Vec<usize> = normalized.match_indices("[Event \"")
        .map(|(at, _)| at)
        .filter(|at| *at == 0 || normalized.as_bytes().get(at - 1) == Some(&b'\n'))
        .collect();
    indices.iter().enumerate().filter_map(|(i, &start)| {
        let end = *indices.get(i + 1).unwrap_or(&normalized.len());
        let block = normalized[start..end].trim();
        if block.is_empty() { None } else { Some(block.to_string()) }
    }).collect()
}

#[tauri::command]
pub async fn import_remote(provider: String, query: String) -> Result<Vec<RemoteGame>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(22))
        .user_agent("ChessReviewSystem/0.1 (open-source desktop app)")
        .build().map_err(|e| e.to_string())?;
    match provider.as_str() {
        "lichess-link" => {
            let link = Url::parse(query.trim()).map_err(|_| "Paste a full https://lichess.org/GAME_ID URL")?;
            if link.scheme() != "https" || !matches!(link.host_str(), Some("lichess.org") | Some("www.lichess.org")) {
                return Err("Only public lichess.org URLs are supported".into());
            }
            let id = link.path_segments().and_then(|mut p| p.next()).unwrap_or("");
            if !(8..=12).contains(&id.len()) || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Err("No valid Lichess game ID was found in that URL".into());
            }
            let url = format!("https://lichess.org/game/export/{id}");
            let res = client.get(&url).header("Accept", "application/x-chess-pgn").send().await.map_err(|e| e.to_string())?;
            if !res.status().is_success() { return Err(format!("Lichess returned HTTP {}", res.status())); }
            let pgn = res.text().await.map_err(|e| e.to_string())?;
            Ok(vec![RemoteGame {id: id.to_string(), title: label(&pgn), url: format!("https://lichess.org/{id}"), pgn}])
        }
        "lichess-user" => {
            let name = valid_name(&query)?;
            let url = format!("https://lichess.org/api/games/user/{name}?max=20&opening=true&clocks=false");
            let res = client.get(&url).header("Accept", "application/x-chess-pgn").send().await.map_err(|e| e.to_string())?;
            if !res.status().is_success() { return Err(format!("Lichess returned HTTP {}", res.status())); }
            let data = res.text().await.map_err(|e| e.to_string())?;
            Ok(split_pgn(&data).into_iter().enumerate().map(|(i,pgn)| {
                let site = tag(&pgn, "Site");
                RemoteGame {id: i.to_string(), title: label(&pgn), url: site, pgn}
            }).collect())
        }
        "chesscom-user" => {
            let name = valid_name(&query)?;
            let archive_url = format!("https://api.chess.com/pub/player/{name}/games/archives");
            let res = client.get(&archive_url).send().await.map_err(|e| e.to_string())?;
            if !res.status().is_success() { return Err(format!("Chess.com archive returned HTTP {}", res.status())); }
            let json: Value = res.json().await.map_err(|e| e.to_string())?;
            let months = json["archives"].as_array().ok_or("No public Chess.com archive found")?;
            let mut games = Vec::new();
            for month in months.iter().rev().take(3) {
                if games.len() >= 25 { break; }
                let Some(address) = month.as_str() else { continue; };
                if !address.starts_with("https://api.chess.com/pub/player/") { continue; }
                let response = client.get(address).send().await.map_err(|e| e.to_string())?;
                if !response.status().is_success() { continue; }
                let data: Value = response.json().await.map_err(|e| e.to_string())?;
                if let Some(entries) = data["games"].as_array() {
                    for entry in entries.iter().rev() {
                        if let Some(pgn) = entry["pgn"].as_str() {
                            games.push(RemoteGame {
                                id: entry["uuid"].as_str().unwrap_or("game").to_string(),
                                title: label(pgn),
                                url: entry["url"].as_str().unwrap_or("").to_string(),
                                pgn: pgn.to_string(),
                            });
                            if games.len() >= 25 { break; }
                        }
                    }
                }
            }
            Ok(games)
        }
        _ => Err("Choose Chess.com player, Lichess player or Lichess game link".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pgn_split_keeps_multiple_games() {
        let s = "[Event \"A\"]\n[White \"W\"]\n\n1. e4 *\n\n[Event \"B\"]\n[White \"X\"]\n\n1. d4 *";
        assert_eq!(split_pgn(s).len(), 2);
        assert_eq!(tag(s, "White"), "W");
    }
    #[test]
    fn usernames_are_restricted() {
        assert!(valid_name("user-name_12").is_ok());
        assert!(valid_name("example.com/path").is_err());
    }
}
