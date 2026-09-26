import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'Quark', short_name: 'Quark', description: 'The Monad task marketplace', start_url: '/', display: 'standalone', background_color: '#f7f8fa', theme_color: '#166d56', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] };
}
