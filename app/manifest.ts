import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'POHODA PASS',
    short_name: 'POHODA PASS',
    description: 'Stravovaci system POHODA 2026',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#7417e8',
    theme_color: '#56db3f',
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
