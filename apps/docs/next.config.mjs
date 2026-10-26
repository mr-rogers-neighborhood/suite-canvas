/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
