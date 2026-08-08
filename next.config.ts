import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets the Cloudflare quick tunnel (which changes on every restart) reach dev
  // assets/HMR. *.trycloudflare.com covers whatever hostname gets assigned.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
