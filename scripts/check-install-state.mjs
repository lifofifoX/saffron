import { execFileSync, spawnSync } from 'node:child_process'

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

const changes = git('status', '--short', '--untracked-files=all')
if (changes) {
  console.error('Dependency installation changed the repository:')
  console.error(changes)
  process.exit(1)
}

const blameConfig = spawnSync('git', ['config', '--local', '--get', 'blame.ignoreRevsFile'], {
  encoding: 'utf8',
})
if (blameConfig.status === 0) {
  console.error(
    `Dependency installation changed blame.ignoreRevsFile to ${blameConfig.stdout.trim()}`,
  )
  process.exit(1)
}
if (blameConfig.status !== 1) {
  console.error(blameConfig.stderr.trim() || 'Unable to inspect repository-local Git config')
  process.exit(1)
}

console.log('Dependency installation left the repository and local Git config unchanged.')
