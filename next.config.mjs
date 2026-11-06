/** @type {import('next').NextConfig} */
const r2PublicBaseUrl =
  process.env.NEXT_PUBLIC_B2_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_B2_PUBLIC_URL ||
  process.env.B2_PUBLIC_BASE_URL ||
  process.env.B2_PUBLIC_URL ||
  process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL ||
  process.env.R2_PUBLIC_BASE_URL ||
  process.env.R2_PUBLIC_URL ||
  "";
const r2RemotePatterns = (() => {
  if (!r2PublicBaseUrl) return [];
  try {
    const url = new URL(r2PublicBaseUrl);
    const basePath = url.pathname.replace(/\/+$/, "");
    return [{
      protocol: url.protocol.replace(":", ""),
      hostname: url.hostname,
      port: url.port,
      pathname: `${basePath || ""}/**`,
    }];
  } catch {
    return [];
  }
})();

/**
 * Optional offload of the heavy /downloads assets to object storage.
 *
 * public/downloads holds ~103 MB of installers, and the largest is 34 MB, so
 * every plugin download is 34 MB of egress from whichever host serves the app.
 * Setting STATIC_CDN_BASE_URL (a Backblaze B2 or Cloudflare public base URL)
 * redirects those paths to storage instead, while the URLs the site and the
 * plugin updater already use — /downloads/SaadStudio-Setup.exe and friends in
 * lib/admin/plugin-control-plane.ts — keep working unchanged.
 *
 * Leaving the variable unset changes nothing: the files continue to be served
 * from public/. Next.js evaluates redirects before the filesystem, so when it
 * is set the redirect wins over the local file and the file can then be removed
 * from the repository in a separate, deliberate commit.
 *
 * Deliberately a temporary (307) redirect, not a permanent one: browsers cache
 * a 301 indefinitely, which would make unsetting the variable ineffective and
 * leave no way back if the bucket URL turns out to be wrong.
 *
 * See deploy/upload-static-to-b2.sh for the upload side.
 */
function staticOffloadRedirects() {
  const base = process.env.STATIC_CDN_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return [];
  return [
    {
      source: "/downloads/:file*",
      destination: `${base}/downloads/:file*`,
      permanent: false,
    },
  ];
}

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

const nextConfig = {
  output: process.env.NEXT_OUTPUT_MODE === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  compress: true,
  experimental: {
    serverComponentsExternalPackages: ["sharp", "fluent-ffmpeg", "@ffmpeg-installer/ffmpeg", "ffmpeg-static"],
    serverActions: {
      bodySizeLimit: "10mb",
    },
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
    ],
    outputFileTracingExcludes: {
      '*': [
        'public/img/beauty-tools/**/*',
        'public/landing/**/*',
        'public/uploads/**/*',
        'public/preset/**/*',
        'public/explore/**/*',
        'public/transitions/**/*',
        'public/downloads/**/*',
        'adobe/**/*',
      ],
    },
    outputFileTracingIncludes: {
      '/api/video-extend/stitch': [
        'node_modules/@ffmpeg-installer/**/*',
        'node_modules/ffmpeg-static/**/*',
      ],
      '/api/video-extend/last-frame': [
        'node_modules/@ffmpeg-installer/**/*',
        'node_modules/ffmpeg-static/**/*',
      ],
      '/api/transitions/stitch': [
        'node_modules/@ffmpeg-installer/**/*',
        'node_modules/ffmpeg-static/**/*',
      ],
      '/api/studio/export': [
        'node_modules/fluent-ffmpeg/**/*',
        'node_modules/@ffmpeg-installer/**/*',
        'node_modules/ffmpeg-static/**/*',
      ],
    },
  },
  eslint: {
    // ESLint errors will not fail the production build — warnings only
    ignoreDuringBuilds: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
    deviceSizes: [640, 960, 1280, 1920],
    imageSizes: [64, 128, 256, 384, 512],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "f003.backblazeb2.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "saadstudio-storage.s3.eu-central-003.backblazeb2.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "oaidalleapiprodscus.blob.core.windows.net",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "tempfile.aiquickdraw.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "tempfileb.aiquickdraw.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "static.aiquickdraw.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "img.clerk.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.clerk.dev",
        port: "",
        pathname: "/**",
      },
      ...r2RemotePatterns,
      {
        protocol: "https",
        hostname: "*.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "d2h7xmz5gqybh9.cloudfront.net",
        port: "",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: process.env.NODE_ENV === "production"
              ? "public, max-age=31536000, immutable"
              : "no-store, must-revalidate",
          },
        ],
      },
      {
        source: "/:path*.:ext(ico|png|jpg|jpeg|gif|webp|avif|svg|woff|woff2|ttf|otf|eot|mp4|webm|mp3|wav)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/explore",
        permanent: false,
      },
      {
        source: "/dash",
        destination: "/explore",
        permanent: true,
      },
      {
        source: "/apps/tool/storyboard-studio",
        destination: "/storyboard",
        permanent: true,
      },
      {
        source: "/original-series",
        destination: "/canvas",
        permanent: true,
      },
      ...staticOffloadRedirects(),
    ];
  },
};

export default nextConfig;
