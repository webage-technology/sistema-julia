/** @type {import('next').NextConfig} */
// O frontend chama a API na MESMA origem (/api/*); este rewrite encaminha para o
// backend Express. Em Docker o destino é o serviço `backend`; localmente pode
// sobrescrever com BACKEND_URL.
const BACKEND = process.env.BACKEND_URL || 'http://backend:4700'

module.exports = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND}/api/:path*` }]
  },
}
