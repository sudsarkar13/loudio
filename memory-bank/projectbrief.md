# Project Brief — Loudio

## Project
Loudio is a macOS-first desktop transcription application built with Tauri + Next.js for offline/local audio transcription workflows.

## Core Objectives
- Provide reliable **file + microphone** transcription from a desktop UI.
- Keep runtime setup resilient (ffmpeg / whisper runtime checks and bootstrap).
- Preserve user productivity with practical controls (copy, clear, auto-copy, timestamps, recording shortcuts).
- Deliver a polished native desktop experience, including menu integration and packaging metadata/icons.

## Current Product Scope
- Audio file transcription.
- Microphone recording and transcription.
- Runtime bootstrap and status messaging.
- Settings persistence.
- Desktop menu actions for File/Edit/View/Window/Help.
- Native About menu entry with app metadata.

## Constraints & Standards
- Next.js App Router structure (no `src/` folder).
- Tauri v2 APIs.
- TypeScript + Rust compile health required before completion.
- Desktop-first quality and predictable UX for release builds.

## Success Criteria
- Mic transcription conversion/transcription path works in release-like usage.
- Menu actions are functional and aligned with user expectation.
- About flow behaves as native OS window behavior (not an in-app custom modal) while showing app identity details.
