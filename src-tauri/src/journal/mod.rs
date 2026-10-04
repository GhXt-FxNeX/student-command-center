//! Secret Private Video Journal (Phase 14 Item 8, future_enhancement.md
//! §8). Deliberately isolated from the rest of the app: nothing outside
//! commands/journal.rs imports from this module, and this module imports
//! nothing from ai:: — no journal content (video, title, note) is ever
//! passed to ai::router or any AiProvider, matching §8's "Local-first
//! privacy" section, which explicitly rules out Gemini, OpenRouter,
//! Ollama, NotebookLM, and RAG for journal content without opt-in.

pub mod crypto;
pub mod session;
pub mod storage;
