# UI refactor — Phase 2

This is a behavior-preserving component extraction, based on main commit `82c1863`.

## Daily Plan

- `daily-plan-view.tsx`: owns selected day, bulk assignments, search state, and the guided tour lifecycle.
- `daily-plan-hero.tsx`: owns visual progress/target presentation. Its callbacks are supplied by the view.
- `daily-plan-word-card.tsx`: renders one assigned word with accessible edit, removal, deletion, and move controls; all actions remain external.
- `daily-plan-add-existing-word.tsx`: existing-word selector; assignment policy stays in the parent.

## Atlas AI

- `ai-chat-widget.tsx`: retains requests, cancellation, retries, errors, authentication, and chat history lifecycle.
- `chat-welcome.tsx`: suggestions shown when there is no active conversation.
- `chat-message-list.tsx`: user bubbles and safe assistant markdown.
- `chat-composer.tsx`: controlled text input and submit action.
- `chat-launcher.tsx`: floating open-chat button.
- `chat-error-notice.tsx`: request failure and manual retry UI; transport remains in the widget.
- `chat-sign-in-notice.tsx`: authentication prompt UI.

## Scope and invariants

No changes to backend, Supabase, Gemini, persisted learning data, styles, responsive breakpoints, translated labels, tour anchors, or element IDs. Test existing browser flows on desktop and mobile before merging.
