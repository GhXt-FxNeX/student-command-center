use super::persistence;
use rusqlite::Connection;

const CELEBRATING_WINDOW_SECS: i64 = 10 * 60;
const EXCITED_WINDOW_SECS: i64 = 30 * 60;
const PROUD_WINDOW_SECS: i64 = 60 * 60;
const WORRIED_WINDOW_SECS: i64 = 24 * 60 * 60;
const SLEEPY_IDLE_SECS: i64 = 6 * 60 * 60;

/// Priority-ordered deterministic mood computation (architecture.md A4).
/// First matching rule wins. Every input is either the happiness score or
/// counts of recent events already logged in `companion_event_log` — no AI
/// call, nothing here is a free choice.
///
/// Returns (mood, celebration_trigger). `mood` stays "celebrating" for both
/// a recent level-up and a recent evolution — no schema change needed for
/// that, it's the same value as before. `celebration_trigger` is the new,
/// separate piece of information (migration 0020) that tells the frontend
/// which *specific* one-shot clip to play instead of the generic
/// "celebration" fallback. Evolution wins when both happened in the same
/// window (leveling up is what triggers evolution in the first place, so
/// they're often simultaneous — evolution is the rarer, bigger deal).
pub fn compute_mood(conn: &Connection, happiness: i64) -> Result<(&'static str, Option<&'static str>), String> {
    let evolution_recent =
        persistence::recent_event_count(conn, &["EvolutionUnlocked"], CELEBRATING_WINDOW_SECS)? > 0;
    if evolution_recent {
        return Ok(("celebrating", Some("evolution")));
    }
    let level_up_recent =
        persistence::recent_event_count(conn, &["LevelUp"], CELEBRATING_WINDOW_SECS)? > 0;
    if level_up_recent {
        return Ok(("celebrating", Some("level_up")));
    }

    let excited = persistence::recent_event_count(
        conn,
        &["HighExamScore", "PerfectExamScore", "MajorTaskCompleted"],
        EXCITED_WINDOW_SECS,
    )? > 0;
    if excited {
        return Ok(("excited", None));
    }

    let proud = persistence::recent_event_count(
        conn,
        &["WeeklyGoalCompleted", "StudyStreakReached"],
        PROUD_WINDOW_SECS,
    )? > 0;
    if proud {
        return Ok(("proud", None));
    }

    let negative_recent = persistence::recent_event_count(
        conn,
        &["GoalMissed", "StreakBroken"],
        WORRIED_WINDOW_SECS,
    )? > 0;

    if happiness >= 70 && !negative_recent {
        return Ok(("happy", None));
    }

    // Idle/sleepy check in v1 uses the most recent TaskCompleted event as a
    // simple proxy for "the user has been doing something in the app" —
    // refined in a later phase once more event sources exist.
    let idle_secs = persistence::seconds_since_last_event(conn, "TaskCompleted")?;
    if let Some(idle) = idle_secs {
        if idle >= SLEEPY_IDLE_SECS {
            return Ok(("sleepy", None));
        }
    }

    if negative_recent && happiness < 50 {
        return Ok(("worried", None));
    }

    if happiness <= 30 {
        return Ok(("sad", None));
    }

    Ok(("neutral", None))
}
