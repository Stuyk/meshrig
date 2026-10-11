// Renders build/icon.svg to the PNG icons the app and installers use.
// Run with: npm run icons
import { app, BrowserWindow } from 'electron'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync } from 'fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf-8')
const SIZE = 1024

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    useContentSize: true,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('width="100%" height="100%"', `width="${SIZE}" height="${SIZE}"`)}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  const out = [
    [join(root, 'build', 'icon.png'), 1024],
    [join(root, 'resources', 'icon.png'), 512],
    [join(root, 'src', 'renderer', 'assets', 'app-icon.png'), 256],
    [join(root, 'docs', 'icon.png'), 256]
  ]
  for (const [path, size] of out) {
    writeFileSync(path, image.resize({ width: size, height: size, quality: 'best' }).toPNG())
    console.log('Wrote', path)
  }
  app.quit()
})
