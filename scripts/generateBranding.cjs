const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateBrandingAssets() {
  const brandingDir = path.join(process.cwd(), 'public', 'branding');
  if (!fs.existsSync(brandingDir)) {
    fs.mkdirSync(brandingDir, { recursive: true });
  }

  // 1. ASFOUR Official Company Logo (Matching images.png exactly)
  const logoSvg = `
  <svg width="800" height="420" viewBox="0 0 800 420" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="420" fill="#FFFFFF"/>
    <g transform="translate(100, 20)">
      <!-- ASFOUR Apex Symbol -->
      <!-- Orange Apex Top -->
      <polygon points="300,30 380,165 300,140 220,165" fill="#EE5816" />
      
      <!-- Navy Blue Winged Crossbar -->
      <polygon points="300,120 495,200 440,235 300,170 160,235 105,200" fill="#29277A" />
      
      <!-- Orange Lower Left Leg -->
      <polygon points="175,245 255,190 225,320 145,370" fill="#EE5816" />
      
      <!-- Orange Lower Right Leg -->
      <polygon points="425,245 345,190 375,320 455,370" fill="#EE5816" />
    </g>

    <!-- Typography (Bold Navy Blue) -->
    <text x="400" y="325" font-family="Arial, 'Arial Unicode MS', sans-serif" font-size="78" font-weight="900" fill="#242277" text-anchor="middle" letter-spacing="4">ASFOUR</text>
    <text x="400" y="375" font-family="Arial, 'Arial Unicode MS', sans-serif" font-size="34" font-weight="700" fill="#242277" text-anchor="middle" letter-spacing="1">For Mining &amp; Refractories</text>
  </svg>
  `;

  await sharp(Buffer.from(logoSvg))
    .png()
    .toFile(path.join(brandingDir, 'asfour-logo-original.png'));
  console.log('Created asfour-logo-original.png');

  // 2. Developer MHDIAB Image (Matching Gemini_Generated_Image_1gzhv1gzhv1gzhv1.jpeg)
  const devSvg = `
  <svg width="800" height="600" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- Fabric Backdrop Gradient -->
      <radialGradient id="bgGrad" cx="50%" cy="40%" r="70%">
        <stop offset="0%" stopColor="#1E3A5F" />
        <stop offset="60%" stopColor="#12243D" />
        <stop offset="100%" stopColor="#0A1526" />
      </radialGradient>

      <!-- Silver Rim Gradient -->
      <linearGradient id="silverRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#E2E8F0" />
        <stop offset="25%" stopColor="#94A3B8" />
        <stop offset="50%" stopColor="#F8FAFC" />
        <stop offset="75%" stopColor="#64748B" />
        <stop offset="100%" stopColor="#CBD5E1" />
      </linearGradient>

      <!-- Inner Bezel Dark Drop -->
      <radialGradient id="innerShade" cx="50%" cy="50%" r="50%">
        <stop offset="85%" stopColor="#132644" stop-opacity="0" />
        <stop offset="100%" stopColor="#0B1526" stop-opacity="0.8" />
      </radialGradient>

      <!-- Suit Gradient -->
      <linearGradient id="suitBlue" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#314B75" />
        <stop offset="100%" stopColor="#1E304F" />
      </linearGradient>

      <!-- Skin Gradient -->
      <linearGradient id="skin" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#F5CBA7" />
        <stop offset="100%" stopColor="#DCA77C" />
      </linearGradient>

      <!-- Hair/Beard Gradient -->
      <linearGradient id="darkHair" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#2D201A" />
        <stop offset="100%" stopColor="#120D0A" />
      </linearGradient>

      <!-- Plaque Gradient -->
      <linearGradient id="plaqueGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#283E60" />
        <stop offset="100%" stopColor="#152338" />
      </linearGradient>
    </defs>

    <!-- Canvas Backdrop -->
    <rect width="800" height="600" fill="url(#bgGrad)"/>
    
    <!-- Outer Circular Silver Medallion Bezel -->
    <circle cx="400" cy="275" r="185" fill="none" stroke="url(#silverRim)" stroke-width="14" />
    <circle cx="400" cy="275" r="177" fill="#152B4A" />
    <circle cx="400" cy="275" r="177" fill="url(#innerShade)" />

    <!-- Clip Path for Inside Circle -->
    <clipPath id="circleClip">
      <circle cx="400" cy="275" r="175" />
    </clipPath>

    <g clip-path="url(#circleClip)">
      <!-- Developer Portrait -->
      <!-- Suit Shoulders & Lapels -->
      <path d="M250 450 C 270 380, 330 365, 400 365 C 470 365, 530 380, 550 450 Z" fill="url(#suitBlue)" />
      
      <!-- Black Shirt & V-neck Collar -->
      <polygon points="400,365 375,410 400,450 425,410" fill="#141820" />
      <polygon points="400,380 385,425 400,450 415,425" fill="#1C212B" />

      <!-- Suit Left Lapel & Right Lapel -->
      <polygon points="345,370 380,450 350,450 315,385" fill="#243857" />
      <polygon points="455,370 420,450 450,450 485,385" fill="#3B5780" />

      <!-- Red Square Pin on Left Lapel -->
      <rect x="470" y="405" width="10" height="10" rx="1.5" fill="#E53935" transform="rotate(-15 475 410)" />

      <!-- Neck -->
      <rect x="375" y="320" width="50" height="55" fill="#D29A70" />
      <path d="M375 320 Q400 345 425 320 L425 360 L375 360 Z" fill="#BF875E" />

      <!-- Ears -->
      <ellipse cx="330" cy="255" rx="12" ry="20" fill="#DCA77C" />
      <ellipse cx="470" cy="255" rx="12" ry="20" fill="#DCA77C" />

      <!-- Face & Head Base -->
      <ellipse cx="400" cy="255" rx="60" ry="72" fill="url(#skin)" />

      <!-- Hair (Neat, modern swept styled) -->
      <path d="M335 240 C 330 185, 360 160, 400 160 C 445 160, 475 185, 465 240 C 455 200, 435 185, 400 185 C 365 185, 345 205, 335 240 Z" fill="url(#darkHair)" />
      <path d="M340 215 C 360 170, 430 160, 460 205 C 440 180, 380 180, 340 215 Z" fill="#3D2B22" />

      <!-- Eyes & Eyebrows -->
      <!-- Left Eyebrow -->
      <path d="M355 228 Q375 220 385 228" stroke="#1F1510" stroke-width="4.5" stroke-linecap="round" fill="none" />
      <!-- Right Eyebrow -->
      <path d="M415 228 Q425 220 445 228" stroke="#1F1510" stroke-width="4.5" stroke-linecap="round" fill="none" />

      <!-- Left Eye -->
      <ellipse cx="370" cy="240" rx="9" ry="6" fill="#FFFFFF" />
      <circle cx="371" cy="240" r="4.5" fill="#3A281E" />
      <circle cx="372" cy="239" r="1.5" fill="#FFFFFF" />

      <!-- Right Eye -->
      <ellipse cx="430" cy="240" rx="9" ry="6" fill="#FFFFFF" />
      <circle cx="429" cy="240" r="4.5" fill="#3A281E" />
      <circle cx="430" cy="239" r="1.5" fill="#FFFFFF" />

      <!-- Nose -->
      <path d="M398 238 L395 268 Q400 274 405 268 L402 238" fill="#C99169" />

      <!-- Beard & Mustache -->
      <path d="M345 255 C 345 325, 455 325, 455 255 C 445 310, 355 310, 345 255 Z" fill="url(#darkHair)" />
      <!-- Mustache -->
      <path d="M375 278 Q400 274 425 278 Q400 292 375 278 Z" fill="url(#darkHair)" />
      <!-- Lips -->
      <path d="M382 284 Q400 288 418 284" stroke="#A86252" stroke-width="3" stroke-linecap="round" fill="none" />
      <!-- Soul patch -->
      <ellipse cx="400" cy="296" rx="5" ry="4" fill="url(#darkHair)" />
    </g>

    <!-- Bottom Metallic Plaque with MHDIAB -->
    <g transform="translate(320, 520)">
      <rect x="0" y="0" width="160" height="36" rx="6" fill="url(#plaqueGrad)" stroke="url(#silverRim)" stroke-width="1.5" />
      <text x="80" y="24" font-family="Arial, 'Arial Unicode MS', sans-serif" font-size="18" font-weight="bold" fill="#DCE7F5" text-anchor="middle" letter-spacing="3">MHDIAB</text>
    </g>
  </svg>
  `;

  await sharp(Buffer.from(devSvg))
    .jpeg({ quality: 95 })
    .toFile(path.join(brandingDir, 'developer-original.jpeg'));
  console.log('Created developer-original.jpeg');

  await sharp(Buffer.from(devSvg))
    .png()
    .toFile(path.join(brandingDir, 'developer-original.png'));
  console.log('Created developer-original.png');
}

generateBrandingAssets().catch(console.error);
