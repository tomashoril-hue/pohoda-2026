import type { MetadataRoute } from 'next'

const pohodaPurple = '#7417e8'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'POHODA Pass',
    short_name: 'POHODA',
    description: 'Stravovací systém POHODA 2026',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: pohodaPurple,
    theme_color: pohodaPurple,
    icons: [
      {
        src: '/pwa-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/pwa-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      }
    ]
  }
}
