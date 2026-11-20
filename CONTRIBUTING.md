# Contributing to Fathom

Thanks for helping. This guide covers running Fathom locally and sending a change.

## Where changes go

Fathom is published in the [Raycast Store](https://www.raycast.com/chrismessina/fathom).
Open pull requests against [`raycast/extensions`](https://github.com/raycast/extensions/tree/main/extensions/fathom),
not this repository: Raycast reviews every change there, and merged changes sync back here
automatically. Open [issues](https://github.com/chrismessina/raycast-fathom/issues) here or in
`raycast/extensions`, whichever you prefer.

## Run it locally

You need [Raycast](https://www.raycast.com/) and Node.js 22 or later.

1. In Raycast, find Fathom in the Store and choose **Fork Extension** from the action panel.
   Raycast checks out only this extension's folder from `raycast/extensions`.
2. In that folder, run `npm ci`, then `npm run dev`. Raycast opens the development version, and
   saving a file reloads it.

You need a Fathom API key, made under **API Access** in [Fathom Settings](https://fathom.video/customize)
and pasted into the extension's preferences.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Copy the download runner, then run the extension in Raycast and reload on save |
| `npm run build` | Copy the download runner, then build the distribution bundle |
| `npm run lint` | Run Raycast's ESLint and Prettier checks |
| `npm run fix-lint` | Fix what the linter can fix |
| `npm run copy-runner` | Copy the runner bundle from `@chrismessina/raycast-downloader` into `assets/raycast-downloader-runner.js` |
| `npm run verify-runner` | Fail if `assets/raycast-downloader-runner.js` does not match the installed package |

## How it works

- `src/fathom/api.ts` calls the Fathom API (`https://api.fathom.ai/external/v1`) with the key from
  `src/fathom/auth.ts`; `src/utils/requestQueue.ts` limits concurrency, dedupes requests and
  retries with backoff.
- `src/utils/cacheManager.ts` is one cache shared by every view. Transcripts are stored on disk by
  `src/utils/transcriptStore.ts` rather than in LocalStorage, whose writes can silently fail to
  persist past its size ceiling; the file's header has the measurements.
- Recording downloads (`src/fathom/downloads.ts`, `src/utils/downloadRecording.ts`) ask Fathom to
  prepare the media, then hand the transfer to the runner in `assets/raycast-downloader-runner.js`,
  a background process that keeps going after Raycast closes the command. `src/utils/downloadJobs.ts`
  remembers a job between the request and the first byte so reopening the command can resume it.
- The commands are `src/search-meetings.tsx` and `src/search-team-members.tsx`; the AI tools are in
  `src/tools/`.

## Before you open a pull request

- `npm run build`, `npx tsc --noEmit`, `npm run lint` and `npm run verify-runner` all pass.
- You tried the change in Raycast, including its error and empty states.
- `CHANGELOG.md` has a new entry at the top, dated `{PR_MERGE_DATE}`. Raycast fills in the date
  when the pull request merges.
- New or changed screenshots go in `metadata/`, taken with Raycast's Window Capture.
