# 06-modified-legacy-loader-refusal

Recognizable but modified legacy loader mixed with unrelated code; installer must refuse to rewrite firefox.cfg.

Expected installer exit code: `1`.

The current installer detects this after copying the protected script and updating autoconfig.js; the important assertion is that the ambiguous firefox.cfg remains untouched and a backup exists.

Use the root-level `Run-TestScenario.ps1` harness to stage and validate this fixture.
