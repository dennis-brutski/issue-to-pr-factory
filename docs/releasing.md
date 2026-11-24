# Releasing

## Versions

Releases are git tags (`v0.1.0`, `v0.2.0`, …) with GitHub release notes. Versions follow [semantic versioning](https://semver.org/), still 0.x:

- A minor bump (0.2 → 0.3) may need users to change something.
- A patch bump (0.2.0 → 0.2.1) never does.

"Something" means anything a user's setup depends on: fields in `local.mjs` and target files, labels, command-line options, what agents may do.

## How to release

The owner runs this on a clean `main`:

```sh
npm version minor -m "Release %s"     # or patch; bumps package.json, commits, tags
git push --follow-tags
gh release create v0.2.0 --generate-notes
```

Put any change users must act on at the top of the release notes, with what to do.

## Which release built a pull request

Pull requests name the release that built them: the output of `git describe --tags --always --dirty` in the factory checkout. On a tag that is `v0.2.0`; after it, `v0.2.0-3-g268a2d9`; with local changes, a `-dirty` suffix. The start line shows the same version.
