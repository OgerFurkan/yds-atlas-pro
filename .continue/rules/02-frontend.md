---
name: Atlas Pro - Frontend Standards
alwaysApply: false
globs: ["frontend/**/*.ts", "frontend/**/*.tsx", "frontend/**/*.css"]
description: Apply to React TypeScript and frontend changes.
---

- Use React, TypeScript and the patterns already present in frontend/. Respect existing aliases, component folders, styling approach and state ownership.
- Keep UI states explicit: idle, loading, success, empty, error; prevent duplicate submits and stuck transitions.
- Ensure keyboard navigation, descriptive labels, visible focus, sensible disabled states and reduced-motion support where animations are added.
- Mobile-first: verify narrow widths, long English words, Turkish text expansion, overflow and touch targets.
- Do not remove card flip animation, shortcut handling or existing navigation when adjusting appearance unless requested.
- Avoid replacing tested business logic merely to restyle a component. Prefer reusable components and minimal state.
