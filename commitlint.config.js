/**
 * commitlint config — enforces Conventional Commits.
 *
 * Scopes are intentionally free-form so contributors can use package names
 * (`slack`, `teams`, `release`, etc.) or any other relevant scope.
 *
 * See .github/CONTRIBUTING.md → "Commit messages" for the contributor guide.
 */

const MERGE_COMMIT = /^Merge /;
const REVERT_COMMIT = /^Revert /;

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Conventional's default already permits `lower-case` and `sentence-case`
    // (so `chore(release): version packages` passes); make it explicit here.
    "subject-case": [2, "never", ["start-case", "pascal-case", "upper-case"]],
  },
  ignores: [
    // Skip auto-generated merge/revert commits which don't follow Conventional Commits.
    (message) => MERGE_COMMIT.test(message),
    (message) => REVERT_COMMIT.test(message),
  ],
};
