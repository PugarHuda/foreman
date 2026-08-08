import { Config } from "@remotion/cli/config";

/**
 * The narration and the product screenshots both live under video/public, so
 * staticFile() resolves against it rather than the Next app's public/ — which
 * holds brand assets that have nothing to do with the render.
 */
Config.setPublicDir("video/public");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
