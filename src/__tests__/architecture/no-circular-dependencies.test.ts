import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

describe('Circular dependencies', () => {
  it('keeps the tsconfig-aware source graph cycle-free', () => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        'x',
        'madge',
        '--circular',
        '--ts-config',
        'tsconfig.json',
        '--extensions',
        'ts,tsx',
        'src',
        'server',
      ],
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const output = `${decode(result.stdout)}${decode(result.stderr)}`
    if (result.exitCode !== 0) {
      throw new Error(
        `Circular dependencies found. Run the same command locally for the full graph:\n` +
          `bun x madge --circular --ts-config tsconfig.json --extensions ts,tsx src server\n\n` +
          output,
      )
    }

    expect(output).toContain('No circular dependency found')
    // 30s budget: madge over the full src+server graph (now 2488 files after the
    // web-capture tool's core/ + adapters/ + captureTool.ts were added) routinely
    // exceeds 15s on GitHub Actions' smaller runners. The graph itself is still
    // cycle-free — bump the budget rather than skipping the gate.
  }, 30000)
})
