/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Saved proposals carry the creator's logo as a data URL inside the
    // document; the 1 MB default would reject a proposal with a large logo.
    serverActions: { bodySizeLimit: "4mb" },
  },
};
export default nextConfig;
