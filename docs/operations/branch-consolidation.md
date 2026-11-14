# Branch consolidation plan (verified, not executed)

> **Historical record.** Written before PR #1 merged `ai-video-shorts` into `main`. Branch names, commit ids and counts describe that moment. For the current state see [final-codebase-audit.md](../architecture/final-codebase-audit.md).

This plan was produced by inspecting the remote state for real. **No branch was merged,
rebased, reset or force-pushed.** `ai-video-shorts` and `main` are exactly as they were found.

## 1. What was actually reported, and what is true

The task described a discrepancy: "fetched main `ed7b18c`, remote main `9c54e75`, application branch
`9903edd`". After `git fetch --all --prune`, the verified state is:

| Ref | Commit | Subject |
| --- | --- | --- |
| `origin/main` | `9c54e75d06c597223c532075fbbe49709b679fdc` | Update Upwork profile URL in README. |
| `origin/main` (parent) | `ed7b18c4cb8f1ac6b3ae10f9f51100a028a76935` | docs: industry-focused wording |
| `origin/ai-video-shorts` | `77a647f6b3af7ffec6179d862326c25d0858b768` | Remove legacy workflows and refactor server into domain-specific routers |
| local `ai-video-shorts` | `77a647f` | in sync with its remote |
| merge base of the two | `ed7b18c` | — |

So:

- The "newer remote commit" is **one commit**: `9c54e75`, and it changes **one line in the old root
  `README.md`** (an Upwork profile URL). Its parent is the merge base, so nothing else on `main`
  is missing from the application branch; the earlier `ed7b18c` fetch was simply stale by one
  commit.
- The application branch reported as `9903edd` is two commits behind its own remote: `9903edd` is
  the "format tags" commit, and the pushed branch has since received `77a647f` (the router split).
  The branch content to consolidate is therefore `77a647f`, **47 commits ahead** of `main`.

Verified command output:

```
$ git rev-list --count origin/main..origin/ai-video-shorts   → 47
$ git rev-list --count origin/ai-video-shorts..origin/main   → 1
$ git diff --name-status ed7b18c origin/main                 → M README.md
```

## 2. Does the newer remote commit contain changes that must be preserved?

Only the Upwork URL. But whether it should be preserved is a product decision, because the
application branch replaced the root README entirely with the Visual CS Lab README, which today has
**no portfolio/contact section at all** (the only external link is the repository clone URL). The
old README that `9c54e75` edits no longer exists on the application branch.

| Change on `main` not in the app branch | Where it lives | Preserve? |
| --- | --- | --- |
| `README.md`: Upwork URL `…/freelancers/awaisai` → `…/freelancers/~01838e4fc5162aaf52` | The pre-Visual-CS-Lab portfolio README (rewritten on the app branch) | **Yes, if the portfolio link should still be discoverable.** Re-add it to the new README's contact section rather than resurrecting the old file. |
| Everything else | — | Nothing else is unique to `main`. |

The application branch is otherwise a superset: it removes the legacy `workflows/` tree and the old
`docs/tools-stack.md`, `docs/upwork-portfolio-notes.md`, `docs/automation-process.md`,
`docs/client-use-cases.md`, rewrites `CONTRIBUTING.md` and `.gitignore`, and adds `visual-cs-lab/`
plus `docs/architecture`, `docs/development`, `docs/product` and `docs/operations`. None of those
deletions conflict with anything `main` changed.

## 3. Recommended consolidation (when the owner is ready)

**Strategy: merge `ai-video-shorts` into `main` with a merge commit, through a pull request. No
rewrite, no force-push.**

Rejected alternatives:

- *Force-push `ai-video-shorts` over `main`* — loses `9c54e75` and rewrites shared history.
- *Squash/rebase 47 commits* — discards the per-change rationale that makes the reliability work
  reviewable, and requires a force-push.
- *Merge `main` into `ai-video-shorts` first* — acceptable, but produces the same README conflict
  for no benefit; do the preservation step once, on the application branch.

### Steps

1. **Preserve the only `main`-unique change** on `ai-video-shorts` as its own commit: add a short
   "Contact / portfolio" section to `visual-cs-lab/README.md` (or the root README) containing the
   URL from `9c54e75`. This makes the merge's intent explicit instead of resolved silently.
2. **Confirm the merge result locally without touching either remote branch:**
   ```bash
   git switch -c verify/consolidate ai-video-shorts
   git merge origin/main            # expect a README.md conflict — the app branch rewrote it
   # resolve: keep the Visual CS Lab README version (the URL is already added in step 1)
   npm test && npm run typecheck && npm run build
   git merge --abort                # leave the working branches untouched after the check
   ```
3. **Open the pull request** `ai-video-shorts → main` (head `ai-video-shorts`, base `main`). Expect
   GitHub to report the README conflict; resolve it in the PR branch by keeping the new README.
4. **Merge with a regular merge commit** (not squash), so `9c54e75` stays an ancestor.
5. **Verify after merge:**
   ```bash
   git fetch origin
   git merge-base --is-ancestor 9c54e75 origin/main && echo "main's commit preserved"
   git merge-base --is-ancestor 77a647f origin/main && echo "app branch fully merged"
   git diff --stat origin/production-merge-base..origin/main   # review what reached main
   ```
   Then run `npm test`, `npm run typecheck`, `npm run build` against `main` in this sandbox before
   deploying anything from it.
6. **Tag and clean up:** tag the merge (`v0.1.0` or the project's convention), then delete
   `ai-video-shorts` only after the tag exists and the preview is promoted from `main`.

### Expected outcome

- `main` becomes the Visual CS Lab repository with the full 47-commit history and the portfolio
  link restored.
- `9c54e75` remains an ancestor; no commit is dropped and no remote branch is rewritten.
- The merge is expected to conflict **only** in `README.md`. `.gitignore` and `CONTRIBUTING.md`
  differ from `main` but were not changed by `main` since the merge base, so they merge cleanly
  (application branch wins).

## 4. Pre-merge checklist

- [ ] Owner decides on the portfolio/contact restore (step 1).
- [ ] Reliability work from `docs/operations/production-readiness.md` is green on this branch.
- [ ] Admin-account decision recorded (`docs/operations/security-review.md` §7).
- [ ] A current backup of `DATA_DIR`/`MEDIA_DIR` exists before the deployed branch changes
      (`docs/operations/backup-and-recovery.md`) — merging changes code, not data, but this is the
      natural moment for a set.
- [ ] PR title follows the repository convention (`chore`/`feat`, conventional commits).
