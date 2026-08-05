import fs from 'node:fs'
import path from 'node:path'

const SOURCE_DIRS = [path.resolve('src/lib/components'), path.resolve('src/routes')]
const SOURCE_EXTENSIONS = new Set(['.svelte'])

// Patterns that break in light mode: hardcoded white/black with opacity.
// Full `text-white` is handled by CSS overrides in app.css, but opacity
// variants like `text-white/30` or `bg-white/[0.04]` are not.
//
// Allowed exceptions:
//   - `bg-white` (solid, used for toggle knobs etc.)
//   - `text-white` without opacity (caught by CSS override)
//   - `hover:text-white` without opacity (caught by CSS override)
//   - `group-hover:text-white` without opacity (caught by CSS override)
//   - Classes inside theme-protected contexts (bg-os-orange, bg-os-purple buttons)
//     are handled by CSS override; authors still shouldn't use opacity variants there.
const BANNED_PATTERNS = [
  // white with opacity — text, bg, border, ring, shadow, divide
  /\b(?:text|bg|border|ring|shadow|divide|from|to|via|outline|decoration|accent|caret|fill|stroke)-white\/[\d[]/,
  // hover/focus/group variants with white opacity
  /\b(?:hover|focus|group-hover|focus-within|active|peer-hover):(?:text|bg|border|ring)-white\/[\d[]/,
  // Raw rgba(255,255,255,...) in style blocks or inline styles (but not opacity 1)
  /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.\d/,
]

// Lines matching these are exempt (contextual exceptions).
const EXEMPT_PATTERNS = [
  /eslint-disable.*hardcoded-color/,
  /theme-safe/,
]

function walkFiles(directory, callback) {
  if (!fs.existsSync(directory)) return

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      walkFiles(entryPath, callback)
      continue
    }

    if (entry.isFile()) callback(entryPath)
  }
}

function checkFile(filePath, errors) {
  const contents = fs.readFileSync(filePath, 'utf8')
  const lines = contents.split('\n')
  const relative = path.relative(process.cwd(), filePath)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (EXEMPT_PATTERNS.some((pattern) => pattern.test(line))) continue

    for (const pattern of BANNED_PATTERNS) {
      const match = line.match(pattern)
      if (!match) continue

      errors.push(`${relative}:${i + 1}  ${match[0]}`)
      break
    }
  }
}

function main() {
  const errors = []
  const explicitFiles = process.argv.slice(2)

  if (explicitFiles.length > 0) {
    for (const filePath of explicitFiles) {
      if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) continue
      if (!fs.existsSync(filePath)) continue
      checkFile(path.resolve(filePath), errors)
    }
  } else {
    for (const directory of SOURCE_DIRS) {
      walkFiles(directory, (filePath) => {
        if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) return
        checkFile(filePath, errors)
      })
    }
  }

  if (errors.length > 0) {
    console.error('Hardcoded color check failed — use theme tokens instead of white/black opacity variants.\n')
    for (const error of errors) {
      console.error(`  ${error}`)
    }
    console.error(
      '\nReplace with theme tokens: text-os-text, bg-os-border, border-os-border, etc.',
    )
    console.error('Add /* theme-safe */ comment to exempt intentional usage.')
    process.exit(1)
  }

  console.log('Hardcoded color check passed.')
}

main()
