const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: 512,
      height: 512,
      show: false,
      transparent: true,
      frame: false,
      webPreferences: {
        offscreen: true,
      },
    });

    const svgPath = path.join(__dirname, '../public/acuity-logo.svg');
    const svgContent = fs.readFileSync(svgPath, 'utf8');

    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 512px; height: 512px; background: transparent; overflow: hidden; }
    svg { width: 512px; height: 512px; display: block; }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`;

    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 250));

    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
    
    // Scale down to 256x256 with high quality
    const resized256 = image.resize({ width: 256, height: 256, quality: 'best' });
    const pngBuffer = resized256.toPNG();

    const publicIconPng = path.join(__dirname, '../public/icon.png');
    const resourcesIconPng = path.join(__dirname, '../resources/icon.png');

    fs.writeFileSync(publicIconPng, pngBuffer);
    fs.writeFileSync(resourcesIconPng, pngBuffer);
    console.log('✓ Written public/icon.png and resources/icon.png (256x256)');

    // Generate multi-size ICO using Python PIL
    const pythonScript = `
import sys
from PIL import Image

png_path = r'${publicIconPng}'
ico_public = r'${path.join(__dirname, '../public/icon.ico')}'
ico_resources = r'${path.join(__dirname, '../resources/icon.ico')}'

img = Image.open(png_path)
sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
img.save(ico_public, format='ICO', sizes=sizes)
img.save(ico_resources, format='ICO', sizes=sizes)
print('[OK] Written public/icon.ico and resources/icon.ico')
`;

    execSync('python -', { input: pythonScript, stdio: ['pipe', 'inherit', 'inherit'] });
    console.log('✓ All application icons successfully generated from acuity-logo.svg!');
  } catch (err) {
    console.error('Error generating icons:', err);
    process.exit(1);
  } finally {
    app.quit();
  }
});
