Claim and work on the highest-priority agent task.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


1. Check for in-flight work: `./hey work current`
   - Resume → cd into workspace, skip to step 5
   - Abandon → `./hey work fail --task <id> --reason "..."`
2. Rebuild index: `./hey index build`
3. Claim top task: `./hey work claim --next` (stop if none)
4. cd into workspace from output
5. Execute per prompt and definition of done
6. Commit each logical change as you go:
   - Use imperative mood commit messages matching the repo style
   - Stage only the relevant files per commit (no `git add -A`)
7. Done → `./hey work complete --task <id>`
8. Failed → `./hey work fail --task <id> --reason "..."`
9. Push all commits to remote:

   ```bash
   git push origin main
   ```
