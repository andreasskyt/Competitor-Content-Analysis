/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@distube/ytdl-core"],
  },
};

module.exports = nextConfig;
