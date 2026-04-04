# Project Brief — Loudio

## Project
Loudio is a macOS-first desktop transcription application built with Tauri + Next.js for offline/local audio transcription workflows.

## Core Objectives
- Provide reliable **file + microphone** transcription from a desktop UI.
- Preserve user productivity with editable transcript output, append behavior across sessions, and low-friction copy workflows.
- Keep runtime setup resilient (ffmpeg / whisper runtime checks and bootstrap).
- Deliver a polished native desktop experience, including menu integration, compact mode controls, and packaging metadata/icons.

## Current Product Scope
- Audio file transcription.
- Microphone recording and transcription (auto-transcribe on stop).
- Editable transcript area with manual correction support.
- Incremental transcript accumulation (new finalized segments append below prior content).
- Live partial preview while transcription is in progress.
- Auto-copy behavior on finalized merged transcript.
- Runtime bootstrap and status messaging.
- Settings persistence.
- Desktop menu actions for File/Edit/View/Window/Help.
- Native About menu entry with app metadata.
- Compact mode toggle in UI and Window menu.

## Constraints & Standards
- Next.js App Router structure (no `src/` folder for app code).
- Tauri v2 APIs and capabilities permissions model.
- TypeScript + Rust compile health required before completion.
- Desktop-first quality and predictable UX for release builds.

## Success Criteria
- Mic and file transcription flows are stable in release-like usage.
- Transcript corrections persist while subsequent transcription chunks append correctly.
- Auto-copy copies the complete merged transcript when enabled.
- Compact mode can be minimized reliably from keyboard/menu.
- Menu actions are functional and aligned with user expectation.
- About flow behaves as native OS window behavior while showing app identity details.
