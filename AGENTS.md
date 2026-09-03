<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent Coding Guidelines

## Work with Minimal Changes

Do not rewrite unrelated code or scan the entire project unless necessary. Focus purely on the scope of the request.

## Token Saving Rules

- Inspect only the files required for the task.
- Do not output full files in conversational responses unless explicitly requested.
- Use targeted, precise edits instead of rewriting large files.
- Keep responses short, focus only on what changed, and avoid explaining obvious code or repeating the user's request.
- Avoid creating unnecessary abstractions or installing new packages unless absolutely required.

## Code Style

- Write clean, simple, production-ready code.
- Use TypeScript properly with strict types.
- Follow existing folder structures, naming conventions, and reuse existing utilities, hooks, components, and styles.
- Avoid duplicate code.

## Component Rules

- Create small, reusable components with a single responsibility.
- Keep page files focused on layout and data flow, moving business logic into hooks, server actions, or utilities.
- Avoid very large JSX blocks.
- Keep `"use client"` directives as low down the component tree as possible.

## Next.js Rules

- Use Server Components by default.
- Use Client Components only for state, effects, browser APIs, or user interactions.
- Use server actions or API routes for backend logic.
- Always validate input before database operations and never expose secrets to the client.

## UI Rules

- Prioritize existing design system components.
- Keep UI minimal, clean, responsive, and consistent.
- Maintain consistent spacing, typography, and colors; do not redesign unrelated screens.
- Add loading, error, and empty states where necessary.

## Database/Auth Rules

- Do not change schemas unless explicitly asked.
- Reuse the existing database client.
- Always verify the authenticated user before saving private data and associate user-owned data with `userId`.
- Store only necessary user information and do not duplicate user records.

## Workflow

- Before coding: Identify the smallest set of files needed and check existing components/utilities. Always aim for the smallest safe change.
- After coding: Run a type check or relevant tests if available, and summarize only the changed files, and last but not the least keep the response concise.
