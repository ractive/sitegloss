The sync of Sitegloss 0.3.0 as it shipped (tag `v0.3.0`, commit 3e8b1ea): the
engine, its wire and case modules and their dependencies, copied unchanged. Kept
for two questions: does a 0.3.0 browser on the same team as this build keep
working, and does a 0.3.0 browser updated to this build, its cases emptied,
send nothing and read the team's cases again (`test/compat-0-3-0.test.ts`,
DEC-046, DEC-051)? Its store is also what writes the old database in
`test/e2e/store.test.ts`. Never edited: it keeps the names 0.3.0 had (its marks
are `annotations` with ids `a<number>` in the format `sitegloss/1`, which this
build does not read).
