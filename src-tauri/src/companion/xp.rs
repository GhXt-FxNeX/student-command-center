use super::persistence::{self};
use rusqlite::Connection;

pub struct XpResult {
    pub xp_delta: i64,
    pub happiness_delta: i64,
    pub on_cooldown: bool,
}

/// Look up the deterministic XP/happiness reward for an event, applying its
/// cooldown if one is configured (e.g. StudySessionCompleted only rewards
/// once per 5 minutes, so rapid-fire short sessions can't be farmed).
/// Unknown event types (no row in `xp_rules`) reward nothing rather than
/// erroring — a missing rule should never crash the app.
pub fn evaluate_event(conn: &Connection, event_type: &str) -> Result<XpResult, String> {
    let Some(rule) = persistence::get_xp_rule(conn, event_type)? else {
        return Ok(XpResult {
            xp_delta: 0,
            happiness_delta: 0,
            on_cooldown: false,
        });
    };

    if let Some(cooldown) = rule.cooldown_seconds {
        if let Some(elapsed) = persistence::seconds_since_last_event(conn, event_type)? {
            if elapsed < cooldown {
                return Ok(XpResult {
                    xp_delta: 0,
                    happiness_delta: 0,
                    on_cooldown: true,
                });
            }
        }
    }

    Ok(XpResult {
        xp_delta: rule.xp_amount,
        happiness_delta: rule.happiness_delta,
        on_cooldown: false,
    })
}

/// Recompute level from cumulative XP against `level_thresholds`. Simple
/// linear scan is fine at ~40 rows; not worth a binary search.
pub fn level_for_xp(conn: &Connection, xp: i64) -> Result<i64, String> {
    let mut level = 1;
    loop {
        match persistence::xp_required_for_level(conn, level + 1)? {
            Some(required) if xp >= required => level += 1,
            _ => break,
        }
    }
    Ok(level)
}

pub fn xp_for_next_level(conn: &Connection, current_level: i64) -> Result<Option<i64>, String> {
    persistence::xp_required_for_level(conn, current_level + 1)
}
