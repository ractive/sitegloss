The sync of Sitegloss 0.3.0 as it shipped (tag `v0.3.0`, commit 3e8b1ea): the
engine, its wire and case modules and their dependencies, copied unchanged. Kept
for two questions: does a 0.3.0 browser on the same team as this build keep
working, and does this build go on from what a 0.3.0 browser stored
(`test/compat-0-3-0.test.ts`, DEC-046, DEC-051)? Its store is also what writes
the old database in `test/e2e/store.test.ts`. Never edited: it keeps the names
0.3.0 had (its marks are `annotations` in the format `sitegloss/1`, which this
build no longer reads from a file).
