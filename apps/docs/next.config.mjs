/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The container copies `.next/standalone` and runs `node apps/docs/server.js`.
  output: "standalone",
  async rewrites() {
    return [
      {
        // `/docs/getting-started.md` is the Markdown an agent asks for; the
        // route reads the file and serves `text/markdown`.
        source: "/docs/:slug*.md",
        destination: "/llms.mdx/docs/:slug*/content.md",
      },
    ];
  },
};

export default nextConfig;
